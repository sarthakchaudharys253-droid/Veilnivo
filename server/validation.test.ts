import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { base64, envelope, publicKey, username, encodeHistoryCursor, parseHistoryCursor } from "./validation";

test("username rejects PII-shaped identifiers and reserved bot handles", () => {
  assert.equal(username("cipher_42"), "cipher_42");
  for (const value of ["a@b.com", "+123456789", "UPPER", "bot", "ab", "../admin"]) assert.throws(() => username(value));
});

test("envelopes accept only canonical base64 and a 96-bit IV", () => {
  const valid = {recipient_id: "12dd6cf1-d58a-40a6-b0bf-9617217e2247", ciphertext: randomBytes(32).toString("base64"), iv: randomBytes(12).toString("base64")};
  assert.deepEqual(envelope(valid), valid);
  assert.throws(() => envelope({...valid, iv: randomBytes(16).toString("base64")}));
  assert.throws(() => envelope({...valid, ciphertext: "hello readable message"}));
  assert.throws(() => base64("AAAA\n", "proof"));
});

test("public identity records reject accidental private key uploads", () => {
  const point = randomBytes(32).toString("base64url");
  const key = {kty:"EC", crv:"P-256", x:point, y:point};
  assert.equal(publicKey(key).crv, "P-256");
  assert.throws(() => publicKey({...key, d:point}));
  assert.throws(() => publicKey({...key, crv:"P-384"}));
});


test("history cursors round-trip timestamps and UUID ties and reject malformed cursors", () => {
  const timestamp=new Date("2026-10-25T10:00:00.000Z");
  const first={createdAt:timestamp,id:"12dd6cf1-d58a-40a6-b0bf-9617217e2247"};
  const second={createdAt:timestamp,id:"12dd6cf1-d58a-40a6-b0bf-9617217e2248"};
  assert.deepEqual(parseHistoryCursor(encodeHistoryCursor(first)),first);
  assert.notEqual(encodeHistoryCursor(first),encodeHistoryCursor(second));
  assert.equal(parseHistoryCursor(undefined),undefined);
  for (const bad of ["",null,"not+base64",encodeHistoryCursor(first)+"=",Buffer.from(JSON.stringify({created_at:"bad date",id:first.id})).toString("base64url"),Buffer.from(JSON.stringify({created_at:timestamp.toISOString(),id:"../oops"})).toString("base64url")]) assert.throws(() => parseHistoryCursor(bad));
});
