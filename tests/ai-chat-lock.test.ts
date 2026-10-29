import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {useVeilnivo,type Conversation} from '../src/lib/store';
import {db} from '../src/lib/db';
import {BOT_CONTACT_ID as BOT,CLIENT_EVENT_CHANNEL} from '../src/lib/compat';
import {createChatLockVerifier} from '../src/lib/chat-lock';
import {decryptPayload,deriveKeysFromPassword,encryptPayload} from '../src/lib/crypto';

Object.defineProperty(globalThis,'window',{value:undefined,configurable:true});
const state=()=>useVeilnivo.getState(),password='SyntheticAIChatLock2026!',secret='  👩🏽‍💻🔒  ';
const noError=()=>assert.equal(state().error,null);
function providerFixture(configured?:boolean){
 const prompts:string[]=[],history:string[]=[],statusCalls:string[]=[],nativeFetch=globalThis.fetch;
 globalThis.fetch=async(input,options)=>{
  const url=String(input),body=JSON.parse(String(options?.body??'{}'));
  const json=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
  if(url.endsWith('/api/bot/status')){statusCalls.push(url);return json(configured===undefined?{ok:true}:{configured})}
  if(url.includes('/api/messages/'))return json({messages:[],next_cursor:null});
  if(url.endsWith('/api/bot/history')){history.push(body.ciphertext);return json({message:{id:crypto.randomUUID(),senderId:state().user!.id,recipientId:state().user!.id,ciphertext:body.ciphertext,iv:body.iv,createdAt:new Date().toISOString()}})}
  if(url.endsWith('/api/bot/completion')){prompts.push(body.prompt);return new Response('data: '+JSON.stringify({choices:[{delta:{content:'A normal assistant answer.'}}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}})}
  return json({ok:true});
 };
 return{prompts,history,statusCalls,restore:()=>{globalThis.fetch=nativeFetch}};
}
async function until(check:()=>boolean,label:string){for(let n=0;n<200;n++){if(check())return;await new Promise(resolve=>setTimeout(resolve,10))}throw new Error('Timed out waiting for '+label)}

test('inactive Ollama Cloud rejects ordinary prompts before consent or persistence while exact codes stay local',async()=>{
 const provider=providerFixture(false);
 try{
  await state().register('ai_lock_inactive',password);noError();const owner=state().user!.id;
  assert.equal(await state().setChatLockCode(secret),true);
  useVeilnivo.setState({mode:'live'});
  await state().send('What is the moon?');assert.equal(state().error,'Veil AI is inactive. Ollama Cloud has not been activated.');
  await state().updatePreferences({aiEnabled:true,aiConsent:true});
  await state().send('hello');assert.equal(state().error,'Veil AI is inactive. Ollama Cloud has not been activated.');
  await state().updatePreferences({aiEnabled:false,aiConsent:false});
  await state().send(secret);noError();assert.equal(state().lockedChatsOpen,true);
  await state().send(secret);noError();assert.equal(provider.statusCalls.length,2,'exact codes never contact the status endpoint');
  assert.deepEqual(provider.prompts,[]);assert.deepEqual(provider.history,[]);
  assert.equal(await db.messages.where('[ownerId+peerId]').equals([owner,BOT]).count(),0);
  assert.equal(await db.outbox.where('[ownerId+peerId]').equals([owner,BOT]).count(),0);
 }finally{useVeilnivo.setState({mode:'demo'});await state().logout();db.close();provider.restore()}
});

test('normal assistant questions work with a closed vault while only exact Unicode/space codes stay local',async()=>{
 const provider=providerFixture();
 try{
  await state().register('ai_lock_normal',password);noError();const owner=state().user!.id;
  assert.equal(await state().setChatLockCode(secret),true);await state().updatePreferences({aiEnabled:true,aiConsent:true});noError();
  useVeilnivo.setState({mode:'live'});
  for(const prompt of ['hello','Why does the moon change shape?','hello again']){await state().send(prompt);noError();assert.equal(state().lockedChatsOpen,false)}
  assert.deepEqual(provider.prompts,['hello','Why does the moon change shape?','hello again']);
  assert.ok(state().messages[BOT].some(message=>!message.own&&message.text==='A normal assistant answer.'));
  assert.equal(state().chatLockRetryAt,0,'ordinary questions never count as failed code guesses');
  const originalCount=await db.messages.where('[ownerId+peerId]').equals([owner,BOT]).count(),historyCalls=provider.history.length;
  await state().send(secret);noError();assert.equal(state().lockedChatsOpen,true);assert.equal(state().chatSection,'locked');
  await state().send(secret);noError();assert.equal(state().lockedChatsOpen,true);
  assert.equal(provider.prompts.length,3);assert.equal(provider.history.length,historyCalls);
  assert.equal(await db.messages.where('[ownerId+peerId]').equals([owner,BOT]).count(),originalCount);
  assert.equal(await db.outbox.where('[ownerId+peerId]').equals([owner,BOT]).count(),0);
  state().closeLockedChats();await state().updatePreferences({aiEnabled:true,aiConsent:false});
  await state().send('hello');assert.match(state().error??'',/privacy notice/);assert.equal(state().lockedChatsOpen,false);
  await state().send(secret);noError();assert.equal(state().lockedChatsOpen,true,'the local code also works without AI consent');
  state().closeLockedChats();await state().updatePreferences({aiEnabled:false,aiConsent:true});
  await state().send('hello');assert.match(state().error??'',/privacy notice/);assert.equal(provider.prompts.length,3);
  await state().send(secret);noError();assert.equal(state().lockedChatsOpen,true,'the local code also works with AI disabled');
  assert.equal(await state().setChatLockCode('    '),true);await state().send('    ');noError();assert.equal(state().lockedChatsOpen,true,'all-space codes are checked before trimming');
  assert.equal(provider.prompts.length,3);assert.equal(provider.history.length,historyCalls);
  assert.equal(await db.messages.where('[ownerId+peerId]').equals([owner,BOT]).count(),originalCount);
  assert.equal(await state().setChatLockCode(secret),true);await state().updatePreferences({aiEnabled:true,aiConsent:true});
  for(let index=0;index<5;index++)await state().enterLockedChats('bad1');
  assert.ok(state().chatLockRetryAt>Date.now());await state().send(secret);assert.match(state().error??'',/Too many attempts/);assert.equal(state().lockedChatsOpen,false);
  assert.equal(provider.prompts.length,3,'a throttled exact code still never becomes an AI prompt');assert.equal(provider.history.length,historyCalls);
  assert.equal(await db.messages.where('[ownerId+peerId]').equals([owner,BOT]).count(),originalCount);
 }finally{useVeilnivo.setState({mode:'demo'});await state().logout();db.close();provider.restore()}
});

test('held code checks cannot send to another chat/account or reopen a vault after context changes',async t=>{
 const provider=providerFixture(),previousDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
 try{
  for(const [index,change] of ['switch-chat','close-vault','logout','hide-closed-vault'].entries()){
   await state().register('ai_lock_race_'+index,password);noError();const owner=state().user!,peer:Conversation={id:crypto.randomUUID(),username:'synthetic_peer',name:'Synthetic peer',initials:'SP',color:'mint',online:false,unread:0,publicKeyJwk:owner.publicKeyJwk,requestStatus:'accepted'};
   assert.equal(await state().setChatLockCode(secret),true);await state().updatePreferences({aiEnabled:true,aiConsent:true});assert.equal(await state().enterLockedChats(secret),true);
   if(change==='hide-closed-vault')state().closeLockedChats();
   useVeilnivo.setState(current=>({mode:'live',conversations:[...current.conversations,peer]}));
   let started!:()=>void,release!:()=>void,held=false;
   const began=new Promise<void>(resolve=>{started=resolve}),gate=new Promise<void>(resolve=>{release=resolve}),native=crypto.subtle.deriveBits.bind(crypto.subtle);
   const mock=t.mock.method(crypto.subtle,'deriveBits',async(algorithm:AlgorithmIdentifier|EcdhKeyDeriveParams|HkdfParams|Pbkdf2Params,key:CryptoKey,length:number|null)=>{if(!held){held=true;started();await gate}return native(algorithm,key,length)});
   try{
    const sending=state().send(change==='switch-chat'?'question':secret);await began;
    if(change==='switch-chat')state().selectChat(peer.id);else if(change==='close-vault')state().closeLockedChats();else if(change==='hide-closed-vault')Object.defineProperty(globalThis,'document',{value:{hidden:true},configurable:true});else await state().logout();
    release();await sending;
    assert.equal(provider.prompts.length,0);assert.equal(provider.history.length,0);
    assert.equal(await db.outbox.where('ownerId').equals(owner.id).count(),0);
    assert.equal(await db.messages.where('[ownerId+peerId]').equals([owner.id,BOT]).count(),0);
    if(change!=='switch-chat')assert.equal(state().lockedChatsOpen,false);
   }finally{release();mock.mock.restore();useVeilnivo.setState({mode:'demo'});await state().logout()}
  }
 }finally{if(previousDocument)Object.defineProperty(globalThis,'document',previousDocument);else Reflect.deleteProperty(globalThis,'document');useVeilnivo.setState({mode:'demo'});await state().logout();db.close();provider.restore()}
});

test('a verifier replaced by another tab cancels an already-running old-code check',async t=>{
 const provider=providerFixture();let release:(()=>void)|undefined;const channel=new BroadcastChannel(CLIENT_EVENT_CHANNEL);
 try{
  await state().register('ai_lock_replace',password);noError();const owner=state().user!,nextCode='new🔒';
  assert.equal(await state().setChatLockCode(secret),true);await state().updatePreferences({aiEnabled:true,aiConsent:true});
  const account=(await db.accounts.get(owner.id))!,keys=await deriveKeysFromPassword(password,account.auth_salt,account.wrap_salt),row=(await db.settings.get(owner.id))!,decoded=await decryptPayload<Record<string,unknown>>(row.ciphertext,row.iv,keys.masterWrappingKey),nextVerifier=await createChatLockVerifier(nextCode);
  const updated=await encryptPayload({...decoded,chatLockVerifier:nextVerifier},keys.masterWrappingKey),beforePreferences=state().preferences;
  let started!:()=>void,held=false;const began=new Promise<void>(resolve=>{started=resolve}),gate=new Promise<void>(resolve=>{release=resolve}),native=crypto.subtle.deriveBits.bind(crypto.subtle);
  const mock=t.mock.method(crypto.subtle,'deriveBits',async(algorithm:AlgorithmIdentifier|EcdhKeyDeriveParams|HkdfParams|Pbkdf2Params,key:CryptoKey,length:number|null)=>{if(!held){held=true;started();await gate}return native(algorithm,key,length)});
  try{
   const sending=state().send(secret);await began;await db.settings.put({ownerId:owner.id,...updated});channel.postMessage({type:'organization-updated',ownerId:owner.id});
   await until(()=>state().preferences!==beforePreferences,'the other tab’s new verifier');release!();await sending;
   assert.equal(state().lockedChatsOpen,false);assert.equal(provider.prompts.length,0);assert.equal(provider.history.length,0);
   assert.equal(await db.messages.where('[ownerId+peerId]').equals([owner.id,BOT]).count(),0);
  }finally{release?.();mock.mock.restore()}
  assert.equal(await state().enterLockedChats(nextCode),true,'the new verifier is now authoritative');
 }finally{release?.();channel.close();useVeilnivo.setState({mode:'demo'});await state().logout();db.close();provider.restore()}
});
