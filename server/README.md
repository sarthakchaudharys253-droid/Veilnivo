# Production backend

Veilnivo's hosted Site preview uses a local demonstration. This server supplies the actual PostgreSQL and Socket.io transport. Its database contains wrapped private keys and opaque message envelopes only. Ollama Cloud is selected but inactive. If activated later, an AI prompt is sent over TLS to the configured provider, which necessarily sees that prompt. The bot transport is not end-to-end encrypted to an AI model.

For the production container, provider setup, secrets, HTTPS origin, and acceptance checks, follow [DEPLOYMENT.md](../DEPLOYMENT.md). The included Dockerfile serves the built frontend and backend on one origin. Deploy one application replica; preparing these files does not mean a remote backend is running.

## Start locally

1. Install the root package dependencies.
2. Copy `.env.example` to `.env` and set `DATABASE_URL`, a strong random `JWT_SECRET`, and the exact `CLIENT_ORIGIN`.
3. Run `pnpm db:generate`, then `pnpm exec prisma migrate deploy` to apply the checked-in migrations to the development database. Use `prisma migrate dev` only when intentionally authoring a new schema migration.
4. Run `pnpm start`; it reads `.env` when present. For a production release, `pnpm start:deploy` applies migrations before starting the server.
5. Run the frontend separately with `NEXT_PUBLIC_API_URL=http://localhost:3001` configured before `pnpm dev` or `pnpm build`; leave same-origin mode unset for this two-port setup. The development API defaults to port 3001 on loopback and the browser to port 3000. For the production container, use build-time `NEXT_PUBLIC_API_MODE=same-origin` with no API URL, runtime `SERVE_FRONTEND=true` and `FRONTEND_DIR=out`, and an exact HTTPS origin. `CLIENT_ORIGIN` takes precedence over `APP_ORIGIN`; Render's public URL is a fallback when neither is configured. Cross-site embeds and unrelated frontend/API sites cannot use the strict session cookie.

Never commit `.env`. Run the server behind TLS. Proxy configuration should not log `/api/bot/completion` bodies, authentication proofs, or response streams. Logging is disabled in Fastify and Prisma by default here. In-memory IP rate limits do not coordinate multiple replicas; production replicas need a shared transient limiter. Public keys are authenticated through account lookup but should be verified out of band using safety numbers.

## Veil AI configuration

Veil AI uses a normal question-and-answer chat interface with a Powered by Ollama label. The current configuration is `AI_PROVIDER=ollama`, `OLLAMA_CLOUD_ENABLED=false`, and empty `OLLAMA_API_KEY` / `OLLAMA_MODEL` placeholders. Keep the API key on the server; never put it in a `NEXT_PUBLIC_*` variable. A key and model alone cannot activate inference. No PC worker or local Ollama bridge is used, and no live AI has been enabled.

