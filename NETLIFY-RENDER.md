# Netlify frontend and free Render backend

The free beta is deployed at [veilnivo.netlify.app](https://veilnivo.netlify.app/) with its [Render backend](https://veilnivo-api-free.onrender.com/api/ready) and PostgreSQL connected. The latest 29 October 2026 frontend release adds public Privacy, Terms, Acceptable use, Contact & safety and Legal overview pages. The operator-supplied contact email is public; the notices explain signup without phone/email, encrypted content and visible metadata, essential storage, deletion scopes, inactive AI, voluntary reports and valid legal requests. They do not introduce AI chat scanning or certify legal compliance. Production build, export checks and public navigation passed. The backend remains on the inactive Ollama Cloud release, whose 179 regression checks previously passed. See [VERIFICATION.md](VERIFICATION.md) for precise coverage.

## Current deployment record

| Item | Verified value |
| --- | --- |
| Public frontend | https://veilnivo.netlify.app/ |
| Public backend | https://veilnivo-api-free.onrender.com |
| Source | https://github.com/sarthakchaudharys253-droid/Veilnivo |
| Backend source commit | `bee20298a873b5982d07fc3e50fa1e5efd5390ce` |
| Frontend source commit | `dfa48426efd0d8c476d6bf6afc4168f840d6924f` |
| Render workspace | My Workspace, `tea-dbfikelg1s2s73fvboag` |
| Render Blueprint | `veilnivo-netlify-free` |
| Render web service | `veilnivo-api-free`, `srv-dbg80dmc6qcc73ekou90` |
| Verified Live backend deploy | `dep-dbhf9em1egvs73fdtua0` at `2026-10-29T07:27:00.986895Z` |
| Render database | `veilnivo-db-free`, `dpg-dbg7spl9fdbs73d1ms7g-a` |
| Published Netlify deploy | `6ae339a823d8d26699028f41`, 29 October 2026, 5:48 PM IST |
| Database expiry | **26 November 2026, 4:05 PM IST** (`2026-11-26T10:35:18.553914Z`) |

Both Render resources use Free plans in Singapore. The existing database was associated with the Blueprint, preserving that resource. Later documentation/build-helper updates do not change the source commit recorded for the verified release above.

The 5:48 PM frontend update adds Confirm password immediately below Password in Create identity. Registration rejects mismatched entries locally before account creation starts; confirmation is not stored or sent to the backend. Public browser checks confirmed the native required field and that sign-in still has one password field. The policy pages and public email remain available from the form; no backend deployment or migration was needed.

Ollama Cloud's current runtime settings are maintained on the existing Render service: `AI_PROVIDER=ollama` and `OLLAMA_CLOUD_ENABLED=false`. This scoped merge preserved unrelated environment variables. The checked-in Blueprint omits these keys, so a later Blueprint sync preserves their service values. Server-only key/model placeholders are documented in `.env.example`; a key alone cannot enable cloud calls. The inactive status and HTTP 503 completion response were verified after the deploy reached Live. The PC worker alternative was removed and no PC model/worker was started. Ollama's [metered pricing](https://ollama.com/pricing) requires a separate deliberate activation decision; this deployment enables no AI billing.

The compact-sidebar frontend update reduced the phone Messages heading, search and tabs from 179px to 132px and removed the lower sidebar invitation card. User lookup and invitations remain accessible from the header controls. Desktop control styling and native keyboard input were unchanged; no backend deployment or database migration was needed.

The coordinated update at source `5e1e33584cb30dc03122e913c6f6c45dfed1d57f` puts dots at the top right of own bubbles and top left of received bubbles. The first-read deletion deadline is enforced by the server; repeated reads and edits do not restart it, and editing remains available after deletion closes. All 139 regression tests and the production build passed. The existing Render service reached Live as `dep-dbh007utlv9c73dhbgmg` at `2026-10-28T14:02:54.981545Z` (28 October, 7:32:54 PM IST), followed by the matching Netlify publication at 7:33 PM IST. Public checks confirmed the corner controls, edit/read-time preservation, within-window API deletion and recovery. The exact elapsed cutoff was tested against isolated PostgreSQL rather than by waiting 30 minutes publicly. This update needed no new database migration.

The 29 October chat-organization frontend at source `98d3c5749b04b86dfcde9cda404ca75f91b2d9f5` was published as Netlify deployment `6ae2a37942820e1594c98eb6` at 7:08 AM IST. All 146 regression tests and the production webpack build passed. Organization and lock settings are encrypted in this device's browser storage; they do not add server metadata synchronization. Clear/delete and forgotten-code reset affect this device, with persistent local clear markers preventing old server history from reappearing on an ordinary sign-in. The existing Render service/database and message protocol were unchanged; this release requires no backend deploy or new migration.

The encrypted-group release at source `87fb9a9cc3dd58d2626f82a404c3d6af9b4b9d87` reached Render Live as `dep-dbharu0m7kps73ectu1g` at `2026-10-29T02:25:27.52027Z` (29 October, 7:55:27 AM IST), with the additive `202610290000_groups` migration confirmed in deployment logs. The matching Netlify upload was published as `6ae2aec4bb1e5378e6397703` at 7:56 AM IST. Public acceptance checks completed: a three-member group was created in the browser, a fourth member was added, each member independently decrypted shared messages, and the added member could not fetch prior keys/history. Right-click/keyboard selection and 375px layout checks passed; true phone-touch long-press has automated coverage rather than a live hardware test. All four generated QA identities and their synthetic group were removed through their own account-bound API sessions. The existing free service and database were retained.

The current Render service was created from a public repository URL, which requires a manual deploy of the latest `main` commit. Its auto-deploy setting alone does not establish a connected Git provider. Check for an existing deployment before triggering one; connecting a Git provider separately can enable automatic deploys. The existing Netlify project uses manual Drop uploads and is not linked to Git. Frontend changes require a local rebuild and upload to the same Netlify project unless Git-based Netlify deployment is configured separately. Reuse these resources; do not create a second project or database for routine updates.

The message-actions update adds sender-authorized edits/deletion, encrypted forwarding, message selection/replies/reactions, touch swipe replies and double-click reactions. Its additive migration, `202610280000_message_actions`, adds revision/deletion metadata and a nonce lookup index; it does not reset accounts or history. Render logs confirmed that migration succeeded before the matching frontend was published. The subsequent standard-keyboard restoration changes only frontend input behavior and needs no backend deployment or database migration. For future coordinated backend/frontend updates, deploy the backend and complete its committed migrations first. Refresh existing browser tabs so they load the updated client. The message-actions production build and public acceptance checks passed; their scope is recorded in [VERIFICATION.md](VERIFICATION.md).

## Render resources

The default `render.yaml` defines only the free beta resources. `render-free.yaml` is an identical explicit free copy. The previous paid configuration is preserved separately as `deploy/render-paid.yaml` and requires a deliberate paid opt-in; do not apply it for this free-only setup.

The free Blueprint defines one Docker web service, `veilnivo-api-free`, and one PostgreSQL 17 database, `veilnivo-db-free`, in Singapore. `DATABASE_URL` uses Render's internal database connection; the database external IP allowlist is empty. The application reads the stable generated `JWT_SECRET` from Render's environment. `CLIENT_ORIGIN` is the exact Netlify HTTPS origin, and `SERVE_FRONTEND=false` keeps Render focused on the API and live messaging. The existing Dockerfile builds the app, then starts committed Prisma migrations before the server listens. Do not add a development server, schema-reset command, persistent disk, autoscaling, or extra replicas.

Before applying the Blueprint, check the workspace for an existing Veilnivo backend or database. Reuse the intended resource instead of provisioning duplicates. Render permits only one free PostgreSQL instance per workspace. Never delete a database to make room for a new one without a separately authorized data migration or deletion.

1. Push the sanitized application source, lockfile, Dockerfile, Prisma migrations, and free Blueprint to the Git repository Render can access. Exclude `.env`, `.local`, runtime account data, and installed dependencies.
2. In Render, create a Blueprint from that repository using the default `render.yaml` path (or its identical `render-free.yaml` copy). Confirm that both resources show the Free plan before applying.
3. Wait for the specific deployment to become Live and for `https://<actual-render-host>/api/ready` to return `{"ok":true}`. `<actual-render-host>` is a placeholder; copy the exact hostname returned by Render, including any generated suffix.
4. Configure and rebuild the Netlify integration described below, then verify the public site itself.

Do not paste database URLs, JWT secrets, session cookies, or provider keys into chat, source files, frontend variables, or screenshots.

## Connect the Netlify frontend

The existing `SameSite=Strict` session cookie cannot authenticate direct cross-site browser calls from `veilnivo.netlify.app` to an unrelated `onrender.com` hostname. Changing the frontend API URL alone is insufficient; CORS alone does not fix the cookie boundary. The same-origin HTTP and authenticated realtime integration must be deployed together before sign-in is considered connected. Keep the strict HttpOnly cookie protections; do not use localStorage as a session-token store.

The free configuration enables `REALTIME_TICKETS=true` on Render. Netlify must forward HTTP API requests through a forced HTTP 200 rewrite, preserving `/api` in the target. The browser sends its strict HttpOnly session cookie to Netlify's same-origin API route. For realtime messaging, it requests a short-lived, single-use ticket from `POST /api/realtime/ticket`, then connects directly to Render's WebSocket endpoint with that ticket. The ticket lasts at most 30 seconds and is not a persistent browser session token. This avoids depending on third-party cookies or a WebSocket proxy through Netlify.

For the current deployment, set this one public build variable in the terminal for manual builds, or in Netlify's build environment if Git-based builds are configured later:

```text
VEILNIVO_BACKEND_ORIGIN=https://veilnivo-api-free.onrender.com
```

The checked-in `netlify.toml` runs `node scripts/build-netlify.mjs` and publishes `out/` when Netlify performs the build. That helper validates the backend HTTPS origin, forces `NEXT_PUBLIC_API_MODE=same-origin`, clears `NEXT_PUBLIC_API_URL`, and sets `NEXT_PUBLIC_SOCKET_URL` to the Render origin. After building, it writes a forced `/api/*` to `https://veilnivo-api-free.onrender.com/api/:splat` HTTP 200 rewrite into `out/_redirects`, plus `out/_headers` matching the security/cache headers in `netlify.toml` for manual uploads. It does not proxy WebSocket traffic through Netlify. Never put PostgreSQL or JWT secrets in this public build variable.

For the current manual workflow, set the same `VEILNIVO_BACKEND_ORIGIN` in the terminal and run `node scripts/build-netlify.mjs`, then upload the entire `out/` directory or a ZIP of its contents to the existing Netlify `veilnivo` project. Preserve root-level `index.html`, `_redirects`, `_headers`, `/login/` and assets. A custom frontend builder must reproduce the same three public connection settings, forced API rewrite and headers together; configuring only a socket URL or only a proxy is incomplete.

If Turbopack's CSS worker fails to start on Windows, use `node scripts/build-netlify.mjs --webpack` to select Next.js's supported alternative builder. It uses the same connection settings, headers and API rewrite.

Rebuild and redeploy the frontend after changing these settings. Public build settings are embedded in JavaScript, so a runtime-only environment edit does not repair an older static export. Deploy the complete `out/` output to Netlify, preserving `/login/` and its generated assets. A source ZIP cannot replace the built export in Netlify's manual deploy flow.

Configure only the exact production Netlify origin on Render. Netlify branch previews and unrelated origins are not automatically trusted. Enable and verify HTTPS for both providers. Backend/database secrets remain solely in Render's secret settings.

## Free-plan operation

Render documents these limits in its [free-plan guide](https://render.com/docs/free):

- The web service sleeps after 15 minutes without inbound HTTP traffic or WebSocket messages. The next request or connection wakes it; startup can take about a minute. A cold-start delay is different from a lost database.
- Each workspace has a monthly allowance of free instance hours, bandwidth and build minutes. The app can be suspended or builds disabled when limits are exhausted. Check the provider's current usage limits before applying or increasing workloads. Do not select paid resources or enable automatic purchases for this free-only setup.
- Free PostgreSQL has 1 GB of storage, expires 30 days after creation, and does not include managed backups or managed connection pooling. Expiry makes the database inaccessible; after the documented grace period, Render deletes it. A free beta is not indefinite production data retention.
- The app service's filesystem is temporary. PostgreSQL contains accounts, relationships, encrypted messages, wrapped identity keys and encrypted attachments; do not move persistent data into the web container's local files.

The current database expires on **26 November 2026 at 4:05 PM IST**. Export data before that date if it must be retained. An operator must choose a continuing storage plan or perform a deliberate migration before expiry; rotating free databases does not preserve account identity and history automatically. No scheduled task or monitor is implied by this guide.

## Acceptance checks

Public checks used one browser and independent Node WebCrypto clients. They covered readiness, strict host-only HttpOnly cookies, sign-in, exact username search, request acceptance, direct cookie-free Render WebSockets, encrypted messages in both directions and saved-history decryption. The 28 October checks also covered edits, replies, full-picker reactions, two-message selection/forwarding, attachment download and re-encryption, an own synthetic deletion through the sender API, website keyboard input/send and browser lock/sign-in history recovery. Forwarded files used fresh IDs/keys, preserved the original expiry limit and decrypted successfully. All generated QA identities were removed through their own sessions, and the browser returned to the empty sign-in page.

Further public acceptance checks remain: two separate browsers/devices, actual phone touch gestures and operating-system keyboard behavior, multilingual input methods, Delete for me persistence, alias search, blocking, reconnect after a backend restart and cold start, and source/local-ZIP access restrictions. The public browser checked deletion-dialog options and Cancel; actual deletion used the independent sender API. Automated/local coverage for these features is recorded separately in [VERIFICATION.md](VERIFICATION.md). Repeat the relevant checks after deployment changes and remove only generated QA identities.

Existing local-preview accounts, server accounts, encrypted browser caches and Netlify browser storage do not move automatically to the new deployment. Preserve the local database and credentials until any intended migration has been verified.
