import os
import threading
import time
import uuid
from pathlib import Path
from typing import Literal

import torch
from diffusers import WanPipeline
from diffusers.utils import export_to_video
from fastapi import BackgroundTasks, FastAPI, Header, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

app = FastAPI(title='AI Video Wan GPU Worker', version='1.0.0')

TOKEN = os.getenv('GPU_WORKER_TOKEN', '').strip()
PUBLIC_URL = os.getenv('GPU_WORKER_PUBLIC_URL', '').strip().rstrip('/')
MODEL_ID = os.getenv(
    'WAN_MODEL_ID',
    'Wan-AI/Wan2.1-T2V-1.3B-Diffusers',
).strip()
OUTPUT_DIR = Path(os.getenv('VIDEO_OUTPUT_DIR', '/data/outputs')).resolve()
CPU_OFFLOAD = os.getenv('WAN_CPU_OFFLOAD', 'true').strip().lower() in {
    '1',
    'true',
    'yes',
}
DEFAULT_FRAMES = int(os.getenv('WAN_NUM_FRAMES', '81'))
DEFAULT_FPS = int(os.getenv('WAN_FPS', '16'))
DEFAULT_STEPS = int(os.getenv('WAN_STEPS', '30'))
DEFAULT_GUIDANCE = float(os.getenv('WAN_GUIDANCE_SCALE', '5.0'))
DEFAULT_SEED = int(os.getenv('WAN_SEED', '42'))

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

jobs: dict[str, dict] = {}
jobs_lock = threading.Lock()
pipeline_lock = threading.Lock()
generation_lock = threading.Lock()
pipeline: WanPipeline | None = None


class RenderJob(BaseModel):
    project_id: str = Field(min_length=1, max_length=120)
    audio_url: str = ''
    reference_urls: list[str] = Field(default_factory=list, max_length=8)
    brief: str = Field(min_length=1, max_length=4000)
    aspect_ratio: Literal['16:9', '9:16', '1:1'] = '16:9'


def auth(authorization: str | None):
    if not TOKEN:
        raise HTTPException(
            status_code=503,
            detail='GPU_WORKER_TOKEN is not configured.',
        )
    if authorization != f'Bearer {TOKEN}':
        raise HTTPException(status_code=401, detail='Unauthorized')


def generation_ready() -> bool:
    return bool(torch.cuda.is_available() and PUBLIC_URL and TOKEN)


def dimensions(aspect_ratio: str) -> tuple[int, int]:
    if aspect_ratio == '9:16':
        return 480, 832
    if aspect_ratio == '1:1':
        return 512, 512
    return 832, 480


def get_pipeline() -> WanPipeline:
    global pipeline
    if pipeline is not None:
        return pipeline

    with pipeline_lock:
        if pipeline is not None:
            return pipeline
        if not torch.cuda.is_available():
            raise RuntimeError('CUDA GPU is required for this Wan worker.')

        loaded = WanPipeline.from_pretrained(
            MODEL_ID,
            torch_dtype=torch.bfloat16,
        )

        if CPU_OFFLOAD:
            loaded.enable_model_cpu_offload()
        else:
            loaded.to('cuda')

        pipeline = loaded
        return pipeline


def update_job(job_id: str, **changes):
    with jobs_lock:
        if job_id in jobs:
            jobs[job_id].update(changes)
            jobs[job_id]['updatedAt'] = time.time()


def generate(job_id: str, request: RenderJob):
    update_job(job_id, status='working')
    try:
        pipe = get_pipeline()
        width, height = dimensions(request.aspect_ratio)
        seed = DEFAULT_SEED
        generator = torch.Generator(device='cpu').manual_seed(seed)
        filename = f'{job_id}.mp4'
        output_path = OUTPUT_DIR / filename

        with generation_lock:
            result = pipe(
                prompt=request.brief,
                height=height,
                width=width,
                num_frames=max(17, min(DEFAULT_FRAMES, 129)),
                num_inference_steps=max(4, min(DEFAULT_STEPS, 80)),
                guidance_scale=max(1.0, min(DEFAULT_GUIDANCE, 20.0)),
                generator=generator,
            )

            frames = result.frames[0]
            export_to_video(
                frames,
                str(output_path),
                fps=max(8, min(DEFAULT_FPS, 30)),
            )

        if not output_path.is_file() or output_path.stat().st_size == 0:
            raise RuntimeError('Wan generation completed without an output file.')

        update_job(
            job_id,
            status='succeeded',
            outputUrls=[f'{PUBLIC_URL}/outputs/{filename}'],
            metadata={
                'model': MODEL_ID,
                'width': width,
                'height': height,
                'numFrames': max(17, min(DEFAULT_FRAMES, 129)),
                'fps': max(8, min(DEFAULT_FPS, 30)),
                'seed': seed,
            },
        )
    except Exception as exc:
        update_job(job_id, status='failed', error=str(exc)[:4000])
    finally:
        if torch.cuda.is_available():
            torch.cuda.empty_cache()


def enqueue(job: RenderJob, background_tasks: BackgroundTasks):
    if not generation_ready():
        raise HTTPException(
            status_code=503,
            detail=(
                'Wan worker is not generation-ready. Configure CUDA, '
                'GPU_WORKER_TOKEN and GPU_WORKER_PUBLIC_URL.'
            ),
        )

    job_id = f'wan_{uuid.uuid4().hex}'
    now = time.time()
    with jobs_lock:
        jobs[job_id] = {
            'jobId': job_id,
            'projectId': job.project_id,
            'status': 'queued',
            'outputUrls': [],
            'error': None,
            'model': MODEL_ID,
            'createdAt': now,
            'updatedAt': now,
        }

    background_tasks.add_task(generate, job_id, job)

    return {
        'accepted': True,
        'jobId': job_id,
        'projectId': job.project_id,
        'status': 'queued',
        'model': MODEL_ID,
        'statusUrl': f'/jobs/{job_id}',
    }


@app.get('/health')
def health():
    return {
        'ok': True,
        'gpuWorker': True,
        'backend': 'wan-diffusers',
        'model': MODEL_ID,
        'cudaAvailable': torch.cuda.is_available(),
        'modelLoaded': pipeline is not None,
        'generationReady': generation_ready(),
        'detail': (
            'Wan worker is ready.'
            if generation_ready()
            else 'Configure a CUDA GPU, GPU_WORKER_TOKEN and GPU_WORKER_PUBLIC_URL.'
        ),
    }


@app.post('/jobs', status_code=202)
def create_job(
    job: RenderJob,
    background_tasks: BackgroundTasks,
    authorization: str | None = Header(default=None),
):
    auth(authorization)
    return enqueue(job, background_tasks)


@app.post('/generate-video', status_code=202)
def generate_video(
    job: RenderJob,
    background_tasks: BackgroundTasks,
    authorization: str | None = Header(default=None),
):
    auth(authorization)
    return enqueue(job, background_tasks)


@app.get('/jobs/{job_id}')
def get_job(job_id: str, authorization: str | None = Header(default=None)):
    auth(authorization)
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail='Job not found')
        return dict(job)


@app.get('/outputs/{filename}')
def get_output(filename: str, authorization: str | None = Header(default=None)):
    auth(authorization)

    if Path(filename).name != filename:
        raise HTTPException(status_code=400, detail='Invalid filename')

    path = (OUTPUT_DIR / filename).resolve()
    if path.parent != OUTPUT_DIR or not path.is_file():
        raise HTTPException(status_code=404, detail='Output not found')

    return FileResponse(
        path,
        media_type='video/mp4',
        filename=filename,
        headers={'Cache-Control': 'private, no-store'},
    )
