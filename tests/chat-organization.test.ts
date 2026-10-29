import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {useVeilnivo,CHAT_PIN_LIMITS} from '../src/lib/store';
import {db} from '../src/lib/db';
import {BOT_CONTACT_ID as BOT} from '../src/lib/compat';
import {deriveKeysFromPassword,decryptPayload} from '../src/lib/crypto';

Object.defineProperty(globalThis,'window',{value:undefined,configurable:true});
const state=()=>useVeilnivo.getState(),password='SyntheticOrganizationPassword2026!';
const noError=()=>assert.equal(state().error,null);

test('bulk organization has no arbitrary selection cap and Free pin limits are atomic',async()=>{
 try{
  await state().initDemo();noError();const template=state().conversations.find(c=>!c.isBot)!;
  const contacts=Array.from({length:72},(_,index)=>({...template,id:`bulk-chat-${index}`,username:`bulk_${index}`,name:`Bulk ${index}`}));
  useVeilnivo.setState(s=>({conversations:[...s.conversations,...contacts]}));const ids=contacts.map(c=>c.id);
  assert.equal(await state().organizeChats(ids,'archive'),true);noError();
  assert.equal(state().conversations.filter(c=>ids.includes(c.id)&&c.archived).length,72);
  assert.equal(await state().organizeChats(ids,'unarchive'),true);noError();
  assert.equal(await state().organizeChats(ids.slice(0,3),'pin'),true);noError();
  assert.equal(await state().organizeChats([ids[3]],'pin'),false);assert.match(state().error??'',/3 pinned/);state().clearError();
  assert.deepEqual(state().conversations.filter(c=>!c.isBot&&c.pinned).map(c=>c.id).sort(),ids.slice(0,3).sort());
  assert.equal(state().pinLimit,CHAT_PIN_LIMITS.free);assert.equal(CHAT_PIN_LIMITS.plus,10);
  assert.equal(await state().organizeChats(ids.slice(0,3),'archive'),true);noError();
  assert.equal(state().conversations.some(c=>!c.isBot&&c.pinned),false,'archiving releases Free pin slots');
 }finally{await state().logout();db.close()}
});

