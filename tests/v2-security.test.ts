import { BOT_CONTACT_ID } from '../src/lib/compat';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { base64ToBytes, bytesToBase64, deriveSharedSecret, encryptPayload, decryptPayload, fingerprint, generateIdentityKeyPair } from '../src/lib/crypto.ts';
import { encryptAttachment, decryptAttachment, MAX_ATTACHMENT_BYTES, sanitizedFilename, safeAttachmentMime, isVerifiedFingerprint } from '../src/lib/chat-utils.ts';

function file(text: string, name = 'notes.txt', type = 'text/plain') {
  const bytes = new TextEncoder().encode(text);
  return { name, type, size: bytes.byteLength, arrayBuffer: async () => bytes.buffer };
}

test('attachment bytes use independent random keys and IVs, and decrypt intact', async () => {
  const a = await encryptAttachment(file('confidential attachment content'));
  const b = await encryptAttachment(file('confidential attachment content'));
  assert.notEqual(a.metadata.key, b.metadata.key);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ciphertext, b.ciphertext);
  assert.equal(base64ToBytes(a.metadata.key).byteLength, 32);
  assert.equal(base64ToBytes(a.iv).byteLength, 12);
  const blob = await decryptAttachment({ id: 'opaque-file', ...a.metadata }, a.ciphertext, a.iv);
  assert.equal(await blob.text(), 'confidential attachment content');
  assert.equal(blob.type, 'text/plain');
});

test('attachment tampering, wrong keys, mismatched metadata and invalid sizes fail', async () => {
  const a = await encryptAttachment(file('authenticated file'));
  const b = await encryptAttachment(file('another file'));
  const meta = { id: 'opaque-file', ...a.metadata };
  const corrupt = base64ToBytes(a.ciphertext); corrupt[0] ^= 1;
  await assert.rejects(decryptAttachment(meta, bytesToBase64(corrupt), a.iv));
  await assert.rejects(decryptAttachment({ ...meta, key: b.metadata.key }, a.ciphertext, a.iv));
  await assert.rejects(decryptAttachment({ ...meta, iv: b.iv }, a.ciphertext, a.iv));
  await assert.rejects(decryptAttachment({ ...meta, size: meta.size + 1 }, a.ciphertext, a.iv));
  await assert.rejects(encryptAttachment({ name: 'too-big', type: '', size: MAX_ATTACHMENT_BYTES + 1, arrayBuffer: async () => { throw new Error('must not read oversized input'); } }), /10 MB/);
  await assert.rejects(encryptAttachment({ ...file('actual size'), size: 1 }), /size changed/);
  await assert.rejects(encryptAttachment(file('')), /nonempty/);
});

test('attachment keys and names travel inside the encrypted conversation payload', async () => {
  const [alice, bob] = await Promise.all([generateIdentityKeyPair(), generateIdentityKeyPair()]);
  const [sendKey, receiveKey] = await Promise.all([deriveSharedSecret(alice.privateKey, bob.publicKeyJwk), deriveSharedSecret(bob.privateKey, alice.publicKeyJwk)]);
  const attachment = await encryptAttachment(file('private bytes', 'private-plan.txt'));
  const payload = { text: 'A private file', type: 'attachment', attachment: { id: 'opaque-upload-id', ...attachment.metadata } };
  const wire = await encryptPayload(payload, sendKey);
  assert.equal(Object.keys(wire).sort().join(','), 'ciphertext,iv');
  assert.ok(!JSON.stringify(wire).includes(payload.attachment.name));
  assert.ok(!JSON.stringify(wire).includes(payload.attachment.key));
  const decoded = await decryptPayload<typeof payload>(wire.ciphertext, wire.iv, receiveKey);
  const blob = await decryptAttachment(decoded.attachment, attachment.ciphertext, attachment.iv);
  assert.equal(await blob.text(), 'private bytes');
});

