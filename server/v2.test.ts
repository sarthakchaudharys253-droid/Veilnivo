import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { ttlSeconds,pair,expiresAt,invitationToken,tokenHash,encryptedAttachment,clientMessageId,MAX_FILE_BYTES,liveWhere } from './v2';

test('conversation expiry accepts only supported explicit timers',()=>{
 for(const value of [0,3600,86400,604800])assert.equal(ttlSeconds(value),value);
 for(const value of [1,-1,'3600',undefined,Infinity,86400.5])assert.throws(()=>ttlSeconds(value));
 const now=new Date('2026-10-25T00:00:00.000Z');
 assert.equal(expiresAt(0,now),null);assert.equal(expiresAt(3600,now)?.toISOString(),'2026-10-25T01:00:00.000Z');
 assert.deepEqual(liveWhere(now),{OR:[{expiresAt:null},{expiresAt:{gt:now}}]});
});

test('contact pair identity is stable in both directions',()=>{
 const a=randomUUID(),b=randomUUID();assert.deepEqual(pair(a,b),pair(b,a));assert.notEqual(pair(a,b).userAId,pair(a,b).userBId);
});

test('invitations require a canonical random 256-bit token and store only a hash',async()=>{
 const token=randomBytes(32).toString('base64url');assert.equal(invitationToken(token),token);
 const hash=await tokenHash(token);assert.match(hash,/^[0-9a-f]{64}$/);assert.notEqual(hash,token);assert.equal(await tokenHash(token),hash);
 assert.notEqual(await tokenHash(randomBytes(32).toString('base64url')),hash);
 for(const bad of ['',token+'=',token.slice(0,-1),token+'x','../'+token,null])assert.throws(()=>invitationToken(bad));
});

test('encrypted attachments enforce authenticated size, recipient and random-IV envelope boundaries',()=>{
 const plainBytes=64;const valid={recipient_id:randomUUID(),ciphertext:randomBytes(plainBytes+16).toString('base64'),iv:randomBytes(12).toString('base64'),size:plainBytes};
 assert.equal(encryptedAttachment(valid).size,plainBytes);
 for(const change of [{size:0},{size:MAX_FILE_BYTES+1},{size:plainBytes+1},{iv:randomBytes(16).toString('base64')},{ciphertext:'plaintext-filename.txt'},{recipient_id:'someone'}])assert.throws(()=>encryptedAttachment({...valid,...change}));
 assert.equal(clientMessageId(undefined),undefined);const nonce=randomUUID();assert.equal(clientMessageId(nonce),nonce);assert.throws(()=>clientMessageId('../retry'));
});
