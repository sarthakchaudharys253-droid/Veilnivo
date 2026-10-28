import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import type {Socket} from 'socket.io-client';
import {SESSION_COOKIE_NAME} from '../src/lib/compat';
import {deliveryExpiry,mutationRevision,pair,messageDeletionWindow} from './v2';

test('mutation revisions and explicit expiry reject malformed or expired operations',()=>{
 for(const value of [0,1,1000])assert.equal(mutationRevision(value),value);
 for(const value of [undefined,null,'0',-1,0.5,Infinity,2147483647])assert.throws(()=>mutationRevision(value));
 const now=Date.now(),future=new Date(now+60_000).toISOString();
 assert.equal(deliveryExpiry(future,now)?.toISOString(),future);assert.equal(deliveryExpiry(undefined,now),null);
 for(const value of [0,'not a date',new Date(now).toISOString(),new Date(now-1).toISOString()])assert.throws(()=>deliveryExpiry(value,now));
});

const encrypted=()=>({ciphertext:randomBytes(64).toString('base64'),iv:randomBytes(12).toString('base64')});
function once<T>(socket:Socket,name:string):Promise<T>{return new Promise((resolve,reject)=>{const handler=(data:T)=>{clearTimeout(timer);resolve(data)},timer=setTimeout(()=>{socket.off(name,handler);reject(new Error('Missing '+name))},5000);socket.once(name,handler)})}