test('verification is bound to the whole current public key and rejects shortcut labels', async () => {
  const [oldIdentity, newIdentity] = await Promise.all([generateIdentityKeyPair(), generateIdentityKeyPair()]);
  const oldFingerprint = await fingerprint(oldIdentity.publicKeyJwk);
  const changedFingerprint = await fingerprint(newIdentity.publicKeyJwk);
  assert.equal(isVerifiedFingerprint(oldFingerprint, oldFingerprint), true);
  assert.equal(isVerifiedFingerprint(oldFingerprint.toLowerCase(), oldFingerprint), true);
  assert.equal(isVerifiedFingerprint(oldFingerprint, changedFingerprint), false);
  assert.equal(isVerifiedFingerprint('verified', oldFingerprint), false);
  assert.equal(isVerifiedFingerprint(undefined, oldFingerprint), false);
  assert.equal(isVerifiedFingerprint('', ''), false);
  assert.equal(isVerifiedFingerprint(oldFingerprint.slice(0, -1), oldFingerprint), false);
});

test('filenames cannot provide filesystem paths or bidi masquerades; active MIME types download inertly', () => {
  assert.equal(sanitizedFilename('../../secrets.txt'), 'secrets.txt');
  assert.equal(sanitizedFilename('C:\\private\\notes.txt'), 'notes.txt');
  assert.equal(sanitizedFilename('invoice\u202Egpj.exe'), 'invoicegpj.exe');
  assert.equal(sanitizedFilename('NUL.txt'), '_NUL.txt');
  assert.equal(sanitizedFilename('..'), 'attachment.bin');
  assert.equal(safeAttachmentMime('text/html'), 'application/octet-stream');
  assert.equal(safeAttachmentMime('image/svg+xml'), 'application/octet-stream');
  assert.equal(safeAttachmentMime('Image/PNG; charset=utf-8'), 'image/png');
});


test('authenticated routing binds message authorship and accepts only validated semantic metadata', async () => {
  const { validateMessagePayload } = await import('../src/lib/chat-utils.ts');
  const sender = crypto.randomUUID(), self = crypto.randomUUID();
  const payload = { id: crypto.randomUUID(), text: 'hello', timestamp: Date.now(), senderId: sender, type: 'text' };
  assert.doesNotThrow(() => validateMessagePayload(payload, sender, self));
  assert.throws(() => validateMessagePayload({ ...payload, senderId: self }, sender, self), /metadata/);
  assert.throws(() => validateMessagePayload({ ...payload, timestamp: NaN }, sender, self), /metadata/);
  assert.throws(() => validateMessagePayload({ ...payload, expiresAt: 'tomorrow' }, sender, self), /metadata/);
  assert.throws(() => validateMessagePayload({ ...payload, expiresAt: payload.timestamp - 1 }, sender, self), /metadata/);
  assert.throws(() => validateMessagePayload({ ...payload, text: 'x'.repeat(10_001) }, sender, self), /metadata/);
  assert.doesNotThrow(() => validateMessagePayload({ ...payload, type: 'reaction', targetId: crypto.randomUUID(), emoji: '💚', active: true }, sender, self));
  assert.throws(() => validateMessagePayload({ ...payload, type: 'reaction', targetId: '__proto__', emoji: '💚', active: true }, sender, self), /metadata/);
  assert.throws(() => validateMessagePayload({ ...payload, type: 'reaction', targetId: crypto.randomUUID(), emoji: '<script>', active: true }, sender, self), /metadata/);
  assert.doesNotThrow(() => validateMessagePayload({ ...payload, type: 'bot', senderId: BOT_CONTACT_ID }, self, self, true));
  assert.throws(() => validateMessagePayload({ ...payload, type: 'bot', senderId: BOT_CONTACT_ID }, sender, self, true), /metadata/);
  const encrypted = await encryptAttachment(file('attachment'));
  const attachment = { id: crypto.randomUUID(), ...encrypted.metadata };
  assert.doesNotThrow(() => validateMessagePayload({ ...payload, attachment }, sender, self));
  assert.throws(() => validateMessagePayload({ ...payload, attachment: { ...attachment, name: '../../secret' } }, sender, self), /metadata/);
  assert.throws(() => validateMessagePayload({ ...payload, attachment: { ...attachment, mime: 'text/html' } }, sender, self), /metadata/);
});
