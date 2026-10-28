import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {useVeilnivo} from '../src/lib/store';
import {db} from '../src/lib/db';
import {isReactionEmoji} from '../src/lib/reaction-emoji';
import {ALL_EMOJI} from '../src/lib/emoji-catalog';
import {validateMessagePayload} from '../src/lib/chat-utils';

Object.defineProperty(globalThis,'window',{value:undefined,configurable:true});
const state=()=>useVeilnivo.getState(),password='SyntheticActionPassword2026!';
const noError=()=>assert.equal(state().error,null);

test('every catalog emoji is a valid reaction while markup, text and incomplete sequences are rejected',()=>{
 assert.equal(ALL_EMOJI.length,3944);
 for(const entry of ALL_EMOJI)assert.equal(isReactionEmoji(entry.emoji),true,entry.label);
 for(const invalid of ['hello','<script>','👍👍','\u200d','🏽',''])assert.equal(isReactionEmoji(invalid),false);
 const sender=crypto.randomUUID(),self=crypto.randomUUID(),payload={id:crypto.randomUUID(),targetId:crypto.randomUUID(),text:'',timestamp:Date.now(),senderId:sender,type:'reaction',emoji:'🫱🏻‍🫲🏿',active:true};
 assert.doesNotThrow(()=>validateMessagePayload(payload,sender,self));
 assert.throws(()=>validateMessagePayload({...payload,editedAt:Date.now()},sender,self));
 assert.throws(()=>validateMessagePayload({...payload,forwarded:true},sender,self));
});

