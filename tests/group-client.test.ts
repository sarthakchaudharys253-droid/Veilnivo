import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {Server as SocketServer,type Socket as ServerSocket} from 'socket.io';
import {generateIdentityKeyPair} from '../src/lib/crypto';
import {unwrapGroupKey,decryptGroupPayload,encryptGroupPayload} from '../src/lib/group-crypto';
import {db} from '../src/lib/db';
import {groupConversationId,groupServerId,parseGroupMember,parseGroupSummary,parseGroupWireMessage,type GroupWireMessage} from '../src/lib/group-types';

async function until(check:()=>boolean,label:string){const deadline=Date.now()+7000;while(Date.now()<deadline){if(check())return;await new Promise(resolve=>setTimeout(resolve,15))}throw new Error(label)}
const wait=()=>new Promise(resolve=>setTimeout(resolve,90));

test('group wire parsers keep conversation namespaces and reject invalid metadata',async()=>{
 const id=crypto.randomUUID(),ownerId=crypto.randomUUID(),at=new Date().toISOString(),key=await generateIdentityKeyPair();
 assert.equal(groupServerId(groupConversationId(id)),id);assert.throws(()=>groupServerId('ai-bot'));
 assert.equal(parseGroupSummary({id,ownerId,name:'👨‍👩‍👧‍👦'.repeat(10),keyVersion:1,memberCount:10001,createdAt:at,updatedAt:at,needsRekey:false}).memberCount,10001);
 assert.throws(()=>parseGroupSummary({id,ownerId,name:'Group',keyVersion:0,memberCount:2,createdAt:at,updatedAt:at,needsRekey:false}));
 assert.throws(()=>parseGroupMember({id:ownerId,username:'test_peer',public_key:{...key.publicKeyJwk,d:'private'},role:'member',joinedVersion:1}));
 assert.throws(()=>parseGroupWireMessage({id,groupId:id,senderId:ownerId,senderUsername:'test_peer',clientMessageId:id,keyVersion:1,createdAt:'yesterday',ciphertext:'x',iv:'x'}));
});

