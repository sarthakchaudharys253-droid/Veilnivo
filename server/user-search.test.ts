import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { SESSION_COOKIE_NAME } from '../src/lib/compat';
import { pair } from './v2';

// Creates only isolated fixtures and removes only those random IDs.
// TEST_DATABASE_URL must never point to the user's local or production database.
test('PostgreSQL exact user search enforces consent, canonical aliases, blocks and rate limits', {skip:!process.env.TEST_DATABASE_URL,timeout:30_000}, async(t)=>{
 const {PrismaClient}=await import('@prisma/client');
 const {buildServer}=await import('./index');
 const database=new PrismaClient({datasources:{db:{url:process.env.TEST_DATABASE_URL}}});
 const {app,io}=await buildServer({...process.env,DATABASE_URL:process.env.TEST_DATABASE_URL,JWT_SECRET:randomBytes(48).toString('base64url'),CLIENT_ORIGIN:'http://localhost:3000',NODE_ENV:'test'},database);
 const users:string[]=[];
 try{
  await app.ready();
  async function fixture(){
   const user=await database.user.create({data:{username:`lookup_${randomBytes(5).toString('hex')}`,authHashDigest:'test-only-unused-proof',authSalt:'unused',wrapSalt:'unused',wrapIv:'unused',publicKeyJwk:'{}',encryptedPrivateKey:'unused'}});
   users.push(user.id);
   const session=await database.session.create({data:{userId:user.id,expiresAt:new Date(Date.now()+60_000)}});
   const cookie=`${SESSION_COOKIE_NAME}=${app.jwt.sign({sub:user.id,sid:session.id},{expiresIn:60})}`;
   return {...user,cookie};
  }
  const alice=await fixture(),bob=await fixture();
  const alias=`alias_${randomBytes(5).toString('hex')}`;
  await database.alias.create({data:{userId:bob.id,username:alias}});
  const search=(handle:string,cookie=alice.cookie,remoteAddress='127.0.0.1')=>app.inject({method:'GET',url:`/api/users/search?username=${encodeURIComponent(handle)}`,headers:{cookie},remoteAddress});
  const minimal=(relationship:string)=>({users:[{id:bob.id,username:bob.username,relationship}]});
  await t.test('requires a session and the expected active account',async()=>{
   const anonymous=await app.inject({method:'GET',url:`/api/users/search?username=${bob.username}`});
   assert.equal(anonymous.statusCode,401);
   const wrongAccount=await app.inject({method:'GET',url:`/api/users/search?username=${bob.username}`,headers:{cookie:alice.cookie,'x-veilnivo-account':bob.id}});
   assert.equal(wrongAccount.statusCode,409);
   const result=await search(bob.username);
   assert.equal(result.statusCode,200,result.body);assert.deepEqual(result.json(),minimal('none'));
   assert.equal(result.headers['cache-control'],'no-store');
  });
  await t.test('matches exact usernames and aliases without listing prefixes or private fields',async()=>{
   assert.deepEqual((await search(alias)).json(),minimal('none'));
   assert.deepEqual((await search(bob.username.slice(0,-1))).json(),{users:[]});
   assert.deepEqual((await search(`absent_${randomBytes(5).toString('hex')}`)).json(),{users:[]});
   assert.deepEqual((await search(alice.username)).json(),{users:[{id:alice.id,username:alice.username,relationship:'self'}]});
   assert.equal(await database.contact.count({where:{OR:[{userAId:alice.id},{userBId:alice.id}]}}),0,'Search must not create a contact request');
  });
  const ids=pair(alice.id,bob.id);
  const contact=await database.contact.create({data:{...ids,requestedById:alice.id,status:'pending'}});
  await t.test('reports outgoing, incoming and accepted relationships without changing them',async()=>{
   assert.deepEqual((await search(bob.username)).json(),minimal('outgoing'));
   assert.deepEqual((await search(alice.username,bob.cookie)).json(),{users:[{id:alice.id,username:alice.username,relationship:'incoming'}]});
   await database.contact.update({where:{id:contact.id},data:{status:'accepted'}});
   assert.deepEqual((await search(bob.username)).json(),minimal('accepted'));
   await database.contact.update({where:{id:contact.id},data:{status:'declined'}});
   assert.deepEqual((await search(bob.username)).json(),{users:[]},'Declined connections cannot invite another request');
   await database.contact.update({where:{id:contact.id},data:{status:'accepted'}});
  });
  await t.test('hides blocked identities in either direction, including their aliases',async()=>{
   const block=await database.block.create({data:{blockerId:bob.id,blockedId:alice.id}});
   assert.deepEqual((await search(bob.username)).json(),{users:[]});
   assert.deepEqual((await search(alias)).json(),{users:[]});
   assert.deepEqual((await search(alice.username,bob.cookie)).json(),{users:[]});
   await database.block.delete({where:{id:block.id}});
   await database.block.create({data:{blockerId:alice.id,blockedId:bob.id}});
   assert.deepEqual((await search(bob.username)).json(),{users:[]});
   await database.block.deleteMany({where:{blockerId:alice.id,blockedId:bob.id}});
  });
  await t.test('rejects missing, partial syntax, wildcard and repeated handles',async()=>{
   for(const handle of ['ab','@someone','UPPERCASE','some%','some*','a'.repeat(25),'bot']){
    const response=await search(handle,alice.cookie,'127.0.0.2');assert.equal(response.statusCode,400,response.body);
   }
   const missing=await app.inject({method:'GET',url:'/api/users/search',headers:{cookie:alice.cookie},remoteAddress:'127.0.0.2'});
   assert.equal(missing.statusCode,400);
   const repeated=await app.inject({method:'GET',url:`/api/users/search?username=${bob.username}&username=${alice.username}`,headers:{cookie:alice.cookie},remoteAddress:'127.0.0.2'});
   assert.equal(repeated.statusCode,400);
  });
  await t.test('limits exact lookup to twenty requests per IP per minute',async()=>{
   for(let index=0;index<20;index++)assert.equal((await search(bob.username,alice.cookie,'127.0.0.3')).statusCode,200);
   const limited=await search(bob.username,alice.cookie,'127.0.0.3');
   assert.equal(limited.statusCode,429);assert.ok(limited.headers['retry-after']);
  });
 }finally{
  io.disconnectSockets(true);
  if(users.length)await database.user.deleteMany({where:{id:{in:users}}});
  await app.close();
 }
});
