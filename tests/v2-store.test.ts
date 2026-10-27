import { BOT_CONTACT_ID } from '../src/lib/compat';
import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {useVeilnivo} from '../src/lib/store';
import {db} from '../src/lib/db';
const memory=new Map<string,string>();
const storage={clear:()=>memory.clear(),getItem:(key:string)=>memory.get(key)??null,setItem:(key:string,value:string)=>memory.set(key,value),removeItem:(key:string)=>memory.delete(key),key:(index:number)=>[...memory.keys()][index]??null,get length(){return memory.size}};
Object.defineProperty(globalThis,'localStorage',{value:storage,configurable:true});
Object.defineProperty(globalThis,'sessionStorage',{value:storage,configurable:true});
Object.defineProperty(globalThis,'window',{value:undefined,configurable:true});
const password='SyntheticPassword2026!';
function state(){return useVeilnivo.getState()}
function noError(){assert.equal(state().error,null)}

test('v2 local identities require contact consent, recover encrypted history, retry a stable outbox and erase',async()=>{
 try{
  await state().initDemo();noError();assert.equal(state().messageRequests[0]?.peer.username,'luna');
  Object.defineProperty(globalThis,'window',{value:{location:{origin:'http://preview.test'}},configurable:true});await state().createInvite();noError();assert.ok(state().lastInvite?.token);Object.defineProperty(globalThis,'window',{value:undefined,configurable:true});
  await state().register('test_alice',password);noError();assert.equal(state().lastInvite,null,'registration must discard the prior identity’s raw invitation token');assert.equal(state().messageRequests.length,0);const alice=state().user!;assert.equal(state().conversations.filter(c=>!c.isBot).length,0);
  await state().addAlias('alice_alias');noError();assert.deepEqual(state().aliases,['alice_alias']);
  await state().send('not permitted without AI consent');assert.match(state().error??'',/privacy notice/);
  await state().updatePreferences({aiConsent:true,density:'compact'});state().clearError();await state().send('encrypted assistant recovery');noError();
  const legacyAccount=await db.accounts.get(alice.id);const rawHash=Uint8Array.from(atob(legacyAccount!.authDigest),c=>c.charCodeAt(0));await db.accounts.update(alice.id,{authDigest:Array.from(rawHash,v=>v.toString(16).padStart(2,'0')).join('')});
  await state().logout();await state().register('test_bob',password);noError();const bob=state().user!;
  await state().findUser('alice_alias');noError();assert.equal(state().conversations.find(c=>c.id===alice.id)?.requestStatus,'outgoing');
  await state().send('must not arrive');assert.match(state().error??'',/accept/);assert.equal((state().messages[alice.id]??[]).length,0);
  Object.defineProperty(globalThis,'window',{value:{location:{origin:'http://preview.test'}},configurable:true});await state().createInvite();noError();assert.ok(state().lastInvite?.token);Object.defineProperty(globalThis,'window',{value:undefined,configurable:true});
  await state().login('test_alice',password);noError();assert.equal(state().lastInvite,null,'login must discard the prior identity’s raw invitation token');assert.equal(state().preferences.density,'compact');assert.ok(state().messages[BOT_CONTACT_ID].some(m=>m.text==='encrypted assistant recovery'));
  const incoming=state().messageRequests.find(r=>r.direction==='incoming')!;assert.equal(incoming.peer.id,bob.id);await state().acceptRequest(incoming.id);noError();
  await state().logout();await state().login('test_bob',password);noError();state().selectChat(alice.id);assert.equal(state().conversations.find(c=>c.id===alice.id)?.requestStatus,'accepted');
  useVeilnivo.setState({mode:'live'});await state().send('queued private payload');noError();const queued=state().messages[alice.id].find(m=>m.text==='queued private payload')!;assert.equal(queued.status,'queued');const outbox=await db.outbox.where('ownerId').equals(bob.id).toArray();assert.equal(outbox.length,1);assert.equal(JSON.stringify(outbox).includes('queued private payload'),false);
  useVeilnivo.setState({mode:'demo'});await state().retryMessage(queued.id);noError();assert.equal(await db.outbox.where('ownerId').equals(bob.id).count(),0);assert.equal(state().messages[alice.id].filter(m=>m.id===queued.id).length,1);
  await state().send('A private reply',queued.id);noError();await state().reactToMessage(queued.id,'💚');noError();assert.deepEqual(state().messages[alice.id].find(m=>m.id===queued.id)?.reactions?.['💚'],[bob.id]);
  const file=new File(['a secret attachment body'],'sensitive-name.txt',{type:'text/plain'});await state().sendAttachment(file,'A private attachment');noError();const message=state().messages[alice.id].find(m=>m.attachment)!;assert.ok(message.attachment);const storedFiles=await db.attachments.toArray();assert.equal(JSON.stringify(storedFiles).includes('sensitive-name'),false);assert.equal(JSON.stringify(storedFiles).includes('secret attachment'),false);const downloaded=await state().downloadAttachment(message.attachment!);assert.equal(await downloaded?.text(),'a secret attachment body');
  await state().setChatTimer(3600);noError();await state().send('expiring message');noError();const timed=state().messages[alice.id].find(m=>m.text==='expiring message')!;assert.ok(timed.expiresAt!>Date.now()+3590000);
  const cache=await db.messages.where('ownerId').equals(bob.id).toArray();assert.equal(JSON.stringify(cache).includes('private reply'),false);assert.equal(JSON.stringify(cache).includes('sensitive-name'),false);
  await state().logout();await state().login('test_alice',password);noError();state().selectChat(bob.id);const restored=state().messages[bob.id];assert.ok(restored.some(m=>m.text==='queued private payload'));assert.equal(restored.find(m=>m.text==='A private reply')?.replyTo?.own,false);assert.deepEqual(restored.find(m=>m.id===queued.id)?.reactions?.['💚'],[bob.id]);
  await state().verifyContact(bob.id);noError();assert.equal(state().conversations.find(c=>c.id===bob.id)?.verified,true);
  await state().blockContact(bob.id);noError();assert.equal(state().blockedContacts[0]?.id,bob.id);await state().unblockContact(bob.id);noError();assert.ok(state().conversations.some(c=>c.id===bob.id));
  memory.set('sensitive','remove');await state().erase();assert.equal(state().user,null);assert.equal(state().erasure.local,'cleared');assert.equal(memory.size,0);await state().login('test_alice',password);assert.match(state().error??'',/No local identity/);
 }finally{await state().logout();db.close()}
});
