# Private Wan → Native MP4 Master (stacked prototype)

This PR builds on [native scene-master PR #15](https://github.com/mabrig1/aivideo/pull/15) and connects **actual Wan outputs** to the existing local FFmpeg assembly queue.

**Status:** review-only code. Does not deploy a GPU, download model weights, spend provider credits, merge PRs or enable production on Cloudflare.

## Data flow (real, non-simulated once an actual GPU is configured)

```
/native-render (operator login token)
  → POST /api/render (audio + 1–4 Wan text prompts + explicit rights/GPU consent)
  → Mongo render_jobs + Redis render queue
  → FFmpeg worker sees wanPrompts and enters generating
  → authenticated GET /health on configured private Wan worker
  → POST /jobs (each prompt, one at a time; no automatic retry)
  → poll GET /jobs/{validated_wan_job_id}
  → authenticated GET /outputs/{validated_wan_job_id}.mp4
  → saved under the SAME private job directory as uploaded song
  → FFmpeg motion test rejects exact duplicate decoded frames
  → scene_master assembles generated clips with original soundtrack
  → ffprobe H264/AAC quality check, Mongo state ready
  → authenticated GET /api/render/{job_id}/download
```

No client-provided URL is fetched. The bridge ignores remote `outputUrls`; it derives the output path from the validated GPU job ID and uses only the operator-configured private origin. HTTP redirects fail closed, token never appears in browser code or logs, output size limit is 120 MB per clip, and missing/failed GPU generation results in a failed job **not** a fabricated black video.

## Explicit operator setup (local Docker with an NVIDIA CUDA GPU)

Provide private secrets to your shell, never commit them:

```bash
export RENDER_TOKEN="$(openssl rand -hex 32)"
export GPU_WORKER_TOKEN="$(openssl rand -hex 32)"
export WAN_BRIDGE_ENABLED=true
# WAN_WORKER_URL defaults to http://wan:8080 inside Compose only.
# No WAN worker is started unless the operator intentionally uses --profile gpu.
docker compose --profile gpu up --build
```

For an existing HTTPS-only private GPU worker set `WAN_WORKER_URL=https://your-private-worker.example.com` on BOTH the app and FFmpeg worker and do not use the gpu Compose profile. Keep the GPU endpoint protected with VPN / IP allow-list in addition to its strong `GPU_WORKER_TOKEN`. An externally routable HTTPS origin with a valid TLS cert is supported; arbitrary HTTP hosts are rejected. Do not open the Wan worker port publicly.

At `http://localhost:3000/native-render`, choose **Generate private Wan clips**, upload your soundtrack, enter one prompt per scene, choose 16:9 / 9:16 / 1:1, and explicitly approve both rights and GPU computation. Review status. Download MP4 only when QC succeeds.

To turn off generation without affecting regular uploads set `WAN_BRIDGE_ENABLED=false` on BOTH app and worker. It defaults to false.

## Scope and important limitations

- Wan is *text-to-video* in this version. It ignores uploaded faces and does **not** lock identity, sing along or synchronize lips. MuseTalk/face continuity remain separate approved steps.
- One generation mission can contain 1–4 short scene prompts, duration 1–8 seconds per scene. Scenes loop to cover up to 10 minutes of audio. The sound is NOT beat-matched.
- Output stays in the private local Docker volume. This is not yet an R2/S3 cross-repository integration, so VidMint/Content Engine remain separate until signed private asset handoff is added.
- Generation state and scene paths persist in Mongo. The existing simple Redis list is **not** an acknowledgment-based durable queue. A worker crash can interrupt a Wan generation and orphan its GPU job. No automatic retries are added; manual reconciliation is required.
- This does NOT ensure the actual content is visually good. Frame hashes only establish that sampled frames differ; a human must still check visual identity, music sync and consent.
- Self-hosted Wan model weights may be free under their applicable license, but GPU compute and storage can cost money. No metered external provider is contacted by this bridge.
- The existing audio-only proof remains explicitly separate. `wan-scene-master` should be marked ready only when generated scenes pass the motion test and final MP4 passes ffprobe checks.

## Safe verification

The Github Actions tests use `worker/mock_wan_server.py` and synthetic `testsrc2` footage. This **does not** establish that a CUDA machine and Wan weights are available; it validates the API protocol, authentication, clip handoff and MP4 assembly **without spending GPU credits**.

```bash
python -m unittest discover -s worker -p 'test_wan_bridge.py' -v
```

CI also starts the mock on `127.0.0.1:8091`, submits a rights-cleared synthetic audio + Wan prompt through `/api/render`, polls the persisted job and downloads an H.264/AAC MP4. A physical desktop/mobile playback check and a real self-hosted GPU evaluation are mandatory before production release.

## Next stage

Content Engine approved campaign/script → scoped signed `mabrig.video.v1` storyboard mission → generation execution → private R2/S3 artifacts with quotas/retention → VidMint review/edit/lip-sync → final human-approved download/publish. Keep provider approval and side effects explicit and auditable.
