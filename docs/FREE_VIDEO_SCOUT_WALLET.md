# Free video model scout + truthful credit wallet

This review-only PR is stacked on the native Wan bridge. It adds:

- `/free-video-scout`: combined read-only dashboard.
- `GET /api/free-video-scout`: guarded public Hugging Face model catalog lookup with curated fallback and **unverified** labels.
- `GET /api/free-video-wallet`: the existing AI Video router's provider list with server-side configured/unconfigured visibility and explicit **unknown** free monthly, purchased and total credit fields.
- `scripts/free-video-scout.py`: public checkpoint release scanner for recent Wan, LTX, CogVideoX, HunyuanVideo, SkyReels and Mochi model cards.
- `.github/workflows/free-video-model-scout.yml`: *daily schedule after merging onto default branch*, artifacts and at most three deduplicated GitHub review issues per run. **It does not install or connect models.**

## Important truth-in-balance distinction

This server cannot independently read the connected Runway **ChatGPT plugin** workspace, and the Runway developer API is a different billing system. It must never copy a one-time observed ChatGPT credit number to an app dashboard as if it were a live recurring balance. The same principle applies to Google Vids versus Gemini/Veo, self-hosted Wan versus cloud credits, and external Magic Hour/VidMint accounts.

`null` means **unknown**, not zero. Configuration `true` means an environment variable exists, not verified usable quota. No credentials, tokens or financial data are sent to Hugging Face by the scanner.

For live balances, a subsequent PR needs provider-specific official **read-only** account/quota adapters, authenticated server-side secrets, last-checked timestamps, correct reset semantics, and "not supported" labels for providers without official balance APIs. Manual operator-reported balances must be clearly flagged as such with date; they cannot be labeled verified.

## Model vetting / automatic connection policy

Discovery checks official public model-card indexes, not random blogs. Model-card presence alone does not establish:
- free hosted video inference, included monthly generation or a monthly reset;
- license permission for commercial music videos, trained voice/face use, or absence of watermark;
- compatibility with the private AI Video executor;
- availability of NVIDIA GPUs or a deployment budget.

New model leads create review issues, with no execution code changes and **no GPU/paid API calls**. Auto-connecting arbitrary discovered models is intentionally blocked until the operator approves: exact model ID/license, official provider interface, zero-cost or explicitly budgeted execution, credential configuration, test job, media QC, rate limits, and explicit owner approval.

## Activation

1. Review and pass tests on this stacked PR, then independently merge its base PRs.
2. Merge this PR onto the repository's **default branch** (after retargeting). Scheduled Actions only run from the default branch.
3. In GitHub Actions, run **Free video model scout (review only)** once manually to verify the model scanner, evidence artifact and issue creation.
4. Keep automated inference, new API connectors, model installation and spending disabled.

Neither this PR nor its CI automatically merges, deploys, or makes self-hosted GPU usage free.

Current dashboard link: `/free-video-scout` (once deployed).
