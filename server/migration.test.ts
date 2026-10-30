import {test} from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {migrationAuthorized,registerMigration,migrationModels} from './migration';

test('migration export is absent unless explicitly frozen and authenticated',async()=>{
  assert.equal(migrationAuthorized('', ''),false);
  assert.equal(migrationAuthorized('a'.repeat(43),'a'.repeat(42)),false);
  assert.equal(migrationAuthorized('a'.repeat(43),'a'.repeat(43)),true);
  const env:NodeJS.ProcessEnv={NODE_ENV:'test',MIGRATION_EXPORT_TOKEN:'x'.repeat(43)};
  let reads=0;
  const app=Fastify();
  registerMigration(app,{user:{count:async()=>{reads++;return 1},findMany:async()=>[]}} as any,env);
  app.post('/api/ordinary',async()=>({ok:true}));
  const exportPage=()=>app.inject({method:'POST',url:'/api/migration/export',headers:{'x-veilnivo-migration':'x'.repeat(43)},payload:{model:'User'}});
  assert.equal((await exportPage()).statusCode,404);
  env.MIGRATION_READ_ONLY='true';
  assert.equal((await app.inject({method:'POST',url:'/api/ordinary'})).statusCode,503);
  assert.equal((await app.inject({method:'POST',url:'/api/migration/export',payload:{model:'User'}})).statusCode,404);
  assert.equal((await exportPage()).statusCode,200);
  assert.equal(reads,1);
  assert.equal((await app.inject({method:'POST',url:'/api/migration/export',headers:{'x-veilnivo-migration':'x'.repeat(43)},payload:{model:'User',offset:-1}})).statusCode,400);
  await app.close();
});

test('authenticated aggregate preflight does not freeze the source or export identity rows',async()=>{
  const env:NodeJS.ProcessEnv={NODE_ENV:'test',MIGRATION_EXPORT_TOKEN:'x'.repeat(43)};
  const database:any={$queryRaw:async()=>[{bytes:'100'}]};
  let rowReads=0;
  for(const name of Object.keys(migrationModels))database[name[0].toLowerCase()+name.slice(1)]={count:async()=>0,findMany:async()=>{rowReads++;return[]}};
  const app=Fastify();registerMigration(app,database,env);app.post('/api/ordinary',async()=>({ok:true}));
  const manifest=await app.inject({method:'POST',url:'/api/migration/export',headers:{'x-veilnivo-migration':'x'.repeat(43)},payload:{model:'manifest'}});
  assert.equal(manifest.statusCode,200);assert.equal(manifest.json().readOnly,false);assert.equal(manifest.json().payload_bytes,1300);assert.equal(Object.keys(manifest.json().counts).length,13);assert.equal(rowReads,0);
  assert.equal((await app.inject({method:'POST',url:'/api/ordinary'})).statusCode,200);
  env.MIGRATION_READ_ONLY='true';
  const rejected=await app.inject({method:'POST',url:'/api/migration/export',headers:{'x-veilnivo-migration':'x'.repeat(43)},payload:{model:'Attachment',limit:2}});
  assert.equal(rejected.statusCode,400);assert.equal(rowReads,0);
  await app.close();
});
