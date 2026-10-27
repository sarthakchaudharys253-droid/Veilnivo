# Veilnivo security status and protocol amendment

## Status

Veilnivo is an application build with automated checks. It has not received an independent cryptographic audit or penetration test. The product's v2 feature release does not replace its current ECDH/AES message protocol with a ratchet. Do not label the release Signal Protocol, independently audited, forward-secret, post-quantum secure, anonymous, or zero-metadata.

The current client uses native WebCrypto: independently salted PBKDF2-SHA256 (600,000 rounds), password-wrapped P-256 identity keys, static identity ECDH-derived peer AES-256-GCM keys, fresh random 12-byte IVs and authenticated ciphertexts. These protect message contents from a passive storage operator that does not possess a user's keys. They do not provide forward secrecy: later compromise of an identity key can expose recorded messages derived from that identity key.

The production server necessarily observes usernames/aliases, routing participants, timestamps, encrypted message/file sizes, request state, delivery receipts, and connection information. No plaintext message or attachment key is meant to be stored server-side. An AI provider necessarily receives readable prompts over TLS; encrypted saved history and a provider's retention agreement are separate properties.

## User-facing statements

Show these states separately:

- **Encrypted:** message content was encrypted locally before transport. This does not mean the contact's real-world identity was verified.
- **Identity verified:** the complete current public-key fingerprint matches the fingerprint the user explicitly verified using another trusted channel. A changed public key invalidates this state.
- **Connected / offline:** transport availability only. A queued encrypted message has not yet been delivered.
- **Device cleared:** local keys/state and origin browser storage were cleared successfully.
- **Server deletion pending / confirmed:** confirmation appears only after the authenticated server transaction succeeds. Offline local erasure does not prove server erasure.
- **Assistant provider access:** submitting a prompt gives the configured AI provider access to that prompt. The application cannot technically verify the provider's contractual retention settings.

Avoid promises that expiration or erasure retracts copies, screenshots, exported files, browser snapshots, infrastructure backups, or data held by a compromised endpoint. JavaScript can discard key references but cannot guarantee physical memory overwriting. The local preview is an isolated demonstration, not evidence that the production PostgreSQL acceptance suite passed.

## V2 implementation invariants

1. Each attachment receives a fresh independent AES-256-GCM key and IV. Only the encrypted chat payload carries its key, name, MIME type, and declared size. The upload API receives opaque ciphertext/IV plus routing and size metadata. Never place a file key in a URL, server log, public invitation, analytics event, or unencrypted IndexedDB record.
2. Untrusted file names are reduced to safe base names. HTML and SVG are downloaded as inert `application/octet-stream`; decrypted files are not automatically executed or rendered. Object URLs are short-lived and revoked. Encryption authenticates bytes, not file safety.
3. Verification is bound to a full canonical SHA-256 public-key fingerprint, never a boolean attached only to a username. Key changes require a visible warning and re-verification before treating the identity as trusted.
4. Unknown contacts require message acceptance; blocking must be enforced on the server as well as in the UI. Invitation capabilities expire, are revocable, are consumed atomically, and are stored by hash on the server.
5. Client-generated message IDs are idempotency keys. Repeating the same ciphertext returns the same accepted result; reuse with a different recipient or ciphertext is rejected. Keep an expiry tombstone long enough that retrying an expired outbox entry cannot recreate an expired message.
6. Expiration applies to server retrieval, delivery, local decrypted state, encrypted cache, attachment retrieval and attachment deletion. Both sides see the selected policy. Control-event references must not resurrect expired contents.
7. Nuke must cover uploaded attachments, invite capabilities, aliases, contact relations, messages, outbox, sessions, and user. Concurrent uploads/sends and delayed client callbacks must not recreate data after successful erasure. Multiple tabs must release open storage handles.
8. Decrypted payloads must pass semantic validation before caching or rendering. Authenticated routing decides the sender, expiry values must be finite integer timestamps, control messages may use only bounded accepted shapes, and attachment metadata must be validated. A peer cannot claim a recipient sender ID merely because both hold the conversation key.
9. Never send unencrypted message text, file data, encryption keys, public-key comparisons, or contact graphs to analytics. The initial market test should use explicit opt-in feedback, aggregated operational counts, and honest consent.

## Protocol upgrade: explicit amendment, not a silent patch

Signal's Double Ratchet derives changing message keys and mixes fresh Diffie-Hellman outputs to improve protection before and after some key compromises. Its state management, skipped-message limits, authenticated headers and secure deletion requirements are part of the protocol, not optional embellishments. See the [official Double Ratchet specification](https://signal.org/docs/specifications/doubleratchet/).