Ollama Cloud is [metered](https://ollama.com/pricing), not a guaranteed free hosted API. Future activation requires explicit approval, `OLLAMA_CLOUD_ENABLED=true`, a server-side key and an explicit model. Requests use the fixed hosted OpenAI-compatible endpoint; the server bounds concurrency, request duration and output, and never retries with a different provider or paid fallback. The separate legacy `AI_PROVIDER=openai-compatible` option additionally requires its `BOT_*` configuration and `BOT_ZERO_RETENTION_CONFIRMED=true`; that retention flag is an operator attestation, not a technical guarantee, and is not the Ollama activation gate.

Only the raw exact configured chat-lock code is intercepted locally before consent, history, outbox or provider dispatch, even when AI or consent is off. Other input follows ordinary assistant checks. For live sessions, an inactive provider status rejects an ordinary prompt before history or outbox creation or a completion request. The provider can read prompts sent after future activation; encrypted saved assistant history does not provide end-to-end encryption to the model.

## HTTP contract

All mutations require an `Origin` header equal to the configured frontend origin; requests use `credentials: include`. Authentication uses an HTTP-only session cookie whose existing identifier is retained for session compatibility. Registration and login return `{user:{id,username},public_key,encrypted_private_key,wrap_iv}`.

- `GET /api/health` checks process liveness. `GET /api/ready` runs a real database `SELECT 1`, returning HTTP 503 when unavailable. This verifies connectivity, not the complete schema or message lifecycle.

- `GET /api/auth/salts?username=handle` → `{auth_salt,wrap_salt}`.
- `POST /api/auth/register` → PRD registration envelope; server validates public-key shape and curve, then Argon2id hashes the client authentication proof.
- `POST /api/auth/login` → `{username,auth_hash}`. `POST /api/auth/logout` revokes the session and its sockets.
- `GET /api/users/:username/key` → `{id,username,public_key,online}`.
- `GET /api/users/search?username=exact_handle` → `{users:[{id,username,relationship}]}` with at most one match. Authentication and the active-account guard apply. Aliases resolve to the canonical username. Relationship is `self`, `none`, `incoming`, `outgoing`, or `accepted`. Blocked/declined/unavailable identities return an empty list; no presence or keys are exposed. Lookup is read-only and limited to 20 requests per IP per minute.
- `GET /api/conversations` → `{conversations:[{id,username,public_key,online,last_message}]}`.
- `GET /api/messages/:peerId?cursor=OPAQUE&limit=200` → `{messages,next_cursor}`; chronological envelopes ordered by timestamp and ID, maximum 500 per page. Pass the returned composite `next_cursor` unchanged to fetch the next older page; it is null when exhausted. This preserves messages that share a timestamp. Self ID retrieves encrypted assistant history.
- `POST /api/bot/history` → `{ciphertext,iv}`; returns `{message}`. A self-addressed envelope stores the bot prompt or answer, encrypted on the client.
- `GET /api/bot/status` requires authentication and the active-account guard. The inactive configuration returns `{provider:"ollama",mode:"cloud",configured:false,connected:false}` without keys or endpoint details. Configured providers can include a model; `connected` records a successful upstream connection, not a guarantee of future availability.
- `POST /api/bot/completion` → `{prompt}`; authenticated OpenAI-compatible SSE response. Inactive Ollama returns HTTP 503 with `Veil AI is inactive. Ollama Cloud has not been activated.` and makes no provider request, even if credentials have been saved. Enabled responses contain normalized text deltas and a final `[DONE]`; failures are sanitized and do not reveal upstream response bodies or secrets.
- `POST /api/account/nuke` accepts optional `{expected_user_id}` to bind a deletion retry to the intended account, rejecting a changed session with HTTP 409 before deletion. Returns `{ok:true,erased:true}` only after a serializable transaction deletes sent/received/self messages, every session, and the user. Foreign-key cascades are also enforced. Timing depends on database/network conditions; no fixed sub-500ms server guarantee is made.

Socket.io uses the same session cookie and websocket transport. Events: `message:send` accepts `{recipient_id,ciphertext,iv}` and acknowledges `{message}` or `{error}`; `message:receive` emits the stored envelope. `typing:send` accepts `{recipient_id,typing}` and emits `typing:receive` with `{user_id,typing}`. `message:read` accepts `{message_id}` and produces `message:receipt` with `{message_id,status,at}`. Presence changes emit `presence:update` with `{user_id,online}` only to conversation peers. `peer:erased` emits `{user_id}` after deletion; all the erased account's own sessions receive `account:erased` before disconnection.

## Erasure boundary

A server erasure cannot complete while a device is offline. Clients must distinguish immediate local erasure from confirmed server erasure and retain a deletion-only retry mechanism if needed. Erasure does not retract recipient screenshots, exported copies, or infrastructure backups outside the application's configured database. Do not configure message backups if the PRD's strict erasure requirement applies. JavaScript cannot promise physical overwriting of memory; keys are held only in memory and references can be dropped.

## Verification

Run `pnpm test` for crypto and envelope validation tests and `pnpm typecheck` for the whole project. A PostgreSQL instance is required to verify cross-session historical recovery, SQL ciphertext inspection, two-window peer purge, and atomic deletion. No production database verification is claimed by these source files. Before launch, run those PRD acceptance scenarios against the deployed database. Before any future AI activation, review the provider's current pricing and data-handling terms; legacy OpenAI-compatible configuration retains its separate operator-confirmed retention requirement.



## V2 contact and delivery additions

The v2 migration adds accepted-contact gating, incoming/outgoing requests, directional blocking, hash-only single-use invitations, same-account aliases, content-free delivery nonces and encrypted attachments. Existing message peers are migrated to accepted contacts. Run `prisma migrate deploy` before starting the updated API. New accounts require explicit request acceptance or an invitation before peer delivery.

- `GET /api/requests` returns pending incoming/outgoing requests. `POST /api/contacts/request {username}` creates a request; `POST /api/requests/:id/accept` and `/decline` resolve incoming requests. `POST /api/contacts/:peerId/block` or `/unblock` changes directional blocking; `GET /api/blocks` lists your blocks. Both directions of delivery/typing/receipts are suppressed while either party blocks the other.
- `POST /api/invitations {expires_in:3600|86400|604800}` returns `{id,token,expires_at}` once. The database stores only a SHA-256 token hash. Public `GET /api/invitations/:token` previews the creator's username and public key; authenticated `POST /api/invitations/:token/accept` atomically consumes it and accepts the contact. `GET /api/invitations` lists metadata; `POST /api/invitations/:id/revoke` revokes an unused invite. Redact invitation URLs from reverse-proxy access logs.
- `GET/PUT /api/conversations/:peerId/settings` reads/writes `{ttl_seconds:0|3600|86400|604800}` for new messages. Either accepted peer may change the timer; both receive `conversation:settings`. This is an expiration policy, not a guarantee against recipient copies. Expired rows are excluded from history immediately and physically removed by the application cleanup loop (up to 30 seconds under normal operation). User erasure still deletes all rows atomically without waiting for that loop.
- `message:send` additionally accepts `client_message_id` (UUID). A retry with the same sender, recipient, IV and ciphertext returns the original row. Conflicting replay fails. Content-free `SendNonce` rows prevent a previously expired/deleted operation from being resurrected; they contain routing IDs and survive message expiry, then cascade on either participant's account erasure. They are not encrypted conversation archives.
- Encrypt raw file bytes on the client with an independent AES-GCM key. `POST /api/attachments {recipient_id,ciphertext,iv,size}` accepts at most 10 MiB plus a 16-byte authentication tag. File name, MIME type and per-file key belong inside the encrypted message payload, never in database metadata. The response returns `{attachment:{id,size,expiresAt}}`; include opaque `attachment_id` in `message:send`. Sending atomically binds the upload to one message and inherits that message's exact expiry. Unsent uploads expire after 15 minutes. Deleting/expiring the message cascades its encrypted file. `GET /api/attachments/:id` requires owner or accepted, unblocked intended recipient; recipients cannot fetch unsent uploads.
- `GET/POST /api/aliases` lists/creates up to three exact-match contact handles; `DELETE /api/aliases/:username` removes one. Aliases map to the same public identity. They are not unlinkable identities and do not change the primary login username. No payment entitlement is assumed or charged.
- `contacts:updated` asks both parties to refresh request/conversation lists; `message:expired` purges the named envelope locally.

No protocol audit, ratcheting upgrade, forward-secrecy claim, new AI retention guarantee or active payment integration is implied by these changes. The static Sites preview still uses browser-local data; PostgreSQL tests remain opt-in via an isolated `TEST_DATABASE_URL`.
