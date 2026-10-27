# Netlify frontend and free Render backend

This guide describes a free beta configuration for the existing frontend at `https://veilnivo.netlify.app`. Configuration files do not prove a deployment is live. Verify the actual Render service, its readiness endpoint, and the Netlify frontend after applying changes.

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

The exact backend hostname is assigned by Render. After that address is known, set this one public Netlify build variable:

```text
VEILNIVO_BACKEND_ORIGIN=https://<actual-render-host>
```

`<actual-render-host>` is a placeholder; use the exact returned hostname. The checked-in `netlify.toml` runs `node scripts/build-netlify.mjs` and publishes `out/`. That helper validates the backend HTTPS origin, forces `NEXT_PUBLIC_API_MODE=same-origin`, clears `NEXT_PUBLIC_API_URL`, and sets `NEXT_PUBLIC_SOCKET_URL` to the Render origin. After building, it writes a forced `/api/*` to `https://<actual-render-host>/api/:splat` HTTP 200 rewrite into `out/_redirects`. It does not proxy WebSocket traffic through Netlify. Never put PostgreSQL or JWT secrets in this public build variable.

For a manual build, set the same `VEILNIVO_BACKEND_ORIGIN` in the terminal and run `node scripts/build-netlify.mjs`, then upload the entire `out/` directory to the existing Netlify project. A custom frontend builder must reproduce the same three public connection settings and forced API rewrite together; configuring only a socket URL or only a proxy is incomplete.

Rebuild and redeploy the frontend after changing these settings. Public build settings are embedded in JavaScript, so a runtime-only environment edit does not repair an older static export. Deploy the complete `out/` output to Netlify, preserving `/login/` and its generated assets. A source ZIP cannot replace the built export in Netlify's manual deploy flow.

Configure only the exact production Netlify origin on Render. Netlify branch previews and unrelated origins are not automatically trusted. Enable and verify HTTPS for both providers. Backend/database secrets remain solely in Render's secret settings.

## Free-plan operation

Render documents these limits in its [free-plan guide](https://render.com/docs/free):

- The web service sleeps after 15 minutes without inbound HTTP traffic or WebSocket messages. The next request or connection wakes it; startup can take about a minute. A cold-start delay is different from a lost database.
- Each workspace has a monthly allowance of free instance hours, bandwidth and build minutes. The app can be suspended or builds disabled when limits are exhausted. Check the provider's current usage limits before applying or increasing workloads. Do not select paid resources or enable automatic purchases for this free-only setup.
- Free PostgreSQL has 1 GB of storage, expires 30 days after creation, and does not include managed backups or managed connection pooling. Expiry makes the database inaccessible; after the documented grace period, Render deletes it. A free beta is not indefinite production data retention.
- The app service's filesystem is temporary. PostgreSQL contains accounts, relationships, encrypted messages, wrapped identity keys and encrypted attachments; do not move persistent data into the web container's local files.

Record the database's actual expiry date from Render when it is created. Export data before that date if it must be retained. An operator must choose a continuing storage plan or perform a deliberate migration before expiry; rotating free databases does not preserve account identity and history automatically. No scheduled task or monitor is implied by this guide.

## Acceptance checks

After the actual deployment, verify new identities in two separate browsers/devices, exact username and alias search, request acceptance, encrypted messages in both directions, lock/sign-in history recovery, and blocking. Check WebSocket reconnect after a backend restart and cold start, validate `/api/ready`, and confirm that direct access to source files and local ZIP delivery is unavailable on Render. Remove only generated QA identities after verification.

Existing local-preview accounts, server accounts, encrypted browser caches and Netlify browser storage do not move automatically to the new deployment. Preserve the local database and credentials until any intended migration has been verified.
