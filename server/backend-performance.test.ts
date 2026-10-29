import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import type {Prisma,PrismaClient} from '@prisma/client';
import type {Server} from 'socket.io';
import {v2Services,pair} from './v2';
import {groupServices} from './groups';
import {SESSION_COOKIE_NAME} from '../src/lib/compat';

function harness(database:unknown){
 const routes=new Map<string,(request:any,reply?:any)=>Promise<any>>(),hooks:(()=>unknown)[]=[],events:{rooms:string[];event:string;data:unknown}[]=[];
 const app:any={addHook:(_name:string,hook:()=>unknown)=>hooks.push(hook)};
 for(const method of ['get','post','put','patch','delete'])app[method]=(path:string,...args:any[])=>routes.set(method+' '+path,args.at(-1));
 const io={to:(rooms:string|string[])=>({emit:(event:string,data:unknown)=>events.push({rooms:typeof rooms==='string'?[rooms]:rooms,event,data})})} as unknown as Server;
 const erasingUsers=new Set<string>();
 const services=v2Services({app:app as FastifyInstance,database:database as PrismaClient,io,authenticate:async()=>{},erasingUsers,activeSends:new Map(),online:()=>false});
 const groups=groupServices({app:app as FastifyInstance,database:database as PrismaClient,io,authenticate:async()=>{},erasingUsers,tracked:services.tracked,ensureAvailable:services.ensureAvailable});
 return{routes,events,services,groups,erasingUsers,close:()=>hooks.forEach(hook=>hook())};
}

test('block snapshots batch unique candidate peers and never query unrelated accounts',async()=>{
 const userId=randomUUID(),peers=Array.from({length:2505},()=>randomUUID()),queries:any[]=[];
 const expected=new Set<string>([peers[2],peers[1005],peers[2504]]);
 const database={block:{findMany:async(query:any)=>{queries.push(query);const [outgoing,incoming]=query.where.OR;assert.equal(outgoing.blockerId,userId);assert.equal(incoming.blockedId,userId);assert.deepEqual(outgoing.blockedId.in,incoming.blockerId.in);assert.ok(outgoing.blockedId.in.length<=1000);assert.deepEqual(query.select,{blockerId:true,blockedId:true});return outgoing.blockedId.in.filter((peer:string)=>expected.has(peer)).map((peer:string,index:number)=>index%2?{blockerId:peer,blockedId:userId}:{blockerId:userId,blockedId:peer})}}};
 const h=harness(database);try{
  assert.deepEqual(await h.services.blockedPeerIds(userId,[]),new Set());assert.equal(queries.length,0);
  const hidden=await h.services.blockedPeerIds(userId,[...peers,...peers.slice(0,20),userId]);assert.deepEqual(hidden,expected);assert.equal(queries.length,3,'2,505 peers use three bounded block queries');
 }finally{h.close()}
});

test('105 pending requests use one block snapshot while preserving both block directions and request order',async()=>{
 const userId=randomUUID(),owner={id:userId,username:'owner',publicKeyJwk:'{}'},peers=Array.from({length:105},(_,index)=>({id:randomUUID(),username:'peer_'+index,publicKeyJwk:'{}'}));
 const rows=peers.map((peer,index)=>({id:randomUUID(),userAId:index%2?peer.id:userId,userBId:index%2?userId:peer.id,userA:index%2?peer:owner,userB:index%2?owner:peer,requestedById:index%3?peer.id:userId,status:'pending'}));
 let contacts=0,blocks=0;
 const h=harness({contact:{findMany:async()=>{contacts++;return rows}},block:{findFirst:async()=>{throw new Error('A pending snapshot must not query each contact')},findMany:async()=>{blocks++;return[{blockerId:userId,blockedId:peers[4].id},{blockerId:peers[92].id,blockedId:userId}]}}});
 try{
  const result=await h.routes.get('get /api/requests')!({principal:{sub:userId}});assert.equal(contacts,1);assert.equal(blocks,1);
  assert.deepEqual(result.requests.map((request:any)=>request.peer.id),peers.filter((_,index)=>![4,92].includes(index)).map(peer=>peer.id));
  assert.equal(result.requests[0].direction,'outgoing');assert.equal(result.requests[1].direction,'incoming');assert.ok(result.requests.every((request:any)=>Object.keys(request.peer).sort().join(',')==='id,online,public_key,username'));
 }finally{h.close()}
});

