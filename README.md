# Veilnivo 2

Chat non-stop.

A dark, two-pane encrypted messenger built with Next.js App Router, TypeScript, Tailwind, Zustand, Dexie, Fastify, Socket.io, Prisma and PostgreSQL.

## What's included

- Single-use expiring invite links and locally generated QR codes; revocation and invite-led username/password onboarding.
- Message requests, explicit acceptance/decline, blocking and unblocking. No public username directory.
- Exact username and alias search with a result preview before sending a request. Existing connections open a chat; incoming requests open the review screen. Search is authenticated, rate limited, and hides blocked identities.
- Message selection, editing, forwarding, replies, encrypted emoji reactions, local message/file-name search, explicit send states and an encrypted, idempotent outbox.
- Encrypted group chats from the plus button: choose connected contacts, send shared text/replies/reactions, and add members as the creator.
- Chat selection with bulk pin/unpin, archive/unarchive, local clear/delete, and chat lock. Free supports 3 pinned peer chats; Plus is planned to support 10.
- Standard chat typing with your phone's keyboard or laptop keyboard, alongside the searchable emoji picker.
- Searchable native emoji picker with all 3,944 Unicode 17 emoji, nine categories, skin-tone and mixed-tone variants, and session-only recent emoji. It loads when opened and inserts at the cursor without replacing the rest of a draft. Emoji designs follow the device font.
- Off / 1 hour / 24 hours / 7 days message timers. New messages use the selected timer; existing messages retain theirs.
- Files up to 10 MiB, each encrypted with its own random AES-GCM key. Keys, filenames and MIME metadata travel only inside encrypted messages. User-triggered downloads use short-lived object URLs.
- Identity verification bound to the current public-key fingerprint, with key-change warnings.
- A normal Veil AI chat with first-use consent and a Powered by Ollama label. Ollama Cloud is selected but inactive; no live AI has been enabled. Peer conversation history is not included automatically.
- Readable comfortable/compact layouts, mint/blue/violet accents, optional inactivity lock, and up to three additional aliases pointing to the same identity.
- Separate local/server erasure states. One header erase control; Ctrl+Shift+Backspace opens the same confirmation.
- Free/Plus pricing experiment and explicit inactive billing. Feedback can be exported locally, with no automatic submission or analytics.

## Public privacy, terms and safety