test('local message edits, private hiding, permanent deletion and forwarding preserve identity and ciphertext boundaries',async t=>{
 try{
  await state().register('actions_alice',password);noError();const alice=state().user!;
  const peers=[];
  for(const name of ['actions_bob','actions_cara','actions_dan']){
   await state().logout();await state().register(name,password);noError();peers.push(state().user!);
   await state().findUser(alice.username);noError();
   await state().logout();await state().login(alice.username,password);noError();
   const request=state().messageRequests.find(r=>r.peer.username===name)!;assert.ok(request);await state().acceptRequest(request.id);noError();
  }
  const [bob,cara,dan]=peers;state().selectChat(bob.id);
  await state().send('Original action text');noError();const original=state().messages[bob.id].find(m=>m.text==='Original action text')!;
  assert.equal(await state().editMessage(original.id,'Edited action text'),true);noError();
  const edited=state().messages[bob.id].find(m=>m.id===original.id)!;assert.equal(edited.text,'Edited action text');assert.equal(edited.at,original.at);assert.equal(edited.revision,1);assert.equal(edited.edited,true);assert.ok(edited.editedAt);
  await state().reactToMessage(original.id,'🫱🏻‍🫲🏿');noError();assert.deepEqual(state().messages[bob.id].find(m=>m.id===original.id)?.reactions?.['🫱🏻‍🫲🏿'],[alice.id]);
  assert.equal(await state().forwardMessages([original.id],[cara.id,dan.id]),true);noError();
  const forwardedText=state().messages[cara.id].find(m=>m.forwarded)!;assert.equal(forwardedText.text,'Edited action text');assert.notEqual(forwardedText.id,original.id);
  const file=new File(['synthetic private attachment bytes'],'source-private.txt',{type:'text/plain'});
  await state().sendAttachment(file,'Forward this attachment');noError();const attachment=state().messages[bob.id].find(m=>m.attachment)!;
  assert.equal(await state().forwardMessages([attachment.id],[cara.id,dan.id]),true);noError();
  const copies=[attachment,...[cara,dan].map(peer=>state().messages[peer.id].find(m=>m.forwarded&&m.attachment)!)];
  assert.equal(new Set(copies.map(m=>m.attachment!.id)).size,3);assert.equal(new Set(copies.map(m=>m.attachment!.key)).size,3);assert.equal(new Set(copies.map(m=>m.attachment!.iv)).size,3);
  for(const copy of copies)assert.equal(await (await state().downloadAttachment(copy.attachment!))?.text(),'synthetic private attachment bytes');
  for(const change of ['edited','removed','expired']){
   const snapshot={...state().messages[bob.id].find(m=>m.id===original.id)!},beforeCount=state().messages[cara.id].length,beforeCache=await db.messages.where('[ownerId+peerId]').equals([alice.id,cara.id]).count();
   let entered!:()=>void,release!:()=>void,held=false;const began=new Promise<void>(resolve=>{entered=resolve}),gate=new Promise<void>(resolve=>{release=resolve}),native=crypto.subtle.encrypt.bind(crypto.subtle);
   const mock=t.mock.method(crypto.subtle,'encrypt',async(algorithm:AlgorithmIdentifier|RsaOaepParams|AesCtrParams|AesCbcParams|AesGcmParams,key:CryptoKey,data:BufferSource)=>{
    let value:any;try{value=JSON.parse(new TextDecoder().decode(data as ArrayBuffer))}catch{}
    if(value?.forwarded&&!held){held=true;entered();await gate}
    return native(algorithm,key,data);
   });
   try{
    const pending=state().forwardMessages([original.id],[cara.id]);await began;
    useVeilnivo.setState(current=>({messages:{...current.messages,[bob.id]:change==='removed'?current.messages[bob.id].filter(m=>m.id!==original.id):current.messages[bob.id].map(m=>m.id===original.id?change==='edited'?{...m,revision:(m.revision??0)+1,text:'Changed during forwarding'}:{...m,expiresAt:Date.now()-1}:m)}}));
    release();assert.equal(await pending,false,`${change} source must cancel while destination crypto is pending`);assert.equal(state().messages[cara.id].length,beforeCount);assert.equal(await db.messages.where('[ownerId+peerId]').equals([alice.id,cara.id]).count(),beforeCache);assert.equal(await db.outbox.where('[ownerId+peerId]').equals([alice.id,cara.id]).count(),0);
   }finally{release();mock.mock.restore();useVeilnivo.setState(current=>({messages:{...current.messages,[bob.id]:[...current.messages[bob.id].filter(m=>m.id!==snapshot.id),snapshot].sort((a,b)=>a.at-b.at)}}));state().clearError()}
  }
  await state().setChatTimer(3600);noError();await state().send('Expiring original');noError();const expiring=state().messages[bob.id].find(m=>m.text==='Expiring original')!;
  assert.equal(await state().forwardMessages([expiring.id],[cara.id]),true);noError();assert.ok(state().messages[cara.id].find(m=>m.text==='Expiring original')!.expiresAt!<=expiring.expiresAt!);
  useVeilnivo.setState(current=>({messages:{...current.messages,[bob.id]:current.messages[bob.id].map(m=>m.id===expiring.id?{...m,expiresAt:Date.now()-1}:m)}}));
  assert.equal(await state().forwardMessages([expiring.id],[dan.id]),false);assert.match(state().error??'',/expired/);state().clearError();
  assert.equal(await state().deleteMessages([original.id],'me'),true);noError();assert.equal(state().messages[bob.id].some(m=>m.id===original.id),false);
  assert.equal(JSON.stringify(await db.settings.get(alice.id)).includes(original.id),false,'hidden IDs stay encrypted');
  await state().logout();await state().login(alice.username,password);noError();state().selectChat(bob.id);assert.equal(state().messages[bob.id].some(m=>m.id===original.id),false,'private deletion survives relogin');
  assert.equal(await state().deleteMessages([attachment.id],'everyone'),true);noError();const removed=state().messages[bob.id].find(m=>m.id===attachment.id)!;assert.equal(removed.deleted,true);assert.equal(removed.attachment,undefined);assert.equal(removed.text,'');
  const tombstone=await db.messages.get(`${alice.id}:${attachment.id}`);assert.equal(tombstone?.ciphertext,'');assert.equal(tombstone?.iv,'');assert.ok(tombstone?.deletedAt);assert.equal(await db.attachments.get(attachment.attachment!.id),undefined);
  assert.equal(await (await state().downloadAttachment(copies[1].attachment!))?.text(),'synthetic private attachment bytes','forwarded copies have independent file retention');
  await state().logout();await state().login(bob.username,password);noError();state().selectChat(alice.id);
  assert.equal(state().messages[alice.id].find(m=>m.id===original.id)?.text,'Edited action text','delete for me keeps the recipient copy');
  assert.equal(state().messages[alice.id].find(m=>m.id===attachment.id)?.deleted,true,'author deletion is recovered as a content-free tombstone');
  assert.equal(await state().editMessage(original.id,'Forgery'),false);assert.match(state().error??'',/your sent/);
  assert.equal(await state().deleteMessages([original.id],'everyone'),false);assert.match(state().error??'',/your sent/);
 }finally{await state().logout();db.close()}
});