test('expiration cleanup coalesces concurrent runs and recovers after a failed run',async()=>{
 let release!:()=>void,scans=0,attachmentDeletes=0,invitationDeletes=0,fail=false;
 let wait=new Promise<void>(resolve=>release=resolve);
 const h=harness({message:{findMany:async()=>{scans++;await wait;if(fail)throw new Error('isolated cleanup failure');return[]}},attachment:{deleteMany:async()=>{attachmentDeletes++;return{count:0}}},invitation:{deleteMany:async()=>{invitationDeletes++;return{count:0}}}});
 try{
  const first=h.services.cleanupExpired(),overlap=h.services.cleanupExpired();assert.equal(scans,1);release();await Promise.all([first,overlap]);assert.equal(attachmentDeletes,1);assert.equal(invitationDeletes,1);
  wait=Promise.resolve();fail=true;await assert.rejects(()=>h.services.cleanupExpired(),/isolated cleanup failure/);assert.equal(scans,2);
  fail=false;await h.services.cleanupExpired();assert.equal(scans,3);assert.equal(attachmentDeletes,2);assert.equal(invitationDeletes,2);
 }finally{h.close()}
});

test('group roster joins membership and metadata once and rejects outsiders before loading members',async()=>{
 const userId=randomUUID(),groupId=randomUUID(),otherId=randomUUID();let allowed=true,metadata=0,rosters=0;
 const h=harness({$queryRaw:async(strings:TemplateStringsArray,...values:unknown[])=>{metadata++;assert.deepEqual(values,[groupId,userId]);assert.match(strings.join('?'),/JOIN "Group"/);assert.match(strings.join('?'),/m\."groupId"=\? AND m\."userId"=\?/);return allowed?[{ownerId:userId,keyVersion:7}]:[]},groupMember:{findMany:async(query:any)=>{rosters++;assert.equal(query.where.groupId,groupId);assert.equal(query.take,3);return[{userId,joinedVersion:1,user:{id:userId,username:'owner',publicKeyJwk:'{}'}},{userId:otherId,joinedVersion:3,user:{id:otherId,username:'other',publicKeyJwk:'{}'}}]}}});
 try{
  const route=h.routes.get('get /api/groups/:id/members')!,request={principal:{sub:userId},params:{id:groupId},query:{limit:'2'}};
  const result=await route(request);assert.equal(metadata,1);assert.equal(rosters,1);assert.equal(result.key_version,7);assert.equal(result.members[0].role,'owner');assert.equal(result.members[1].role,'member');assert.equal(result.next_cursor,null);
  allowed=false;await assert.rejects(()=>route(request),error=>error instanceof Error&&'statusCode'in error&&error.statusCode===404);assert.equal(metadata,2);assert.equal(rosters,1,'no roster is loaded without membership');
 }finally{h.close()}
});

test('group notifications encode once for eligible member rooms and never broadcast an empty target globally',()=>{
 const h=harness({}),members=Array.from({length:105},()=>randomUUID());try{
  h.erasingUsers.add(members[13]);h.groups.updated([...members,members[0]]);assert.equal(h.events.length,1);assert.equal(h.events[0].rooms.length,104);assert.equal(h.events[0].event,'groups:updated');assert.ok(!h.events[0].rooms.includes('user:'+members[13]));assert.equal(new Set(h.events[0].rooms).size,104);
  h.groups.updated([]);h.groups.updated([members[13]]);assert.equal(h.events.length,1);
 }finally{h.close()}
});

