import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient,type Prisma} from '@prisma/client';
import {latestConversationMessages} from './conversation-snapshots';

test('conversation snapshots use bounded parameterized batches with no query for an empty inbox',async()=>{
 const calls:Prisma.Sql[]=[];
 const database={$queryRaw:async(query:Prisma.Sql)=>{calls.push(query);return[]}} as unknown as PrismaClient;
 assert.equal((await latestConversationMessages(database,'owner',[])).size,0);assert.equal(calls.length,0);
 const peers=Array.from({length:1201},(_,index)=>'peer-'+index);
 await latestConversationMessages(database,'owner',[...peers,'owner',peers[0]]);
 assert.equal(calls.length,3);
 assert.ok(calls.every(query=>query.values.length<=502));
 assert.ok(calls.every(query=>!query.sql.includes('peer-')&&query.sql.includes('CROSS JOIN LATERAL')));
 assert.ok(calls.every(query=>query.values.includes('owner')));
});

test('SQL conversation snapshots preserve both directions, expiry, tombstones and stable latest ordering', {skip:!process.env.TEST_DATABASE_URL},async()=>{
 const database=new PrismaClient({datasources:{db:{url:process.env.TEST_DATABASE_URL}}});
 const ids=Array.from({length:5},()=>randomUUID()),[owner,peer,other,outsider,empty]=ids;
 try{
  await database.user.createMany({data:ids.map(id=>({id,username:'snapshot_'+id.replace(/-/g,'').slice(0,16),authHashDigest:'synthetic',authSalt:'synthetic',wrapSalt:'synthetic',wrapIv:'synthetic',publicKeyJwk:'{}',encryptedPrivateKey:'synthetic'}))});
  const at=new Date(Date.now()-60_000),[low,high]=[randomUUID(),randomUUID()].sort();
  await database.message.createMany({data:[
   {id:low,senderId:owner,recipientId:peer,ciphertext:'old',iv:'synthetic',createdAt:at},
   {id:high,senderId:peer,recipientId:owner,ciphertext:'latest reverse',iv:'synthetic',createdAt:at},
   {id:randomUUID(),senderId:owner,recipientId:peer,ciphertext:'expired',iv:'synthetic',createdAt:new Date(),expiresAt:new Date(Date.now()-1)},
   {id:randomUUID(),senderId:owner,recipientId:other,ciphertext:'',iv:'',createdAt:new Date(),deletedAt:new Date()},
   {id:randomUUID(),senderId:outsider,recipientId:peer,ciphertext:'unrelated',iv:'synthetic',createdAt:new Date()},
   {id:randomUUID(),senderId:owner,recipientId:owner,ciphertext:'private AI history',iv:'synthetic',createdAt:new Date()},
  ]});
  const rows=await latestConversationMessages(database,owner,[peer,other,empty,owner]);
  assert.equal(rows.size,2);assert.equal(rows.get(peer)?.id,high);assert.equal(rows.get(peer)?.ciphertext,'latest reverse');
  assert.ok(rows.get(other)?.deletedAt);assert.equal(rows.get(other)?.ciphertext,'');assert.equal(rows.has(empty),false);assert.equal(rows.has(owner),false);
 }finally{await database.user.deleteMany({where:{id:{in:ids}}});await database.$disconnect()}
});
