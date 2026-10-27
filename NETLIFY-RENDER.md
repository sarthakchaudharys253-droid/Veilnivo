# Netlify frontend and free Render backend

The free beta is deployed at [veilnivo.netlify.app](https://veilnivo.netlify.app/) with its [Render backend](https://veilnivo-api-free.onrender.com/api/ready) and PostgreSQL connected. Public checks on 27 October 2026 passed sign-in, exact username search, connection requests, bidirectional encrypted messaging between a browser and an independent Node WebCrypto client, and decryption of saved PostgreSQL-backed history. The two generated QA identities were erased using their own account-bound sessions; existing user identities were not modified. See [VERIFICATION.md](VERIFICATION.md) for the precise scope.

## Current deployment record

| Item | Verified value |
| --- | --- |
| Public frontend | https://veilnivo.netlify.app/ |
| Public backend | https://veilnivo-api-free.onrender.com |
| Source | https://github.com/sarthakchaudharys253-droid/Veilnivo |
| Deployed source commit | `1f59409a1787ae41e5c3b0f742d9caf44b1a3885` |
| Render workspace | My Workspace, `tea-dbfikelg1s2s73fvboag` |
| Render Blueprint | `veilnivo-netlify-free` |
| Render web service | `veilnivo-api-free`, `srv-dbg80dmc6qcc73ekou90` |
| Verified Live backend deploy | `dep-dbgbfrcipgvc73f3aa00` |
| Render database | `veilnivo-db-free`, `dpg-dbg7spl9fdbs73d1ms7g-a` |
| Published Netlify deploy | `6ae0b8100fd190814ea378ba` |
| Database expiry | **26 November 2026, 4:05 PM IST** (`2026-11-26T10:35:18.553914Z`) |

Both Render resources use Free plans in Singapore. The existing database was associated with the Blueprint, preserving that resource. Later documentation/build-helper updates do not change the source commit recorded for the verified release above.

The current Render service was created from a public repository URL, which requires a manual deploy of the latest `main` commit. Its auto-deploy setting alone does not establish a connected Git provider. Check for an existing deployment before triggering one; connecting a Git provider separately can enable automatic deploys. The existing Netlify project uses manual Drop uploads and is not linked to Git. Frontend changes require a local rebuild and upload to the same Netlify project unless Git-based Netlify deployment is configured separately. Reuse these resources; do not create a second project or database for routine updates.

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

The completed public smoke check used one browser and an independent Node WebCrypto client. It covered readiness, strict host-only HttpOnly cookies, sign-in, exact username search, request acceptance, direct cookie-free Render WebSockets, encrypted messages in both directions, and saved-history decryption. Only the two generated QA identities were erased afterward. The final browser view returned to the empty sign-in page.

Further public acceptance checks remain: two separate browsers/devices, alias search, attachment delivery, lock/sign-in history recovery in the browser, blocking, reconnect after a backend restart and cold start, and source/local-ZIP access restrictions. Automated/local coverage for these features is recorded separately in [VERIFICATION.md](VERIFICATION.md). Repeat the relevant checks after deployment changes and remove only generated QA identities.

Existing local-preview accounts, server accounts, encrypted browser caches and Netlify browser storage do not move automatically to the new deployment. Preserve the local database and credentials until any intended migration has been verified.
