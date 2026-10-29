import assert from 'node:assert/strict';
import {before,test} from 'node:test';
import {base64ToBytes,bytesToBase64,deriveSharedSecret,encryptPayload,generateIdentityKeyPair} from '../src/lib/crypto';
import {decryptGroupPayload,encryptGroupPayload,generateGroupKey,unwrapGroupKey,wrapGroupKey} from '../src/lib/group-crypto';

const group=crypto.randomUUID(),otherGroup=crypto.randomUUID();
const aliceId=crypto.randomUUID(),bobId=crypto.randomUUID(),caraId=crypto.randomUUID();
let alice:Awaited<ReturnType<typeof generateIdentityKeyPair>>,bob:typeof alice,cara:typeof alice;
before(async()=>{[alice,bob,cara]=await Promise.all([generateIdentityKeyPair(),generateIdentityKeyPair(),generateIdentityKeyPair()])});
function alter(value:string){const bytes=base64ToBytes(value);bytes[0]^=1;return bytesToBase64(bytes)}

test('group members independently recover their key and decrypt each other including owner self recovery',async()=>{
  const key=await generateGroupKey(),participants=[[alice,aliceId],[bob,bobId],[cara,caraId]] as const;
  const recovered:CryptoKey[]=[];
  for(const [member,id]of participants){
    const envelope=await wrapGroupKey(key,alice.privateKey,member.publicKeyJwk,group,1,{wrappedById:aliceId,recipientId:id});
    assert.equal(base64ToBytes(envelope.iv).length,12);
    const active=await unwrapGroupKey(envelope,member.privateKey,alice.publicKeyJwk,group,1,{wrappedById:aliceId,recipientId:id});
    assert.equal(active.extractable,false);await assert.rejects(crypto.subtle.exportKey('raw',active));recovered.push(active);
  }
  const payload={id:crypto.randomUUID(),senderId:bobId,type:'text',text:'Hello to every group member 👋',timestamp:Date.now()};
  const encrypted=await encryptGroupPayload(payload,recovered[1],group,1);
  for(const active of recovered)assert.deepEqual(await decryptGroupPayload(encrypted.ciphertext,encrypted.iv,active,group,1),payload);
  assert.equal(encrypted.ciphertext.includes(payload.text),false);
});

test('group key wrapping binds conversation, version, identities and ECDH participants exactly',async()=>{
  const key=await generateGroupKey(),ids={wrappedById:aliceId,recipientId:bobId};
  const envelope=await wrapGroupKey(key,alice.privateKey,bob.publicKeyJwk,group,1,ids);
  await assert.rejects(unwrapGroupKey(envelope,bob.privateKey,alice.publicKeyJwk,otherGroup,1,ids));
  await assert.rejects(unwrapGroupKey(envelope,bob.privateKey,alice.publicKeyJwk,group,2,ids));
  await assert.rejects(unwrapGroupKey(envelope,bob.privateKey,alice.publicKeyJwk,group,1,{...ids,recipientId:caraId}));
  await assert.rejects(unwrapGroupKey(envelope,bob.privateKey,alice.publicKeyJwk,group,1,{...ids,wrappedById:caraId}));
  await assert.rejects(unwrapGroupKey(envelope,cara.privateKey,alice.publicKeyJwk,group,1,ids));
  await assert.rejects(unwrapGroupKey(envelope,bob.privateKey,cara.publicKeyJwk,group,1,ids));
  // The reverse ECDH direction derives the same transport key, but its identities differ.
  await assert.rejects(unwrapGroupKey(envelope,alice.privateKey,bob.publicKeyJwk,group,1,{wrappedById:bobId,recipientId:aliceId}));
  await assert.rejects(unwrapGroupKey({...envelope,ciphertext:alter(envelope.ciphertext)},bob.privateKey,alice.publicKeyJwk,group,1,ids));
  await assert.rejects(unwrapGroupKey({...envelope,iv:alter(envelope.iv)},bob.privateKey,alice.publicKeyJwk,group,1,ids));
});