test('SQL attachment reads filter unauthorized, expired and orphaned ciphertext before returning it',{skip:!process.env.TEST_DATABASE_URL,timeout:30000},async()=>{
 const {PrismaClient}=await import('@prisma/client'),{buildServer}=await import('./index'),client=new PrismaClient({datasources:{db:{url:process.env.TEST_DATABASE_URL}}}),origin='http://localhost:3000';
 const queries:Prisma.AttachmentFindUniqueArgs[]=[];
 // Prisma delegates are dynamic proxies, so Node's descriptor-based method mock
 // cannot replace them reliably. A query extension observes the actual call and
 // forwards it unchanged to PostgreSQL rather than stubbing database behavior.
 const database=client.$extends({query:{attachment:{findUnique:async({args,query})=>{queries.push(args);return query(args)}}}});
 const {app}=await buildServer({...process.env,NODE_ENV:'test',CLIENT_ORIGIN:origin,JWT_SECRET:randomBytes(48).toString('base64url')},database as unknown as PrismaClient),users:{id:string;cookie:string}[]=[];
 try{
  for(let index=0;index<3;index++){const user=await database.user.create({data:{username:'opt_file_'+randomBytes(5).toString('hex'),authHashDigest:'isolated-unused-proof',authSalt:'unused',wrapSalt:'unused',wrapIv:'unused',publicKeyJwk:'{}',encryptedPrivateKey:'unused'}}),session=await database.session.create({data:{userId:user.id,expiresAt:new Date(Date.now()+60000)}});users.push({id:user.id,cookie:`${SESSION_COOKIE_NAME}=${app.jwt.sign({sub:user.id,sid:session.id},{expiresIn:60})}`})}
  const [alice,bob,mallory]=users;await database.contact.create({data:{...pair(alice.id,bob.id),requestedById:alice.id,status:'accepted'}});
  const ciphertext=randomBytes(1040).toString('base64'),iv=randomBytes(12).toString('base64'),message=await database.message.create({data:{senderId:alice.id,recipientId:bob.id,ciphertext:randomBytes(64).toString('base64'),iv}}),file=await database.attachment.create({data:{ownerId:alice.id,recipientId:bob.id,messageId:message.id,ciphertext,iv,size:1024}});
  const read=(account=alice)=>app.inject({method:'GET',url:'/api/attachments/'+file.id,headers:{origin,cookie:account.cookie,'x-veilnivo-account':account.id}});
   const outsider=await read(mallory);assert.equal(outsider.statusCode,404);assert.ok(!outsider.body.includes(ciphertext));const filter=queries[0]?.where;assert.ok(filter);assert.deepEqual(filter.OR,[{ownerId:mallory.id},{recipientId:mallory.id}]);assert.ok(Array.isArray(filter.AND));assert.equal(filter.AND.length,2);
   for(const account of [alice,bob]){const result=await read(account);assert.equal(result.statusCode,200,result.body);assert.equal(result.json().ciphertext,ciphertext)}
   await database.attachment.update({where:{id:file.id},data:{expiresAt:new Date(Date.now()-1000)}});assert.equal((await read()).statusCode,404);
   await database.attachment.update({where:{id:file.id},data:{expiresAt:null,messageId:null,orphanExpiresAt:new Date(Date.now()-1000)}});assert.equal((await read()).statusCode,404);
   await database.attachment.update({where:{id:file.id},data:{orphanExpiresAt:new Date(Date.now()+60000)}});assert.equal((await read(bob)).statusCode,404,'an unsent upload is not available to the recipient');assert.equal((await read()).statusCode,200,'the owner can fetch a live unsent upload');
 }finally{await app.close();await database.user.deleteMany({where:{id:{in:users.map(user=>user.id)}}});await client.$disconnect()}
});
