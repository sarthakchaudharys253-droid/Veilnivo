import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {Prisma,PrismaClient} from '@prisma/client';

interface Plan {['Node Type']:string;['Index Name']?:string;['Actual Rows']?:number;['Shared Hit Blocks']?:number;['Shared Read Blocks']?:number;Plans?:Plan[]}
function nodes(plan:Plan):Plan[]{return[plan,...(plan.Plans??[]).flatMap(nodes)]}

test('SQL performance indexes serve selective nonce and directional latest-message probes',{skip:!process.env.TEST_DATABASE_URL,timeout:60000},async t=>{
 const database=new PrismaClient({datasources:{db:{url:process.env.TEST_DATABASE_URL}}}),owner=randomUUID(),peer=randomUUID(),groupId=randomUUID(),users=[owner,peer];
 const messageIndex='Message_senderId_recipientId_createdAt_id_idx',groupIndex='GroupMessage_clientMessageId_idx';
 try{
  const indexes=await database.$queryRaw<{indexname:string;indexdef:string}[]>`SELECT indexname,indexdef FROM pg_indexes WHERE schemaname=current_schema() AND indexname IN (${messageIndex},${groupIndex},'SendNonce_clientMessageId_idx')`;
  assert.equal(indexes.length,3,'both additive indexes and the existing nonce index must be present once');
  assert.match(indexes.find(index=>index.indexname===messageIndex)!.indexdef,/\("senderId", "recipientId", "createdAt", id\)/);
  assert.match(indexes.find(index=>index.indexname===groupIndex)!.indexdef,/\("clientMessageId"\)/);
  await database.user.createMany({data:users.map(id=>({id,username:'perfidx_'+randomBytes(6).toString('hex'),authHashDigest:'isolated-unused-proof',authSalt:'isolated',wrapSalt:'isolated',wrapIv:'isolated',publicKeyJwk:'{}',encryptedPrivateKey:'isolated'}))});
  await database.group.create({data:{id:groupId,name:'Isolated query-plan fixture',ownerId:owner}});
  await database.groupMember.createMany({data:users.map(userId=>({groupId,userId,joinedVersion:1}))});
  // These opaque SQL fixtures are not real encryption sessions or user content.
  const ciphertext=randomBytes(80).toString('base64'),iv=randomBytes(12).toString('base64'),base=Date.now()-120000;
  const messages=Array.from({length:4000},(_,index)=>({id:randomUUID(),senderId:index%2?peer:owner,recipientId:index%2?owner:peer,ciphertext,iv,createdAt:new Date(base+index),expiresAt:index%97===0?new Date(base):null}));
  const groupMessages=Array.from({length:4000},(_,index)=>({id:randomUUID(),groupId,senderId:index%2?peer:owner,clientMessageId:randomUUID(),keyVersion:1,ciphertext,iv,createdAt:new Date(base+index)}));
  for(let offset=0;offset<messages.length;offset+=1000)await database.message.createMany({data:messages.slice(offset,offset+1000)});
  for(let offset=0;offset<groupMessages.length;offset+=1000)await database.groupMessage.createMany({data:groupMessages.slice(offset,offset+1000)});
  await database.$executeRawUnsafe('ANALYZE "Message"');
  await database.$executeRawUnsafe('ANALYZE "GroupMessage"');
  async function explain(query:Prisma.Sql){const [row]=await database.$queryRaw<{'QUERY PLAN':{Plan:Plan;'Execution Time':number}[]}[]>(query);return row['QUERY PLAN'][0]}
  const latest=await explain(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT message.* FROM "Message" AS message WHERE message."senderId"=${owner} AND message."recipientId"=${peer} AND (message."expiresAt" IS NULL OR message."expiresAt">(clock_timestamp() AT TIME ZONE 'UTC')) ORDER BY message."createdAt" DESC,message."id" DESC LIMIT 1`);
  const latestNodes=nodes(latest.Plan);assert.ok(latestNodes.some(node=>node['Index Name']===messageIndex));assert.ok(!latestNodes.some(node=>/Sort/.test(node['Node Type'])),'the directional LIMIT1 probe must not sort conversation history');assert.equal(latest.Plan['Actual Rows'],1);
  const needle=groupMessages[1234].clientMessageId;
  const nonce=await explain(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT "id" FROM "GroupMessage" WHERE "id"=${needle} OR "clientMessageId"=${needle} LIMIT 1`);
  assert.ok(nodes(nonce.Plan).some(node=>node['Index Name']===groupIndex));assert.equal(nonce.Plan['Actual Rows'],1);
  const [sizes]=await database.$queryRaw<{messageBytes:bigint;groupBytes:bigint}[]>`SELECT pg_relation_size('"Message_senderId_recipientId_createdAt_id_idx"'::regclass) AS "messageBytes",pg_relation_size('"GroupMessage_clientMessageId_idx"'::regclass) AS "groupBytes"`;
  const describe=(plan:Plan)=>nodes(plan).map(node=>node['Node Type']+(node['Index Name']?' ['+node['Index Name']+']':'')).join(' → ');
  t.diagnostic('4,000 directional + 4,000 group synthetic rows; latest plan: '+describe(latest.Plan)+'; no history sort; returned 1 row.');
  t.diagnostic('Global group-ID collision plan: '+describe(nonce.Plan)+'; returned 1 row.');
  t.diagnostic('Isolated index sizes including other suite fixtures: message='+sizes.messageBytes+' bytes, group='+sizes.groupBytes+' bytes. These are test measurements, not production projections.');
 }finally{await database.user.deleteMany({where:{id:{in:users}}});await database.$disconnect()}
});
