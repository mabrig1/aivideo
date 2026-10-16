# Cloudflare runtime verification

The October 15 Worker threw error 1101 even though the Next.js build passed.
The deployed revision was reproduced locally with:
`Unexpected loadManifest(/.next/server/preview-props.json) call!`.
OpenNext 1.20.10 did not include that Next.js 16.4 manifest in the Worker bundle.
OpenNext 1.20.12 includes it and requires Next.js 16.4.1 or later in the 16.x line.
The project pins that compatible pair and aligns eslint-config-next to 16.4.1.
Upstream issue: https://github.com/opennextjs/opennextjs-cloudflare/issues/1355

Run `npm run cf:build` then `npm run cf:smoke`. The smoke check starts Wrangler
locally and checks the homepage, Kaggle catalogue, unauthenticated owner routes,
health JSON, and the 404 page. It requires no production credentials or media.
Both pull-request CI and deployment run this check before publishing.

The deployment also checks the public workers.dev URL and its Git revision.
This check runs even if publishing only partially succeeds due to a custom-domain
conflict. The deployment still reports that conflict as a failure.
Health can return 503 for missing configuration while the runtime check passes;
passing does not certify video generation or an end-to-end Kaggle import.

Keep the existing Vercel DNS record until the replacement Worker is verified.
The current `aivideo` CNAME target is `2d7728fa7a2fac06.vercel-dns-017.com`
(DNS only, TTL Auto). No DNS change is part of the runtime repair.
