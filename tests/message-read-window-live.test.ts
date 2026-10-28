import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {Server as SocketServer,type Socket as ServerSocket} from 'socket.io';
import {db} from '../src/lib/db';
import {generateIdentityKeyPair,deriveSharedSecret,encryptPayload} from '../src/lib/crypto';
import {DELETE_FOR_EVERYONE_WINDOW_MS,getMessageDeletionState} from '../src/lib/message-deletion';
import type {WireMessage} from '../src/lib/client';

const pause=()=>new Promise(resolve=>setTimeout(resolve,70));
async function until(check:()=>boolean,label:string){const end=Date.now()+7000;while(Date.now()<end){if(check())return;await new Promise(resolve=>setTimeout(resolve,15))}throw new Error(label)}

test('first-read deadlines survive early receipts, stale snapshots, edits, cache recovery and legacy missing timestamps',{timeout:30000},async t=>{
 Object.defineProperty(globalThis,'window',{value:undefined,configurable:true});
 const nativeMode=process.env.NEXT_PUBLIC_API_MODE,nativeUrl=process.env.NEXT_PUBLIC_API_URL,identity=await generateIdentityKeyPair();
 const peer={id:crypto.randomUUID(),username:'read_window_peer',public_key:identity.publicKeyJwk,ttl_seconds:0},rows=new Map<string,WireMessage>();
 let account:any,socket:ServerSocket|undefined,latest:WireMessage|undefined,earlyRead:number|undefined,deleteRequests=0;
 const http=createServer(async(req,res)=>{
  const send=(value:unknown,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value))};
  try{
   const url=new URL(req.url!,'http://localhost');let raw='';for await(const part of req)raw+=part;const body=raw?JSON.parse(raw):{};
   if(url.pathname==='/api/auth/register'){account={...body,user:{id:crypto.randomUUID(),username:body.username}};send(account);return}
   if(url.pathname==='/api/auth/salts'){send({auth_salt:account.auth_salt,wrap_salt:account.wrap_salt});return}
   if(url.pathname==='/api/auth/login'){send(account);return}
   if(url.pathname==='/api/auth/logout'){send({ok:true});return}
   if(url.pathname==='/api/conversations'){send({conversations:[peer]});return}
   if(url.pathname==='/api/requests'){send({requests:[]});return}
   if(url.pathname==='/api/blocks'){send({blocks:[]});return}
   if(url.pathname==='/api/aliases'){send({aliases:[]});return}
   if(url.pathname.startsWith('/api/messages/')&&req.method==='GET'){send({messages:[...rows.values()],next_cursor:null});return}
   const message=rows.get(url.pathname.split('/').at(-1)!);
   if(message&&req.method==='PATCH'){
    assert.equal(body.expected_revision,message.revision??0);Object.assign(message,{ciphertext:body.ciphertext,iv:body.iv,revision:(message.revision??0)+1});socket?.emit('message:updated',{...message});send({message});return;
   }
   if(message&&req.method==='DELETE'){
    deleteRequests++;Object.assign(message,{ciphertext:'',iv:'',deletedAt:new Date().toISOString(),revision:(message.revision??0)+1});socket?.emit('message:deleted',{...message});send({message});return;
   }
   send({error:'Unexpected fixture route'},404);
  }catch(error){send({error:String(error)},500)}
 });
 const io=new SocketServer(http,{transports:['websocket']});
 io.on('connection',connection=>{socket=connection;connection.on('message:send',(body,ack)=>{
  const row:WireMessage={id:crypto.randomUUID(),senderId:account.user.id,recipientId:peer.id,ciphertext:body.ciphertext,iv:body.iv,clientMessageId:body.client_message_id,createdAt:new Date().toISOString(),revision:0};latest=row;rows.set(row.id,row);
  if(earlyRead!==undefined){const snapshot={...row};row.readAt=new Date(earlyRead).toISOString();connection.emit('message:receipt',{message_id:row.id,status:'read',at:row.readAt});earlyRead=undefined;setTimeout(()=>ack({message:snapshot}),20)}else ack({message:row});
 })});
 await new Promise<void>(resolve=>http.listen(0,'127.0.0.1',resolve));const address=http.address();assert.ok(address&&typeof address==='object');
 process.env.NEXT_PUBLIC_API_MODE='remote';process.env.NEXT_PUBLIC_API_URL=`http://127.0.0.1:${address.port}`;
 const {useVeilnivo}=await import('../src/lib/store'),state=()=>useVeilnivo.getState(),password='SyntheticReadWindow2026!';
 const view=(id:string)=>state().messages[peer.id]?.find(message=>message.id===id);
 try{
  await state().register('read_window_user',password);assert.equal(state().error,null);await until(()=>state().connected&&!!socket,'connected');state().selectChat(peer.id);
  const firstRead=Date.now()-120_000;earlyRead=firstRead;await state().send('Early read receipt');assert.equal(state().error,null);const row=latest!,id=row.clientMessageId!,originalServerId=row.id;let originalExpiredReadAt=0,deleteCollisionId='',legacyCanonicalId='',legacyReadAt=0;
  await t.test('a read receipt arriving before a stale send ACK is retained in memory and cache',async()=>{
   assert.equal(view(id)?.status,'read');assert.equal(view(id)?.readAt,firstRead);assert.equal((await db.messages.get(`${account.user.id}:${id}`))?.readAt,firstRead);
   socket!.emit('message:receipt',{message_id:row.id,status:'delivered',at:new Date().toISOString()});socket!.emit('message:receipt',{message_id:row.id,status:'read',at:new Date().toISOString()});await pause();
   socket!.emit('message:receive',{...row,readAt:null,deliveredAt:new Date().toISOString()});await pause();
   assert.equal(view(id)?.status,'read');assert.equal(view(id)?.readAt,firstRead);assert.equal((await db.messages.get(`${account.user.id}:${id}`))?.readAt,firstRead);
  });
  await t.test('a peer logical nonce equal to another message server UUID cannot receive its read receipt',async()=>{
   const collisionId=row.id,attackServerId=crypto.randomUUID(),timestamp=Date.now()-300_000;
   const key=await deriveSharedSecret(identity.privateKey,account.public_key);
   const envelope=await encryptPayload({id:collisionId,text:'Different incoming message',timestamp,senderId:peer.id,type:'text'},key);
   const collision:WireMessage={id:attackServerId,senderId:peer.id,recipientId:account.user.id,clientMessageId:collisionId,...envelope,createdAt:new Date(timestamp).toISOString(),revision:0};
   rows.set(attackServerId,collision);socket!.emit('message:receive',collision);await pause();
   assert.equal(view(collisionId)?.serverId,attackServerId);assert.equal(view(collisionId)?.readAt,undefined);
   socket!.emit('message:receipt',{message_id:row.id,status:'read',at:new Date(firstRead).toISOString()});await pause();
   assert.equal(view(collisionId)?.readAt,undefined,'receipt IDs belong exclusively to the server-ID namespace');
   assert.notEqual(view(collisionId)?.status,'read');assert.equal(view(id)?.readAt,firstRead);
   assert.equal((await db.messages.get(`${account.user.id}:${collisionId}`))?.readAt,undefined);
  });
  await t.test('edits and a stale original snapshot cannot reset the first-read deadline',async()=>{
   assert.equal(await state().editMessage(id,'Edited without restarting timer'),true);assert.equal(view(id)?.readAt,firstRead);
   const expired=Date.now()-DELETE_FOR_EVERYONE_WINDOW_MS-10;originalExpiredReadAt=expired;
   row.readAt=new Date(expired).toISOString();socket!.emit('message:receive',{...row,revision:0});await pause();
   assert.equal(view(id)?.text,'Edited without restarting timer');assert.equal(view(id)?.readAt,expired);assert.equal((await db.messages.get(`${account.user.id}:${id}`))?.readAt,expired);
   assert.equal(await state().deleteMessages([id],'everyone'),false);assert.match(state().error??'',/30 minutes/);assert.equal(deleteRequests,0,'expired client operations do not reach the network');
   state().clearError();assert.equal(view(originalServerId)?.text,'Different incoming message');assert.ok(rows.get(row.id)?.ciphertext);
  });
  await t.test('a legacy read receipt without its time fails closed until authoritative time arrives',async()=>{
   await state().send('Legacy unknown read time');const row=latest!,id=row.clientMessageId!;
   socket!.emit('message:receipt',{message_id:row.id,status:'read'});await pause();socket!.emit('message:receive',{...row,readAt:null});await pause();
   assert.equal(view(id)?.status,'read');assert.equal(view(id)?.readAt,undefined);assert.equal(getMessageDeletionState(view(id)!).allowed,false);
   assert.equal(await state().deleteMessages([id],'everyone'),false);assert.match(state().error??'',/Refresh/);assert.equal(deleteRequests,0);
   state().clearError();row.readAt=new Date().toISOString();socket!.emit('message:receipt',{message_id:row.id,status:'read',at:row.readAt});await pause();
   assert.equal(await state().deleteMessages([id],'everyone'),true);assert.equal(deleteRequests,1);
  });
  await t.test('deleting an own message cannot tombstone a peer nonce equal to its server UUID',async()=>{
   await state().send('Own deletion collision target');const victim=latest!,timestamp=Date.now()-200_000;deleteCollisionId=victim.id;
   const key=await deriveSharedSecret(identity.privateKey,account.public_key),envelope=await encryptPayload({id:deleteCollisionId,text:'Incoming survives another deletion',timestamp,senderId:peer.id,type:'text'},key);
   const collision:WireMessage={id:crypto.randomUUID(),senderId:peer.id,recipientId:account.user.id,clientMessageId:deleteCollisionId,...envelope,createdAt:new Date(timestamp).toISOString(),revision:0};
   rows.set(collision.id,collision);socket!.emit('message:receive',collision);await pause();assert.equal(view(deleteCollisionId)?.text,'Incoming survives another deletion');
   assert.equal(await state().deleteMessages([victim.clientMessageId!],'everyone'),true);assert.equal(deleteRequests,2);assert.equal(view(victim.clientMessageId!)?.deleted,true);
   assert.equal(view(deleteCollisionId)?.text,'Incoming survives another deletion');assert.equal(view(deleteCollisionId)?.deleted,undefined);assert.ok((await db.messages.get(`${account.user.id}:${deleteCollisionId}`))?.ciphertext);
  });
  await t.test('nonce-free canonical server bindings still edit and preserve their authoritative first read',async()=>{
   legacyCanonicalId=crypto.randomUUID();legacyReadAt=Date.now()-60_000;const timestamp=Date.now()-100_000,key=await deriveSharedSecret(identity.privateKey,account.public_key);
   const envelope=await encryptPayload({id:crypto.randomUUID(),text:'Legacy own canonical message',timestamp,senderId:account.user.id,type:'text'},key);
   const legacy:WireMessage={id:legacyCanonicalId,senderId:account.user.id,recipientId:peer.id,clientMessageId:null,...envelope,createdAt:new Date(timestamp).toISOString(),readAt:new Date(legacyReadAt).toISOString(),revision:0};
   rows.set(legacy.id,legacy);socket!.emit('message:receive',legacy);await pause();assert.equal(view(legacyCanonicalId)?.serverId,legacyCanonicalId);
   assert.equal(await state().editMessage(legacyCanonicalId,'Legacy canonical edit'),true);assert.equal(view(legacyCanonicalId)?.readAt,legacyReadAt);
  });
  await t.test('sign-in history and encrypted-content cache recovery retain an expired read deadline',async()=>{
   await state().send('History read deadline');const row=latest!,id=row.clientMessageId!,readAt=Date.now()-DELETE_FOR_EVERYONE_WINDOW_MS-100;
   row.readAt=new Date(readAt).toISOString();socket!.emit('message:receipt',{message_id:row.id,status:'read',at:row.readAt});await pause();
   await state().logout();await state().login('read_window_user',password);assert.equal(state().error,null);assert.equal(view(id)?.readAt,readAt);assert.equal(getMessageDeletionState(view(id)!).allowed,false);
   assert.equal(view(originalServerId)?.text,'Different incoming message','the collision remains present through history recovery');assert.equal(view(originalServerId)?.readAt,undefined);
   assert.equal(view(deleteCollisionId)?.text,'Incoming survives another deletion');assert.equal(view(deleteCollisionId)?.deleted,undefined);
   assert.equal(view(legacyCanonicalId)?.text,'Legacy canonical edit');assert.equal(view(legacyCanonicalId)?.readAt,legacyReadAt);
   const originalId=rows.get(originalServerId)!.clientMessageId!;assert.equal(view(originalId)?.text,'Edited without restarting timer');assert.equal(view(originalId)?.readAt,originalExpiredReadAt);
   state().selectChat(peer.id);assert.equal(await state().deleteMessages([id],'everyone'),false);assert.equal(deleteRequests,2);assert.match(state().error??'',/30 minutes/);
   state().clearError();assert.equal(await state().editMessage(originalId,'Edited again after collision recovery'),true);assert.equal(state().error,null);assert.equal(view(originalId)?.readAt,originalExpiredReadAt);
   assert.equal(await state().deleteMessages([id],'me'),true,'private hiding remains available for expired deletion windows');assert.ok(rows.get(row.id)?.ciphertext);
  });
 }finally{
  await state().logout();io.disconnectSockets(true);await new Promise<void>(resolve=>io.close(()=>resolve()));http.close();db.close();
  if(nativeMode===undefined)delete process.env.NEXT_PUBLIC_API_MODE;else process.env.NEXT_PUBLIC_API_MODE=nativeMode;
  if(nativeUrl===undefined)delete process.env.NEXT_PUBLIC_API_URL;else process.env.NEXT_PUBLIC_API_URL=nativeUrl;
 }
});