// This creates and erases only generated accounts in an isolated migrated DB.
test('SQL message actions enforce ownership, CAS, durable deletion and expiry',{skip:!process.env.TEST_DATABASE_URL,timeout:60000},async t=>{
 const {PrismaClient,Prisma}=await import('@prisma/client'),{buildServer}=await import('./index'),{io:connectSocket}=await import('socket.io-client');
 const database=new PrismaClient({datasources:{db:{url:process.env.TEST_DATABASE_URL}}}),origin='http://localhost:3000';
 const {app}=await buildServer({...process.env,DATABASE_URL:process.env.TEST_DATABASE_URL,JWT_SECRET:randomBytes(48).toString('base64url'),CLIENT_ORIGIN:origin,NODE_ENV:'test'},database);
 const accounts:{id:string;cookie:string}[]=[],sockets:Socket[]=[];
 try{
  await app.listen({host:'127.0.0.1',port:0});const address=app.server.address();assert.ok(address&&typeof address!=='string');const endpoint=`http://127.0.0.1:${address.port}`;
  for(let index=0;index<3;index++){
   const user=await database.user.create({data:{username:'act_'+randomBytes(6).toString('hex'),authHashDigest:'isolated-unused-proof',authSalt:'isolated',wrapSalt:'isolated',wrapIv:'isolated',publicKeyJwk:'{}',encryptedPrivateKey:'isolated'}});
   const session=await database.session.create({data:{userId:user.id,expiresAt:new Date(Date.now()+300_000)}});
   accounts.push({id:user.id,cookie:`${SESSION_COOKIE_NAME}=${app.jwt.sign({sub:user.id,sid:session.id},{expiresIn:300})}`});
  }
  const [alice,bob,mallory]=accounts;
  await database.contact.create({data:{...pair(alice.id,bob.id),requestedById:alice.id,status:'accepted',ttlSeconds:3600}});
  function headers(account=alice){return{origin,cookie:account.cookie,'x-veilnivo-account':account.id}}
  async function connect(account:{id:string;cookie:string}){const socket=connectSocket(endpoint,{autoConnect:false,transports:['websocket'],extraHeaders:{Origin:origin,Cookie:account.cookie},auth:{expected_user_id:account.id},reconnection:false});sockets.push(socket);const connected=once<void>(socket,'connect');socket.connect();await connected;return socket}
  const sender=await connect(alice),recipient=await connect(bob);
  async function send(extras:Record<string,unknown>={}){
   const body={recipient_id:bob.id,client_message_id:randomUUID(),...encrypted(),...extras};
   const response=await sender.timeout(5000).emitWithAck('message:send',body);assert.ok(response.message?.id,JSON.stringify(response));return{body,message:response.message};
  }

  await t.test('the PostgreSQL deletion predicate excludes the exact first-read cutoff',async()=>{
   const at=new Date('2030-01-01T12:00:00.000Z');
   for(const [readAt,expected]of [[null,true],[new Date(at.getTime()-1_800_000+1),true],[new Date(at.getTime()-1_800_000),false],[new Date(at.getTime()-1_800_000-1),false]] as const){
    const [result]=await database.$queryRaw<{allowed:boolean}[]>`SELECT ${messageDeletionWindow(Prisma.sql`${at.toISOString()}::timestamp`)} AS "allowed" FROM (SELECT ${readAt?.toISOString()??null}::timestamp AS "readAt") AS candidate`;
    assert.equal(result.allowed,expected,readAt?.toISOString()??'Unread');
   }
  });

  await t.test('the database deletion clock stays UTC in non-UTC database sessions',async()=>{
   for(const zone of ['Pacific/Auckland','America/New_York'])await database.$transaction(async tx=>{
    await tx.$queryRaw`SELECT set_config('TimeZone',${zone},true)`;
    for(const [age,expected]of [[29*60_000,true],[31*60_000,false]] as const){
     // Prisma persists UTC values in timestamp columns. Raw Date parameters
     // bind as timestamptz, so use ISO text to model the stored naive UTC value.
     const readAt=new Date(Date.now()-age).toISOString();
     const [result]=await tx.$queryRaw<{allowed:boolean}[]>`SELECT ${messageDeletionWindow()} AS "allowed" FROM (SELECT ${readAt}::timestamp AS "readAt") AS candidate`;
     assert.equal(result.allowed,expected,zone);
    }
   });
  });

  await t.test('deletion is allowed while unread and inside the first-read window, then forbidden',async()=>{
   const unread=await send();assert.equal(unread.message.readAt,null);
   const unreadDeletion=await app.inject({method:'DELETE',url:`/api/messages/${unread.message.id}`,headers:headers(),payload:{expected_revision:0}});assert.equal(unreadDeletion.statusCode,200,unreadDeletion.body);
   const inside=await send();
   await database.message.update({where:{id:inside.message.id},data:{readAt:new Date(Date.now()-1_800_000+10_000)}});
   const insideDeletion=await app.inject({method:'DELETE',url:`/api/messages/${inside.message.id}`,headers:headers(),payload:{expected_revision:0}});assert.equal(insideDeletion.statusCode,200,insideDeletion.body);
   for(const extraAge of [0,60_000]){
    const closed=await send();
    await database.$executeRaw`UPDATE "Message" SET "readAt"=(clock_timestamp() AT TIME ZONE 'UTC')-INTERVAL '30 minutes'-${extraAge}*INTERVAL '1 millisecond' WHERE "id"=${closed.message.id}`;
    const denied=await app.inject({method:'DELETE',url:`/api/messages/${closed.message.id}`,headers:headers(),payload:{expected_revision:0,read_at:new Date().toISOString(),at:new Date().toISOString()}});
    assert.equal(denied.statusCode,403,denied.body);assert.match(denied.json().error,/30 minutes.*first read/i);
    const saved=await database.message.findUniqueOrThrow({where:{id:closed.message.id}});assert.equal(saved.deletedAt,null);assert.equal(saved.revision,0);assert.equal(saved.ciphertext,closed.body.ciphertext);
   }
  });

  await t.test('read retries retain the first server timestamp and edits never restart the deletion window',async()=>{
   const original=await send(),started=Date.now();
   const senderReceipt=once<any>(sender,'message:receipt'),recipientReceipt=once<any>(recipient,'message:receipt');
   recipient.emit('message:read',{message_id:original.message.id,at:'2000-01-01T00:00:00.000Z'});
   const [first,mirrored]=await Promise.all([senderReceipt,recipientReceipt]);
   const firstRow=await database.message.findUniqueOrThrow({where:{id:original.message.id}});assert.ok(firstRow.readAt);assert.ok(firstRow.readAt.getTime()>=started);assert.equal(first.at,firstRow.readAt.toISOString());assert.equal(mirrored.at,first.at);
   const retry=once<any>(sender,'message:receipt');recipient.emit('message:read',{message_id:original.message.id});assert.equal((await retry).at,first.at);
   assert.equal((await database.message.findUniqueOrThrow({where:{id:original.message.id}})).readAt?.toISOString(),first.at);
   const closedAt=new Date(Date.now()-1_860_000);await database.message.update({where:{id:original.message.id},data:{readAt:closedAt}});
   const afterDeadline=once<any>(sender,'message:receipt');recipient.emit('message:read',{message_id:original.message.id});assert.equal((await afterDeadline).at,closedAt.toISOString());
   const edited=await app.inject({method:'PATCH',url:`/api/messages/${original.message.id}`,headers:headers(),payload:{...encrypted(),expected_revision:0}});assert.equal(edited.statusCode,200,edited.body);assert.equal(edited.json().message.readAt,closedAt.toISOString());
   assert.equal((await database.message.findUniqueOrThrow({where:{id:original.message.id}})).readAt?.toISOString(),closedAt.toISOString());
   const denied=await app.inject({method:'DELETE',url:`/api/messages/${original.message.id}`,headers:headers(),payload:{expected_revision:1}});assert.equal(denied.statusCode,403,denied.body);
  });

  await t.test('concurrent first-read retries return one immutable timestamp',async()=>{
   const original=await send(),values:any[]=[];
   let resolve!:(value:void)=>void;const received=new Promise<void>(done=>resolve=done);
   const listener=(receipt:any)=>{if(receipt.message_id===original.message.id){values.push(receipt);if(values.length===2)resolve()}};
   sender.on('message:receipt',listener);
   try{
    recipient.emit('message:read',{message_id:original.message.id});recipient.emit('message:read',{message_id:original.message.id});
    await Promise.race([received,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('Missing concurrent receipts')),5000);received.finally(()=>clearTimeout(timer))})]);
    const saved=await database.message.findUniqueOrThrow({where:{id:original.message.id}});assert.ok(saved.readAt);assert.equal(values[0].at,saved.readAt.toISOString());assert.equal(values[1].at,values[0].at);
   }finally{sender.off('message:receipt',listener)}
  });

  await t.test('a deletion waiting for a read-row lock rechecks the committed first-read cutoff',async()=>{
   const original=await send();let release!:()=>void,entered!:()=>void;
   const locked=new Promise<void>(done=>entered=done),resume=new Promise<void>(done=>release=done);
   const holder=database.$transaction(async tx=>{
    await tx.$queryRaw`SELECT "id" FROM "Message" WHERE "id"=${original.message.id} FOR UPDATE`;
    entered();await resume;
    await tx.$executeRaw`UPDATE "Message" SET "readAt"=(clock_timestamp() AT TIME ZONE 'UTC')-INTERVAL '30 minutes' WHERE "id"=${original.message.id}`;
   });
   await locked;const pending=app.inject({method:'DELETE',url:`/api/messages/${original.message.id}`,headers:headers(),payload:{expected_revision:0}});
   try{
    let waiting=false;
    for(let attempt=0;attempt<100;attempt++){
     const [activity]=await database.$queryRaw<{waiting:boolean}[]>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE 'SELECT * FROM "Message"%FOR UPDATE%') AS waiting`;
     if(activity.waiting){waiting=true;break}await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.ok(waiting,'Deletion must wait for the locked message row');
   }finally{release();await holder}
   const denied=await pending;assert.equal(denied.statusCode,403,denied.body);assert.equal((await database.message.findUniqueOrThrow({where:{id:original.message.id}})).deletedAt,null);
  });

  await t.test('only the author can replace an encrypted snapshot and stale revisions lose',async()=>{
   const original=await send(),replacement=encrypted();
   for(const account of [bob,mallory]){
    const response=await app.inject({method:'PATCH',url:`/api/messages/${original.message.id}`,headers:headers(account),payload:{...replacement,expected_revision:0}});assert.equal(response.statusCode,404,response.body);
   }
   const updatedEvent=once<any>(recipient,'message:updated');
   const edited=await app.inject({method:'PATCH',url:`/api/messages/${original.message.id}`,headers:headers(),payload:{...replacement,expected_revision:0,expires_at:new Date(Date.now()+86400000).toISOString()}});
   assert.equal(edited.statusCode,200,edited.body);const current=edited.json().message;assert.equal(current.revision,1);assert.equal(current.createdAt,original.message.createdAt);assert.equal(current.expiresAt,original.message.expiresAt);assert.equal(current.clientMessageId,original.body.client_message_id);assert.equal((await updatedEvent).ciphertext,replacement.ciphertext);
   const row=await database.message.findUniqueOrThrow({where:{id:current.id}});assert.equal(row.ciphertext,replacement.ciphertext);assert.notEqual(row.ciphertext,original.body.ciphertext);
   const stale=await app.inject({method:'PATCH',url:`/api/messages/${current.id}`,headers:headers(),payload:{...encrypted(),expected_revision:0}});assert.equal(stale.statusCode,409,stale.body);
   const race=await Promise.all([1,2].map(()=>app.inject({method:'PATCH',url:`/api/messages/${current.id}`,headers:headers(),payload:{...encrypted(),expected_revision:1}})));
   assert.deepEqual(race.map(response=>response.statusCode).sort(),[200,409]);
   const replay=await sender.timeout(5000).emitWithAck('message:send',original.body);assert.ok(replay.error,'The original send cannot overwrite a newer encrypted snapshot');
  });

  await t.test('deleting erases cipher and attachment but retains a content-free offline tombstone',async()=>{
   const upload=await app.inject({method:'POST',url:'/api/attachments',headers:headers(),payload:{recipient_id:bob.id,ciphertext:randomBytes(80).toString('base64'),iv:randomBytes(12).toString('base64'),size:64}});assert.equal(upload.statusCode,201,upload.body);
   const attachmentId=upload.json().attachment.id,original=await send({attachment_id:attachmentId});
   const forbidden=await app.inject({method:'DELETE',url:`/api/messages/${original.message.id}`,headers:headers(bob),payload:{expected_revision:0}});assert.equal(forbidden.statusCode,404);
   const deletedEvent=once<any>(recipient,'message:deleted');
   const deleted=await app.inject({method:'DELETE',url:`/api/messages/${original.message.id}`,headers:headers(),payload:{expected_revision:0}});assert.equal(deleted.statusCode,200,deleted.body);
   const tombstone=deleted.json().message;assert.equal(tombstone.ciphertext,'');assert.equal(tombstone.iv,'');assert.equal(tombstone.revision,1);assert.ok(tombstone.deletedAt);assert.equal((await deletedEvent).id,original.message.id);
   assert.equal(await database.attachment.count({where:{id:attachmentId}}),0);
   const row=await database.message.findUniqueOrThrow({where:{id:original.message.id}});assert.equal(row.ciphertext,'');assert.equal(row.iv,'');assert.ok(row.deletedAt);assert.equal(row.expiresAt?.toISOString(),original.message.expiresAt);
   const history=await app.inject({method:'GET',url:`/api/messages/${alice.id}`,headers:headers(bob)});assert.equal(history.statusCode,200);assert.ok(history.json().messages.some((message:any)=>message.id===row.id&&message.deletedAt&&message.ciphertext===''));
   assert.equal(await database.sendNonce.count({where:{senderId:alice.id,clientMessageId:original.body.client_message_id}}),1);
   const replay=await sender.timeout(5000).emitWithAck('message:send',original.body);assert.ok(replay.error);
   const repeated=await app.inject({method:'DELETE',url:`/api/messages/${row.id}`,headers:headers(),payload:{expected_revision:0}});assert.equal(repeated.statusCode,200,repeated.body);assert.equal(repeated.json().message.revision,1);
   const editDeleted=await app.inject({method:'PATCH',url:`/api/messages/${row.id}`,headers:headers(),payload:{...encrypted(),expected_revision:1}});assert.equal(editDeleted.statusCode,410,editDeleted.body);
   const missingFile=await app.inject({method:'GET',url:`/api/attachments/${attachmentId}`,headers:headers(bob)});assert.equal(missingFile.statusCode,404);
  });

  await t.test('forward expiry can only shorten the contact policy and never revive expired content',async()=>{
   const short=new Date(Date.now()+60_000).toISOString(),forwarded=await send({expires_at:short});assert.equal(forwarded.message.expiresAt,short);
   const long=await send({expires_at:new Date(Date.now()+86400000).toISOString()});assert.ok(new Date(long.message.expiresAt).getTime()<Date.now()+3601_000);
   const expired=await sender.timeout(5000).emitWithAck('message:send',{recipient_id:bob.id,client_message_id:randomUUID(),...encrypted(),expires_at:new Date(Date.now()-1000).toISOString()});assert.ok(expired.error);
   await database.message.update({where:{id:forwarded.message.id},data:{expiresAt:new Date(Date.now()-1)}});
   const edit=await app.inject({method:'PATCH',url:`/api/messages/${forwarded.message.id}`,headers:headers(),payload:{...encrypted(),expected_revision:0}});assert.equal(edit.statusCode,410);
   const deletion=await app.inject({method:'DELETE',url:`/api/messages/${forwarded.message.id}`,headers:headers(),payload:{expected_revision:0}});assert.equal(deletion.statusCode,410);
  });

  await t.test('blocked conversations reject edits but an author can still remove their own stored content',async()=>{
   const original=await send();await database.block.create({data:{blockerId:bob.id,blockedId:alice.id}});
   const edit=await app.inject({method:'PATCH',url:`/api/messages/${original.message.id}`,headers:headers(),payload:{...encrypted(),expected_revision:0}});assert.equal(edit.statusCode,400,edit.body);
   const deletion=await app.inject({method:'DELETE',url:`/api/messages/${original.message.id}`,headers:headers(),payload:{expected_revision:0}});assert.equal(deletion.statusCode,200,deletion.body);
   await database.block.deleteMany({where:{blockerId:bob.id,blockedId:alice.id}});
  });

  await t.test('expected-account and origin guards protect message mutations',async()=>{
   const original=await send();
   const switched=await app.inject({method:'DELETE',url:`/api/messages/${original.message.id}`,headers:{...headers(),'x-veilnivo-account':bob.id},payload:{expected_revision:0}});assert.equal(switched.statusCode,409);
   const wrongOrigin=await app.inject({method:'PATCH',url:`/api/messages/${original.message.id}`,headers:{...headers(),origin:'https://unrelated.invalid'},payload:{...encrypted(),expected_revision:0}});assert.equal(wrongOrigin.statusCode,403);
   const malformed=await app.inject({method:'PATCH',url:`/api/messages/${original.message.id}`,headers:headers(),payload:{...encrypted(),expected_revision:undefined}});assert.equal(malformed.statusCode,400);
   assert.equal((await database.message.findUniqueOrThrow({where:{id:original.message.id}})).revision,0);
  });

  await t.test('a different author cannot alias another delivery UUID, even in another conversation',async()=>{
   const original=await send();
   const reverse=await recipient.timeout(5000).emitWithAck('message:send',{recipient_id:alice.id,client_message_id:original.body.client_message_id,...encrypted()});assert.ok(reverse.error);
   await database.contact.create({data:{...pair(mallory.id,alice.id),requestedById:mallory.id,status:'accepted'}});
   const attacker=await connect(mallory);
   const crossPeer=await attacker.timeout(5000).emitWithAck('message:send',{recipient_id:alice.id,client_message_id:original.body.client_message_id,...encrypted()});assert.ok(crossPeer.error);
   assert.equal(await database.sendNonce.count({where:{clientMessageId:original.body.client_message_id}}),1);
   assert.equal(await database.message.count({where:{clientMessageId:original.body.client_message_id}}),1);
  });

  await t.test('new delivery nonces cannot alias an existing server record UUID',async()=>{
   const original=await send();
   const replay=await sender.timeout(5000).emitWithAck('message:send',original.body);assert.equal(replay.message?.id,original.message.id);assert.equal(replay.replayed,true);
   const ownAlias=await sender.timeout(5000).emitWithAck('message:send',{recipient_id:bob.id,client_message_id:original.message.id,...encrypted()});assert.ok(ownAlias.error);
   const oppositeAlias=await recipient.timeout(5000).emitWithAck('message:send',{recipient_id:alice.id,client_message_id:original.message.id,...encrypted()});assert.ok(oppositeAlias.error);
   assert.equal(await database.message.count({where:{clientMessageId:original.message.id}}),0);
   assert.equal(await database.sendNonce.count({where:{clientMessageId:original.message.id}}),0);
   assert.equal((await database.message.findUniqueOrThrow({where:{id:original.message.id}})).ciphertext,original.body.ciphertext);
   await database.message.update({where:{id:original.message.id},data:{clientMessageId:original.message.id}});
   await database.sendNonce.update({where:{senderId_clientMessageId:{senderId:alice.id,clientMessageId:original.body.client_message_id}},data:{clientMessageId:original.message.id}});
   const legacyReplay=await sender.timeout(5000).emitWithAck('message:send',{...original.body,client_message_id:original.message.id});assert.equal(legacyReplay.message?.id,original.message.id);assert.equal(legacyReplay.replayed,true,'An already-valid nonce replay must return before the new-delivery alias check');
  });

  await t.test('concurrent opposite-direction delivery UUID reuse has exactly one winner',async()=>{
   const sharedId=randomUUID();
   const attempts=await Promise.all([
    sender.timeout(5000).emitWithAck('message:send',{recipient_id:bob.id,client_message_id:sharedId,...encrypted()}),
    recipient.timeout(5000).emitWithAck('message:send',{recipient_id:alice.id,client_message_id:sharedId,...encrypted()}),
   ]);
   assert.equal(attempts.filter(response=>response.message?.id).length,1);
   assert.equal(attempts.filter(response=>response.error).length,1);
   assert.equal(await database.sendNonce.count({where:{clientMessageId:sharedId}}),1);
   assert.equal(await database.message.count({where:{clientMessageId:sharedId}}),1);
  });
 }finally{
  for(const socket of sockets)socket.disconnect();
  await database.user.deleteMany({where:{id:{in:accounts.map(account=>account.id)}}});
  await app.close();
 }
});
