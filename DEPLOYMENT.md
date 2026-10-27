# Deploy Veilnivo

[Veilnivo on Netlify](https://veilnivo.netlify.app/) is connected to the free [Render backend](https://veilnivo-api-free.onrender.com/api/ready) and PostgreSQL in Singapore. The Docker deployment became Live on 27 October 2026. The deployed source is commit `a7aeec9c2d92291f2055406f346a5e9251413a0a` in [the public repository](https://github.com/sarthakchaudharys253-droid/Veilnivo); later documentation updates are separate from that verified release. See [VERIFICATION.md](VERIFICATION.md) for the public checks completed.

The default `render.yaml` reproduces this free beta topology. The app sleeps after inactivity, and the current database expires on **26 November 2026 at 4:05 PM IST**. Follow [NETLIFY-RENDER.md](NETLIFY-RENDER.md) for the current resource IDs, update workflow and storage limits. Reuse these existing resources when updating this deployment.

The earlier paid combined-app configuration is preserved as `deploy/render-paid.yaml` for an explicit paid opt-in. In that alternative, Fastify serves the built frontend, `/api`, and Socket.io from one HTTPS origin. The source ZIP also supports a separate connected local deployment documented in [LOCAL-RUN.md](LOCAL-RUN.md).

The older hosted Sites preview remains a separate browser-local demonstration. Adding an API URL to a provider dashboard does not change an already exported frontend. Local preview identities and history are not uploaded or converted into server accounts automatically.

## Included deployment files

| File | Purpose |
| --- | --- |
| `Dockerfile` | Builds the frontend in same-origin mode and packages the Node server. |
| `render.yaml` and `render-free.yaml` | Identical free beta backend plus expiring free PostgreSQL for Netlify. |
| `deploy/render-paid.yaml` | Preserved paid combined-app setup; explicit opt-in only. |
| `netlify.toml` and `scripts/build-netlify.mjs` | Netlify export build, same-origin API rewrite and public realtime origin. |
| `railway.json` | Docker deployment settings for an optional Railway deployment. |
| `compose.yaml` and `deploy/Caddyfile` | Container deployment behind an HTTPS reverse proxy on a VPS. |
| `.env.compose.example` | Secret-free template for the local/VPS Compose settings. |
| `scripts/start-production.mjs` | Applies Prisma migrations before starting the server; used by `pnpm start:deploy`. |

Use one application replica and one Node process. Socket.io delivery, presence, erasure coordination, and rate limits currently use process-local state. A shared database alone does not make multiple application replicas work correctly. Restarts and deploys can interrupt sockets; clients reconnect, but uninterrupted delivery during a rollout is not guaranteed.

## Configuration

Set secrets directly in the hosting provider's secret/environment settings, or in a protected `.env` on your own server. Do not paste database passwords, JWT secrets, provider keys, or populated environment files into chat, Git, Docker build arguments, or `NEXT_PUBLIC_*` variables.

| Setting | Value or meaning |
| --- | --- |
| `NEXT_PUBLIC_API_MODE` | Build time: `same-origin` for the bundled container. |
| `NEXT_PUBLIC_API_URL` | Build time: unset for same-origin mode. A nonempty value conflicts with that mode. |
| `VEILNIVO_BACKEND_ORIGIN` | Netlify build time: the exact public Render HTTPS origin. The Netlify helper derives the frontend connection settings and API rewrite from it. |
| `NEXT_PUBLIC_SOCKET_URL` | Build time: direct Render realtime origin for the Netlify bridge; set by the Netlify helper. |
| `REALTIME_TICKETS` | Runtime: `true` for the Netlify bridge's short-lived authenticated WebSocket tickets. |
| `NODE_ENV` | Runtime: `production`. |
| `DATABASE_URL` | Runtime secret: PostgreSQL connection string with migration permissions; use the provider's required TLS settings. |
| `JWT_SECRET` | Runtime secret: generate at least 32 random bytes. Keep it stable across restarts; changing it invalidates sessions. |
| `APP_ORIGIN` or `CLIENT_ORIGIN` | Runtime: exact public frontend origin, such as `https://chat.example.com`, without a path, query, or fragment. Set one. If both exist, `CLIENT_ORIGIN` takes precedence. |
| `RENDER_EXTERNAL_URL` | Render supplies its public service URL; the app uses this fallback when neither origin setting is present. A custom domain needs an explicit origin setting. |
| `HOST` | Runtime: `0.0.0.0` for a publicly routed container. |
| `PORT` | Runtime: use the platform-injected port; the server defaults to `3001` otherwise. |
| `SERVE_FRONTEND` | Runtime: `false` for the free Netlify API backend; `true` for the combined-app alternative. |
| `FRONTEND_DIR` | Runtime: `out`, relative to the application working directory. |
| `TRUST_PROXY` | Runtime: `false` by default, or a comma-separated list of verified trusted proxy IPs/CIDRs. Boolean `true` and hop counts are not accepted. |

The Dockerfile selects same-origin mode during its build. Next.js embeds public settings in frontend JavaScript: changing them after the image has been built requires a rebuild. Database and JWT secrets remain server-side.

`TRUST_PROXY` controls which proxies may supply the client address used by rate limiting. Obtain the direct proxy addresses from your deployment topology before enabling it. With proxy trust disabled, requests can share the proxy's address and therefore its rate limit; do not solve that by trusting arbitrary forwarded headers.

AI is optional. Leave `BOT_API_KEY` and `BOT_MODEL` unset and `BOT_ZERO_RETENTION_CONFIRMED=false` until the operator has configured an HTTPS provider and confirmed its retention agreement. Live prompts are readable by that provider; this flag does not technically verify its policies.

## Render: primary setup

Render can build this Dockerfile from a Git repository. Blueprints configure the web service and database together. See Render's [Docker guide](https://render.com/docs/docker) and [Blueprint setup](https://render.com/docs/infrastructure-as-code).

1. Put this application directory, including the Dockerfile, lockfile, Prisma migrations, and `render.yaml`, into a Git repository on a supported Git provider. Push the intended release branch. Keep `.env` and credentials excluded. The supplied paths assume this application is the repository root; adjust paths deliberately for a monorepo.
2. Open the Render Dashboard, connect that repository, and create a **New > Blueprint** using `render.yaml`. The free resources are web service `veilnivo-api-free` and database `veilnivo-db-free` in Singapore. Confirm that both resource plans are Free before applying. The identical `render-free.yaml` file is available if an explicit free path is preferred. First reuse any existing intended resources instead of provisioning duplicates.
3. Keep the application and Render PostgreSQL in the same workspace and region. The Blueprint connects `DATABASE_URL` through its database reference and generates the JWT secret. For manual setup, copy the database's internal connection URL directly into the web service's secret settings. Render documents the [internal and external database connection choices](https://render.com/docs/postgresql-creating-connecting).
4. Keep the free backend's `CLIENT_ORIGIN=https://veilnivo.netlify.app`, `REALTIME_TICKETS=true`, and `SERVE_FRONTEND=false`. Copy the actual public HTTPS service origin returned by Render into Netlify's `VEILNIVO_BACKEND_ORIGIN` build variable, then rebuild using the checked-in Netlify configuration. Remove copied localhost values. The frontend HTTP API rewrite and direct authenticated realtime connection must be deployed together; see [NETLIFY-RENDER.md](NETLIFY-RENDER.md).
5. Apply the Blueprint and follow the specific deployment's logs. Keep the Dockerfile's start command, which uses the same migration-first entrypoint as `pnpm start:deploy`: migrations must succeed before the server starts. The service binds to `0.0.0.0` and the platform's `PORT`, as required for a [Render web service](https://render.com/docs/web-services).
6. Wait for the readiness check at `/api/ready` to pass, then run the acceptance checks below. Keep exactly one application instance; do not enable autoscaling.

For a manual free Render deployment, choose Free for both PostgreSQL and the Docker **Web Service**, point the service at this repository's Dockerfile, supply the runtime settings above, and set the health-check path to `/api/ready`. Do not create a Render Static Site for the backend. Do not override the Docker build with `next start`: this application runs Fastify. The free database has 1 GB storage, expires after 30 days and has no managed backups; it is a beta store rather than indefinite production retention. Do not recreate or rotate a free database to bypass expiry or silently discard user data.

To intentionally select the earlier paid combined-app alternative, review and choose `deploy/render-paid.yaml` as the Blueprint path instead of either free file. That configuration serves the frontend and backend on Render with `SERVE_FRONTEND=true`; its app and database plans incur charges. For its initial `onrender.com` address, leave both `APP_ORIGIN` and `CLIENT_ORIGIN` unset to use Render's `RENDER_EXTERNAL_URL`. Set the exact custom HTTPS origin when adding a custom domain. Switching from the free database requires a separate, verified migration; selecting a different Blueprint does not move accounts or history.

The current Render service and database both use Free plans. Backend updates deploy automatically from the repository's `main` branch. The existing Netlify project currently uses manual Drop uploads rather than Git-linked builds: rebuild with `VEILNIVO_BACKEND_ORIGIN=https://veilnivo-api-free.onrender.com`, then upload the complete generated `out/` output to that same project. A Git push alone does not update the Netlify frontend. Paid plans and database migration require a separate decision.

## Optional container hosts

### Railway

Deploy the same application repository as one persistent service using `Dockerfile` and the included `railway.json`. Add PostgreSQL, reference its connection URL in the application's `DATABASE_URL`, and set `JWT_SECRET`, `APP_ORIGIN`, and the other runtime settings above in Railway Variables. Generate the public HTTPS domain, set that exact origin, and redeploy. Retain one replica and the `/api/ready` check. Railway supports [repository Dockerfiles and platform-injected ports](https://blog.railway.com/p/deploy-scale-docker-containers-railway); this is an alternative setup path, not a claim that this repository has been deployed there.

### VPS with Docker Compose

Copy `.env.compose.example` to the ignored `.env.compose`. Generate `POSTGRES_PASSWORD` and `JWT_SECRET` separately in your own terminal, running this command once for each, then place the distinct results directly in that file:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Use hex secrets for the supplied Compose connection string. Neither password has a production default. Set `NODE_ENV=production`, `APP_HOST=chat.example.com` and `APP_ORIGIN=https://chat.example.com`, replacing the example with your actual domain. Compose maps `APP_ORIGIN` into the server's `CLIENT_ORIGIN`.

Point the domain's DNS to the VPS, allow inbound HTTP/HTTPS, and start the optional `https` profile:

```sh
docker compose --env-file .env.compose --profile https up -d --build
```

Caddy terminates HTTPS and forwards WebSockets/streams to `app:3001`. Only Caddy publishes public ports; the application port is also available on VPS loopback, and PostgreSQL has no host port. The supplied topology trusts only Caddy's fixed private proxy address, `172.30.25.10/32`. Verify the actual HTTPS origin and database readiness before inviting users. Keep the database volume across updates; deleting it deletes server accounts and encrypted history.

For a local container check without HTTPS, use the same secret file with `NODE_ENV=development`, `APP_ORIGIN=http://localhost:3001`, and `LOCAL_PORT=3001`. Omit the profile:

```sh
docker compose --env-file .env.compose up -d --build
```

Open `http://localhost:3001`. Update the origin to match if you change `LOCAL_PORT`. This development setting disables production-only HTTPS cookies; restore production settings before exposing a deployment.

### Cloud Run

The same image can be deployed as a Cloud Run service with an external PostgreSQL database and the runtime settings above. Set the exact public origin, use a single active application instance, and account for WebSocket request timeouts, reconnects, CPU allocation, and revision rollouts. Cloud Run's [WebSocket guidance](https://docs.cloud.google.com/run/docs/triggering/websockets) describes these constraints. A Cloud Run adapter or deployment configuration is not included or verified here; validate the topology before using it for conversations.

## External PostgreSQL, including Supabase

An external PostgreSQL service can replace Render PostgreSQL. Use a dedicated database/schema and a connection string accessible from the application host, then set it as the server-side `DATABASE_URL`. The startup process must be able to apply the included Prisma migrations as well as run normal queries. If you keep using a Render Blueprint, remove the unused managed-database definition/reference before applying it and provide the external URL as a secret instead.

Supabase can supply PostgreSQL without replacing this app's authentication, sockets, or attachment API. Copy a suitable database connection string from its Dashboard, with required TLS settings and correctly encoded credentials. Prefer a reachable direct connection for this long-running container and its startup migrations. Supabase documents the IPv6/IPv4 and pooler choices in [Connect to your database](https://supabase.com/docs/guides/database/connecting-to-postgres). Keep application tables private to this backend rather than granting browser Data API access. Do not substitute a Supabase project API URL, anonymous key, or service-role key for `DATABASE_URL`; transaction-pooler setup is not provided by this deployment path.

Full Supabase Auth/Realtime/Storage integration, a Cloudflare Workers backend, and Vercel function hosting require separate implementations or adapters. The supplied Fastify/Socket.io container is the supported backend implementation in this repository.

## Frontend and API on separate domains

The Netlify integration uses same-origin HTTP API requests through a forced Netlify rewrite, plus a direct Render WebSocket connection authenticated by a short-lived, single-use ticket. Set `VEILNIVO_BACKEND_ORIGIN` and run the checked-in Netlify build helper; see [NETLIFY-RENDER.md](NETLIFY-RENDER.md). This preserves strict HttpOnly cookies despite the providers having different registrable domains.

For a different separate static frontend with direct browser API calls, build with `NEXT_PUBLIC_API_MODE=remote` and `NEXT_PUBLIC_API_URL=https://api.example.com`; the existing URL-only configuration also selects remote mode. Rebuild the frontend whenever this address changes. Set the API's allowed origin to the frontend, such as `APP_ORIGIN=https://chat.example.com`.

For those direct browser API calls, use sibling custom domains under the same registrable domain, with HTTPS on both, and ensure the proxy supports `/socket.io` WebSocket upgrades and unbuffered AI response streams. The session cookie is HttpOnly and `SameSite=Strict`; allowing CORS does not make cross-site cookies work. Direct cookie-authenticated HTTP calls from an unrelated frontend origin to a provider domain remain unsupported. Use the explicit Netlify bridge, the combined Node-hosted application, or suitable sibling custom domains.

Changing the frontend origin also changes access to browser-local storage. Existing local preview history stays on its original origin; no automatic storage migration is implemented.

## Acceptance checks and verification limits

1. Open the deployed HTTPS root and `/login/` directly. Check that the application shows live mode and that the browser receives the frontend and assets from the intended release.
2. Request `/api/health`: this is process liveness. Request `/api/ready`: it must return HTTP 200 only after a real database `SELECT 1` succeeds. This proves connectivity, not a complete schema or lifecycle check; confirm startup migrations and the account tests too. HTML, a sign-in gateway, or a static-host fallback is not an API response.
3. In two separate browser profiles/devices, create disposable accounts, send and accept an invitation/request, exchange messages and an encrypted attachment, and check live delivery and receipts. Lock and sign in again to verify history recovery.
4. Restart the service and repeat sign-in and delivery. Test reconnect/retry and expiration. On disposable accounts only, erase and verify separate local and confirmed server outcomes.
5. Review application/provider logs for connection or migration errors without logging secrets, plaintext prompts, invitation tokens, or decrypted messages. Keep `/api` and `/socket.io` routed to Fastify.

Local `pnpm typecheck`, `pnpm test`, and `pnpm build` do not prove a provider deployment works. PostgreSQL integration tests need an isolated, migrated `TEST_DATABASE_URL`; never use the production database for those tests. The current public deployment passed readiness, strict-cookie browser sign-in, exact search, request acceptance, bidirectional encrypted messaging between a browser and an independent Node WebCrypto client, and decryption of PostgreSQL-backed HTTP history. Two-browser/device testing, public attachment delivery, and restart/cold-start lifecycle checks remain to be completed. No active billing, independent-audit, or forward-secrecy claim follows from this setup; see [SECURITY.md](SECURITY.md).

## Automated verification

The included `.github/workflows/verify.yml` is configured to run TypeScript and all tests against a disposable PostgreSQL17 service, including the otherwise opt-in SQL integration test. It also builds the Docker image and checks the combined app's readiness and login page. Its execution in GitHub Actions has not been verified. Render separately built and ran the deployed Docker release successfully. The workflow's disposable CI credentials are unrelated to deployment secrets.

Locally, use `pnpm typecheck`, `pnpm test`, and `pnpm build`. To run SQL integration, point `TEST_DATABASE_URL` only at a separate migrated test database. The verification record in [VERIFICATION.md](VERIFICATION.md) distinguishes completed automated, local and public checks from remaining lifecycle checks.
