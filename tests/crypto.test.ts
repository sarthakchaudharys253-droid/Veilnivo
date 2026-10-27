import assert from "node:assert/strict";
import { before, test } from "node:test";
import {
  base64ToBytes, bytesToBase64, decryptPayload, deriveKeysFromPassword,
  deriveSharedSecret, encryptPayload, fingerprint, generateIdentityKeyPair,
  safetyNumber, unwrapPrivateKey, wrapPrivateKey,
} from "../src/lib/crypto.ts";

let alice: Awaited<ReturnType<typeof generateIdentityKeyPair>>;
let bob: Awaited<ReturnType<typeof generateIdentityKeyPair>>;
let aliceKeys: Awaited<ReturnType<typeof deriveKeysFromPassword>>;
before(async () => {
  [alice, bob, aliceKeys] = await Promise.all([
    generateIdentityKeyPair(), generateIdentityKeyPair(), deriveKeysFromPassword("test passphrase: never sent to server"),
  ]);
});

test("ECDH peers independently derive a key that decrypts the other's payload", async () => {
  const [a, b] = await Promise.all([
    deriveSharedSecret(alice.privateKey, bob.publicKeyJwk),
    deriveSharedSecret(bob.privateKey, alice.publicKeyJwk),
  ]);
  const payload = { text: "Hello, private world 👻", timestamp: 1720000000, type: "text" };
  const encrypted = await encryptPayload(payload, a);
  assert.deepEqual(await decryptPayload(encrypted.ciphertext, encrypted.iv, b), payload);
  assert.equal(a.extractable, false);
  assert.equal(base64ToBytes(encrypted.iv).length, 12);
  assert.ok(!encrypted.ciphertext.includes(payload.text));
});

test("the same plaintext always receives a fresh random IV and ciphertext", async () => {
  const key = await deriveSharedSecret(alice.privateKey, bob.publicKeyJwk);
  const records = await Promise.all(Array.from({ length: 20 }, () => encryptPayload({ text: "Hello" }, key)));
  assert.equal(new Set(records.map(row => row.iv)).size, records.length);
  assert.equal(new Set(records.map(row => row.ciphertext)).size, records.length);
});

test("tampered ciphertext, tampered IV, wrong key and invalid IV fail authentication", async () => {
  const key = await deriveSharedSecret(alice.privateKey, bob.publicKeyJwk);
  const record = await encryptPayload({ text: "must remain authenticated" }, key);
  const corrupt = base64ToBytes(record.ciphertext);
  corrupt[0] ^= 1;
  await assert.rejects(decryptPayload(bytesToBase64(corrupt), record.iv, key));
  const corruptIv = base64ToBytes(record.iv);
  corruptIv[0] ^= 1;
  await assert.rejects(decryptPayload(record.ciphertext, bytesToBase64(corruptIv), key));
  await assert.rejects(decryptPayload(record.ciphertext, record.iv, aliceKeys.masterWrappingKey));
  await assert.rejects(decryptPayload(record.ciphertext, bytesToBase64(new Uint8Array(11)), key));
});

test("a fresh session recovers the identity and historical messages using password and server bundle", async () => {
  const wrapped = await wrapPrivateKey(alice.privateKey, aliceKeys.masterWrappingKey);
  const conversation = await deriveSharedSecret(alice.privateKey, bob.publicKeyJwk);
  const history = await encryptPayload({ text: "recover me after storage is cleared" }, conversation);
  const serverBundle = { ...wrapped, authSalt: aliceKeys.authSalt, wrapSalt: aliceKeys.wrapSalt, publicKeyJwk: alice.publicKeyJwk };
  const recoveredKeys = await deriveKeysFromPassword("test passphrase: never sent to server", serverBundle.authSalt, serverBundle.wrapSalt);
  assert.equal(recoveredKeys.authHash, aliceKeys.authHash);
  const identity = await unwrapPrivateKey(serverBundle.ciphertext, serverBundle.iv, recoveredKeys.masterWrappingKey);
  assert.equal(identity.extractable, false);
  await assert.rejects(crypto.subtle.exportKey("jwk", identity));
  const recoveredConversation = await deriveSharedSecret(identity, bob.publicKeyJwk);
  assert.deepEqual(await decryptPayload(history.ciphertext, history.iv, recoveredConversation), { text: "recover me after storage is cleared" });
});

test("independent salts produce independent keys; wrong passwords cannot unwrap identity", async () => {
  assert.equal(base64ToBytes(aliceKeys.authSalt).length, 16);
  assert.equal(base64ToBytes(aliceKeys.wrapSalt).length, 16);
  assert.notEqual(aliceKeys.authSalt, aliceKeys.wrapSalt);
  assert.equal(base64ToBytes(aliceKeys.authHash).length, 32);
  assert.equal(aliceKeys.masterWrappingKey.extractable, false);
  const wrong = await deriveKeysFromPassword("a different password", aliceKeys.authSalt, aliceKeys.wrapSalt);
  assert.notEqual(wrong.authHash, aliceKeys.authHash);
  const wrapped = await wrapPrivateKey(alice.privateKey, aliceKeys.masterWrappingKey);
  await assert.rejects(unwrapPrivateKey(wrapped.ciphertext, wrapped.iv, wrong.masterWrappingKey));
  await assert.rejects(deriveKeysFromPassword("password", aliceKeys.authSalt, aliceKeys.authSalt));
  await assert.rejects(deriveKeysFromPassword("password", bytesToBase64(new Uint8Array(15))));
});

test("safety numbers match on both peers and change if either identity changes", async () => {
  assert.equal(await safetyNumber(alice.publicKeyJwk, bob.publicKeyJwk), await safetyNumber(bob.publicKeyJwk, alice.publicKeyJwk));
  const charlie = await generateIdentityKeyPair();
  assert.notEqual(await safetyNumber(alice.publicKeyJwk, bob.publicKeyJwk), await safetyNumber(alice.publicKeyJwk, charlie.publicKeyJwk));
  assert.equal(await fingerprint(alice.publicKeyJwk), await fingerprint({ ...alice.publicKeyJwk, ext: false, key_ops: [] }));
  assert.match(await fingerprint(alice.publicKeyJwk), /^(?:[0-9A-F]{4} ){15}[0-9A-F]{4}$/);
});

test("encrypted bot history uses master wrapping key; malformed Base64 is rejected", async () => {
  const history = { prompt: "Hello bot", response: "No plaintext in local storage" };
  const record = await encryptPayload(history, aliceKeys.masterWrappingKey);
  assert.deepEqual(await decryptPayload(record.ciphertext, record.iv, aliceKeys.masterWrappingKey), history);
  assert.throws(() => base64ToBytes("%%%%"), /Base64/);
});
