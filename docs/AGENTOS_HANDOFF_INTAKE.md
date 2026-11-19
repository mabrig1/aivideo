# AgentOS script intake — guarded staging runbook

This feature receives a **script planning record**, not a video or an instruction to generate. Pair it with AgentOS PR #3.

## Route
- `POST /api/agentos/handoff`: authenticated JSON intake (max 10 KB)
- `GET /api/agentos/handoff?id=<sourceJobId>`: authenticated metadata/status lookup

The receiver stores `agentos_script_intake` MongoDB documents keyed uniquely by `sourceJobId`. Exact repeat returns 200 with the same ID; conflicting repeat returns 409. Initial state is always `awaiting-review`; `renderQueued=false`.

## Never-enabled-by-default configuration
Set **only in a protected staging AIVideo environment**:
- `AGENTOS_HANDOFF_ENABLED=true` — explicit test switch; leave absent otherwise
- `AGENTOS_HANDOFF_TOKEN` — randomly generated secret, at least 32 characters, kept server-side
- `MONGODB_URI` — server-side MongoDB connection

Set the **same secret** in the AgentOS server as `AIVIDEO_HANDOFF_TOKEN` with its explicit `AIVIDEO_HANDOFF_ENABLED=true` switch after staging testing. Do not place the token in source files, .env committed to GitHub, query strings, or browser JavaScript.

**Do not enable** `VIDEO_EXECUTION_ENABLED`, `LOCAL_RENDER_ENABLED`, auto-publishing, paid route flags or provider credentials for this test. The path never calls them.

## Preview checks
1. Typecheck, lint, tests and build must pass without production credentials.
2. Disabled receiver responds 403. Wrong/missing bearer token responds 403.
3. Valid script and authorized bearer create a record (201). Its state is `awaiting-review` and `renderQueued=false`.
4. Repeat the exact request and confirm same job ID (200). Alter the script while keeping the ID: 409 conflict.
5. Restart the server and confirm the record survives in MongoDB; do not use `/api/production`, which currently keeps prototype jobs in memory.
6. Verify there are **zero new video provider jobs, render queues, assets, publications or charges**.
7. Disable `AGENTOS_HANDOFF_ENABLED`, rotate the shared token on suspicion of disclosure, and review logs for PII/secrets.

A real video-asset handoff to VidMint is a separate, later design requiring approved asset rights, validated storage URLs, access controls and review.
