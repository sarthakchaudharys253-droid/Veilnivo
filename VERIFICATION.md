# Veilnivo verification - 28 October 2026

## Completed checks

- PASS: 126 automated tests against a fresh PostgreSQL 17.11 database, including SQL integration, message mutation and forwarding, identity/replay isolation, keyboard input, touch gesture rules, exact-user search, local source delivery, Netlify/Render realtime tickets, typing lifecycle regressions and emoji catalog/insertion checks. Zero failures and zero skips.
- PASS: The bundled Unicode 17 catalog contains all 3,944 fully qualified sequences, including exact mixed-tone variants, with nine categories. Every sequence is reachable from its base entry. Local search aliases, skin-tone selection, Unicode-safe cursor replacement and composer length limits are covered. The official data generator verifies its pinned source checksum; Unicode License V3 and attribution are included. No Apple artwork or font is bundled; rendering uses the device's native emoji font.
- PASS: Typing starts only after real input, stops after 1.5 seconds idle and on send/blur/chat cleanup, and expires after six seconds if a stop event is lost. Tests cover offline peers, disconnect/reconnect, message arrival, chat/account changes, AI isolation, immediate server stop signals, late authorization after disconnect and multi-tab presence.
- PASS: All three committed Prisma migrations applied to the isolated PostgreSQL database, including the additive message revision/deletion migration.
- PASS: Production Next.js static export in explicit same-origin live mode completed with `--webpack`, including TypeScript validation and direct `/login/` output. The build exited successfully.
- PASS: The Netlify static ZIP contains 52 files (493,663 bytes), with root-level `index.html`, `/login/`, the exact Render API rewrite and security/cache headers. The Windows Turbopack PostCSS worker previously failed during its startup handshake; the supported webpack builder completed compilation and TypeScript checks.
- PASS: Encryption/key recovery, authenticated routing, encrypted attachment access, idempotent sends, blocking, contact consent, account/session revocation, peer erasure, and SQL ciphertext checks.
- PASS: Bounded Argon2 concurrency returns retryable HTTP 429 under saturation; passive sockets disconnect at database/JWT expiry; account-binding headers/handshakes reject another tab's changed cookie identity.
- PASS: Successful authoritative contact snapshots purge removed peer history before cache decryption. Failed snapshots preserve data. Delayed callbacks and expiration events cannot restore deleted messages; sender acknowledgements preserve the shorter expiry.
- PASS: Render and Compose schema validation from the prior deployment preparation. Railway JSON parses and matches its documented settings; its schema endpoint returned HTTP 403.
- PASS: Production dependency audit reports zero known vulnerabilities after the scoped Prisma-config deepmerge-ts 8 override. Prisma generation and SQL migration tests also pass with that override.
- PASS: Exact username/alias lookup does not create a contact request or disclose presence/keys. Tests cover incoming/outgoing/accepted/self, both block directions, declined pairs, account guards, invalid queries, rate limits, cancellation and delayed responses after identity changes.
- PASS: Source download serves only the configured ZIP over loopback, validates the request host and origin, uses the validated file handle, and returns attachment headers. Missing/non-ZIP files fail closed; public production configuration cannot enable this route.
- PASS: The optional Netlify bridge preserves strict HttpOnly cookies through same-origin HTTP API requests. Direct cookie-free WebSockets use single-use opaque tickets capped at 30 seconds, with session/account binding, expiry/revocation checks, bounded memory, and race protection. Client tests cover fresh reconnect tickets, namespace retries, lock cancellation, malformed tickets, and abortable backend warmup without replaying authentication mutations.

The portable PostgreSQL archive came from the official EDB distribution linked by PostgreSQL.org; its SHA-256 matched the vendor-published checksum before execution. Verification used a random password, loopback-only listener, and a disposable cluster that was stopped and removed afterward. No Windows service was registered.

## Message actions and phone keyboard - local verification, 28 October 2026

- PASS: Sender-only revision-checked edits/deletion, encrypted file removal, content-free deletion history, replay rejection, expiry limits, blocked contacts, erasure races and foreign-sender nonce reuse were exercised against real PostgreSQL.
- PASS: Client checks cover stale history/events/acknowledgements, account/conversation changes, cached identity binding, hidden-message persistence, reply redaction, forwarding source changes during encryption, fresh recipient attachment encryption and all 3,944 accepted Unicode reaction sequences.
- PASS: Local browser checks edited a sample message, opened the full reaction picker by double-click, selected a reaction and forwarded a sample message to another sample conversation.
- PASS: At a 375 by 812 browser viewport, touching the composer opened the Veilnivo keyboard. Its buttons typed `hello World12` using shift, numbers and backspace. The composer had `readOnly=true` and `inputmode=none`.
- PASS: Directional touch-swipe rules and Unicode-aware cursor/deletion operations have automated coverage. After the final attachment-card interaction changes, gesture tests and whole-project TypeScript validation passed again.
- These are local checks; completed public release evidence is recorded below. Actual phone hardware gestures, operating-system keyboard behavior and multilingual input methods were not tested.

