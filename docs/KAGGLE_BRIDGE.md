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

1. Create a private Cloudflare R2 bucket (or reuse your dedicated, access-controlled media bucket). Set `R2_ENDPOINT` to the `https://<account>.r2.cloudflarestorage.com` S3 endpoint; set `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_BUCKET` in **Vercel → aivideo → Settings → Environment Variables**. These are server-only. Grant credentials only the required bucket permissions.
2. Generate a **new random secret, at least 32 characters**; for example, locally run `python -c "import secrets; print(secrets.token_urlsafe(48))"`. Set it in the same Vercel project as `KAGGLE_BRIDGE_TOKEN` for the relevant environments. Never use `NEXT_PUBLIC_` for this token. Existing unrelated `VIDEO_EXECUTION_TOKEN` is separate.
3. Redeploy the web app after its environment variables are saved. Until R2 and the token are configured, `/api/kaggle` will show `bridgeConfigured:false` and uploads will refuse service.
4. Open each **Kaggle notebook → Add-ons → Secrets**. Create `AIVIDEO_BRIDGE_TOKEN` with the **same** secret value. Enable this secret in the notebook. Optionally set `AIVIDEO_APP_URL` to `https://aivideo.mabrigkorie.org` if needed.
5. Do not add any secrets to GitHub, public notebooks, output logs or generated images. Do not set Kaggle to run as an always-on public inference endpoint.

## Per-notebook output import (manual execution)

Run the appropriate notebook's normal **generation cells first**. After confirming its finished media files exist under `/kaggle/working`, add and run **one Kaggle Python cell**:

```python
import urllib.request
urllib.request.urlretrieve(
    "https://raw.githubusercontent.com/mabrig1/aivideo/main/scripts/kaggle_upload.py",
    "/kaggle/working/kaggle_upload.py"
)
# Run the command for the notebook you are currently using:
%run /kaggle/working/kaggle_upload.py --pipeline cinema --scan --project mabrig-cinema --consent
```

For voice cloning, change `--pipeline cinema` to `--pipeline voice`; for MuseTalk, use `--pipeline musetalk`. If your generated files have different names or locations, specify the exact file, rather than scanning:

```python
%run /kaggle/working/kaggle_upload.py --pipeline cinema --project mabrig-cinema --file /kaggle/working/wan_broll/WAN_PADDLERS_01.mp4 --consent
```

The `--scan` option looks at a **small known set of output folders/patterns** and imports at most 12 matching files. Review the selected files: it could include previous runs' renders. Files are limited to 1 GiB and must be inside `/kaggle/working`. Only the authorized pipeline's media formats are permitted. The `--consent` flag confirms that you have permission to use the underlying music, voice and facial likeness; it is not an identity-verification system.

The Python client obtains the token from Kaggle Secrets. It asks your web app for a short-lived, scoped R2 upload URL, uploads the selected file **directly to R2**, and asks the app to verify object size/type and register a private manifest.

## Download and review finished assets

1. Open `https://aivideo.mabrigkorie.org/#kaggle-studio`.
2. Choose the relevant notebook card to open it or copy a prebuilt import cell.
3. In **Imported Cinema Library**, enter the owner token *only in the password field on your own app*. It is held in component memory, not localStorage and not included in URLs.
4. Click **Load my imported renders**. The app returns up to 50 latest recorded artifacts with private, 10-minute download URLs. Use these as inputs for editing, assembly, or further human-reviewed scenes.

**Never put this owner token on a publicly shared workstation.** Anyone possessing it could list imported assets and request uploads. The token has no built-in per-user authorization; for multi-user commercial deployment replace it with real authenticated user accounts and per-project authorization.

## Privacy and security design

- **No files transit Vercel's request body**: the Python client uploads directly to R2 using a 15-minute presigned PUT URL.
- The server grants presigned upload links **only to a valid owner token** and a known workflow/file type. R2 credentials stay server-side.
- Completing an import requires a signed, tamper-resistant receipt and an R2 `HEAD` check verifying the exact declared byte length and MIME type.
- The R2 bucket should remain **private**; GET URLs expire after 10 minutes.
- The public `GET /api/kaggle` returns only the three notebook names and whether import prerequisites are configured. Listing assets requires authorization.
- Uploaded content remains **untrusted**, including when the model generates it. Review and scan before feeding it into other models, or redistributing.
- R2 storage and egress may have charges. Kaggle's free GPU is time-limited and cannot be treated as an always-on commercial worker.
- Never silently auto-publish finished media or enable paid provider fallback as part of this workflow.

## Existing infrastructure preserved

`/api/video-router`, `/api/video-execution`, `/api/production` and the stand-alone GPU worker are unchanged. The existing `MONGODB_URI`, `REDIS_URL`, `GPU_WORKER_URL` and provider credentials remain independent. A future job runner can import R2 media into authenticated production jobs, but this change does **not** pretend that the in-memory `/api/production` state is durable or that Kaggle provides web-executable inference.

## Verification

```bash
npm install
npm test
npx tsc --noEmit
npm run build
python -m py_compile scripts/kaggle_upload.py
```

End-to-end integration additionally requires **operator-controlled test files**, **real R2 credentials**, and **a Kaggle notebook session**. Do not report live uploads or generated video completion without observing successful calls to prepare, R2 PUT and complete.

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
