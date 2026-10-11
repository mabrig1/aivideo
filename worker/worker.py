import json
import os
import subprocess
import threading
import time
import uuid
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, Header, HTTPException
from pydantic import BaseModel

app = FastAPI(title='Mabrig Verse GPU Worker', version='0.2.0')

TOKEN = os.getenv('GPU_WORKER_TOKEN', '')
GENERATION_EXECUTABLE = os.getenv('VIDEO_GENERATION_EXECUTABLE', '').strip()
GENERATION_TIMEOUT_SECONDS = int(os.getenv('VIDEO_GENERATION_TIMEOUT_SECONDS', '900'))

jobs: dict[str, dict] = {}
jobs_lock = threading.Lock()


class RenderJob(BaseModel):
    project_id: str
    audio_url: str = ''
    reference_urls: list[str] = []
    brief: str
    aspect_ratio: str = '16:9'
    engine: str = 'wan'
    source_image_url: str = ''
    source_video_url: str = ''


def auth(authorization: str | None):
    if TOKEN and authorization != f'Bearer {TOKEN}':
        raise HTTPException(status_code=401, detail='Unauthorized')


def generation_ready() -> bool:
    if not GENERATION_EXECUTABLE:
        return False
    path = Path(GENERATION_EXECUTABLE)
    return path.is_file() and os.access(path, os.X_OK)


def update_job(job_id: str, **changes):
    with jobs_lock:
        if job_id in jobs:
            jobs[job_id].update(changes)
            jobs[job_id]['updatedAt'] = time.time()


def run_generation(job_id: str, payload: dict):
    update_job(job_id, status='working')
    try:
        completed = subprocess.run(
            [GENERATION_EXECUTABLE],
            input=json.dumps(payload),
            text=True,
            capture_output=True,
            timeout=GENERATION_TIMEOUT_SECONDS,
            check=False,
        )

        if completed.returncode != 0:
            update_job(
                job_id,
                status='failed',
                error=(completed.stderr or completed.stdout or 'Generation executable failed')[:4000],
            )
            return

        try:
            result = json.loads(completed.stdout or '{}')
        except json.JSONDecodeError:
            update_job(
                job_id,
                status='failed',
                error='Generation executable returned invalid JSON.',
            )
            return

        output_urls = result.get('outputUrls') or result.get('output_urls') or []
        if not isinstance(output_urls, list) or not output_urls:
            update_job(
                job_id,
                status='failed',
                error='Generation executable completed without outputUrls.',
            )
            return

        update_job(
            job_id,
            status='succeeded',
            outputUrls=[str(url) for url in output_urls[:20]],
        )
    except subprocess.TimeoutExpired:
        update_job(job_id, status='failed', error='Generation executable timed out.')
    except Exception as exc:
        update_job(job_id, status='failed', error=str(exc)[:4000])


@app.get('/health')
def health():
    try:
        ffmpeg = subprocess.check_output(
            ['ffmpeg', '-version'],
            text=True,
            timeout=5,
        ).splitlines()[0]
    except Exception:
        ffmpeg = 'unavailable'

    ready = generation_ready()
    return {
        'ok': True,
        'gpuWorker': True,
        'ffmpeg': ffmpeg,
        'generationReady': ready,
        'detail': (
            'Generation executable is configured and executable.'
            if ready
            else 'Worker is reachable, but VIDEO_GENERATION_EXECUTABLE is not configured to an executable adapter.'
        ),
    }


@app.post('/jobs')
def create_job(
    job: RenderJob,
    background_tasks: BackgroundTasks,
    authorization: str | None = Header(default=None),
):
    auth(authorization)

    if not generation_ready():
        raise HTTPException(
            status_code=503,
            detail='GPU worker has no generation executable configured.',
        )

    job_id = f'gpu_{uuid.uuid4().hex}'
    payload = job.model_dump()
    if payload['engine'] not in {'wan', 'musetalk'}:
        raise HTTPException(status_code=400, detail='Unsupported generation engine.')
    if payload['engine'] == 'musetalk' and not payload['audio_url']:
        raise HTTPException(status_code=400, detail='MuseTalk requires audio_url.')
    if payload['engine'] == 'musetalk' and not (payload['source_video_url'] or payload['source_image_url'] or payload['reference_urls']):
        raise HTTPException(status_code=400, detail='MuseTalk requires a presenter source.')

    with jobs_lock:
        jobs[job_id] = {
            'jobId': job_id,
            'projectId': job.project_id,
            'engine': job.engine,
            'status': 'queued',
            'outputUrls': [],
            'error': None,
            'createdAt': time.time(),
            'updatedAt': time.time(),
        }

    background_tasks.add_task(run_generation, job_id, payload)

    return {
        'accepted': True,
        'jobId': job_id,
        'projectId': job.project_id,
        'status': 'queued',
        'pipeline': (
            ['presenter-prepare', 'audio-analysis', 'musetalk-lip-sync', 'qc-repair', 'ffmpeg-master']
            if job.engine == 'musetalk'
            else [
            'audio-analysis',
            'storyboard',
            'shot-generation',
            'lip-sync',
            'qc-repair',
            'ffmpeg-master',
            ]
        ),
        'note': 'Job accepted by the operator-controlled generation executable.',
    }


@app.get('/jobs/{job_id}')
def get_job(job_id: str, authorization: str | None = Header(default=None)):
    auth(authorization)
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail='Job not found')
        return dict(job)