## Deployment scope

The initial delivery followed the user's **Keep everything local** choice. On 27 October the user requested a free Render backend for the existing [Netlify frontend](https://veilnivo.netlify.app/) and explicitly approved uploading the reviewed source to [the public GitHub repository](https://github.com/sarthakchaudharys253-droid/Veilnivo). Source commit `a7aeec9c2d92291f2055406f346a5e9251413a0a` was deployed to Render, and the connected static export was published to the existing Netlify project. Later documentation/build-helper changes are separate from that verified source release. No paid hosting plan is authorized. The source package excludes `.local` credentials and database files.

The Render Docker web service `veilnivo-api-free` (`srv-dbg80dmc6qcc73ekou90`) and PostgreSQL 17 database `veilnivo-db-free` (`dpg-dbg7spl9fdbs73d1ms7g-a`) both use Free plans in Singapore. The database external IP allowlist is empty. Its recorded expiry is **26 November 2026 at 4:05 PM IST** (`2026-11-26T10:35:18.553914Z`); a continuing storage plan or deliberate migration is required before expiry. See [NETLIFY-RENDER.md](NETLIFY-RENDER.md) for the current topology and update workflow.

The separate local runner retains its application database and stable session secret across normal stop/restart. Its listeners use 127.0.0.1 and local HTTP; it is not an internet production endpoint. See [LOCAL-RUN.md](LOCAL-RUN.md).

## Public deployment smoke check - 27 October 2026

- PASS: Render built and ran the Docker release. Deployment `dep-dbg80duc6qcc73ekovfg` for source commit `a7aeec9c2d92291f2055406f346a5e9251413a0a` reached Live at `2026-10-27T10:45:52.752596Z`.
- PASS: The rebuilt frontend was published to the existing Netlify project as deployment `6ae081632e04ccd398ebb90f`. This uses manual Drop uploads. The Render public-repository source needs a manual deploy of the intended Git commit; frontend updates require a separate rebuild/upload.
- PASS: Direct Render `/api/ready` returned HTTP 200 JSON `{"ok":true}`. Netlify `/api/ready` and `/api/health` returned production JSON through the same-origin proxy; `/login/` returned HTTP 200 HTML. Live external AI was unconfigured.
- PASS: Two generated identities registered through the Netlify API proxy. Authentication cookies were Secure, HttpOnly, SameSite=Strict and host-only. Actual browser sign-in and exact username search succeeded, followed by an explicit connection request and recipient acceptance.
- PASS: A browser on Netlify and an independent Node WebCrypto client exchanged and decrypted encrypted messages in both directions. The independent client authenticated its direct Render WebSocket using a single-use realtime ticket without a Cookie header.
- PASS: The independent client recovered the recipient's private key, fetched saved HTTP message history through Netlify, and decrypted both synthetic messages from the PostgreSQL-backed history.
- PASS: Exactly the two generated QA identities were erased through their own account-bound sessions. Existing user identities were not modified. The final browser screenshot, `outputs/Veilnivo-public-live.jpg`, shows the empty sign-in page with no QA identity.

## Public typing-fix verification - 27 October 2026

- PASS: Render deployed source `1f59409a1787ae41e5c3b0f742d9caf44b1a3885` as `dep-dbgbfrcipgvc73f3aa00`, reaching Live at `2026-10-27T14:42:26.073173Z`. Netlify production deploy `6ae0b8100fd190814ea378ba` published the matching frontend.
- PASS: A real browser with an unsent draft emitted typing start and then stop after 1,506 ms without additional input. The independent recipient observed both events through the public backend.
- PASS: The browser displayed active peer typing. When the independent peer deliberately omitted its stop event, the indicator expired. When the typing peer disconnected, the header changed to Offline and the typing indicator cleared.
- PASS: Public Netlify readiness and health returned HTTP 200 JSON after the release. Exactly the two synthetic QA identities were removed through their own account-bound sessions. Existing accounts were not modified; no database migration was needed.
- The local screenshot `outputs/Veilnivo-typing-fixed.jpg` records the offline peer without a typing indicator before QA cleanup.

## Public emoji-picker verification - 27 October 2026