test('device-local clearing, deletion and secret-code reset persist without changing the recipient copy',async t=>{
 try{
  await state().register('organization_alice',password);noError();const alice=state().user!;
  await state().logout();await state().register('organization_bob',password);noError();const bob=state().user!;
  await state().findUser(alice.username);noError();
  await state().logout();await state().login(alice.username,password);noError();
  await state().acceptRequest(state().messageRequests.find(r=>r.peer.id===bob.id)!.id);noError();state().selectChat(bob.id);
  await state().send('History before local clear');noError();
  await state().sendAttachment(new File(['Preserve the other person’s attachment'],'organization-private.txt',{type:'text/plain'}));noError();
  const old=state().messages[bob.id].find(m=>m.text==='History before local clear')!,file=state().messages[bob.id].find(m=>m.attachment)!;
  const replay=await db.messages.get(`${alice.id}:${old.id}`);assert.ok(replay);
  assert.equal(await state().clearChats([bob.id]),true);noError();
  assert.equal(state().messages[bob.id]?.length??0,0);assert.equal(await db.outbox.where('[ownerId+peerId]').equals([alice.id,bob.id]).count(),0);
  assert.ok(await db.messages.get(`${bob.id}:${old.id}`),'clear preserves the recipient’s encrypted copy');
  assert.ok(await db.attachments.get(file.attachment!.id),'a recipient reference retains its attachment');
  // A stale cache writer cannot resurrect cleared history on the next unlock.
  await db.messages.put(replay);await state().logout();await state().login(alice.username,password);noError();
  assert.equal(state().messages[bob.id]?.some(m=>m.id===old.id)??false,false);
  assert.equal(await state().organizeChats([bob.id],'delete'),true);noError();
  assert.equal(state().conversations.find(c=>c.id===bob.id)?.hidden,true);
  await state().logout();await state().login(bob.username,password);noError();state().selectChat(alice.id);
  assert.equal(state().messages[alice.id].find(m=>m.id===old.id)?.text,'History before local clear');
  assert.equal(await (await state().downloadAttachment(state().messages[alice.id].find(m=>m.attachment)!.attachment!))?.text(),'Preserve the other person’s attachment');
  await state().send('A future message may reopen the chat');noError();const future=state().messages[alice.id].find(m=>m.text==='A future message may reopen the chat')!;
  await state().logout();await state().login(alice.username,password);noError();
  assert.equal(state().conversations.find(c=>c.id===bob.id)?.hidden,false);
  assert.equal(state().messages[bob.id].find(m=>m.id===future.id)?.text,'A future message may reopen the chat');
  assert.equal(state().messages[bob.id].some(m=>m.id===old.id),false);
  assert.equal(await state().organizeChats([bob.id],'pin'),true);noError();
  assert.equal(await state().organizeChats([bob.id],'archive'),true);noError();
  const secret='  👩🏽‍💻🔒  ';
  assert.equal(await state().setChatLockCode(secret),true);noError();
  await state().updatePreferences({aiEnabled:false,aiConsent:false});noError();
  assert.ok(state().conversations.some(c=>c.id===BOT),'the local code entry remains available with the assistant disabled');
  assert.equal(await state().organizeChats([bob.id],'lock'),true);noError();
  assert.equal(state().messages[bob.id]?.length??0,0);assert.equal(state().conversations.find(c=>c.id===bob.id)?.preview,undefined);
  assert.equal(state().conversations.find(c=>c.id===bob.id)?.unread,0);
  state().selectChat(bob.id);assert.notEqual(state().activeId,bob.id);assert.match(state().error??'',/unlock/i);state().clearError();
  await state().findUser(bob.username);assert.notEqual(state().activeId,bob.id);state().clearError();
  assert.deepEqual(await state().searchUsers(bob.username),[],'closed locked chats do not appear in username search');
  for(const action of ['unpin','archive','unarchive','delete','unlock'] as const){assert.equal(await state().organizeChats([bob.id],action),false);assert.match(state().error??'',/unlock/i);state().clearError()}
  assert.equal(await state().clearChats([bob.id]),false);state().clearError();
  state().selectChat(BOT);const beforeBot=await db.messages.where('[ownerId+peerId]').equals([alice.id,BOT]).count();
  await state().send('wrong-code');assert.equal(state().lockedChatsOpen,false);state().clearError();
  await state().send(secret);noError();assert.equal(state().lockedChatsOpen,true);assert.equal(state().chatSection,'locked');
  assert.equal(state().messages[bob.id].find(m=>m.id===future.id)?.text,'A future message may reopen the chat');
  assert.equal(await db.messages.where('[ownerId+peerId]').equals([alice.id,BOT]).count(),beforeBot);
  assert.equal(await db.outbox.where('[ownerId+peerId]').equals([alice.id,BOT]).count(),0,'secret codes and failed attempts never enter an outbox');
  // A slow verifier must never send an assistant draft into a newly selected chat.
  await state().updatePreferences({aiEnabled:true,aiConsent:true});noError();
  const beforePeer=state().messages[bob.id].length;
  for(const contextChange of ['switch-chat','close-vault'] as const){
   let began!:()=>void,release!:()=>void,held=false;
   const started=new Promise<void>(resolve=>{began=resolve}),gate=new Promise<void>(resolve=>{release=resolve}),native=crypto.subtle.deriveBits.bind(crypto.subtle);
   const mock=t.mock.method(crypto.subtle,'deriveBits',async(algorithm:AlgorithmIdentifier|EcdhKeyDeriveParams|HkdfParams|Pbkdf2Params,key:CryptoKey,length:number|null)=>{if(!held){held=true;began();await gate}return native(algorithm,key,length)});
   try{
    state().selectChat(BOT);const sending=state().send('hello');await started;
    if(contextChange==='switch-chat')state().selectChat(bob.id);else state().closeLockedChats();
    release();await sending;noError();
    assert.equal(state().messages[bob.id]?.length??0,contextChange==='switch-chat'?beforePeer:0);
    assert.equal(await db.messages.where('[ownerId+peerId]').equals([alice.id,BOT]).count(),beforeBot);
    assert.equal(await db.outbox.where('[ownerId+peerId]').equals([alice.id,BOT]).count(),0);
   }finally{release();mock.mock.restore()}
   if(!state().lockedChatsOpen)assert.equal(await state().enterLockedChats(secret),true);
  }
  const account=(await db.accounts.get(alice.id))!,keys=await deriveKeysFromPassword(password,account.auth_salt,account.wrap_salt),settings=(await db.settings.get(alice.id))!;
  const decoded=await decryptPayload<Record<string,unknown>>(settings.ciphertext,settings.iv,keys.masterWrappingKey);
  assert.equal(JSON.stringify(decoded).includes(secret),false,'the encrypted settings contain a verifier, never the raw secret');
  assert.ok(decoded.chatLockVerifier);
  state().closeLockedChats();assert.equal(state().lockedChatsOpen,false);assert.equal(state().messages[bob.id]?.length??0,0);
  await state().logout();await state().login(alice.username,password);noError();
  assert.equal(state().hasChatLockCode,true);assert.equal(state().lockedChatsOpen,false);assert.equal(state().conversations.find(c=>c.id===bob.id)?.locked,true);
  // Concurrent code guesses are serialized, and repeated failures are throttled.
  const attempts=await Promise.all([state().enterLockedChats('bad1'),state().enterLockedChats(secret)]);assert.deepEqual(attempts,[false,false]);state().clearError();
  for(let index=0;index<4;index++)await state().enterLockedChats('bad1');
  assert.ok(state().chatLockRetryAt>Date.now());assert.equal(await state().enterLockedChats(secret),false);state().clearError();
  assert.equal(await state().resetChatLock(),true);noError();
  const unlocked=state().conversations.find(c=>c.id===bob.id)!;assert.equal(unlocked.locked,false);assert.equal(unlocked.archived,false);assert.equal(unlocked.hidden,false);
  assert.equal(state().hasChatLockCode,false);assert.equal(state().chatSection,'all');assert.equal(state().messages[bob.id]?.length??0,0);
  await state().logout();await state().login(alice.username,password);noError();
  assert.equal(state().messages[bob.id]?.length??0,0,'reset-cleared messages stay cleared on relogin');
  assert.equal(state().hasChatLockCode,false,'forgotten-code reset removes the encrypted verifier across relogin');
  await state().logout();await state().login(bob.username,password);noError();
  assert.ok(state().messages[alice.id].some(m=>m.id===future.id),'forgotten-code reset does not delete the other person’s messages');
  // Blocking a locked peer removes it from conversations; forgotten-code reset
  // must still clear and unlock the persisted peer while keeping the block.
  assert.equal(await state().setChatLockCode('new🔒'),true);assert.equal(await state().organizeChats([alice.id],'lock'),true);
  assert.equal(await state().enterLockedChats('new🔒'),true);await state().blockContact(alice.id);noError();
  assert.equal(state().conversations.some(c=>c.id===alice.id),false);state().closeLockedChats();
  assert.equal(await state().resetChatLock(),true);noError();assert.equal(state().hasChatLockCode,false);
  assert.equal(state().blockedContacts.find(c=>c.id===alice.id)?.locked,false);
  assert.equal(await db.messages.where('[ownerId+peerId]').equals([bob.id,alice.id]).count(),0);
  await state().unblockContact(alice.id);noError();assert.equal(state().conversations.find(c=>c.id===alice.id)?.locked,false);
 }finally{await state().logout();db.close()}
});