Visitors can read the [Privacy policy](https://veilnivo.netlify.app/privacy/), [Terms of use](https://veilnivo.netlify.app/terms/), [Acceptable use rules](https://veilnivo.netlify.app/acceptable-use/) and [Contact & safety guidance](https://veilnivo.netlify.app/support/) without signing in. The [legal overview](https://veilnivo.netlify.app/legal/) links them together. Sign-in, Settings and Privacy & trust expose the same pages; messenger links open separately to preserve drafts.

The notices explain username/password signup without a phone number or email, encrypted content and visible metadata, essential storage, hosting, deletion controls, inactive AI and valid legal requests. They do not introduce private-chat scanning or an AI crime-detection system. The operator supplied a public email for voluntary privacy, abuse and legal requests; there is no automatic in-app report inbox. See [LEGAL-NOTICES.md](LEGAL-NOTICES.md) for configuration and remaining operator-specific legal setup.

## Run the local preview

Use Node.js 22+ and pnpm 11.25, then:

```sh
pnpm install
pnpm dev
```

With neither `NEXT_PUBLIC_API_MODE` nor `NEXT_PUBLIC_API_URL` configured, the app opens a labeled sample workspace. Contacts and requests in that workspace are examples. Veil AI is a deterministic local helper, not a hosted model. Create your own identity in Settings to test accounts, aliases, invite acceptance and encrypted history. Local identities created in the same browser origin can connect through requests or invitations. Cross-device invitations and remote messages require the backend.

For a clean local account workspace, open `/login/` and create an identity. Real account workspaces start empty except the optional assistant. Lock and sign in again to restore encrypted history. Prior v1 local identities are migrated on successful login.

Create identity includes a required Confirm password field directly below Password. Both entries must match exactly, including spaces, before registration starts. The confirmation stays in form memory and is not sent to the backend or saved; sign-in uses one password field.

## Message controls

Press and hold a message, right-click it, or use the dots inside its bubble to reply, react, select, forward, edit an own sent message, or delete. The dots sit at the top right of your messages and the top left of received messages; your menu includes Edit message. Double-click a message to open the full emoji reaction picker. On touch screens, swipe a received message from left to right or an own message from right to left to reply. Selection supports up to 50 messages; forwarding supports up to five accepted contacts and 50 copies per operation.

Delete for me hides the message on the current device and clears its local cached copy. Other people retain their copy. Delete for everyone applies to your own sent peer messages while unread and for 30 minutes after the recipient first reads them. At the cutoff the option is disabled and the server rejects the operation. The server removes message ciphertext and attached files, retaining a content-free deletion record to synchronize clients and prevent retries restoring it. Reading again or editing does not restart the window; editing remains available after the deletion cutoff. Copies already exported or downloaded cannot be recalled.

Forwarding creates a fresh encrypted message for each recipient, with a Forwarded marker and no source identity. Files receive fresh encryption keys and attachment IDs. The forwarded copy expires at the earlier of the original message's expiry and the destination conversation's timer.

Touch the chat composer to type with your phone's normal keyboard, or use your laptop keyboard. Paste and input methods use the browser's standard text field behavior. The emoji button still opens the searchable emoji picker. The earlier website keyboard has been removed at the user's request.

## Organizing and locking chats

On a phone, press and hold a chat to enter selection mode, then tap other chats or their square checkboxes. On a computer, right-click a chat, then left-click chats or checkboxes to select them. Select all and Cancel are available after selection starts; the arrow beside All chats opens Archived chats. Selection has no fixed chat-count limit. Pin, unpin, archive, unarchive, lock, clear or delete the selected conversations. Free allows 3 pinned peer chats across this device's inbox. Archive preserves the conversation and its messages. Clear chat is also available in the conversation menu above Block contact; it clears messages while keeping the conversation. Delete removes the conversation from this device's list until a new message brings it back. Other people and other devices retain their copies.

Chat organization is saved in the account's encrypted browser settings on this device. Clear/delete actions also remove the affected local cached messages, attachments and queued sends, and retain local clear markers so old server history does not return on an ordinary reload. They do not delete the server's encrypted message records or another participant's data, and organization does not synchronize to another device.

Set a secret code in Settings → Chat lock, confirm it, and choose conversations to lock. A code can contain 4–12 Unicode characters, counted as grapheme clusters so a joined emoji counts as one. Letters, numbers, symbols, spaces and emoji work; the code is checked exactly, without trimming or normalization. Only sending the exact configured code to Veil AI opens the locked section locally. That matching code never enters assistant history, the outbox or a provider request, and local unlocking works even when AI or consent is off. Other input follows the normal assistant path and its consent and availability checks; it is not treated as a failed unlock attempt.

Leaving the locked section, backgrounding the page, or locking/signing out of the account closes it. Locked conversation names and previews stay out of the ordinary chat list and search. Chat lock is a local interface guard inside an already unlocked account, not a separate message-encryption identity or a new server-side protection boundary.

Forgot chat-lock code opens a second confirmation. Confirming clears messages and queued sends for all locked conversations on this device, removes the code, unlocks and unarchives those chats, and returns to All chats. It does not recover the old code, clear another person's messages, or erase the server copy.

## Group conversations

Use the plus button beside Find user, choose New group, enter a name and select connected contacts. Selection has no fixed member-count cap; member lists and history load in pages. Practical group size still depends on browser memory, request-size limits and available hosting capacity. Groups require a live backend account.

Every member can send encrypted text, replies and emoji reactions to the shared conversation. Each received message identifies its author. Open Group members to see the roster; the creator can add more accepted contacts. Adding members rotates the content key and gives new members access only to messages sent afterward. Existing members retain their earlier encrypted history after signing in again. Queued messages are encrypted locally and recover on retry/reconnect.

Group message content uses a random AES-256-GCM key, distributed to each member inside a recipient-bound ECDH-encrypted envelope. The server stores opaque message/key ciphertext alongside the group name, creator, member list, sender and timing metadata. This is not an audited ratcheting group protocol. Blocking a direct contact does not hide messages in a shared group. Group conversations support local pin/archive/lock/clear/delete controls; the initial group release supports text/replies/reactions, with no group attachments, message editing, forwarding, Delete for everyone, member removal or ownership transfer controls.

If a member erases their account, remaining members rotate the key before new messages can be sent. Erasing the creator's account removes that group and its server history. Recipient exports/downloads and independently retained copies remain outside application erasure.

## Production backend

[Veilnivo is live on Netlify](https://veilnivo.netlify.app/) with its [Render API](https://veilnivo-api-free.onrender.com/api/ready) and PostgreSQL database connected. Public verification covered browser sign-in, exact username search, connection requests, bidirectional encrypted messaging with an independent WebCrypto client, and decryption of saved history. See [VERIFICATION.md](VERIFICATION.md) for the release record and test limits.

For this free beta setup, use [NETLIFY-RENDER.md](NETLIFY-RENDER.md). The default `render.yaml` and its `render-free.yaml` copy both use Free plans for the API and PostgreSQL. The free app sleeps when idle; the current database expires on **26 November 2026 at 4:05 PM IST**. Continuing storage requires an explicit plan or verified migration before expiry. Render deploys backend changes from Git; the Netlify frontend currently uses manual Drop uploads and must be rebuilt and uploaded separately. The earlier paid configuration is preserved as `deploy/render-paid.yaml` for a separate, explicit paid opt-in.

Follow [DEPLOYMENT.md](DEPLOYMENT.md) for the Render Docker + PostgreSQL setup and optional container hosts. Netlify's checked-in build uses `VEILNIVO_BACKEND_ORIGIN` to prepare same-origin HTTP API routing and direct authenticated realtime connections to Render. The combined Docker alternative can serve the frontend through Fastify alongside the API and Socket.io. Runtime `DATABASE_URL`, a random `JWT_SECRET`, and the exact HTTPS `APP_ORIGIN` or `CLIENT_ORIGIN` belong in the provider's secret/environment settings. `pnpm start:deploy` applies the included Prisma migrations before starting the server. Run one application replica.

For separate local frontend/API processes, see [server/README.md](server/README.md). Direct browser HTTP API connections still require suitable same-site HTTPS origins for strict HttpOnly cookies. The Netlify integration instead proxies HTTP through the frontend origin and uses short-lived realtime tickets for the separate WebSocket origin. PostgreSQL migrations include v2 contact consent, hashed invitations, message idempotency tombstones, expiry policy, aliases and encrypted attachment storage.

The older hosted Sites preview remains a separate static demonstration with browser-local data. The Netlify site above uses the live Render backend. Browser-local identities/history are not uploaded automatically. Cloudflare Workers and Vercel functions need separate backend adapters; Supabase can supply external PostgreSQL without replacing this backend. Optional deployment templates do not provision additional hosting resources by themselves.

Veil AI keeps a normal question-and-answer interface. Ollama Cloud is selected with `AI_PROVIDER=ollama` but inactive with `OLLAMA_CLOUD_ENABLED=false`; `OLLAMA_API_KEY` and `OLLAMA_MODEL` remain empty server-only placeholders. A saved key alone never activates cloud inference. Live provider status reports the inactive state, and the client rejects ordinary prompts before adding history or outbox entries or requesting a completion. The exact chat-lock code still opens locked chats locally.

Ollama Cloud uses [metered pricing](https://ollama.com/pricing); this release enables no live AI or billing. Future activation requires an explicit cloud enable flag plus a server-side API key and model, and user consent before sending a prompt. The provider necessarily reads those prompts over TLS; encrypted saved history does not make provider requests end-to-end encrypted. The legacy OpenAI-compatible option separately requires `BOT_ZERO_RETENTION_CONFIRMED=true`, an operator attestation rather than a technical retention guarantee. No PC worker or local Ollama bridge is part of this configuration.

## Security and honest limits

Read [SECURITY.md](SECURITY.md). This version retains native WebCrypto PBKDF2-SHA256 (600,000 iterations, independent salts), ECDH P-256 and AES-256-GCM with fresh random IVs. Production auth proofs are Argon2id-hashed. Messages, replies, reactions, file keys and file metadata are encrypted before storage/transmission. Browser settings/trust records are encrypted locally.

The ratcheting-protocol suggestion is documented as a concrete migration proposal, not implemented or independently audited. Static ECDH conversation keys do not provide forward secrecy. The official current Signal library is not a drop-in WebCrypto browser library. A specialist must select/review the implementation and historical-recovery tradeoff before a security-focused public launch. No homemade replacement is represented as a reviewed protocol.

This is not a zero-metadata service: the server sees account IDs, routing, timing, ciphertext sizes and required delivery metadata. JavaScript drops key references but cannot promise physical RAM overwriting. Local preview account verification uses SHA-256 over an already stretched authentication proof; production uses Argon2id.

## Expiry and erasure

Timers run from message sending time and apply to new messages. Online clients remove expired local messages/files; server reads filter expired rows immediately and a periodic cleanup removes database copies. Cleanup occurs when clients/server run. Application expiry cannot retract screenshots, exported files or downloaded copies.

Each uploaded file expires after 15 minutes if it is never sent. Successful sends atomically bind attachments to messages and inherit the message expiry. Delete for everyone removes the attached encrypted file; Delete for me affects only the current device. Retry tombstones prevent replaying an expired or deleted message back into history.

Erase drops keys/sockets, clears localStorage/sessionStorage and origin IndexedDB databases, and in live mode requests atomic account/message/file deletion. Local and server states are displayed separately. Offline server deletion is unconfirmed; while the page remains open, the HttpOnly-cookie request retries on reconnection with an expected-user guard. Reloading or changing identities cancels that memory-only retry. Network latency prevents a universal under-500ms guarantee. Infrastructure backups and recipient copies are outside the application deletion boundary.

## Pricing and pilot

The $4/month Plus card is a planned subscription, not an active purchase. Free currently allows 3 pinned chats; the shown Plus limit of 10 becomes available only when a real subscription integration launches. No checkout, payment collection, paid activation switch or active Plus entitlement is implemented. Core messaging, encryption, chat lock, archiving, blocking, timers and erase controls are not paywalled. Preview aliases/colors are available for evaluation; larger attachments are not advertised as working.

Use [PILOT.md](PILOT.md) for a 20-user research workflow. The app's feedback form keeps answers in memory and exports a user-controlled JSON file; it sends nothing automatically. No participants have been contacted and no market demand is claimed.

## Verification

```sh
pnpm typecheck
pnpm test
pnpm build
```

The Windows build uses Next's worker-thread option to avoid sandbox child-process filesystem restrictions. Output is `out/`. Automated tests cover cryptography, file encryption/tampering, payload validation, contact consent, local history/key recovery, legacy-account migration, encrypted outbox retry, replies/reactions, attachments, timers, trust and erasure. PostgreSQL integration tests are included but explicitly skipped without an isolated `TEST_DATABASE_URL`; do not point tests at production.

## Connected local backend

Use [LOCAL-RUN.md](LOCAL-RUN.md) to start the combined frontend and real PostgreSQL backend on this computer. `pnpm local` starts it; `pnpm local:stop` stops it while retaining local accounts and history.

The source ZIP must be fully extracted and its prerequisites installed before starting it. On the configured local installation, open `http://127.0.0.1:3001` while the runner is active. An optional sanitized source download is available at `/downloads/Veilnivo-source.zip`; the runner prints that link when it finds the archive. The file download route is limited to loopback use and is disabled for public production hosting.
