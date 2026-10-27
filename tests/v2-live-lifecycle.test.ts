import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {Server as SocketServer,type Socket as ServerSocket} from 'socket.io';
import {generateIdentityKeyPair,deriveSharedSecret,encryptPayload} from '../src/lib/crypto';
import {db,type CachedMessage,type CachedContact} from '../src/lib/db';
import {BOT_CONTACT_ID} from '../src/lib/compat';
import type {WireMessage} from '../src/lib/client';

async function until(check:()=>boolean|Promise<boolean>,label:string){const deadline=Date.now()+8000;while(Date.now()<deadline){if(await check())return;await new Promise(resolve=>setTimeout(resolve,15))}throw new Error(`Timed out: ${label}`)}
const pause=()=>new Promise(resolve=>setTimeout(resolve,80));

test('live reconciliation, delayed callbacks, expiry events, and sender TTL stay authoritative',{timeout:40000},async t=>{
 const nativeMode=process.env.NEXT_PUBLIC_API_MODE,nativeUrl=process.env.NEXT_PUBLIC_API_URL;
 Object.defineProperty(globalThis,'window',{value:undefined,configurable:true});
 const keys=await Promise.all(Array.from({length:4},()=>generateIdentityKeyPair()));
 const peers=keys.map((key,index)=>({id:crypto.randomUUID(),username:['gone_peer','kept_peer','blocked_peer','pending_peer'][index],public_key:key.publicKeyJwk,ttl_seconds:0,blocked:false}));
 let conversations=[peers[0],peers[1]],blocks=[peers[2]],requests=[{id:crypto.randomUUID(),direction:'outgoing',peer:peers[3]}];
 let account:any,failBlocks=false,ackExpiry:string|null=null,socket:ServerSocket|undefined,heldPeer:string|undefined,releaseHistory:(()=>void)|undefined,releaseBot:(()=>void)|undefined;
 const history=new Map<string,WireMessage[]>(),uploads=new Map<string,any>(),accountHeaders:string[]=[];
 let lastAck:WireMessage|undefined;
 const http=createServer(async(req,res)=>{
  const send=(body:unknown,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body))};
  try{
   const url=new URL(req.url!,'http://localhost');let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{};
   if(url.pathname==='/api/auth/register'){account={...body,user:{id:crypto.randomUUID(),username:body.username}};send(account);return}
   if(url.pathname==='/api/auth/salts'){send({auth_salt:account.auth_salt,wrap_salt:account.wrap_salt});return}
   if(url.pathname==='/api/auth/login'){send(account);return}
   if(url.pathname==='/api/auth/logout'){send({ok:true});return}
   accountHeaders.push(String(req.headers['x-veilnivo-account']??''));
   if(url.pathname==='/api/conversations'){send({conversations});return}
   if(url.pathname==='/api/requests'){send({requests});return}
   if(url.pathname==='/api/blocks'){send(failBlocks?{error:'Synthetic block sync unavailable'}:{blocks},failBlocks?503:200);return}
   if(url.pathname==='/api/aliases'){send({aliases:[]});return}
   if(url.pathname==='/api/bot/history'&&req.method==='POST'){send({message:{id:crypto.randomUUID(),senderId:account.user.id,recipientId:account.user.id,...body,createdAt:new Date().toISOString()}});return}
   if(url.pathname==='/api/bot/completion'){res.writeHead(200,{'content-type':'text/plain'});res.write('Synthetic assistant response');releaseBot=()=>res.end(' complete');return}
   if(url.pathname.startsWith('/api/messages/')){
    const peer=decodeURIComponent(url.pathname.split('/').at(-1)!);const page={messages:history.get(peer)??[],next_cursor:null};
    if(peer===heldPeer){heldPeer=undefined;releaseHistory=()=>send(page);return}send(page);return;
   }
   if(url.pathname==='/api/attachments'){const id=crypto.randomUUID();uploads.set(id,body);send({attachment:{id,expiresAt:null}});return}
   send({error:`Unexpected fixture route ${url.pathname}`},404);
  }catch(error){send({error:String(error)},500)}
 });
 const io=new SocketServer(http,{transports:['websocket']});
 io.on('connection',connection=>{
  socket=connection;
  connection.on('message:send',(body,ack)=>{
   const message:WireMessage={id:crypto.randomUUID(),senderId:account.user.id,recipientId:body.recipient_id,ciphertext:body.ciphertext,iv:body.iv,clientMessageId:body.client_message_id,createdAt:new Date().toISOString(),expiresAt:ackExpiry};
   lastAck=message;history.set(body.recipient_id,[...(history.get(body.recipient_id)??[]),message]);ack({message});
  });
 });
 await new Promise<void>(resolve=>http.listen(0,'127.0.0.1',resolve));
 const address=http.address();assert.ok(address&&typeof address==='object');
 process.env.NEXT_PUBLIC_API_MODE='remote';process.env.NEXT_PUBLIC_API_URL=`http://127.0.0.1:${address.port}`;
 const {useVeilnivo,getPeerPublicKey}=await import('../src/lib/store');
 const state=()=>useVeilnivo.getState(),password='SyntheticPassword2026!';
 const noError=()=>assert.equal(state().error,null);
 const rowFor=(peerId:string,id=crypto.randomUUID())=>({cacheId:`${account.user.id}:${id}`,id,ownerId:account.user.id,peerId,ciphertext:'opaque',iv:'opaque',createdAt:Date.now()});
 try{
  await state().register('lifecycle_user',password);noError();await until(()=>state().connected&&!!socket,'initial socket');
  assert.equal(socket!.handshake.auth.expected_user_id,account.user.id,'socket auth binds the unlocked identity');
  assert.ok(accountHeaders.length>0&&accountHeaders.every(value=>value===account.user.id),'initial live sync is bound before any protected request');

  await t.test('typing is cleared by offline presence, messages, chat switches and transport loss',async()=>{
   const peer=peers[1];state().selectChat(peer.id);
   socket!.emit('typing:receive',{user_id:peer.id,typing:true});await pause();
   assert.equal(state().typing,false,'an offline contact cannot show typing');
   socket!.emit('presence:update',{user_id:peer.id,online:true});
   socket!.emit('typing:receive',{user_id:peer.id,typing:true});await until(()=>state().typing,'online typing');
   socket!.emit('presence:update',{user_id:peer.id,online:false});await until(()=>!state().typing,'offline clears typing');
   socket!.emit('typing:receive',{user_id:peer.id,typing:true});await pause();
   assert.equal(state().typing,false,'a late start cannot restore typing after offline');
   socket!.emit('presence:update',{user_id:peer.id,online:true});
   socket!.emit('typing:receive',{user_id:peer.id,typing:true});await until(()=>state().typing,'typing before switching');
   state().selectChat(peers[0].id);assert.equal(state().typing,false);
   socket!.emit('typing:receive',{user_id:peer.id,typing:true});await pause();assert.equal(state().typing,false,'another chat cannot show this peer typing');
   state().selectChat(peer.id);assert.equal(state().typing,false,'switching back does not restore an old hint');
   socket!.emit('typing:receive',{user_id:peer.id,typing:true});await until(()=>state().typing,'typing before offline browser');
   useVeilnivo.setState({networkOnline:false});assert.equal(state().typing,false);
   useVeilnivo.setState({networkOnline:true});assert.equal(state().typing,false);
   socket!.emit('typing:receive',{user_id:peer.id,typing:true});await until(()=>state().typing,'typing before incoming message');
   const id=crypto.randomUUID(),payload={id,text:'Synthetic message stops typing',timestamp:Date.now(),senderId:peer.id,type:'text'};
   const encrypted=await encryptPayload(payload,await deriveSharedSecret(keys[1].privateKey,account.public_key));
   socket!.emit('message:receive',{id:crypto.randomUUID(),senderId:peer.id,recipientId:account.user.id,clientMessageId:id,...encrypted,createdAt:new Date().toISOString()});
   await until(()=>!state().typing&&!!state().messages[peer.id]?.some(m=>m.id===id),'message clears typing');
   socket!.emit('typing:receive',{user_id:peer.id,typing:true});await until(()=>state().typing,'typing before socket loss');
   const previous=socket;socket!.conn.close();await until(()=>!state().connected,'socket disconnected');assert.equal(state().typing,false);
   await until(()=>state().connected&&socket!==previous,'socket reconnected');assert.equal(state().typing,false,'reconnect cannot revive old typing');
  });

  await t.test('assistant thinking stays in its own chat and completion cannot clear peer typing',async()=>{
   await state().updatePreferences({aiConsent:true});state().selectChat(BOT_CONTACT_ID);
   const pending=state().send('Synthetic assistant typing isolation');
   await until(()=>!!releaseBot&&state().typing,'assistant thinking');
   state().selectChat(peers[1].id);assert.equal(state().typing,false,'assistant thinking must not label a peer as typing');
   socket!.emit('presence:update',{user_id:peers[1].id,online:true});socket!.emit('typing:receive',{user_id:peers[1].id,typing:true});await until(()=>state().typing,'peer typing while assistant completes');
   releaseBot!();releaseBot=undefined;await pending;noError();
   assert.equal(state().typing,true,'assistant finally must not clear another peer typing');
   socket!.emit('typing:receive',{user_id:peers[1].id,typing:false});await until(()=>!state().typing,'peer stopped');
   await state().updatePreferences({aiConsent:false});noError();
  });

  await t.test('failed snapshots keep cache and preserve pending, blocked, and assistant peers',async()=>{
   const pending=rowFor(peers[3].id),blocked=rowFor(peers[2].id),bot=rowFor(BOT_CONTACT_ID);
   await db.messages.bulkPut([pending,blocked,bot]);
   useVeilnivo.setState({activeId:peers[1].id});await state().send('kept across a failed sync');noError();
   const saved=await db.messages.where('[ownerId+peerId]').equals([account.user.id,peers[1].id]).count();
   failBlocks=true;conversations=[];socket!.emit('contacts:updated');
   await until(()=>!!state().error?.includes('Synthetic block sync unavailable'),'failed snapshot');
   assert.equal(await db.messages.where('[ownerId+peerId]').equals([account.user.id,peers[1].id]).count(),saved);
   assert.ok(state().conversations.some(c=>c.id===peers[1].id),'incomplete sync must not replace the visible snapshot');
   failBlocks=false;conversations=[peers[0],{...peers[1],ttl_seconds:3600}];socket!.emit('contacts:updated');
   await until(()=>state().conversations.some(c=>c.id===peers[1].id&&c.ttlSeconds===3600),'successful retry');
   assert.ok(await db.messages.get(pending.cacheId));assert.ok(await db.messages.get(blocked.cacheId));assert.ok(await db.messages.get(bot.cacheId));
   assert.ok(state().blockedContacts.some(c=>c.id===peers[2].id));assert.ok(state().messageRequests.some(r=>r.peer.id===peers[3].id));
  });

  let removedCache:CachedMessage,removedContact:CachedContact;
  await t.test('a missed peer erase is reconciled on reconnect and delayed history cannot restore it',async()=>{
   state().clearError();useVeilnivo.setState({activeId:peers[0].id});
   await state().sendAttachment(new File(['encrypted attachment body'],'erase-me.txt',{type:'text/plain'}),'removed with peer');noError();
   const message=state().messages[peers[0].id].at(-1)!;assert.ok(message.attachment);
   removedCache=(await db.messages.get(`${account.user.id}:${message.id}`))!;
   removedContact=(await db.contacts.get(`${account.user.id}:${peers[0].id}`))!;
   await db.outbox.put({...removedCache,id:crypto.randomUUID(),cacheId:`${account.user.id}:queued-gone`});
   heldPeer=peers[0].id;state().selectChat(peers[0].id);await until(()=>!!releaseHistory,'held history response');
   conversations=[peers[1]];socket!.conn.close();
   await until(async()=>state().connected&&!state().conversations.some(c=>c.id===peers[0].id)&&!(await db.contacts.get(removedContact.cacheId)),'reconnect reconciliation');
   assert.equal(getPeerPublicKey(peers[0].id),undefined);
   assert.equal(state().messages[peers[0].id],undefined);
   assert.equal(await db.messages.where('[ownerId+peerId]').equals([account.user.id,peers[0].id]).count(),0);
   assert.equal(await db.outbox.where('[ownerId+peerId]').equals([account.user.id,peers[0].id]).count(),0);
   assert.equal(await db.attachments.get(message.attachment.id),undefined);
   releaseHistory!();releaseHistory=undefined;await pause();
   assert.equal(state().messages[peers[0].id],undefined);assert.equal(await db.messages.get(removedCache.cacheId),undefined);
  });

  await t.test('relogin reconciles before decrypting an old cached peer',async()=>{
   await db.contacts.put(removedContact);await db.messages.put(removedCache);
   await state().logout();const displayed:string[]=[];
   const unsubscribe=useVeilnivo.subscribe(value=>{if(value.messages[peers[0].id]?.length)displayed.push('old peer rendered')});
   try{await state().login('lifecycle_user',password);noError();await until(()=>state().connected,'relogin socket')}finally{unsubscribe()}
   assert.deepEqual(displayed,[]);assert.equal(await db.contacts.get(removedContact.cacheId),undefined);assert.equal(await db.messages.get(removedCache.cacheId),undefined);
  });

  await t.test('sender ACK expiry updates message and attachment; expiration events prevent replay',async()=>{
   state().clearError();useVeilnivo.setState({activeId:peers[1].id});ackExpiry=new Date(Date.now()+30000).toISOString();
   await state().sendAttachment(new File(['short lived bytes'],'short.txt',{type:'text/plain'}),'short lived');noError();
   const message=state().messages[peers[1].id].at(-1)!,wire=lastAck!;const expires=Date.parse(ackExpiry);
   assert.equal(message.expiresAt,expires);assert.equal((await db.messages.get(`${account.user.id}:${message.id}`))?.expiresAt,expires);
   assert.equal((await db.attachments.get(message.attachment!.id))?.expiresAt,expires);
   socket!.emit('message:expired',{message_id:wire.id});
   await until(async()=>!state().messages[peers[1].id]?.some(m=>m.id===message.id)&&!(await db.messages.get(`${account.user.id}:${message.id}`))&&!(await db.attachments.get(message.attachment!.id)),'expiration purge');
   socket!.emit('message:receive',wire);await pause();
   assert.ok(!state().messages[peers[1].id]?.some(m=>m.id===message.id));assert.equal(await db.messages.get(`${account.user.id}:${message.id}`),undefined);
  });

  await t.test('sender ACK cannot extend an earlier client expiry',async()=>{
   useVeilnivo.setState(value=>({activeId:peers[1].id,conversations:value.conversations.map(c=>c.id===peers[1].id?{...c,ttlSeconds:3600}:c)}));
   ackExpiry=new Date(Date.now()+86400000).toISOString();const before=Date.now();await state().send('keep the shorter expiry');noError();
   const message=state().messages[peers[1].id].at(-1)!;assert.ok(message.expiresAt!>=before+3600000&&message.expiresAt!<before+3605000);
   assert.equal((await db.messages.get(`${account.user.id}:${message.id}`))?.expiresAt,message.expiresAt);
   assert.equal(await db.outbox.get(`${account.user.id}:${message.id}`),undefined);
  });
 }finally{
  releaseHistory?.();releaseBot?.();await state().logout();io.close();await new Promise<void>(resolve=>http.close(()=>resolve()));db.close();
  if(nativeMode===undefined)delete process.env.NEXT_PUBLIC_API_MODE;else process.env.NEXT_PUBLIC_API_MODE=nativeMode;
  if(nativeUrl===undefined)delete process.env.NEXT_PUBLIC_API_URL;else process.env.NEXT_PUBLIC_API_URL=nativeUrl;
 }
});
