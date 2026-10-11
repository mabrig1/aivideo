# Kaggle Cinema + Voice + MuseTalk → AI Video

**Integration boundary:** This bridge imports completed, user-authorized media from three notebooks into the private R2 bucket used by `aivideo.mabrigkorie.org`. It does not provision Kaggle GPUs, control Kaggle sessions, install models in Kaggle, or execute notebooks on demand. Kaggle sessions and their `/kaggle/working` output files are temporary.

## Three notebooks

| Pipeline | Notebook | Typical outputs |
| --- | --- | --- |
| `cinema` | [Mabrig Cinema Tools](https://www.kaggle.com/code/mabrigkorie/mabrig-cinema-tools) | Wan-generated MP4 scenes, visual plates, FFmpeg renders |
| `voice` | [Mabrig Voice Clone](https://www.kaggle.com/code/mabrigkorie/mabrig-voice-clone/edit) | WAV / MP3 / M4A speech |
| `musetalk` | [MuseTalk](https://www.kaggle.com/code/mabrigkorie/muse-talk) | MP4 or WebM talking-performer video |

**Notebook visibility is not assumed.** A public browser may see 404 for private or unpublished Kaggle notebooks. Sign in as the owner and check each notebook manually. The sources, weights and input datasets remain in Kaggle; the app imports selected media outputs rather than copying models.

## One-time configuration

1. Create a private Cloudflare R2 bucket (or reuse your dedicated, access-controlled media bucket). Set `R2_ENDPOINT` to the `https://<account>.r2.cloudflarestorage.com` S3 endpoint; set `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_BUCKET` in **Vercel → aivideo → Settings → Environment Variables**. These are server-only. Grant credentials only the required bucket permissions: list, read, write and delete (delete removes a rejected upload). Keep public access disabled.
2. Generate a **new random secret, at least 32 characters**; for example, locally run `python -c "import secrets; print(secrets.token_urlsafe(48))"`. Set it in the same Vercel project as `KAGGLE_BRIDGE_TOKEN` for the relevant environments. Never use `NEXT_PUBLIC_` for this token. Existing unrelated `VIDEO_EXECUTION_TOKEN` is separate.
3. Redeploy the web app after its environment variables are saved. Until R2 and the token are configured, `/api/kaggle` will show `bridgeConfigured:false` and uploads will refuse service.
4. Open each **Kaggle notebook → Add-ons → Secrets**. Create `AIVIDEO_BRIDGE_TOKEN` with the **same** secret value. Enable this secret in the notebook. Optionally set `AIVIDEO_APP_URL` to `https://aivideo.mabrigkorie.org` if needed.
5. Do not add any secrets to GitHub, public notebooks, output logs or generated images. Do not set Kaggle to run as an always-on public inference endpoint.

## Per-notebook output import (manual execution)

Run the appropriate notebook's normal **generation cells first**. After confirming its finished media files exist under `/kaggle/working`, add and run **one Kaggle Python cell**:

```python
import json, urllib.request
app = "https://aivideo.mabrigkorie.org"
with urllib.request.urlopen(app + "/api/kaggle") as response:
    catalog = json.load(response)
assert catalog["build"]["version"] == 2, "Deploy bridge v2 first"
commit = catalog["build"]["commit"]
assert commit and len(commit) == 40, "Verify the deployed Git revision first"
uploader = f"https://raw.githubusercontent.com/mabrig1/aivideo/{commit}/scripts/kaggle_upload.py"
urllib.request.urlretrieve(uploader, "/kaggle/working/kaggle_upload.py")
%run /kaggle/working/kaggle_upload.py --pipeline cinema --scan --project mabrig-cinema --dry-run
```

**Review the preview list first.** It reads no secrets and makes no uploads. Then replace `--dry-run` with `--consent`, preferably using one explicit `--file` for the first test. Never run an uploader downloaded from a moving `main` branch in a secret-enabled notebook.

For voice cloning, change `--pipeline cinema` to `--pipeline voice`; for MuseTalk, use `--pipeline musetalk`. If your generated files have different names or locations, specify the exact file, rather than scanning:

```python
%run /kaggle/working/kaggle_upload.py --pipeline cinema --project mabrig-cinema --file /kaggle/working/wan_broll/WAN_PADDLERS_01.mp4 --consent
```

The uploader requires Python 3.9+ and `requests` (see `scripts/kaggle-requirements.txt`).

The `--scan` option looks at a **small known set of output folders/patterns** and imports at most 12 matching files. Review the selected files: it could include previous runs' renders. Files are limited to 1 GiB and must be inside `/kaggle/working`. Only the authorized pipeline's media formats are permitted. The `--consent` flag confirms that you have permission to use the underlying music, voice and facial likeness; it is not an identity-verification system.

The Python client obtains the token from Kaggle Secrets. It asks your web app for a short-lived, scoped R2 upload URL, uploads the selected file **directly to R2**, and asks the app to verify object size/type and register a private manifest.

## Download and review finished assets

1. Open `https://aivideo.mabrigkorie.org/#kaggle-studio`.
2. Choose the relevant notebook card to open it or copy a prebuilt import cell.
3. In **Imported Cinema Library**, enter the owner token *only in the password field on your own app*. It is held in component memory, not localStorage and not included in URLs.
4. Click **Load my imported renders**. The app returns a page of up to 50 manifest entries with private, 10-minute download URLs. Use the notebook filter and **Load more imports** to traverse the full library. Pages follow storage key order; records are sorted by completion date within each page, not globally. Use these as inputs for editing, assembly, or further human-reviewed scenes.

**Never put this owner token on a publicly shared workstation.** Anyone possessing it could list imported assets and request uploads. The token has no built-in per-user authorization; for multi-user commercial deployment replace it with real authenticated user accounts and per-project authorization.

## Privacy and security design

- **No files transit Vercel's request body**: the Python client uploads directly to R2 using a 15-minute presigned PUT URL.
- The server grants presigned upload links **only to a valid owner token** and a known workflow/file type. R2 credentials stay server-side.
- V2 signs `Content-Length`, `Content-Type` and `If-None-Match: *`. The uploader must send every returned `uploadHeaders` value. The create-only condition prevents overwriting a completed object with the same upload URL.
- Completion receipts bind the version, object identity, metadata and expiry. They expire after 30 minutes; upload URLs expire after 15 minutes. Successful completion retries reuse the original manifest. Legacy v1 receipts must be replaced with fresh v2 prepares.
- Completing an import requires an R2 `HEAD` check verifying declared byte length and MIME metadata. Mismatched objects are deleted before rejection. MIME metadata is not media-content inspection or malware scanning.
- Network errors are reported without signed URLs. API and upload redirects are refused.
- Unfinished uploads that never call completion are not automatically deleted. Account for these during bucket maintenance; do not put a blanket expiry policy on completed media.
- The R2 bucket should remain **private**; GET URLs expire after 10 minutes.
- The public `GET /api/kaggle` returns only the three notebook names and whether import prerequisites are configured. Listing assets requires authorization.
- Uploaded content remains **untrusted**, including when the model generates it. Review and scan before feeding it into other models, or redistributing.
- R2 storage and egress may have charges. Kaggle's free GPU is time-limited and cannot be treated as an always-on commercial worker.
- Never silently auto-publish finished media or enable paid provider fallback as part of this workflow.

## Existing infrastructure preserved

`/api/video-router`, `/api/video-execution`, `/api/production` and the stand-alone GPU worker are unchanged. The existing `MONGODB_URI`, `REDIS_URL`, `GPU_WORKER_URL` and provider credentials remain independent. A future job runner can import R2 media into authenticated production jobs, but this change does **not** pretend that the in-memory `/api/production` state is durable or that Kaggle provides web-executable inference.

## Verification

```bash
npm ci
python -m pip install -r scripts/kaggle-requirements.txt
python -m unittest discover -s test -p 'test_*.py'
npm test
npx tsc --noEmit
npm run build
python -m py_compile scripts/kaggle_upload.py
```

End-to-end integration additionally requires **operator-controlled test files**, **real R2 credentials**, and **a Kaggle notebook session**. Do not report live uploads or generated video completion without observing successful calls to prepare, R2 PUT and complete.

## Readiness and release verification

`GET /api/kaggle` returns `build.version`, `build.commit`, a commit-pinned uploader URL, and separate token/storage configuration flags. Every code path requires a token of at least 32 characters and an HTTPS Cloudflare R2 S3 endpoint. Configuration presence does not prove R2 permissions, bucket privacy, notebook access, or a successful import.

In the owner panel, **Check storage access** calls authenticated `GET /api/kaggle?action=diagnostics`. It performs one read-only list operation and explicitly reports that write access and bucket privacy remain unverified. It does not upload a test object.

Before configuring secrets, confirm that the custom domain returns HTTP 200 JSON from `/api/kaggle`, `build.version:2`, and the expected deployed commit. A 404 indicates a release/routing mismatch, not simply missing secrets. Check the owning Vercel project, Git repository, production deployment and domain assignment. `VERCEL_GIT_COMMIT_SHA` supplies the source identity on Vercel; other build hosts may provide the same reviewed SHA as `GITHUB_SHA`. Without an identity, the panel refuses to copy a mutable uploader.

After deployment/configuration, use a tiny explicitly selected owned file to verify: prepare 201 → direct R2 PUT 2xx → complete 201 → library listing → successful private download. Also verify that a repeat PUT to the same upload URL returns 412 and an unauthenticated asset request returns 401. Keep the upload URL out of shared logs. A storage check or CI pass alone is not end-to-end proof.

The automated tests use a simulated S3 store and real SDK signing; they cover the HTTP flow, receipt tampering/expiry, mismatched-object cleanup, idempotent completion, pagination, auth, bounded requests and sanitized errors. They do not certify real R2 conditional-write enforcement or Kaggle execution.

## Troubleshooting

| Symptom | Explanation / action |
| --- | --- |
| Kaggle notebook returns 404 | Sign into Kaggle as owner; confirm whether it is private, renamed, or deleted. |
| `bridgeConfigured:false` | Missing Vercel server environment variables or deployment has not refreshed them. |
| 401 from `/api/kaggle` | Incorrect/unset owner token; verify the same secret in Vercel and Kaggle. |
| 400 on prepare | Invalid filename, file extension, size, project name or missing consent. |
| R2 PUT rejects upload | Check valid 15-minute upload link, correct `Content-Type`, bucket credentials and network restrictions. Rerun a fresh prepare after expiry. |
| Complete fails | Object size or MIME differs from the signed declaration; repeat upload without changing the file. |
| Notebook works but website lists no media | Kaggle `/kaggle/working` files are not shared with Vercel. Run the explicit import cell. |
| Voice sounds good, MuseTalk is missing | Finish the MuseTalk notebook and upload its output separately. The website cannot auto-run notebook cells. |