The maintained [Signal libsignal repository](https://github.com/signalapp/libsignal) exposes Java, Swift and TypeScript wrappers over Rust, with Node native add-ons for its TypeScript package. Its README says use outside Signal is unsupported. That is not a drop-in native-WebCrypto browser dependency. The former [official browser JavaScript library](https://github.com/signalapp/libsignal-protocol-javascript) is archived and explicitly unmaintained. The [third-party TypeScript fork](https://github.com/privacyresearchgroup/libsignal-protocol-typescript) uses a separate curve implementation; the reviewed project documentation did not establish an independent audit for Veilnivo's intended deployment. No such package was added on an assumed audit claim.

An engineering team should select one of these paths before implementing a replacement:

- A maintained native client that can integrate the current official libsignal binding, with explicit dependency/license/version decisions and independent integration review.
- A browser-compatible, maintained protocol implementation with documented review provenance, pinned versions, reproducible builds and an independently reviewed Veilnivo integration. If no suitable implementation is available, commission that work; do not substitute a new home-grown ratchet.

The original PRD's native-WebCrypto-only implementation constraint and password-only restoration of every historical message need explicit revision. Retaining all old transport keys wrapped under one recoverable password-derived key would weaken the intended historical-compromise protection. The product must decide whether a fresh login loses old ratcheted history, imports an explicitly user-held encrypted history export, or offers a separately specified archive with a clearly different threat model. Backups remain out of scope unless this decision changes that requirement.

## Proposed migration contract

- Introduce an authenticated envelope `protocol_version` and a fixed supported-suite identifier. Existing records remain explicitly legacy. Unknown or retired versions fail closed.
- Publish authenticated identity/prekey bundles; consume one-time prekeys atomically. Bind account ID, device ID, protocol suite and session ID into authenticated context. Do not re-use the current ECDH identity key as an improvised signing key.
- Store ratchet state locally, encrypted at rest with versioned serialization. Atomically persist the next ratchet state and the encrypted outbox item, so a crash cannot roll back and re-use a message key.
- Prevent concurrent browser tabs from advancing the same session state. Use a tested single-writer lock and durable transaction model. Limit and expire skipped-message keys to resist memory/storage exhaustion.
- Show contact-key changes and restart verification explicitly. Pin supported protocol versions per session; an attacker-controlled peer response must not downgrade a ratcheted session to legacy encryption.
- Keep legacy history read-only under its original key scheme while both peers negotiate a fresh new session. Never decrypt and re-upload old history merely to make a migration look complete.
- Delete session keys, skipped keys, file keys, encrypted outbox records and prekeys in both local and remote erasure paths. Maintain the distinction between account deletion and independently held recipient copies.

## Required validation before production security claims

Use the selected implementation's published vectors and interoperability tests. Then exercise offline initialization, concurrent first messages, reordered/dropped/duplicated messages, replay, altered headers, key substitution, downgrade attempts, stale prekeys, prekey exhaustion, crash recovery, storage rollback, parallel tabs and skipped-key limits. Test every supported platform and protocol-version migration.

Use compromise simulations that actually reveal current ratchet state and verify the documented limits for old and future ciphertexts; an AES round-trip test is not a forward-secrecy test. Include malicious-server routing/key-substitution tests, expired idempotency retries, blocked-contact attachment access and simultaneous upload/nuke tests against an isolated PostgreSQL instance.

An independent specialist should review protocol selection, state persistence, browser delivery, key verification, content rendering, attachment lifecycle, deletion and deployment before a strong production-security launch. This repository's automated checks and internal code review do not replace that review.

## Security reporting

No external reporting address or audit provider is configured in this build. The operator should publish a real security contact and response process before inviting production users to rely on this application for sensitive communications.


## Local production-hardening update

Authentication now bounds expensive Argon2 operations process-wide. Live HTTP requests and socket handshakes bind to the account whose keys the tab unlocked, so a changed shared session cookie cannot silently apply those requests to another account. Passive sockets leave rooms when their database or signed-token session expires. Authoritative client snapshots and expiry events reconcile missing peer/message data before cached history is restored.

The optional Netlify/Render transport keeps HTTP authentication in Secure, HttpOnly, SameSite=Strict host-only cookies through the frontend's same-origin API proxy. Direct cross-site WebSockets use a separate, opaque, single-use 256-bit ticket minted by an authenticated, account-bound POST. Tickets expire within 30 seconds, are stored as hashes in a bounded server map, and are revalidated against the live session before connection. They cannot authenticate HTTP requests, are never placed in URLs or browser storage, and are revoked on logout/erasure. A supplied invalid ticket never falls back to a cookie. This changes transport authentication, not the message encryption protocol or its forward-secrecy limits.

These implementation fixes are covered by regression and real PostgreSQL integration checks. They do not change the documented cryptographic protocol or establish an independent audit claim.
