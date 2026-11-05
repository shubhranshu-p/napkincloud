# Deployment and judging

For the GitHub-hosted frontend, start with [GITHUB-PAGES.md](GITHUB-PAGES.md). The Pages frontend requires the full backend. Run the backend on a hosted server throughout judging. A public GitHub repository is source code; it does not keep the author's Mac or API running.

## Cloudflare Workers (standalone)

Requires a Cloudflare account and access to deploy Workers. From this repository:

```sh
npx wrangler@4 secret put MODEL_API_KEY
# Enter the key interactively; never add it to wrangler.jsonc.
npx wrangler@4 deploy
```

The build compiles the dependency-free app into `worker/index.js`. `wrangler.jsonc` contains no account identifiers or credentials. `META_PARSE_MODEL` defaults to Spark 1.3. Reasoning and image models are selected server-side.

For a bounded judging window, optionally add a server-side `META_ACCESS_UNTIL` value, for example `2026-11-09T23:59:59+05:30` to keep paid features available through November 9 IST. Leave it unset for no application expiry. This does not extend the provider's credit validity or guarantee availability.

Do not deploy only static HTML: API routes and secret-backed calls require the backend. Alternatively run `npm start` on a Node 24 host behind HTTPS with `MODEL_API_KEY` in its secret manager. The local development server binds loopback; for public hosting use the Worker entrypoint or a production reverse proxy.

## Before submission

- Open the actual demo URL in a signed-out browser. Confirm judges can access it without the author's account.
- Test an example, generate a repair, check its illustration, restore history, and download evidence.
- Check `/api/health`: configured means a key exists, not that Meta accepted it. A successful explicit Generate operation verifies model access at that time.
- Confirm the provider key and credits remain valid through the judging window. Monitor usage and hosting status manually.
- Share the demo URL and repository URL in the submission. Never share the key.

The prepared source release is independent of the author's hosting account. No private hosting identity, local conversations, screenshots, browser profiles, or Git history are included.
