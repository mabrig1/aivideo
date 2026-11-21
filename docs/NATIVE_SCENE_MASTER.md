# Native video masters — local, review-only stage (21 November 2026)

This stage turns **actual recorded or AI-generated moving clips** and a soundtrack into a downloadable **H.264/AAC MP4**. It is NOT a text-to-video engine, not autonomous lip-sync and not a claim that a Wan GPU or commercial provider is configured.

## One-screen operator path

Open `/native-render` in the AI Video app running on the local/private render stack.

1. Enter the private `RENDER_TOKEN` (minimum 32 characters; it remains in the browser tab, not stored in browser storage).
2. Upload an audio master and 1–8 **real video files** (MP4/WebM/MOV/MKV). The files may be owner-recorded footage, generated Wan shots, or exports from VidMint.
3. Choose aspect ratio, confirm your rights/consent, and press **Create Real MP4 Master**.
4. Press **Refresh status** until the job reports `ready` with `qc.passed=true`, then **Download MP4**.
5. Watch the entire exported video, checking shot continuity, soundtrack alignment, identities and lip-sync (if supplied). No automatic publication is enabled.

The video sources are transcoded to uniform geometry and 30 fps, arranged in upload order, and **looped until the audio ends**. Each uploaded scene is limited to 30 seconds during assembly. Maximum soundtrack: 10 minutes. Preview assembly is 720px short-edge rather than 4K. The loop may cause visible jump cuts; this is an MVP, not beat-aware final editing. Video inputs can contain audio but the master uses the uploaded soundtrack.

## Endpoint

`POST /api/render`, protected with `Authorization: Bearer <RENDER_TOKEN>`, multipart form fields:

- `audio`: one uploaded music/narration file
- `clips`: 1–8 uploaded video files; the order is the edit order
- `rightsConfirmed=yes`
- `ratio=9:16` (or `16:9`, `1:1`, `4:5`, `2.39:1`)
- `brief`: optional text

Example (requires the private self-hosted stack):

```bash
curl -fsS -H "Authorization: Bearer $RENDER_TOKEN" \
  -F 'audio=@song.wav;type=audio/wav' \
  -F 'clips=@shot1.mp4;type=video/mp4' \
  -F 'clips=@shot2.mp4;type=video/mp4' \
  -F 'rightsConfirmed=yes' \
  -F 'ratio=9:16' \
  http://localhost:3000/api/render
```

The response contains a job ID. Poll `/api/render/<job-id>`; download from `/api/render/<job-id>/download` after `ready`. Only an authenticated operator can access local status and download.

## Proof versus native scene mastering

The older audio-only proof remains compatible, but its job has `renderMode=audio-proof` and black visuals. When actual scenes are uploaded, `renderMode=scene-master` and the worker QC includes `mode=scene-master` and `sceneCount`. Never advertise the audio-only mode as a finished music video.

## What is already real and what remains

- **Implemented on this branch:** local clip intake, strict limits, rights confirmation, server-side file isolation, FFmpeg scene normalization/assembly, H.264/AAC master, ffprobe QC and authenticated download UI.
- **Already present elsewhere in the repository:** separately gated Wan GPU generator, lip-sync adapter, video router, creative workflow. This branch does not automatically execute or pay for any of them.
- **Not yet integrated:** automatic Content Engine → AI Video → VidMint media handoff; production R2/S3, signed uploads, durable crash-safe acknowledgements, beat-aware cut detection, machine-checked lip-sync, cross-device playback validation and published releases.

The local endpoint remains disabled on Cloudflare Workers. To make the unified swarm truly automatic later, add a private R2 artifact contract and durable task queue, then require human approval of any generated likeness/voice and any metered generation. Do not expose private worker origins or tokens in public code. No PR merges or production deployments are performed in this stage.

## Verification

```bash
python -m unittest discover -s worker -p 'test_scene_master.py' -v
```

GitHub's `minimal-render-smoke.yml` runs these tests with synthetic moving video, plus the original authenticated audio-only render smoke. An end-to-end authenticated multi-clip upload through the live private stack and real-device video review are still required before promotion.
