# MABRIG Free-First Video Studio (review-only)

## Goal
Make real music videos using **existing moving video** + your own soundtrack for **zero external video-generation credits**. This is the non-AI alternative when Magic Hour / Runway / Higgsfield / OpenArt credit balances are exhausted.

This is a focused source-footage finder and original music-video editor, NOT a Pexels clone or a video model that creates new people moving from text.

## What has been built on this branch
- `/native-render`: choose **Free licensed footage**, **Upload existing clips**, or separately approved Wan GPU generation.
- `GET /api/free-footage?q=mountain%20sunrise&orientation=portrait` returns up to 12 matching video previews plus original Pexels page, videographer attribution and compatibility flag. Requires private operator `RENDER_TOKEN`.
- `POST /api/render`: a private Pexels-mode mission with `audio`, `pexelsIds` (JSON array of 1–8 official numeric IDs), `rightsConfirmed=yes`, and a `ratio`. The backend—not the client—resolves each ID through the official Pexels video-details API and downloads a suitable small MP4 to that render job's local media directory; then the **existing** FFmpeg scene-master assembles real moving clips with the soundtrack into H.264/AAC MP4 and serves authenticated download.
- Video links supplied by the browser are NEVER fetched. Server accepts only trusted HTTPS Pexels/Vimeo media hosts and fixed API endpoint URLs, disables redirects, caps each clip at 120 MiB and combined uploads at 400 MiB, checks container MIME and retains credited Pexels video IDs in the private render job.
- If the Pexels key is missing, the studio directs the owner to search manually at Pexels, download permissible footage, and use Upload existing clips.
- No metered cloud video API, no auto-publishing, no Google account or Runway credits required.

## Setup (private, self-hosted Node/FFmpeg)
1. Set a fresh 32+ character `RENDER_TOKEN` and other standard private scene-master infrastructure from `docs/NATIVE_SCENE_MASTER.md`.
2. Request a free Pexels API key at https://www.pexels.com/api/ and store it as **server-side** `PEXELS_API_KEY`; do NOT use `NEXT_PUBLIC_PEXELS_API_KEY`, push it to GitHub or expose it in browser code. The key is optional.
3. On the existing private Docker Compose stack: `PEXELS_API_KEY=... docker compose up --build`. This deploys the app and FFmpeg worker **only to your own machine/server**, using your existing infrastructure. GPU mode remains **off** unless explicitly opted in.
4. Open `http://localhost:3000/native-render`, enter operator token, upload your song, select Free licensed footage, enter “mountain sunrise” or similar, pick up to 8 clips, check the rights box, create MP4, poll status and download.
5. Retain visible attribution for each photographer and the source links when sharing your finished video.

Pexels documents current API limits of **200 requests/hour and 20,000 requests/month**, subject to its own service terms. Search/detail operations consume API quota (not money). Pexels may change rate limits or media URLs. Do not automatically scrape, bulk mirror, train AI on the clips or resell videos on a standalone/as-is basis. A song plus original selection/edit adds creative value, but creator/subject/brand rights still require review; do not imply identifiable people endorse your music or ministry.

Official docs:
- https://www.pexels.com/api/documentation/
- https://www.pexels.com/license/
- https://help.pexels.com/hc/en-us/articles/900005880463-What-are-the-Terms-and-Conditions

## Production safety / limitations
- Not merged and not deployed. Needs real Pexels API key, live private app/server and FFmpeg stack.
- Rendering is currently local-server only, not Cloudflare Workers. Do not attempt large file intake on Cloudflare.
- A source media host may redirect to another CDN. For privacy and SSRF safety this integration **rejects redirects**; use the manual upload fallback.
- Some Pexels videos have no suitable <=720p MP4 variant and must also be downloaded manually.
- Clips loop in selection order to fill the soundtrack. This version has no beat-aligned shot cuts, independent lyrics transcriptions, lip-sync, GPU-generated identity motion, or automatic credits burn-in.
- Long song and large footage can still consume CPU, bandwidth, disk and power even though there is no paid video API credit charge.
- A person in stock footage is not the user's actual singer; don't misrepresent footage as a live performance.
- Correctness tests validate identifier allowlist, URL host restrictions, bounded media streaming and provider protocol using mocked responses. Before release, operator should test with a legitimate Pexels clip and a rights-cleared 3-second soundtrack, verify FFprobe QC and playback on desktop and Android.

## Next steps after validation
- Add explicit choice between different source files / download sizes and prevent silent crop.
- Optional shot timeline + captions/credits overlay and VidMint handoff after signed/private asset manifest implementation.
- A guided “Follow Your Dream” storyboard: 8 shots (mountain climb, storm, resolve, sunrise, path, summit, concert, finale).
- Physical browser export, publish reviewed scene source attributions in description.
