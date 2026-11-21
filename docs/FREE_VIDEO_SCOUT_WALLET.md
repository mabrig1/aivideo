# Free Video Model Scout + Read-only Credit Wallet

Status: stacked **draft** work on AI Video. No service has been deployed, connected automatically or allowed to spend credits.

## Two deliberately separate jobs

1. **Model Scout**: a read-only GitHub Action scheduled every day at 07:15 UTC, only after the workflow exists on the repository's default branch. It fetches public Hugging Face text-to-video model metadata, checks model identifiers and license metadata, and exports a JSON artifact for manual review. It does **not** submit inference, download weights, auto-install, register execution adapters, or claim free APIs. Open weights and free API credits are different concepts; self-hosted GPU runs have real resource costs. GitHub scheduled workflows on feature branches are NOT active, and GitHub may delay scheduled triggers.
2. **Credit Wallet**: an authenticated read-only web dashboard at `/video-wallet`. Currently probes two official project-API billing endpoints when separate API credentials are configured:
   - **Runway Developer API**, `GET https://api.dev.runwayml.com/v1/organization` using `RUNWAYML_API_SECRET`. The authoritative field is `creditBalance`. **This is separate from your ChatGPT Runway connected workspace, whose web-app plan/purchased credits are different.**
   - **fal**, `GET https://api.fal.ai/v1/account/billing` using a billing-read-authorized `FAL_KEY`. If the provider returns no recognized finite non-negative USD balance field or an error, the UI displays **Unknown**, not a guessed amount or zero.
   
   Other providers (OpenArt, Higgsfield, HeyGen, InVideo, Runway web app, Google Vids, Gemini Veo) are shown as `Unknown / separate connector bridge required`. ChatGPT connector authorization does not automatically grant this separate Next.js app access to those accounts. Do not paste ChatGPT session tokens into this app.

## Security and privacy

- Set `VIDEO_WALLET_TOKEN` to a dedicated high-entropy secret, minimum 32 characters, in the app's backend environment; it is **not** a `NEXT_PUBLIC_*` variable.
- The browser asks for that operator token once each tab session and sends it as an Authorization bearer. The server uses timing-safe comparison; rejects unconfigured or unauthorized requests. No login URLs include tokens.
- Provider keys remain only on the server. The wallet's GET requests are fixed to vetted HTTPS origins, have 8-second timeouts, reject redirects, disable caching and never invoke a generation endpoint. Failure reveals no provider key.
- Displaying credits is not authorizing a spend. No auto-connect, auto-purchase or paid fallback is enabled. If billing APIs change, fail closed and show Unknown.
- Current requests are made when a signed-in operator presses Refresh. The page itself does not continuously poll third-party providers; a future protected server-side scheduler would need quotas, persistence and signed connector integrations to offer that.

## Setup

Generate the wallet token separately and set it as `VIDEO_WALLET_TOKEN`. Optionally configure `RUNWAYML_API_SECRET` and/or `FAL_KEY` with minimum necessary read permissions. Restart the private Next app. Open `/video-wallet`, provide the wallet token, select **Refresh provider balances**. Without backend credentials the app still renders each provider but marks balances unavailable.

The GitHub Actions model scout workflow becomes active after review and an authorized merge to the **default** branch; the stacked branch alone is not sufficient. To test manually, run:

```bash
python -m unittest discover -s scripts -p test_free_video_model_scout.py -v
python scripts/free_video_model_scout.py --output /tmp/video-model-candidates.json
```

The latter retrieves public metadata; it can fail due to network or rate limits without touching project data. It emits an ephemeral report as an Actions artifact, never opening a PR or modifying execution code without human review.

## Verified balances vs monthly allowance

A numeric remaining balance is not automatically a *monthly free* balance. Record:
- The provider and account/project scope (Runway Dev API vs Runway app).
- Balance unit (credits, USD, clips), retrieval timestamp, and renewal date only if officially supplied.
- Plan renewal credits separately from one-time purchased/top-up credits, where available.
- API capability separately from website or subscription access.
- Mark missing billing APIs `Unknown`, and depleted or blocked providers as unavailable until explicitly restored.

The ChatGPT connected Runway workspace balance must be read by its own account connector, and it cannot simply be treated as Runway Developer API credits.

## Roadmap for true provider auto-connection

Add provider-specific permissioned read-only integrations, support OAuth where offered, use an encrypted server secret manager, schedule quota polling with rate limits, persist last-known verified quota timestamps, and require explicit owner review of each model's API terms, region, safety and commercial license. No discovered model gets a runnable adapter or paid budget automatically.