- PASS: Frontend source `20c1483eba7f24e5f1a63837b42d981cc554ee26` was published as Netlify deployment `6ae0be0421774fa585bafe7f`. No backend release or database migration was required.
- PASS: In the real public browser, search found India and thumbs up; medium skin tone selected the intended sequence. The variant menu inserted an exact light/dark mixed-tone handshake, and the recent list showed the chosen emoji.
- PASS: Several selections preserved an existing draft; a later emoji inserted at the saved cursor in the middle of the text. The picker stayed open for repeated selections.
- PASS: At a 375 by 812 viewport, the picker fit within the screen (left 12, right 363, top 282.5, bottom 682.5). Category navigation and the native emoji grid worked. The temporary viewport was reset afterward.
- PASS: The single synthetic QA identity was erased using its own account-bound session. No message was sent to a user or AI provider during the picker checks. Screenshots are `outputs/Veilnivo-full-emoji-picker.jpg` and `outputs/Veilnivo-emoji-mobile.jpg`.

## Public message-actions and keyboard verification - 28 October 2026

- PASS: Source `3cfcbbf362c1fc630aa77b32d39494fea7016a18` deployed to the existing Render service as `dep-dbgqrm7f3r2c73aeq40g`, reaching Live at `2026-10-28T08:12:52.121906Z`. Deployment logs confirmed successful application of `202610280000_message_actions`. The matching Netlify frontend was published as `6ae1aeb09637aa48d2817c8f` on 28 October at 1:43 PM IST.
- PASS: The public browser edited an own message, opened the full reaction picker by double-click and chose 😺, and sent a reply. Selection forwarded two messages together: the edited text and an attachment. Selecting the attachment card toggled it once; double-clicking that card opened reactions and a single tap downloaded the synthetic file.
- PASS: The deletion dialog displayed its available options and Cancel. An independent authenticated sender client deleted its own synthetic message through the public API, and the browser displayed the resulting live deletion record. The browser's Delete for everyone submit action was not used; Delete for me and its persistence have automated coverage only.
- PASS: At a 375 by 812 browser viewport, the chat composer exposed `readOnly=true` and `inputmode=none`. Website keyboard buttons used shift, numbers and backspace to enter `hello World12`, then sent it. Locking and signing in again recovered the edited message, deletion record, reaction and keyboard-authored message.
- PASS: An independent recipient WebCrypto client verified the edited snapshot and revision, deletion row with blank ciphertext/IV, reply target, emoji payload and keyboard message. It also verified the forwarded text and file, fresh attachment ID/key, expiry no later than the original, and successful decryption of the synthetic note.
- PASS: Exactly three generated QA identities were erased through their own account-bound sessions. Existing user identities were not modified. The browser returned to a clean sign-in page and its temporary viewport was reset. Screenshots are `outputs/Veilnivo-message-actions.jpg` and `outputs/Veilnivo-phone-keyboard.jpg`.

## Remaining limits

Public checks used one browser and independent Node WebCrypto clients. Two-browser/device interoperability, actual phone touch gestures, operating-system keyboard behavior, multilingual input methods, public Delete for me persistence, and backend restart/cold-start lifecycle behavior remain unverified publicly. Automated and local coverage is recorded separately above and below. GitHub Actions execution has not been verified, although the workflow is included. Paid billing and live AI are inactive. An independent cryptographic/security audit and a reviewed forward-secrecy protocol remain outside the implemented scope; [SECURITY.md](SECURITY.md) describes the current protocol accurately.

## Connected local deployment smoke check

- PASS: Combined frontend/API started on http://127.0.0.1:3001 with persistent PostgreSQL on 127.0.0.1:54329. Both migrations applied successfully.
- PASS: /api/ready and /api/health returned ok=true; /login/ returned HTTP 200; external AI remained disabled.
- PASS: Authenticated local control status/stop commands stopped the app and database. Database files and the stable session secret were retained. Restart succeeded with no pending migrations and readiness passed again.
- PASS: Browser sign-in with two generated temporary identities, empty search result, exact match preview, explicit request, incoming request review/acceptance, accepted-result Open chat, and bidirectional message composition.
- PASS: Signing in again recovered the other identity's message from the real backend. An independent WebCrypto client read PostgreSQL-backed HTTP history and decrypted both browser-authored messages with the intended recipient's recovered key.
- PASS: The running server's ZIP download matched the SHA-256 of the sanitized source package. The package includes START-HERE.txt and actionable setup instructions, with no runtime secrets, local data, or installed dependencies.
- The two generated QA identities were removed using their own account-bound API sessions after verification. Existing user accounts and history were not modified.
