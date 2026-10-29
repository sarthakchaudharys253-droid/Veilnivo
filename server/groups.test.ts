import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import type {Socket} from 'socket.io-client';
import {SESSION_COOKIE_NAME} from '../src/lib/compat';
import {groupName,groupVersion} from './groups';
import {pair} from './v2';

test('group names and key versions reject malformed routing metadata',()=>{
 assert.equal(groupName('  Weekend plans 🏖️  '),'Weekend plans 🏖️');
 for(const value of ['',null,0,'x'.repeat(81),'hidden\nline','bad\u0000name'])assert.throws(()=>groupName(value));
 for(const value of [1,2,1000])assert.equal(groupVersion(value),value);
 for(const value of [0,-1,1.2,'1',null,Infinity,2147483647])assert.throws(()=>groupVersion(value));
});
const encrypted=()=>({ciphertext:randomBytes(80).toString('base64'),iv:randomBytes(12).toString('base64')});
function once<T>(socket:Socket,event:string):Promise<T>{return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{socket.off(event,handler);reject(new Error('Missing '+event))},5000),handler=(value:T)=>{clearTimeout(timer);resolve(value)};socket.once(event,handler)})}

test('SQL groups authorize member keys/history, rotate membership atomically, and coordinate erasure',{skip:!process.env.TEST_DATABASE_URL,timeout:90000},async t=>{
 const {PrismaClient}=await import('@prisma/client'),{buildServer}=await import('./index'),{io:connectSocket}=await import('socket.io-client');
 const database=new PrismaClient({datasources:{db:{url:process.env.TEST_DATABASE_URL}}}),origin='http://localhost:3000';
 const {app}=await buildServer({...process.env,DATABASE_URL:process.env.TEST_DATABASE_URL,JWT_SECRET:randomBytes(48).toString('base64url'),CLIENT_ORIGIN:origin,NODE_ENV:'test'},database);
 const accounts:{id:string;cookie:string;username:string}[]=[],sockets:Socket[]=[];
 try{
  await app.listen({host:'127.0.0.1',port:0});const address=app.server.address();assert.ok(address&&typeof address!=='string');const endpoint=`http://127.0.0.1:${address.port}`;
  for(let i=0;i<6;i++){
   const username='grp_'+randomBytes(6).toString('hex'),user=await database.user.create({data:{username,authHashDigest:'isolated-unused-proof',authSalt:'isolated',wrapSalt:'isolated',wrapIv:'isolated',publicKeyJwk:JSON.stringify({kty:'EC',crv:'P-256',x:'snapshot_x_'+i,y:'snapshot_y_'+i}),encryptedPrivateKey:'isolated'}}),session=await database.session.create({data:{userId:user.id,expiresAt:new Date(Date.now()+300_000)}});
   accounts.push({id:user.id,username,cookie:`${SESSION_COOKIE_NAME}=${app.jwt.sign({sub:user.id,sid:session.id},{expiresIn:300})}`});
  }
  const [alice,bob,cara,dana,eve,mallory]=accounts;
  for(const account of [bob,cara,dana,eve])await database.contact.create({data:{...pair(alice.id,account.id),requestedById:alice.id,status:'accepted'}});
  function headers(account=alice){return{origin,cookie:account.cookie,'x-veilnivo-account':account.id}}
  async function request(method:'GET'|'POST',url:string,account=alice,payload?:Record<string,unknown>){return app.inject({method,url,headers:headers(account),...(payload===undefined?{}:{payload})})}
  async function connect(account=alice){const socket=connectSocket(endpoint,{autoConnect:false,transports:['websocket'],extraHeaders:{Origin:origin,Cookie:account.cookie},auth:{expected_user_id:account.id},reconnection:false});sockets.push(socket);const ready=once<void>(socket,'connect');socket.connect();await ready;return socket}
  const aliceSocket=await connect(alice),bobSocket=await connect(bob),caraSocket=await connect(cara);
  const keys=(ids:string[])=>ids.map(recipient_id=>({recipient_id,...encrypted()}));
  const groupId=randomUUID(),initialKeys=keys([alice.id,bob.id]);
  const created=await request('POST','/api/groups',alice,{id:groupId,name:'A private group',member_ids:[bob.id],envelopes:initialKeys});assert.equal(created.statusCode,201,created.body);assert.equal(created.json().group.memberCount,2);
  let version=1;
  const post=(account=alice,extras:Record<string,unknown>={})=>request('POST',`/api/groups/${groupId}/messages`,account,{client_message_id:randomUUID(),key_version:version,...encrypted(),...extras});
  const before=await post();assert.equal(before.statusCode,201,before.body);const firstMessage=before.json().message;

  await t.test('outsiders cannot discover the group or fetch another member key',async()=>{
   for(const suffix of ['/members','/keys','/messages']){const denied=await request('GET',`/api/groups/${groupId}${suffix}`,mallory);assert.equal(denied.statusCode,404,denied.body)}
   const missing=await request('GET','/api/groups',mallory);assert.equal(missing.statusCode,200);assert.deepEqual(missing.json().groups,[]);
   const own=await request('GET',`/api/groups/${groupId}/keys?user_id=${alice.id}`,bob);assert.equal(own.statusCode,200,own.body);assert.equal(own.json().keys.length,1);assert.equal(own.json().keys[0].ciphertext,initialKeys.find(key=>key.recipient_id===bob.id)!.ciphertext);assert.equal(own.json().keys[0].wrapped_by.id,alice.id);
   const denied=await post(mallory);assert.equal(denied.statusCode,404,denied.body);
   const strangers=await request('POST','/api/groups',alice,{id:randomUUID(),name:'No stranger additions',member_ids:[mallory.id],envelopes:keys([alice.id,mallory.id])});assert.equal(strangers.statusCode,403,strangers.body);
   const badHeader=await app.inject({method:'GET',url:'/api/groups',headers:{...headers(), 'x-veilnivo-account':bob.id}});assert.equal(badHeader.statusCode,409);
  });
  await t.test('key recipients must exactly match the roster, and only the owner adds members',async()=>{
   const missing=await request('POST',`/api/groups/${groupId}/members`,alice,{expected_version:version,member_ids:[cara.id],envelopes:keys([alice.id,cara.id])});assert.equal(missing.statusCode,409,missing.body);
   const foreign=await request('POST',`/api/groups/${groupId}/members`,bob,{expected_version:version,member_ids:[cara.id],envelopes:keys([alice.id,bob.id,cara.id])});assert.equal(foreign.statusCode,403,foreign.body);
   assert.equal((await database.group.findUniqueOrThrow({where:{id:groupId}})).keyVersion,1);assert.equal(await database.groupMember.count({where:{groupId}}),2);
   const duplicate=await request('POST','/api/groups',alice,{id:randomUUID(),name:'Duplicate recipients',member_ids:[bob.id,bob.id],envelopes:keys([alice.id,bob.id])});assert.equal(duplicate.statusCode,400,duplicate.body);
  });
  await t.test('adding a person rotates the key and excludes earlier message history',async()=>{
   const notification=once<void>(caraSocket,'groups:updated');
   const added=await request('POST',`/api/groups/${groupId}/members`,alice,{expected_version:version,member_ids:[cara.id],envelopes:keys([alice.id,bob.id,cara.id])});assert.equal(added.statusCode,200,added.body);await notification;version=2;
   const stale=await post(alice,{key_version:1});assert.equal(stale.statusCode,409,stale.body);
   const history=await request('GET',`/api/groups/${groupId}/messages`,cara);assert.equal(history.statusCode,200);assert.deepEqual(history.json().messages,[]);
   const memberKeys=await request('GET',`/api/groups/${groupId}/keys`,cara);assert.deepEqual(memberKeys.json().keys.map((key:any)=>key.key_version),[2]);
   const received=once<any>(bobSocket,'group:message'),receivedCara=once<any>(caraSocket,'group:message');const sent=await post(cara);assert.equal(sent.statusCode,201,sent.body);const message=sent.json().message;assert.equal(message.senderUsername,cara.username);assert.equal((await received).id,message.id);assert.equal((await receivedCara).id,message.id);
   const own=await request('GET',`/api/groups/${groupId}/messages`,alice);assert.equal(own.json().messages.length,2);assert.equal(own.json().messages[0].id,firstMessage.id);
   const recent=await request('GET',`/api/groups/${groupId}/messages`,cara);assert.deepEqual(recent.json().messages.map((row:any)=>row.id),[message.id]);
   const groups=(await request('GET','/api/groups',cara)).json().groups;assert.ok(groups[0].lastMessageAt);assert.equal(groups[0].memberCount,3);
  });
  await t.test('exact encrypted delivery retries are idempotent and changed retries fail',async()=>{
   const body={client_message_id:randomUUID(),key_version:version,...encrypted()},first=await request('POST',`/api/groups/${groupId}/messages`,alice,body),replay=await request('POST',`/api/groups/${groupId}/messages`,alice,body);assert.equal(first.statusCode,201);assert.equal(replay.statusCode,200);assert.equal(replay.json().message.id,first.json().message.id);assert.equal(replay.json().replayed,true);
   const changed=await request('POST',`/api/groups/${groupId}/messages`,alice,{...body,...encrypted()});assert.equal(changed.statusCode,409,changed.body);
   const raceBody={client_message_id:randomUUID(),key_version:version,...encrypted()},raced=await Promise.all([1,2].map(()=>request('POST',`/api/groups/${groupId}/messages`,alice,raceBody)));assert.deepEqual(raced.map(r=>r.statusCode).sort(),[200,201]);assert.equal(raced[0].json().message.id,raced[1].json().message.id);
  });
  await t.test('group and direct messages share an author-bound logical and server-ID namespace',async()=>{
   for(const client_message_id of [firstMessage.clientMessageId,firstMessage.id]){
    const foreign=await post(bob,{client_message_id});assert.equal(foreign.statusCode,409,foreign.body);
    const direct=await aliceSocket.timeout(5000).emitWithAck('message:send',{recipient_id:bob.id,client_message_id,...encrypted()});assert.ok(direct.error,JSON.stringify(direct));
   }
   const directId=randomUUID(),direct=await aliceSocket.timeout(5000).emitWithAck('message:send',{recipient_id:bob.id,client_message_id:directId,...encrypted()});assert.ok(direct.message?.id,JSON.stringify(direct));
   for(const client_message_id of [directId,direct.message.id]){const collision=await post(bob,{client_message_id});assert.equal(collision.statusCode,409,collision.body)}
   const sameId=randomUUID(),groupBody={client_message_id:sameId,key_version:version,...encrypted()},directBody={recipient_id:bob.id,client_message_id:sameId,...encrypted()};
   const [groupRace,directRace]=await Promise.all([request('POST',`/api/groups/${groupId}/messages`,alice,groupBody),aliceSocket.timeout(5000).emitWithAck('message:send',directBody)]);
   assert.equal(Number(groupRace.statusCode===201)+Number(!!directRace.message),1,'one protocol wins a shared nonce, never both');
  });
  await t.test('concurrent roster changes serialize without partial key insertion',async()=>{
   const additions=await Promise.all([dana,eve].map(person=>request('POST',`/api/groups/${groupId}/members`,alice,{expected_version:version,member_ids:[person.id],envelopes:keys([alice.id,bob.id,cara.id,person.id])})));assert.deepEqual(additions.map(response=>response.statusCode).sort(),[200,409]);version=3;
   const roster=(await request('GET',`/api/groups/${groupId}/members?limit=2`)).json();assert.equal(roster.members.length,2);assert.ok(roster.next_cursor);assert.equal(roster.key_version,version);const next=(await request('GET',`/api/groups/${groupId}/members?limit=2&cursor=${roster.next_cursor}`)).json();assert.equal(next.members.length,2);assert.equal(next.next_cursor,null);assert.equal(new Set([...roster.members,...next.members].map((member:any)=>member.id)).size,4);
   const history=(await request('GET',`/api/groups/${groupId}/messages?limit=2`)).json();assert.equal(history.messages.length,2);assert.ok(history.next_cursor);const older=(await request('GET',`/api/groups/${groupId}/messages?limit=2&cursor=${history.next_cursor}`)).json();assert.ok(older.messages.length>0);assert.ok(older.messages.every((row:any)=>!history.messages.some((recent:any)=>recent.id===row.id)));
  });
  await t.test('member erasure blocks future sends until a remaining member repairs the key',async()=>{
   const erased=await request('POST','/api/account/nuke',bob,{expected_user_id:bob.id});assert.equal(erased.statusCode,200,erased.body);assert.equal(await database.groupMember.count({where:{groupId,userId:bob.id}}),0);
   const current=(await request('GET','/api/groups',alice)).json().groups.find((group:any)=>group.id===groupId);assert.equal(current.needsRekey,true);assert.equal((await post()).statusCode,409);
   const roster=(await request('GET',`/api/groups/${groupId}/members`,cara)).json().members.map((member:any)=>member.id);
   const repaired=await request('POST',`/api/groups/${groupId}/members`,cara,{expected_version:version,member_ids:[],envelopes:keys(roster)});assert.equal(repaired.statusCode,200,repaired.body);version++;assert.equal(repaired.json().group.needsRekey,false);
   const recipientKeys=await request('GET',`/api/groups/${groupId}/keys`,alice);assert.equal(recipientKeys.json().keys.find((key:any)=>key.key_version===version).wrapped_by.id,cara.id);
   assert.equal((await post()).statusCode,201);
   const savedKey=recipientKeys.json().keys.find((key:any)=>key.key_version===version);
   const erasedWrapper=await request('POST','/api/account/nuke',cara,{expected_user_id:cara.id});assert.equal(erasedWrapper.statusCode,200,erasedWrapper.body);assert.equal((await request('GET',`/api/groups/${groupId}/keys`,alice)).json().keys.find((key:any)=>key.key_version===version).wrapped_by.public_key.x,savedKey.wrapped_by.public_key.x,'remaining participants keep old key envelopes after the wrapper account is erased');
   assert.equal(await database.groupKeyEnvelope.count({where:{groupId,userId:cara.id}}),0);assert.equal((await post()).statusCode,409);
  });
  await t.test('rosters above a page boundary have no artificial participant-count cap',async()=>{
   const others=[] as string[];
   for(let index=0;index<104;index++){const user=await database.user.create({data:{username:'grp_bulk_'+randomBytes(6).toString('hex'),authHashDigest:'isolated-unused-proof',authSalt:'isolated',wrapSalt:'isolated',wrapIv:'isolated',publicKeyJwk:'{}',encryptedPrivateKey:'isolated'}});others.push(user.id);accounts.push({id:user.id,cookie:'',username:user.username})}
   await database.contact.createMany({data:others.map(userId=>({...pair(alice.id,userId),requestedById:alice.id,status:'accepted'}))});
   const large=randomUUID(),response=await request('POST','/api/groups',alice,{id:large,name:'More than one roster page',member_ids:others,envelopes:keys([alice.id,...others])});assert.equal(response.statusCode,201,response.body);assert.equal(response.json().group.memberCount,105);
   const first=(await request('GET',`/api/groups/${large}/members`)).json();assert.equal(first.members.length,100);assert.ok(first.next_cursor);const second=(await request('GET',`/api/groups/${large}/members?cursor=${first.next_cursor}`)).json();assert.equal(second.members.length,5);assert.equal(second.next_cursor,null);
  });
  await t.test('owner erasure cascades groups, member keys and encrypted group history',async()=>{
   const erased=await request('POST','/api/account/nuke',alice,{expected_user_id:alice.id});assert.equal(erased.statusCode,200,erased.body);assert.equal(await database.group.count({where:{id:groupId}}),0);assert.equal(await database.groupMember.count({where:{groupId}}),0);assert.equal(await database.groupKeyEnvelope.count({where:{groupId}}),0);assert.equal(await database.groupMessage.count({where:{groupId}}),0);
  });
 }finally{for(const socket of sockets)socket.disconnect();await app.close();await database.user.deleteMany({where:{id:{in:accounts.map(account=>account.id)}}});await database.$disconnect()}
});
