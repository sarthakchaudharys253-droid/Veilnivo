import { BOT_CONTACT_ID } from '../src/lib/compat';
import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {db} from '../src/lib/db';
import {useVeilnivo} from '../src/lib/store';

test('revoking AI consent aborts before the provider and paused prompts require an explicit retry',async()=>{
 let heldHistory=false;let historyStarted!:()=>void;const historyGate=new Promise<void>(resolve=>historyStarted=resolve);let releaseHistory:(()=>void)|undefined;
 const providerPrompts:string[]=[];const nativeFetch=globalThis.fetch;const state=()=>useVeilnivo.getState();
 Object.defineProperty(globalThis,'window',{value:undefined,configurable:true});
 globalThis.fetch=async(input,options)=>{
  const url=String(input);const body=JSON.parse(String(options?.body??'{}'));
  const response=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
  if(url.includes('/api/messages/'))return response({messages:[],next_cursor:null});
  if(url.endsWith('/api/bot/history')){
   const answer=()=>response({message:{id:crypto.randomUUID(),senderId:state().user!.id,recipientId:state().user!.id,ciphertext:body.ciphertext,iv:body.iv,createdAt:new Date().toISOString()}});
   if(!heldHistory){heldHistory=true;historyStarted();return new Promise<Response>((resolve,reject)=>{releaseHistory=()=>resolve(answer());options?.signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true})})}
   return answer();
  }
  if(url.endsWith('/api/bot/completion')){providerPrompts.push(body.prompt);return new Response('data: '+JSON.stringify({choices:[{delta:{content:'Synthetic provider response'}}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}})}
  return response({ok:true});
 };
 try{
  await state().register('consent_test','SyntheticPassword2026!');assert.equal(state().error,null);const identityId=state().user!.id;
  await state().updatePreferences({aiConsent:true});useVeilnivo.setState({mode:'live'});state().selectChat(BOT_CONTACT_ID);
  const sending=state().send('held sensitive prompt');await historyGate;
  await state().updatePreferences({aiConsent:false,aiEnabled:false});releaseHistory?.();await sending;
  assert.deepEqual(providerPrompts,[],'the plaintext provider endpoint must never be called after consent revocation');
  let queued=await db.outbox.where('ownerId').equals(identityId).toArray();assert.equal(queued.length,1);assert.equal(queued[0].paused,true);assert.equal(queued[0].status,'failed');const pausedId=queued[0].id;
  await state().retryMessage(pausedId);assert.match(state().error??'',/privacy notice/);assert.deepEqual(providerPrompts,[]);
  await state().updatePreferences({aiEnabled:true,aiConsent:true});state().clearError();state().selectChat(BOT_CONTACT_ID);await state().send('new explicitly approved prompt');assert.equal(state().error,null);assert.deepEqual(providerPrompts,['new explicitly approved prompt'],'a later flush must skip the paused old prompt');
  queued=await db.outbox.where('ownerId').equals(identityId).toArray();assert.equal(queued.length,1);assert.equal(queued[0].id,pausedId);assert.equal(queued[0].paused,true);
  await state().retryMessage(pausedId);assert.equal(state().error,null);assert.deepEqual(providerPrompts,['new explicitly approved prompt','held sensitive prompt']);assert.equal(await db.outbox.where('ownerId').equals(identityId).count(),0);
 }finally{releaseHistory?.();useVeilnivo.setState({mode:'demo'});await state().logout();db.close();globalThis.fetch=nativeFetch}
});

