import test from 'node:test';
import assert from 'node:assert/strict';
import {bytesToBase64} from '../src/lib/crypto';
import {CHAT_LOCK_ITERATIONS,MAX_CHAT_LOCK_CODE_UNITS,countChatLockCharacters,validateChatLockCode,createChatLockVerifier,verifyChatLockCode,isChatLockVerifier} from '../src/lib/chat-lock';

test('chat-lock limits count visible Unicode characters and preserve exact keyboard input',()=>{
 for(const code of ['abcd','a  b','    ','1#₹!','👨‍👩‍👧‍👦🔐🚀💚','e\u0301abc','क्षabc','😀'.repeat(12)])assert.equal(validateChatLockCode(code),null,code);
 assert.equal(countChatLockCharacters('👨‍👩‍👧‍👦🇮🇳👍🏽1️⃣'),4);
 assert.equal(countChatLockCharacters('e\u0301abc'),4);
 for(const code of ['', 'abc','😀'.repeat(13),'a'.repeat(13),null,42,'abc\n','a\tb!','ab\u0000c','ab\ud800c','ab\udc00c'])assert.equal(typeof validateChatLockCode(code),'string');
 const oversized='a'+'\u0301'.repeat(MAX_CHAT_LOCK_CODE_UNITS);assert.equal(typeof validateChatLockCode(oversized),'string');assert.ok(countChatLockCharacters(oversized)>12);
});

test('older-browser fallback keeps emoji families, tones, flags and combining marks together',()=>{
 const descriptor=Object.getOwnPropertyDescriptor(Intl,'Segmenter');
 try{
  Object.defineProperty(Intl,'Segmenter',{value:undefined,writable:true,configurable:true});
  assert.equal(countChatLockCharacters('👨‍👩‍👧‍👦🇮🇳👍🏽1️⃣'),4);
  assert.equal(countChatLockCharacters('e\u0301abc'),4);
  assert.equal(countChatLockCharacters('각abc'),4);
  assert.equal(countChatLockCharacters('a\u200dbcd'),4,'a ZWJ cannot join arbitrary alphabet characters');
 }finally{if(descriptor)Object.defineProperty(Intl,'Segmenter',descriptor)}
});

test('chat-lock verification is salted, exact, domain-separated and stores no plaintext',async()=>{
 const code=' A🔐#',first=await createChatLockVerifier(code),second=await createChatLockVerifier(code);
 assert.equal(first.iterations,600_000);assert.equal(first.iterations,CHAT_LOCK_ITERATIONS);
 assert.notEqual(first.salt,second.salt);assert.notEqual(first.verifier,second.verifier);
 assert.equal(isChatLockVerifier(JSON.parse(JSON.stringify(first))),true);
 assert.equal(JSON.stringify(first).includes(code),false);
 assert.equal(await verifyChatLockCode(code,first),true);
 for(const wrong of [' A🔒#','a A🔐#',' A🔐# ',' A🔐!'])assert.equal(await verifyChatLockCode(wrong,first),false);
 const composed=await createChatLockVerifier('é123');
 assert.equal(await verifyChatLockCode('e\u0301123',composed),false,'visually similar normalization is not silently changed');
 const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(code),'PBKDF2',false,['deriveBits']);
 const salt=Uint8Array.from(atob(first.salt),character=>character.charCodeAt(0));
 const raw=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',iterations:CHAT_LOCK_ITERATIONS,salt},material,256);
 assert.notEqual(bytesToBase64(new Uint8Array(raw)),first.verifier,'chat-lock verifier is separate from a generic password derivation');
});

test('invalid codes and malformed verifier records fail before invoking the expensive KDF',async()=>{
 const record={version:1,algorithm:'PBKDF2-SHA256',iterations:CHAT_LOCK_ITERATIONS,salt:bytesToBase64(new Uint8Array(16)),verifier:bytesToBase64(new Uint8Array(32))};
 for(const changed of [null,[],{}, {...record,version:2},{...record,iterations:1},{...record,iterations:1e12},{...record,algorithm:'SHA-1'},{...record,salt:'x'.repeat(10000)},{...record,salt:bytesToBase64(new Uint8Array(15))},{...record,verifier:'!!!'},{...record,secret:'abcd'}]){
  assert.equal(isChatLockVerifier(changed),false);assert.equal(await verifyChatLockCode('abcd',changed),false);
 }
 assert.equal(await verifyChatLockCode('ab',record),false);
 await assert.rejects(createChatLockVerifier('abc'),/4–12/);
 await assert.rejects(createChatLockVerifier('a'+'\u0301'.repeat(MAX_CHAT_LOCK_CODE_UNITS)),/too long/);
});
