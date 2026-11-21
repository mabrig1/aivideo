"""Private, authenticated Wan -> local FFmpeg scene handoff.

No arbitrary URLs, third-party billing, redirected fetches or automatic retries.
WAN_BRIDGE_ENABLED and a separately configured private GPU token are mandatory.
"""
import json
import os
import re
import subprocess
import time
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import (
    HTTPRedirectHandler,
    ProxyHandler,
    Request,
    build_opener,
)

MAX_WAN_CLIP_BYTES = 120 * 1024 * 1024
MAX_SHOTS = 4
JOB_ID_PATTERN = re.compile(r'^wan_[a-f0-9]{32}$')


class BridgeError(RuntimeError):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        raise BridgeError('GPU worker redirected an authenticated request')


def configured_worker():
    if os.getenv('WAN_BRIDGE_ENABLED') != 'true':
        raise BridgeError('Wan bridge is disabled (WAN_BRIDGE_ENABLED=false)')
    url = os.getenv('WAN_WORKER_URL', '').rstrip('/')
    token = os.getenv('GPU_WORKER_TOKEN', '').strip()
    parsed = urlsplit(url)
    if (parsed.scheme not in ('http', 'https') or not parsed.hostname or
            parsed.username or parsed.password or parsed.path or parsed.query or
            parsed.fragment or not 1 <= (parsed.port or 443) <= 65535):
        raise BridgeError('WAN_WORKER_URL must be a trusted worker origin')
    if len(token) < 32:
        raise BridgeError('A private GPU_WORKER_TOKEN (32+ characters) is required')
    if parsed.scheme == 'http' and parsed.hostname not in (
            'wan', '127.0.0.1', 'localhost'):
        raise BridgeError('Plain HTTP is restricted to local/private Docker WAN')
    return url, token


def private_request(origin, token, method, path, payload=None, stream_to=None):
    """Only paths fixed by this module. No external URLs or redirect follow."""
    if not path.startswith(('/health', '/jobs', '/outputs/')):
        raise BridgeError('Unexpected worker path')
    if not path.startswith('/') or '//' in path or '..' in path:
        raise BridgeError('Invalid GPU worker path')
    body = json.dumps(payload).encode('utf-8') if payload is not None else None
    headers = {'Authorization': f'Bearer {token}', 'Accept': 'application/json'}
    if body is not None:
        headers['Content-Type'] = 'application/json'
    request = Request(origin + path, data=body, headers=headers, method=method)
    opener = build_opener(ProxyHandler({}), NoRedirect())
    try:
        with opener.open(request, timeout=40 if stream_to else 25) as response:
            if stream_to is None:
                raw = response.read(128 * 1024 + 1)
                if len(raw) > 128 * 1024:
                    raise BridgeError('GPU worker JSON response is oversized')
                result = json.loads(raw)
                if not isinstance(result, dict):
                    raise BridgeError('Invalid GPU worker response')
                return result
            temporary = Path(str(stream_to) + '.part')
            total = 0
            try:
                with temporary.open('wb') as output:
                    while True:
                        chunk = response.read(1024 * 1024)
                        if not chunk:
                            break
                        total += len(chunk)
                        if total > MAX_WAN_CLIP_BYTES:
                            raise BridgeError('Generated clip is larger than 120 MB')
                        output.write(chunk)
                if total < 1024:
                    raise BridgeError('Wan clip is empty or invalid')
                temporary.replace(stream_to)
                return {'bytes': total}
            finally:
                temporary.unlink(missing_ok=True)
    except BridgeError:
        raise
    except Exception as error:
        # An HTTP error can contain a full provider response; do not leak tokens.
        raise BridgeError('Private Wan worker request failed or timed out') from error


def has_moving_frames(video):
    """Reject black/static-frame impostors, not merely container codec success."""
    try:
        output = subprocess.check_output([
            'ffmpeg', '-nostdin', '-v', 'error', '-i', str(video),
            '-vf', 'fps=2,scale=80:45', '-frames:v', '12', '-f', 'framemd5', '-',
        ], text=True, timeout=45)
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return False
    hashes = [line.rsplit(',', 1)[-1].strip()
              for line in output.splitlines() if line and not line.startswith('#')]
    return len(hashes) >= 2 and len(set(hashes)) >= 2


def generate_wan_scenes(job_id, prompts, job_dir, ratio, seconds=5, progress=None):
    """One explicitly consented GPU mission -> private genuine clips on disk."""
    if not isinstance(prompts, list) or not 1 <= len(prompts) <= MAX_SHOTS:
        raise BridgeError('Wan missions require 1–4 scene prompts')
    if ratio not in ('16:9', '9:16', '1:1'):
        raise BridgeError('Wan model supports 16:9, 9:16 or 1:1')
    if not isinstance(seconds, (int, float)) or isinstance(seconds, bool) or not 1 <= seconds <= 8:
        raise BridgeError('Wan clip duration must be 1–8 seconds')
    if any(not isinstance(p, str) or not 12 <= len(p.strip()) <= 1200 for p in prompts):
        raise BridgeError('Each Wan prompt must be 12–1200 characters')
    origin, token = configured_worker()
    readiness = private_request(origin, token, 'GET', '/health')
    if readiness.get('generationReady') is not True or readiness.get('backend') != 'wan-diffusers':
        raise BridgeError('Wan GPU model is unavailable or not generation-ready')

    outdir = Path(job_dir).resolve()
    if not outdir.is_dir() or not re.fullmatch(r'mv_[a-z0-9]+_[a-f0-9]{8}', job_id):
        raise BridgeError('Internal Wan bridge configuration invalid')
    output = []
    for index, prompt in enumerate(prompts):
        if progress:
            progress(index, 'generating')
        submit = private_request(origin, token, 'POST', '/jobs', {
            'project_id': job_id,
            'brief': prompt.strip(),
            'engine': 'wan',
            'aspect_ratio': ratio,
            'duration_seconds': seconds,
        })
        gpu_id = submit.get('jobId')
        if submit.get('accepted') is not True or not isinstance(gpu_id, str) or not JOB_ID_PATTERN.fullmatch(gpu_id):
            raise BridgeError('Wan worker did not accept the scene safely')
        if progress:
            progress(index, 'queued', gpu_id)

        # Bounded wait. Wan worker jobs are generated only once, no retry/repurchase.
        deadline = time.monotonic() + 1800
        while True:
            state = private_request(origin, token, 'GET', f'/jobs/{gpu_id}')
            if state.get('jobId') != gpu_id or state.get('projectId') != job_id:
                raise BridgeError('Wan worker job identity mismatch')
            if state.get('status') == 'succeeded':
                break
            if state.get('status') == 'failed':
                raise BridgeError('Wan GPU generation failed; review worker logs')
            if state.get('status') not in ('working', 'queued'):
                raise BridgeError('Wan worker returned an invalid job status')
            if time.monotonic() >= deadline:
                raise BridgeError('Wan scene deadline exceeded; do not retry automatically')
            time.sleep(4)

        # Ignore untrusted outputUrls. The filename is derived exclusively from
        # validated GPU job ID and fetched from the configured private origin.
        target = outdir / f'wan_scene_{index:02d}.mp4'
        private_request(origin, token, 'GET', f'/outputs/{gpu_id}.mp4', stream_to=target)
        if not has_moving_frames(target):
            target.unlink(missing_ok=True)
            raise BridgeError('Generated scene had no verifiable frame motion')
        output.append(target)
        if progress:
            progress(index, 'scene-ready', gpu_id)
    return output
