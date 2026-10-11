# Movie-generation PR integration review

This integration combines PRs #2, #8, #9, and #12. It preserves the Cloudflare web app, the operator-controlled generation worker, and the separate Wan server while adding an optional local FFmpeg render proof.

## Integration fixes

- Kept `worker/worker.py` as the generation-executable adapter. Moved the Redis/FFmpeg consumer from #2 into `worker/ffmpeg_worker.py` with a CPU Dockerfile; Compose uses that worker.
- Preserved existing service configuration and Kaggle readiness checks instead of replacing them with the older #2 configuration.
- Restricted all local render endpoints to explicit local-storage enablement and a bearer token of at least 32 characters. They default to unavailable on Cloudflare. Prefixed source filenames to prevent traversal and validated the requested ratio.
- Added MuseTalk to orchestrator and status/persistence provider validation. MuseTalk preflight now requires a worker that advertises its engine, so a Wan-only server cannot accept a presenter request by mistake.
- Passed requested duration to local engines; the Wan server accepts only its own engine and calculates frame count from the request within its supported range. Native landscape/portrait dimensions now preserve 16:9/9:16.
- Kept signed metered-provider approvals and prevented request credit caps from raising a configured Runway server ceiling. Google API-key download headers are restricted to the Gemini API origin.
- Added compatible ESLint configuration, updated the dependency lockfile, and retained CI checks for Python and Cloudflare builds.
- Added `.github/workflows/deploy-cloudflare.yml`: pushes to `main` or manual dispatch build and deploy the reviewed revision. It requires `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets and passes the Git revision as `GITHUB_SHA` for bridge version diagnostics. It does not provision a GPU worker or enable paid execution.

## Validation

- Lint, TypeScript checks, Next.js build, and Cloudflare bundle build passed locally.
- Six original Kaggle contract tests, fourteen Kaggle flow tests, and five execution integration tests passed. Five Python uploader tests passed, and worker/uploader syntax checks passed.
- An actual multipart audio upload traversed the app, MongoDB, Redis, and separate FFmpeg worker. The resulting download was 58,844 bytes: H.264 video, AAC audio, 1080×1080, and 3.000 seconds. QC passed; an unauthenticated status request was rejected with HTTP 401.
- Wrangler's deployment dry run succeeded: approximately 1.53 MiB compressed, with the `VIDEO_ASSETS` R2 binding. Production deployment credentials were not available in the local environment; the workflow reports missing secrets explicitly.

## Remaining release limits

The local FFmpeg output is a black canvas with source audio, proving render plumbing rather than AI-generated movie content. It requires shared filesystem storage and is intentionally disabled on serverless deployments. Its Redis list has no acknowledgement/recovery for a worker crash during a render; queued persistence does not establish complete retry semantics.

The generation UI still creates production plans and browser-local scene variants. It does not upload source media into a complete AI scene-generation, assembly, and QC workflow. Production plans remain in process memory and their master URLs are placeholders. Operator-executable generation and MuseTalk require real engines; Wan requires CUDA, model setup, and worker credentials. Cloud provider clips require current credentials, verified request contracts, scoped approvals, and persistent artifacts. These changes must not be described as a verified finished-movie generation service.

Review the deployed revision, R2 access, worker health and engine availability before an end-to-end AI clip/movie acceptance test. Existing deployment/domain drift remains relevant until the new deployment is verified.