test('group messages reject cross-conversation, cross-version, wrong-key and altered envelopes',async()=>{
  const key=await generateGroupKey(),wrong=await generateGroupKey(),payload={text:'Authenticated group content'};
  const first=await encryptGroupPayload(payload,key,group,1),second=await encryptGroupPayload(payload,key,group,1);
  assert.notEqual(first.iv,second.iv);assert.notEqual(first.ciphertext,second.ciphertext);
  await assert.rejects(decryptGroupPayload(first.ciphertext,first.iv,key,otherGroup,1));
  await assert.rejects(decryptGroupPayload(first.ciphertext,first.iv,key,group,2));
  await assert.rejects(decryptGroupPayload(first.ciphertext,first.iv,wrong,group,1));
  await assert.rejects(decryptGroupPayload(alter(first.ciphertext),first.iv,key,group,1));
  await assert.rejects(decryptGroupPayload(first.ciphertext,alter(first.iv),key,group,1));
  // A generic peer payload encrypted with the same key is not a group-message envelope.
  const unbound=await encryptPayload(payload,key);
  await assert.rejects(decryptGroupPayload(unbound.ciphertext,unbound.iv,key,group,1));
});

test('a fresh membership key keeps prior history unavailable to the newly added member',async()=>{
  const previous=await generateGroupKey(),current=await generateGroupKey();
  const oldMessage=await encryptGroupPayload({text:'Before Cara joined'},previous,group,1);
  const ids={wrappedById:aliceId,recipientId:caraId},envelope=await wrapGroupKey(current,alice.privateKey,cara.publicKeyJwk,group,2,ids);
  const caraKey=await unwrapGroupKey(envelope,cara.privateKey,alice.publicKeyJwk,group,2,ids);
  await assert.rejects(decryptGroupPayload(oldMessage.ciphertext,oldMessage.iv,caraKey,group,1));
  const nextMessage=await encryptGroupPayload({text:'Welcome Cara'},current,group,2);
  assert.deepEqual(await decryptGroupPayload(nextMessage.ciphertext,nextMessage.iv,caraKey,group,2),{text:'Welcome Cara'});
  assert.deepEqual(await decryptGroupPayload(oldMessage.ciphertext,oldMessage.iv,previous,group,1),{text:'Before Cara joined'});
});

test('malformed group context, key material, encodings and domain wrappers fail closed',async()=>{
  const key=await generateGroupKey(),ids={wrappedById:aliceId,recipientId:bobId};
  for(const version of [0,-1,1.5,NaN,Infinity,2_147_483_648])await assert.rejects(encryptGroupPayload({},key,group,version));
  await assert.rejects(encryptGroupPayload({},key,'not-a-group',1));
  await assert.rejects(encryptGroupPayload(undefined,key,group,1));
  await assert.rejects(encryptGroupPayload({text:'x'.repeat(131_072)},key,group,1));
  const shortKey=await crypto.subtle.generateKey({name:'AES-GCM',length:128},true,['encrypt','decrypt']);
  await assert.rejects(wrapGroupKey(shortKey,alice.privateKey,bob.publicKeyJwk,group,1,ids));
  const wrappingKey=await deriveSharedSecret(alice.privateKey,bob.publicKeyJwk);
  const malformed=await encryptPayload({type:'veilnivo-group-key-v1',groupId:group,keyVersion:1,...ids,key:bytesToBase64(new Uint8Array(31))},wrappingKey);
  await assert.rejects(unwrapGroupKey(malformed,bob.privateKey,alice.publicKeyJwk,group,1,ids));
  const wrongDomain=await encryptPayload({type:'peer-key',groupId:group,keyVersion:1,...ids,key:bytesToBase64(new Uint8Array(32))},wrappingKey);
  await assert.rejects(unwrapGroupKey(wrongDomain,bob.privateKey,alice.publicKeyJwk,group,1,ids));
  const encrypted=await encryptGroupPayload({},key,group,1);
  await assert.rejects(decryptGroupPayload(encrypted.ciphertext,encrypted.iv.slice(0,-1)+'=',key,group,1));
  await assert.rejects(decryptGroupPayload('%%%%',encrypted.iv,key,group,1));
  await assert.rejects(decryptGroupPayload('AAAA',encrypted.iv,key,group,1));
});
