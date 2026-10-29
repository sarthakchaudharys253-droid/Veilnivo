import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {Server as SocketServer,type Socket as ServerSocket} from 'socket.io';
import {generateIdentityKeyPair,deriveSharedSecret,encryptPayload} from '../src/lib/crypto';
import {db} from '../src/lib/db';
import {BOT_CONTACT_ID as BOT} from '../src/lib/compat';
import type {WireMessage} from '../src/lib/client';

const pause=()=>new Promise(resolve=>setTimeout(resolve,70));
async function until(check:()=>boolean,label:string){const deadline=Date.now()+6000;while(Date.now()<deadline){if(check())return;await new Promise(resolve=>setTimeout(resolve,15))}throw new Error(label)}

test('live clears reject old HTTP history and vault closure cancels delayed plaintext and read receipts',{timeout:20000},async t=>{
 Object.defineProperty(globalThis,'window',{value:undefined,configurable:true});
 const nativeMode=process.env.NEXT_PUBLIC_API_MODE,nativeUrl=process.env.NEXT_PUBLIC_API_URL;
 const identity=await generateIdentityKeyPair(),peer={id:crypto.randomUUID(),username:'organization_live_peer',public_key:identity.publicKeyJwk};
 let account:any,socket:ServerSocket|undefined,rows:WireMessage[]=[],hold=false,releaseHistory:(()=>void)|undefined,reads:string[]=[],deletedRequests=0;
 const http=createServer(async(req,res)=>{
  const send=(value:unknown,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value))};
  try{
   const url=new URL(req.url!,'http://localhost');let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{};
   if(req.method==='DELETE')deletedRequests++;
   if(url.pathname==='/api/auth/register'){account={...body,user:{id:crypto.randomUUID(),username:body.username}};send(account);return}
   if(url.pathname==='/api/auth/salts'){send({auth_salt:account.auth_salt,wrap_salt:account.wrap_salt});return}
   if(url.pathname==='/api/auth/login'){send(account);return}
   if(url.pathname==='/api/auth/logout'){send({ok:true});return}
   if(url.pathname==='/api/conversations'){send({conversations:[peer]});return}
   if(url.pathname==='/api/requests'){send({requests:[]});return}
   if(url.pathname==='/api/blocks'){send({blocks:[]});return}
   if(url.pathname==='/api/aliases'){send({aliases:[]});return}
   if(url.pathname.startsWith('/api/messages/')){const page={messages:url.pathname.endsWith(peer.id)?rows:[],next_cursor:null};if(hold&&url.pathname.endsWith(peer.id)){hold=false;releaseHistory=()=>{releaseHistory=undefined;send(page)};return}send(page);return}
   send({error:'Unexpected fixture route'},404);
  }catch(error){send({error:String(error)},500)}
 });
 const io=new SocketServer(http,{transports:['websocket']});io.on('connection',connection=>{socket=connection;connection.on('message:read',({message_id})=>reads.push(message_id))});
 await new Promise<void>(resolve=>http.listen(0,'127.0.0.1',resolve));const address=http.address();assert.ok(address&&typeof address==='object');
 process.env.NEXT_PUBLIC_API_MODE='remote';process.env.NEXT_PUBLIC_API_URL=`http://127.0.0.1:${address.port}`;
 const {useVeilnivo}=await import('../src/lib/store'),state=()=>useVeilnivo.getState(),password='SyntheticLiveOrganization2026!';
 try{
  await state().register('organization_live_user',password);assert.equal(state().error,null);await until(()=>state().connected&&!!socket,'socket connection');
  const key=await deriveSharedSecret(identity.privateKey,account.public_key);
  const incoming=async(text:string,at:number,createdAt:number)=>{
   const id=crypto.randomUUID(),encrypted=await encryptPayload({id,text,timestamp:at,senderId:peer.id,type:'text'},key);
   return{id:crypto.randomUUID(),clientMessageId:id,senderId:peer.id,recipientId:account.user.id,...encrypted,createdAt:new Date(createdAt).toISOString(),revision:0} satisfies WireMessage;
  };
  const old=await incoming('Old server history with a fast sender clock',Date.now()+86400_000,Date.now()-10_000);rows=[old];
  socket!.emit('message:receive',old);await until(()=>!!state().messages[peer.id]?.length,'initial incoming message');
  const cachedOld=(await db.messages.get(`${account.user.id}:${old.clientMessageId}`))!;assert.ok(cachedOld);
  // Failed encrypted-settings persistence must not partially clear the cache.
  const native=crypto.subtle.encrypt.bind(crypto.subtle),mock=t.mock.method(crypto.subtle,'encrypt',async(algorithm:AlgorithmIdentifier|RsaOaepParams|AesCtrParams|AesCbcParams|AesGcmParams,key:CryptoKey,data:BufferSource)=>{
   let value:any;try{value=JSON.parse(new TextDecoder().decode(data as ArrayBuffer))}catch{}
   if(value?.chatOrganization)throw new Error('Synthetic settings write failure');return native(algorithm,key,data);
  });
  try{assert.equal(await state().clearChats([peer.id]),false);assert.equal(state().messages[peer.id]?.length,1);assert.ok(await db.messages.get(cachedOld.cacheId))}finally{mock.mock.restore();state().clearError()}
  assert.equal(await state().clearChats([peer.id]),true);assert.equal(state().messages[peer.id]?.length??0,0);
  await db.messages.put(cachedOld);await state().logout();await state().login(account.user.username,password);assert.equal(state().error,null);
  await until(()=>state().connected&&!!socket,'relogin socket');assert.equal(state().messages[peer.id]?.length??0,0,'HTTP and stale cache cannot restore cleared ciphertext');
  const later=await incoming('Future message with a slow sender clock',Date.now()-86400_000,Date.now()+100);rows.push(later);socket!.emit('message:receive',later);
  await until(()=>state().messages[peer.id]?.some(m=>m.id===later.clientMessageId)??false,'new server message');
  assert.equal(await state().setChatLockCode('a🔒 9'),true);assert.equal(await state().organizeChats([peer.id],'lock'),true);
  assert.equal(state().messages[peer.id]?.length??0,0);state().selectChat(peer.id);assert.notEqual(state().activeId,peer.id);state().clearError();
  const privateRow=await incoming('Hidden until the vault opens',Date.now(),Date.now()+200);rows.push(privateRow);reads=[];
  socket!.emit('presence:update',{user_id:peer.id,online:true});socket!.emit('typing:receive',{user_id:peer.id,typing:true});socket!.emit('message:receive',privateRow);await pause();
  assert.equal(state().typing,false);assert.equal(state().conversations.find(c=>c.id===peer.id)?.unread,0);assert.equal(state().conversations.find(c=>c.id===peer.id)?.preview,undefined);
  assert.equal(state().messages[peer.id]?.length??0,0);assert.equal(await db.messages.get(`${account.user.id}:${privateRow.clientMessageId}`),undefined);assert.deepEqual(reads,[]);
  state().selectChat(BOT);await state().send('a🔒 9');assert.equal(state().lockedChatsOpen,true);assert.ok(state().messages[peer.id].some(m=>m.id===privateRow.clientMessageId));
  const delayed=await incoming('A delayed page must stay locked',Date.now(),Date.now()+300);rows.push(delayed);hold=true;releaseHistory=undefined;
  state().selectChat(peer.id);await until(()=>!!releaseHistory,'held history request');state().closeLockedChats();reads=[];releaseHistory!();await pause();
  assert.equal(state().lockedChatsOpen,false);assert.equal(state().messages[peer.id]?.length??0,0);assert.deepEqual(reads,[]);
  assert.equal(await db.messages.get(`${account.user.id}:${delayed.clientMessageId}`),undefined,'history started before closure cannot repopulate the cache');
  assert.equal(await state().resetChatLock(),true);assert.equal(deletedRequests,0,'device-local organization never deletes server messages or relationships');
 }finally{
  releaseHistory?.();await state().logout();io.disconnectSockets(true);await new Promise<void>(resolve=>io.close(()=>resolve()));http.close();db.close();
  if(nativeMode===undefined)delete process.env.NEXT_PUBLIC_API_MODE;else process.env.NEXT_PUBLIC_API_MODE=nativeMode;
  if(nativeUrl===undefined)delete process.env.NEXT_PUBLIC_API_URL;else process.env.NEXT_PUBLIC_API_URL=nativeUrl;
 }
});


