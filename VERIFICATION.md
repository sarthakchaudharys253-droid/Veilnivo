# Veilnivo verification â€” 27 October 2026

## Completed checks

- PASS: 83 automated tests against a fresh PostgreSQL 17.11 database, including SQL integration, exact-user search, local source delivery, client identity isolation, and Netlify/Render realtime tickets. Zero failures and zero skips after final source changes.
- PASS: Both committed Prisma migrations applied to the isolated PostgreSQL database.
- PASS: Optimized Next.js static export in explicit same-origin live mode, including TypeScript validation and direct `/login/` output.
- PASS: Encryption/key recovery, authenticated routing, encrypted attachment access, idempotent sends, blocking, contact consent, account/session revocation, peer erasure, and SQL ciphertext checks.
- PASS: Bounded Argon2 concurrency returns retryable HTTP 429 under saturation; passive sockets disconnect at database/JWT expiry; account-binding headers/handshakes reject another tab's changed cookie identity.
- PASS: Successful authoritative contact snapshots purge removed peer history before cache decryption. Failed snapshots preserve data. Delayed callbacks and expiration events cannot restore deleted messages; sender acknowledgements preserve the shorter expiry.
- PASS: Render and Compose schema validation from the prior deployment preparation. Railway JSON parses and matches its documented settings; its schema endpoint returned HTTP 403.
- PASS: Production dependency audit reports zero known vulnerabilities after the scoped Prisma-config deepmerge-ts 8 override. Prisma generation and SQL migration tests also pass with that override.
- PASS: Exact username/alias lookup does not create a contact request or disclose presence/keys. Tests cover incoming/outgoing/accepted/self, both block directions, declined pairs, account guards, invalid queries, rate limits, cancellation and delayed responses after identity changes.
- PASS: Source download serves only the configured ZIP over loopback, validates the request host and origin, uses the validated file handle, and returns attachment headers. Missing/non-ZIP files fail closed; public production configuration cannot enable this route.
- PASS: The optional Netlify bridge preserves strict HttpOnly cookies through same-origin HTTP API requests. Direct cookie-free WebSockets use single-use opaque tickets capped at 30 seconds, with session/account binding, expiry/revocation checks, bounded memory, and race protection. Client tests cover fresh reconnect tickets, namespace retries, lock cancellation, malformed tickets, and abortable backend warmup without replaying authentication mutations.

The portable PostgreSQL archive came from the official EDB distribution linked by PostgreSQL.org; its SHA-256 matched the vendor-published checksum before execution. Verification used a random password, loopback-only listener, and a disposable cluster that was stopped and removed afterward. No Windows service was registered.

## Deployment scope

The initial delivery followed the user's **Keep everything local** choice. On 27 October the user requested a free Render backend for the separately uploaded `https://veilnivo.netlify.app` frontend. The free PostgreSQL instance has been provisioned in Singapore with external access disabled; its stated expiry is 26 November 2026. Publishing the reviewed source and deploying the connected backend/frontend remain separate steps and must be verified on the actual public site. No paid hosting plan is authorized. The source package excludes `.local` credentials and database files.

The separate local runner retains its application database and stable session secret across normal stop/restart. Its listeners use 127.0.0.1 and local HTTP; it is not an internet production endpoint. See [LOCAL-RUN.md](LOCAL-RUN.md).

## Remaining limits

A Docker image was not executed here; the included CI workflow prepares that check for a future repository. Public HTTPS, provider infrastructure, multi-device internet delivery, billing, and live AI are not claimed as deployed. External AI is disabled in the local runner. An independent cryptographic/security audit and a reviewed forward-secrecy protocol remain outside the implemented scope; [SECURITY.md](SECURITY.md) describes the current protocol accurately.

## Connected local deployment smoke check

- PASS: Combined frontend/API started on http://127.0.0.1:3001 with persistent PostgreSQL on 127.0.0.1:54329. Both migrations applied successfully.
- PASS: /api/ready and /api/health returned ok=true; /login/ returned HTTP 200; external AI remained disabled.
- PASS: Authenticated local control status/stop commands stopped the app and database. Database files and the stable session secret were retained. Restart succeeded with no pending migrations and readiness passed again.
- PASS: Browser sign-in with two generated temporary identities, empty search result, exact match preview, explicit request, incoming request review/acceptance, accepted-result Open chat, and bidirectional message composition.
- PASS: Signing in again recovered the other identity's message from the real backend. An independent WebCrypto client read PostgreSQL-backed HTTP history and decrypted both browser-authored messages with the intended recipient's recovered key.
- PASS: The running server's ZIP download matched the SHA-256 of the sanitized source package. The package includes START-HERE.txt and actionable setup instructions, with no runtime secrets, local data, or installed dependencies.
- The two generated QA identities were removed using their own account-bound API sessions after verification. Existing user accounts and history were not modified.
