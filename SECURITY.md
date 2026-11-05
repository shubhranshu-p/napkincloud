# Security and credentials

Keep `MODEL_API_KEY` in a local ignored `.env` file or the hosting provider's encrypted runtime secrets. Never put it in browser code, a public repository, a screenshot, a recording, or a GitHub issue. The full app calls same-origin backend routes; an optional Pages frontend can call one explicitly configured backend HTTPS origin. The backend accepts only the configured PUBLIC_APP_ORIGIN for cross-origin API calls. Only the backend calls Meta.

A clone contains no owner credentials. Simulation works without a key. AI upload, repair, and image generation require a configured server key with model access and sufficient credits.

Public deployments let visitors consume the server's Meta allowance. The application limits endpoint starts and reserves attempted upstream calls in a per-process sliding window. These limits include failures and cancellations, but reset on restart and do not coordinate multiple processes or edge isolates. They are not a dollar spending cap. Set provider-side limits where available; use authenticated access or an edge rate-limit rule for broader public traffic. No secret is included in exported experiment evidence.

`META_ACCESS_UNTIL` can disable paid operations after a server-side timestamp. Simulation, saved history, and downloads remain available. The key is never returned by health checks. Uploaded images are sent to Meta for interpretation; history is stored in the visitor's browser. Avoid confidential diagrams in the public demo.

If a credential is exposed, revoke it with its provider and replace the runtime secret. Deleting the latest file alone does not remove it from Git history. The prepared GitHub release intentionally includes no existing Git history.

Report security issues privately to the repository owner, with reproduction steps and no live credentials.
