# Self-host Wan video generation for AI Video

This worker implements the same local provider contract already used by the
AI Video `local-wan` adapter.

## Model

Default model:

`Wan-AI/Wan2.1-T2V-1.3B-Diffusers`

The model weights are Apache-2.0 licensed. The weights are free to use under
that license, but GPU compute, bandwidth and storage are not free.

The model repository is large, so give the host generous persistent disk for
the Hugging Face cache. Mount `/models/huggingface` to persistent storage so
the model is not downloaded on every container restart.

## Build

```bash
cd worker
docker build -f Dockerfile.wan -t aivideo-wan .
```

## Run

```bash
docker run --gpus all -p 8080:8080 \
  -e GPU_WORKER_TOKEN="replace-with-a-long-secret" \
  -e GPU_WORKER_PUBLIC_URL="https://your-gpu-worker.example.com" \
  -e HF_TOKEN="hf_optional_for_public_model_downloads" \
  -v aivideo-hf-cache:/models/huggingface \
  -v aivideo-outputs:/data/outputs \
  aivideo-wan
```

Optional tuning variables:

- `WAN_MODEL_ID`
- `WAN_CPU_OFFLOAD=true`
- `WAN_NUM_FRAMES=81`
- `WAN_FPS=16`
- `WAN_STEPS=30`
- `WAN_GUIDANCE_SCALE=5.0`
- `WAN_SEED=42`

## FastAPI endpoints

### Health

`GET /health`

### Queue a generation

`POST /generate-video` is a human-readable alias for the router-compatible
`POST /jobs`.

```bash
curl -X POST "https://your-gpu-worker.example.com/generate-video" \
  -H "Authorization: Bearer $GPU_WORKER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": "aivideo_demo_001",
    "brief": "Cinematic sunrise over an African city, slow dolly movement, premium film lighting",
    "aspect_ratio": "16:9",
    "audio_url": "",
    "reference_urls": []
  }'
```

Response:

```json
{
  "accepted": true,
  "jobId": "wan_...",
  "projectId": "aivideo_demo_001",
  "status": "queued",
  "model": "Wan-AI/Wan2.1-T2V-1.3B-Diffusers",
  "statusUrl": "/jobs/wan_..."
}
```

### Poll the job

```bash
curl "https://your-gpu-worker.example.com/jobs/wan_..." \
  -H "Authorization: Bearer $GPU_WORKER_TOKEN"
```

When generation succeeds, `outputUrls` contains a protected URL on the same
GPU-worker origin. AI Video can then stream that provider output into its
private R2 `VIDEO_ASSETS` bucket.

### Download an output

`GET /outputs/{filename}` also requires `GPU_WORKER_TOKEN`.

## AI Video environment

Set the web app's local-provider configuration to this GPU worker:

```env
GPU_WORKER_URL=https://your-gpu-worker.example.com
GPU_WORKER_TOKEN=the-same-long-secret
```

Keep `VIDEO_EXECUTION_ENABLED=false` until the worker, private R2 binding and
execution authorization have been verified.
