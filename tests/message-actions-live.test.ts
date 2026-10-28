import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {Server as SocketServer,type Socket as ServerSocket} from 'socket.io';
import {db} from '../src/lib/db';
import {generateIdentityKeyPair,deriveSharedSecret,encryptPayload} from '../src/lib/crypto';
import type {WireMessage} from '../src/lib/client';

const pause=()=>new Promise(resolve=>setTimeout(resolve,70));
async function until(check:()=>boolean,label:string){const deadline=Date.now()+7000;while(Date.now()<deadline){if(check())return;await new Promise(resolve=>setTimeout(resolve,15))}throw new Error(label)}

test('live edited snapshots and deletion tombstones defeat old history, stale events and offline cache recovery',{timeout:30000},async t=>{
 Object.defineProperty(globalThis,'window',{value:undefined,configurable:true});
 const nativeMode=process.env.NEXT_PUBLIC_API_MODE,nativeUrl=process.env.NEXT_PUBLIC_API_URL;
 const identity=await generateIdentityKeyPair(),peer={id:crypto.randomUUID(),username:'live_actions_peer',public_key:identity.publicKeyJwk,ttl_seconds:0};
 let account:any,socket:ServerSocket|undefined,row:WireMessage|undefined,holdHistory=false,releaseHistory:(()=>void)|undefined,holdEdit=false,releaseEdit:(()=>void)|undefined;
 const http=createServer(async(req,res)=>{
  const send=(data:unknown,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data))};
  try{
   const url=new URL(req.url!,'http://localhost');let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{};
   if(url.pathname==='/api/auth/register'){account={...body,user:{id:crypto.randomUUID(),username:body.username}};send(account);return}
   if(url.pathname==='/api/auth/salts'){send({auth_salt:account.auth_salt,wrap_salt:account.wrap_salt});return}
   if(url.pathname==='/api/auth/login'){send(account);return}
   if(url.pathname==='/api/auth/logout'){send({ok:true});return}
   if(url.pathname==='/api/conversations'){send({conversations:[peer]});return}
   if(url.pathname==='/api/requests'){send({requests:[]});return}
   if(url.pathname==='/api/blocks'){send({blocks:[]});return}
   if(url.pathname==='/api/aliases'){send({aliases:[]});return}
   if(url.pathname.startsWith('/api/messages/')&&req.method==='GET'){
    const page={messages:row?[{...row}]:[],next_cursor:null};if(holdHistory){holdHistory=false;releaseHistory=()=>send(page);return}send(page);return;
   }
   if(url.pathname.startsWith('/api/messages/')&&req.method==='PATCH'){
    if(!row||row.revision!==body.expected_revision){send({error:'Message changed; refresh and select again.'},409);return}
    row={...row,ciphertext:body.ciphertext,iv:body.iv,revision:(row.revision??0)+1};const result={message:{...row}};
    if(holdEdit){holdEdit=false;releaseEdit=()=>send(result);return}socket?.emit('message:updated',row);send(result);return;
   }
   if(url.pathname.startsWith('/api/messages/')&&req.method==='DELETE'){
    assert.ok(row);row={...row,ciphertext:'',iv:'',deletedAt:new Date().toISOString(),revision:(row.revision??0)+1};socket?.emit('message:deleted',row);send({message:row});return;
   }
   send({error:'Unexpected fixture route'},404);
  }catch(error){send({error:String(error)},500)}
 });
 const io=new SocketServer(http,{transports:['websocket']});
 io.on('connection',connection=>{socket=connection;connection.on('message:send',(body,ack)=>{row={id:crypto.randomUUID(),senderId:account.user.id,recipientId:peer.id,ciphertext:body.ciphertext,iv:body.iv,clientMessageId:body.client_message_id,createdAt:new Date().toISOString(),revision:0};ack({message:row})})});
 await new Promise<void>(resolve=>http.listen(0,'127.0.0.1',resolve));const address=http.address();assert.ok(address&&typeof address==='object');
 process.env.NEXT_PUBLIC_API_MODE='remote';process.env.NEXT_PUBLIC_API_URL=`http://127.0.0.1:${address.port}`;
 const {useVeilnivo}=await import('../src/lib/store'),state=()=>useVeilnivo.getState(),password='SyntheticLiveActions2026!';
 try{
  await state().register('live_actions_user',password);assert.equal(state().error,null);await until(()=>state().connected&&!!socket,'initial socket');state().selectChat(peer.id);
  await state().send('Original live action');assert.equal(state().error,null);const original={...row!},id=original.clientMessageId!;
  await t.test('edits replace ciphertext but keep message position and reject stale original snapshots',async()=>{
   assert.equal(await state().editMessage(id,'Updated live action'),true);assert.equal(state().error,null);
   const edited=state().messages[peer.id].find(m=>m.id===id)!;assert.equal(edited.text,'Updated live action');assert.equal(edited.edited,true);assert.equal(edited.revision,1);
   socket!.emit('message:receive',original);await pause();assert.equal(state().messages[peer.id].find(m=>m.id===id)?.text,'Updated live action');
   const cached=await db.messages.get(`${account.user.id}:${id}`);assert.equal(cached?.revision,1);assert.equal(cached?.id,id);assert.notEqual(cached?.ciphertext,original.ciphertext);
   await db.messages.put({...cached!,id:original.id});socket!.emit('message:updated',row);await pause();
   assert.equal(state().error,null);assert.equal((await db.messages.get(`${account.user.id}:${id}`))?.id,id,'older envelope-spread cache IDs are safely normalized');
  });
  await t.test('foreign logical IDs cannot delete another author or poison its revision, including nonce-free payload aliases',async()=>{
   const shared=await deriveSharedSecret(identity.privateKey,account.public_key);
   const forged=await encryptPayload({id,text:'Forged foreign content',timestamp:Date.now(),senderId:peer.id,type:'text'},shared);
   const attack={id:crypto.randomUUID(),senderId:peer.id,recipientId:account.user.id,clientMessageId:id,...forged,createdAt:new Date().toISOString(),revision:99};
   socket!.emit('message:deleted',{...attack,ciphertext:'',iv:'',deletedAt:new Date().toISOString()});await pause();
   socket!.emit('message:updated',attack);await pause();
   socket!.emit('message:receive',{...attack,id:crypto.randomUUID(),clientMessageId:undefined});await pause();
   assert.equal(state().messages[peer.id].find(m=>m.id===id)?.text,'Updated live action');assert.equal(state().messages[peer.id].find(m=>m.id===id)?.revision,1);
   const cached=await db.messages.get(`${account.user.id}:${id}`);assert.equal(cached?.revision,1);assert.notEqual(cached?.ciphertext,'');
   const otherId=crypto.randomUUID(),otherServer=crypto.randomUUID();await db.messages.put({cacheId:`${account.user.id}:${otherId}`,id:otherId,ownerId:account.user.id,peerId:peer.id,ciphertext:'untouched cached envelope',iv:'opaque',createdAt:Date.now(),senderId:account.user.id,serverId:otherServer,revision:0});
   socket!.emit('message:deleted',{...attack,id:crypto.randomUUID(),senderId:crypto.randomUUID(),clientMessageId:otherId,ciphertext:'',iv:'',deletedAt:new Date().toISOString()});await pause();
   assert.equal((await db.messages.get(`${account.user.id}:${otherId}`))?.ciphertext,'untouched cached envelope','an unseen cache in another peer cannot be overwritten');await db.messages.delete(`${account.user.id}:${otherId}`);
   state().clearError();socket!.emit('message:updated',row);await pause();assert.equal(state().error,null);assert.equal(state().messages[peer.id].find(m=>m.id===id)?.revision,1);
  });
  await t.test('a deleted snapshot wins over a delayed history page and cached plaintext is scrubbed',async()=>{
   holdHistory=true;state().selectChat(peer.id);await until(()=>!!releaseHistory,'held history');
   assert.equal(await state().deleteMessages([id],'everyone'),true);assert.equal(state().error,null);releaseHistory!();releaseHistory=undefined;await pause();
   socket!.emit('message:updated',{...original,revision:1});await pause();
   const removed=state().messages[peer.id].find(m=>m.id===id)!;assert.equal(removed.deleted,true);assert.equal(removed.text,'');
   const cached=await db.messages.get(`${account.user.id}:${id}`);assert.equal(cached?.ciphertext,'');assert.equal(cached?.iv,'');assert.equal(cached?.revision,2);
  });
  await t.test('missed offline deletion is fetched before a cache can display its old text',async()=>{
   row=undefined;await state().send('Delete while offline');const fresh={...row!},nextId=fresh.clientMessageId!;
   await state().logout();row={...fresh,ciphertext:'',iv:'',deletedAt:new Date().toISOString(),revision:1};
   const rendered:string[]=[];const unsub=useVeilnivo.subscribe(value=>{if(value.messages[peer.id]?.some(m=>m.text==='Delete while offline'))rendered.push('stale plaintext')});
   try{await state().login('live_actions_user',password)}finally{unsub()}
   assert.equal(state().error,null);assert.deepEqual(rendered,[]);assert.equal(state().messages[peer.id].find(m=>m.id===nextId)?.deleted,true);await until(()=>state().connected&&!!socket,'relogin socket');
  });
  await t.test('a late edit response cannot populate a locked session',async()=>{
   row=undefined;state().selectChat(peer.id);await state().send('Private live hide');const hidden={...row!},hiddenId=hidden.clientMessageId!;
   assert.equal(await state().deleteMessages([hiddenId],'me'),true);socket!.emit('message:receive',hidden);await pause();assert.equal(state().messages[peer.id].some(m=>m.id===hiddenId),false);
   await state().logout();await state().login('live_actions_user',password);assert.equal(state().error,null);state().selectChat(peer.id);await until(()=>state().connected&&!!socket,'hidden relogin socket');
   assert.equal(state().messages[peer.id].some(m=>m.id===hiddenId),false,'server history cannot restore a privately hidden message');
   row=undefined;state().selectChat(peer.id);await state().send('Late response original');const nextId=row!.clientMessageId!;
   holdEdit=true;const pending=state().editMessage(nextId,'Late response edit');await until(()=>!!releaseEdit,'held edit');await state().logout();releaseEdit!();releaseEdit=undefined;
   assert.equal(await pending,false);assert.equal(state().user,null);assert.deepEqual(state().messages,{});
  });
 }finally{
  releaseHistory?.();releaseEdit?.();await state().logout();io.disconnectSockets(true);await new Promise<void>(resolve=>io.close(()=>resolve()));http.close();db.close();
  if(nativeMode===undefined)delete process.env.NEXT_PUBLIC_API_MODE;else process.env.NEXT_PUBLIC_API_MODE=nativeMode;
  if(nativeUrl===undefined)delete process.env.NEXT_PUBLIC_API_URL;else process.env.NEXT_PUBLIC_API_URL=nativeUrl;
 }
});