test('live groups encrypt one shared conversation, recover history and rotate keys without queued replay',{timeout:30000},async t=>{
 Object.defineProperty(globalThis,'window',{value:undefined,configurable:true});
 const nativeMode=process.env.NEXT_PUBLIC_API_MODE,nativeUrl=process.env.NEXT_PUBLIC_API_URL,nativeNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 let online=true;Object.defineProperty(globalThis,'navigator',{value:{get onLine(){return online}},configurable:true});
 const peers=await Promise.all(['bob','cara','dana','eli'].map(async name=>{const keys=await generateIdentityKeyPair();return{id:crypto.randomUUID(),username:'group_'+name,public_key:keys.publicKeyJwk,privateKey:keys.privateKey}}));
 let account:any,socket:ServerSocket|undefined,group:any,roster:any[]=[],envelopes:any[]=[],rows:GroupWireMessage[]=[],holdHistory=false,releaseHistory:(()=>void)|undefined,holdRoster=false,releaseRoster:(()=>void)|undefined,failAck=false,reads=0,typing=0;
 const posts:any[]=[];
 const http=createServer(async(req,res)=>{
  const send=(value:unknown,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value))};
  try{
   const url=new URL(req.url!,'http://localhost');let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{};
   if(url.pathname==='/api/auth/register'){account={...body,user:{id:crypto.randomUUID(),username:body.username}};send(account);return}
   if(url.pathname==='/api/auth/salts'){send({auth_salt:account.auth_salt,wrap_salt:account.wrap_salt});return}
   if(url.pathname==='/api/auth/login'){send(account);return}
   if(url.pathname==='/api/auth/logout'){send({ok:true});return}
   if(url.pathname==='/api/conversations'){send({conversations:peers.map(({privateKey,...peer})=>peer)});return}
   if(url.pathname==='/api/requests'){send({requests:[]});return}
   if(url.pathname==='/api/blocks'){send({blocks:[]});return}
   if(url.pathname==='/api/aliases'){send({aliases:[]});return}
   if(url.pathname.startsWith('/api/messages/')){send({messages:[],next_cursor:null});return}
   if(url.pathname==='/api/groups'&&req.method==='POST'){
    const at=new Date().toISOString();group={id:body.id,name:body.name,ownerId:account.user.id,keyVersion:1,memberCount:body.member_ids.length+1,createdAt:at,updatedAt:at,lastMessageAt:null,needsRekey:false};
    roster=[{id:account.user.id,username:account.user.username,public_key:account.public_key,role:'owner',joinedVersion:1},...peers.filter(peer=>body.member_ids.includes(peer.id)).map(peer=>({id:peer.id,username:peer.username,public_key:peer.public_key,role:'member',joinedVersion:1}))];
    envelopes=body.envelopes.map((envelope:any)=>({...envelope,key_version:1,wrapped_by:{id:account.user.id,public_key:account.public_key}}));send({group},201);return;
   }
   if(url.pathname==='/api/groups'){send({groups:group?[group]:[],next_cursor:null});return}
   if(group&&url.pathname===`/api/groups/${group.id}/members`&&req.method==='POST'){
    if(body.expected_version!==group.keyVersion){send({error:'Group changed'},409);return}
    const next=group.keyVersion+1;roster.push(...peers.filter(peer=>body.member_ids.includes(peer.id)&&!roster.some(member=>member.id===peer.id)).map(peer=>({id:peer.id,username:peer.username,public_key:peer.public_key,role:'member',joinedVersion:next})));
    assert.deepEqual(new Set(body.envelopes.map((envelope:any)=>envelope.recipient_id)),new Set(roster.map(member=>member.id)));
    group={...group,keyVersion:next,memberCount:roster.length,needsRekey:false,updatedAt:new Date().toISOString()};envelopes.push(...body.envelopes.map((envelope:any)=>({...envelope,key_version:next,wrapped_by:{id:account.user.id,public_key:account.public_key}})));send({group});return;
   }
   if(group&&url.pathname===`/api/groups/${group.id}/members`){const offset=Number(url.searchParams.get('cursor')||0),page=roster.slice(offset,offset+2),snapshot={members:page,key_version:group.keyVersion,next_cursor:offset+2<roster.length?String(offset+2):null};if(holdRoster){holdRoster=false;releaseRoster=()=>{releaseRoster=undefined;send(snapshot)};return}send(snapshot);return}
   if(group&&url.pathname===`/api/groups/${group.id}/keys`){send({keys:envelopes.filter(envelope=>envelope.recipient_id===account.user.id),next_cursor:null});return}
   if(group&&url.pathname===`/api/groups/${group.id}/messages`&&req.method==='POST'){
    posts.push(body);const old=rows.find(row=>row.clientMessageId===body.client_message_id);
    if(old){assert.equal(old.ciphertext,body.ciphertext);assert.equal(old.iv,body.iv);send({message:old});return}
    if(body.key_version!==group.keyVersion||group.needsRekey){send({error:'Group changed'},409);return}
    const message:GroupWireMessage={id:crypto.randomUUID(),groupId:group.id,senderId:account.user.id,senderUsername:account.user.username,clientMessageId:body.client_message_id,keyVersion:body.key_version,ciphertext:body.ciphertext,iv:body.iv,createdAt:new Date().toISOString()};rows.push(message);
    if(failAck){failAck=false;send({error:'Synthetic lost acknowledgement'},500);return}
    socket?.emit('group:message',message);send({message},201);return;
   }
   if(group&&url.pathname===`/api/groups/${group.id}/messages`){const page={messages:[...rows],next_cursor:null};if(holdHistory){holdHistory=false;releaseHistory=()=>{releaseHistory=undefined;send(page)};return}send(page);return}
   send({error:'Unexpected fixture route'},404);
  }catch(error){send({error:String(error)},500)}
 });
 const io=new SocketServer(http,{transports:['websocket']});io.on('connection',connection=>{socket=connection;connection.on('message:read',()=>reads++);connection.on('typing:send',()=>typing++)});
 await new Promise<void>(resolve=>http.listen(0,'127.0.0.1',resolve));const address=http.address();assert.ok(address&&typeof address==='object');process.env.NEXT_PUBLIC_API_MODE='remote';process.env.NEXT_PUBLIC_API_URL=`http://127.0.0.1:${address.port}`;
 const {useVeilnivo,emitTyping}=await import('../src/lib/store'),state=()=>useVeilnivo.getState(),password='SyntheticGroupPassword2026!';
 try{
  await state().register('group_alice',password);assert.equal(state().error,null);await until(()=>state().connected&&!!socket,'socket connected');
  const created=await state().createGroup('Our encrypted group',peers.slice(0,2).map(peer=>peer.id));assert.ok(created);assert.equal(state().error,null);assert.ok(created.isGroup);assert.equal(created.memberCount,3);assert.equal(created.id,groupConversationId(group.id));
  const members=await state().loadGroupMembers(created.id);assert.equal(members.length,3,'roster combines every page without a member limit');
  const bob=peers[0],wrapped=envelopes.find(envelope=>envelope.recipient_id===bob.id),key=await unwrapGroupKey(wrapped,bob.privateKey,account.public_key,group.id,1,{wrappedById:account.user.id,recipientId:bob.id});
  await state().send('A group message for everyone');assert.equal(state().error,null);const sent=state().messages[created.id].find(message=>message.text==='A group message for everyone')!;assert.equal(sent.status,'sent');assert.equal(sent.senderId,account.user.id);
  const payload=await decryptGroupPayload<any>(rows[0].ciphertext,rows[0].iv,key,group.id,1);assert.equal(payload.text,'A group message for everyone');assert.equal(payload.groupId,group.id);assert.equal(JSON.stringify(posts).includes(payload.text),false);assert.equal(await db.outbox.where('ownerId').equals(account.user.id).count(),0);
  const incoming=async(text:string)=>{const id=crypto.randomUUID(),encrypted=await encryptGroupPayload({id,groupId:group.id,keyVersion:1,senderId:bob.id,type:'text',text,timestamp:Date.now()},key,group.id,1);return{id:crypto.randomUUID(),groupId:group.id,senderId:bob.id,senderUsername:bob.username,clientMessageId:id,keyVersion:1,...encrypted,createdAt:new Date().toISOString()} satisfies GroupWireMessage};
  const reply=await incoming('Hello from Bob');rows.push(reply);socket!.emit('group:message',reply);await until(()=>state().messages[created.id]?.some(message=>message.id===reply.clientMessageId)??false,'incoming group author');assert.equal(state().messages[created.id].find(message=>message.id===reply.clientMessageId)?.senderName,bob.username);
  await state().send('A group reply',reply.clientMessageId);assert.equal(state().error,null);const quoted=await decryptGroupPayload<any>(rows.at(-1)!.ciphertext,rows.at(-1)!.iv,key,group.id,1);assert.equal(quoted.replyTo.senderId,bob.id);assert.equal(quoted.replyTo.senderName,bob.username);
  await state().reactToMessage(reply.clientMessageId,'💚');assert.equal(state().error,null);assert.deepEqual(state().messages[created.id].find(message=>message.id===reply.clientMessageId)?.reactions?.['💚'],[account.user.id]);
  state().markRead(created.id);emitTyping(true,created.id);await wait();assert.equal(reads,0,'groups never send direct-chat read receipts');assert.equal(typing,0,'groups never send direct-chat typing envelopes');
  failAck=true;await state().send('Retry exactly once through rotation');const failed=state().messages[created.id].find(message=>message.text==='Retry exactly once through rotation')!;assert.equal(failed.status,'failed');state().clearError();const before=rows.length;
  assert.equal(await state().addGroupMembers(created.id,[peers[2].id]),true);assert.equal(state().conversations.find(contact=>contact.id===created.id)?.keyVersion,2);assert.equal(group.memberCount,4);
  await state().retryMessage(failed.id);assert.equal(state().error,null);assert.equal(rows.length,before,'a lost ACK replay never creates another record after key rotation');assert.equal(state().messages[created.id].find(message=>message.id===failed.id)?.status,'sent');
  online=false;await state().send('Offline group draft');assert.equal(state().messages[created.id].find(message=>message.text==='Offline group draft')?.status,'queued');online=true;const queued=state().messages[created.id].find(message=>message.text==='Offline group draft')!;await state().retryMessage(queued.id);assert.equal(state().error,null);assert.equal(state().messages[created.id].find(message=>message.id===queued.id)?.status,'sent');
  await state().logout();await state().login(account.user.username,password);assert.equal(state().error,null);await until(()=>state().connected&&!!socket,'relogin socket');assert.ok(state().messages[created.id]?.some(message=>message.text==='Hello from Bob'),'keys and old group history recover on sign-in');
  // An account erase removes that author's server messages and requires a new
  // group epoch. Membership reconciliation must also purge their cached copy.
  holdHistory=true;releaseHistory=undefined;state().selectChat(created.id);await until(()=>!!releaseHistory,'history snapshot held before member erase');const oldHistory=releaseHistory!;
  holdRoster=true;releaseRoster=undefined;const oldRoster=state().loadGroupMembers(created.id);await until(()=>!!releaseRoster,'member snapshot held before erase');const oldMemberSnapshot=releaseRoster!;
  roster=roster.filter(member=>member.id!==bob.id);rows=rows.filter(row=>row.senderId!==bob.id);group={...group,memberCount:roster.length,needsRekey:true};socket!.emit('groups:updated');
  await until(()=>state().conversations.find(contact=>contact.id===created.id)?.keyVersion===3,'remaining members repair the erased member key epoch');
  assert.equal(state().messages[created.id]?.some(message=>message.senderId===bob.id),false);assert.equal((await db.messages.where('[ownerId+peerId]').equals([account.user.id,created.id]).toArray()).some(row=>row.senderId===bob.id),false);
  oldMemberSnapshot();await oldRoster;assert.equal(state().groupMembers[created.id]?.some(member=>member.id===bob.id),false,'a superseded member snapshot cannot restore an erased author');oldHistory();socket!.emit('group:message',reply);await wait();assert.equal(state().messages[created.id]?.some(message=>message.id===reply.clientMessageId),false,'delayed history and an erased-author event cannot return');
  state().selectChat(created.id);await wait();assert.equal(await state().clearChats([created.id]),true);assert.equal(state().messages[created.id]?.length??0,0);await state().logout();await state().login(account.user.username,password);assert.equal(state().error,null);assert.equal(state().messages[created.id]?.length??0,0,'server ciphertext cannot resurrect a cleared group history');
  assert.equal(await state().setChatLockCode('g🔒 4'),true);assert.equal(await state().organizeChats([created.id],'lock'),true);assert.equal(await state().loadGroupMembers(created.id).then(members=>members.length),0);state().clearError();assert.equal(await state().enterLockedChats('g🔒 4'),true);
  holdHistory=true;releaseHistory=undefined;state().selectChat(created.id);await until(()=>!!releaseHistory,'held group history');state().closeLockedChats();releaseHistory!();await wait();assert.equal(state().messages[created.id]?.length??0,0);assert.equal(state().groupMembers[created.id],undefined);
  assert.equal(await state().enterLockedChats('g🔒 4'),true);assert.equal(await state().organizeChats([created.id],'unlock'),true);assert.equal(await state().organizeChats([peers[1].id,peers[3].id],'lock'),true);
  async function duringWrappedKey<T>(action:()=>Promise<T>){
   const native=crypto.subtle.encrypt.bind(crypto.subtle);let release:(()=>void)|undefined;
   const mock=t.mock.method(crypto.subtle,'encrypt',async(algorithm:AlgorithmIdentifier|RsaOaepParams|AesCtrParams|AesCbcParams|AesGcmParams,key:CryptoKey,data:BufferSource)=>{let value:any;try{value=JSON.parse(new TextDecoder().decode(data as ArrayBuffer))}catch{}if(value?.type==='veilnivo-group-key-v1'&&!release)await new Promise<void>(resolve=>{release=resolve});return native(algorithm,key,data)});
   try{const operation=action();await until(()=>!!release,'held group key wrapping');state().closeLockedChats();release!();return await operation}finally{release?.();mock.mock.restore()}
  }
  const unchangedId=group.id;assert.equal(await duringWrappedKey(()=>state().createGroup('Cancelled private selection',[peers[1].id])),null);assert.equal(group.id,unchangedId,'closing the vault cancels a group creation with a now-hidden member');
  assert.equal(await state().enterLockedChats('g🔒 4'),true);state().clearError();assert.equal(await duringWrappedKey(()=>state().addGroupMembers(created.id,[peers[3].id])),false);assert.equal(group.keyVersion,3,'closing a locked candidate cancels adding them to an unlocked group');state().clearError();
 }finally{
  releaseHistory?.();releaseRoster?.();await state().logout();io.disconnectSockets(true);await new Promise<void>(resolve=>io.close(()=>resolve()));http.close();db.close();
  if(nativeMode===undefined)delete process.env.NEXT_PUBLIC_API_MODE;else process.env.NEXT_PUBLIC_API_MODE=nativeMode;if(nativeUrl===undefined)delete process.env.NEXT_PUBLIC_API_URL;else process.env.NEXT_PUBLIC_API_URL=nativeUrl;
  if(nativeNavigator)Object.defineProperty(globalThis,'navigator',nativeNavigator);else Reflect.deleteProperty(globalThis,'navigator');
 }
});
