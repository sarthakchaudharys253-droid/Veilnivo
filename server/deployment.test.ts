import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep, basename } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { readServerConfig } from './config';
import { buildServer, startServer } from './index';

async function removeFixture(directory: string) {
  const target=resolve(directory), temp=resolve(tmpdir());
  if (!target.startsWith(temp+sep) || !basename(target).startsWith('veilnivo-')) throw new Error('Fixture cleanup escaped the temporary directory.');
  await rm(target,{recursive:true,force:true});
}

const baseEnv: NodeJS.ProcessEnv = {NODE_ENV: 'production', JWT_SECRET: 'deployment-test-secret-with-at-least-32-characters', APP_ORIGIN: 'https://app.example.test'};
function fakeDatabase() {
  let queries = 0, disconnects = 0, unavailable = false;
  const database = {
    $queryRaw: async (parts: TemplateStringsArray) => {queries++;assert.equal(parts.join(''), 'SELECT 1');if (unavailable) throw new Error('postgresql://private-user:private-password@private-host');return [{'?column?':1}];},
    $disconnect: async () => {disconnects++;},
  } as unknown as PrismaClient;
  return {database, queries:()=>queries, disconnects:()=>disconnects, fail:()=>{unavailable=true;}};
}

test('deployment config validates origins, listener settings, booleans and explicit proxy networks', () => {
  assert.equal(readServerConfig({NODE_ENV:'development'}).host, '127.0.0.1');
  const config = readServerConfig({...baseEnv, PORT:'10000', TRUST_PROXY:'127.0.0.1, 10.20.0.0/16, ::1', SERVE_FRONTEND:'true'});
  assert.equal(config.origin, 'https://app.example.test');assert.equal(config.host, '0.0.0.0');assert.equal(config.port,10000);assert.equal(config.serveFrontend,true);
  assert.deepEqual(config.trustProxy,['127.0.0.1','10.20.0.0/16','::1']);
  assert.equal(readServerConfig({...baseEnv, CLIENT_ORIGIN:'https://other.example.test'}).origin,'https://other.example.test');
  assert.equal(readServerConfig({NODE_ENV:'production', RENDER_EXTERNAL_URL:'https://demo.onrender.com'}).origin,'https://demo.onrender.com');
  assert.equal(readServerConfig(baseEnv).trustProxy,false);
  for (const origin of ['http://app.example.test','https://app.example.test/path','https://app.example.test?secret=x','https://user:pass@app.example.test','https://*.example.test','ftp://app.example.test']) {
    assert.throws(()=>readServerConfig({...baseEnv,CLIENT_ORIGIN:origin}));
  }
  assert.throws(()=>readServerConfig({NODE_ENV:'production'}));
  for (const value of ['true','1','0.0.0.0/0','::/0','127.0.0.1/33','::1/129','10.0.0.1,','proxy.example.test']) assert.throws(()=>readServerConfig({...baseEnv,TRUST_PROXY:value}));
  for (const value of ['0','-1','65536','3001abc','3.5']) assert.throws(()=>readServerConfig({...baseEnv,PORT:value}));
  assert.throws(()=>readServerConfig({...baseEnv,HOST:'https://app.example.test'}));
  assert.throws(()=>readServerConfig({...baseEnv,SERVE_FRONTEND:'yes'}));
});

test('only configured proxy addresses affect request IP and exact origins protect mutations', async () => {
  const fake = fakeDatabase();const {app}=await buildServer({...baseEnv,TRUST_PROXY:'127.0.0.1'},fake.database);
  app.get('/api/test-ip',async request=>({ip:request.ip}));
  app.post('/api/test-origin',async()=>({ok:true}));
  try {
    const trusted=await app.inject({method:'GET',url:'/api/test-ip',remoteAddress:'127.0.0.1',headers:{'x-forwarded-for':'198.51.100.23'}});
    assert.equal(trusted.json().ip,'198.51.100.23');
    const spoofed=await app.inject({method:'GET',url:'/api/test-ip',remoteAddress:'203.0.113.8',headers:{'x-forwarded-for':'198.51.100.23'}});
    assert.equal(spoofed.json().ip,'203.0.113.8');
    assert.equal((await app.inject({method:'POST',url:'/api/test-origin',headers:{origin:'https://app.example.test'}})).statusCode,200);
    assert.equal((await app.inject({method:'POST',url:'/api/test-origin',headers:{origin:'https://app.example.test/'}})).statusCode,403);
    assert.equal((await app.inject({method:'POST',url:'/api/test-origin',headers:{origin:'https://attacker.example'}})).statusCode,403);
    assert.equal((await app.inject({method:'POST',url:'/api/test-origin'})).statusCode,403);
  } finally {await app.close();}
});

test('readiness queries PostgreSQL and hides failures while liveness remains available', async () => {
  const fake=fakeDatabase();const {app}=await buildServer(baseEnv,fake.database);
  try {
    const ready=await app.inject('/api/ready');assert.equal(ready.statusCode,200);assert.deepEqual(ready.json(),{ok:true});assert.equal(fake.queries(),1);assert.equal(ready.headers['cache-control'],'no-store');
    fake.fail();const down=await app.inject('/api/ready');assert.equal(down.statusCode,503);assert.deepEqual(down.json(),{ok:false,error:'Service is not ready.'});assert.doesNotMatch(down.body,/postgres|private-password|private-host/);
    assert.equal((await app.inject('/api/health')).statusCode,200);
  } finally {await app.close();}
  assert.equal(fake.disconnects(),1);
});

test('startup refuses to listen when PostgreSQL is unavailable and closes resources', async () => {
  const fake=fakeDatabase();fake.fail();
  await assert.rejects(()=>startServer(baseEnv,fake.database));assert.equal(fake.queries(),1);assert.equal(fake.disconnects(),1);
});

test('frontend serving requires a build and remains opt-in', async () => {
  const directory=await mkdtemp(join(tmpdir(),'veilnivo-no-build-'));
  try {
    await assert.rejects(()=>buildServer({...baseEnv,SERVE_FRONTEND:'true',FRONTEND_DIR:directory},fakeDatabase().database),/Build the frontend first/);
    const {app}=await buildServer({...baseEnv,FRONTEND_DIR:directory},fakeDatabase().database);
    try {assert.equal((await app.inject('/')).statusCode,404);}finally{await app.close();}
  }finally{await removeFixture(directory);}
});

test('static export serves pages and assets without API limits or source/traversal exposure', async () => {
  const directory=await mkdtemp(join(tmpdir(),'veilnivo-static-'));const root=join(directory,'out');
  await mkdir(join(root,'login'),{recursive:true});await mkdir(join(root,'_next','static'),{recursive:true});await mkdir(join(root,'src'),{recursive:true});
  await writeFile(join(root,'index.html'),'<html><body>Veilnivo home</body></html>');await writeFile(join(root,'login','index.html'),'<html><body>Veilnivo login</body></html>');
  await writeFile(join(root,'_next','static','app-123.js'),'console.log("public bundle")');await writeFile(join(root,'.env'),'SECRET=never-serve');await writeFile(join(root,'src','secret.js'),'SOURCE=never-serve');await writeFile(join(root,'secret.ts'),'SOURCE=never-serve');await writeFile(join(root,'package.json'),'CONFIG=never-serve');await writeFile(join(directory,'outside.txt'),'OUTSIDE=never-serve');
  let canLink=false;try{await symlink(join(directory,'outside.txt'),join(root,'linked.txt'));canLink=true;}catch{}
  const {app}=await buildServer({...baseEnv,SERVE_FRONTEND:'true',FRONTEND_DIR:root},fakeDatabase().database);
  app.get('/api/test-limiter',async()=>({ok:true}));
  try {
    const home=await app.inject('/');assert.equal(home.statusCode,200);assert.match(home.body,/Veilnivo home/);assert.match(home.headers['content-type']||'',/text\/html/);assert.match(home.headers['cache-control']||'',/no-cache/);
    const redirect=await app.inject('/login');assert.equal(redirect.statusCode,308);assert.equal(redirect.headers.location,'/login/');
    assert.match((await app.inject('/login/')).body,/Veilnivo login/);
    assert.equal((await app.inject({method:'HEAD',url:'/login/'})).body,'');
    for(let i=0;i<185;i++){
      const asset=await app.inject('/_next/static/app-123.js');assert.equal(asset.statusCode,200);assert.match(asset.headers['cache-control']||'',/immutable/);assert.equal(asset.headers['x-ratelimit-limit'],undefined);
    }
    const api=await app.inject('/api/test-limiter');assert.equal(api.statusCode,200);assert.equal(api.headers['x-ratelimit-limit'],'180');
    for(const url of ['/api/unknown','/missing','/.env','/%2eenv','/src/secret.js','/%73rc/secret.js','/secret.ts','/package.json','/%2e%2e%2foutside.txt','/..%5coutside.txt','//index.html',...(canLink?['/linked.txt']:[])]){
      const response=await app.inject(url);assert.ok([400,404].includes(response.statusCode),`${url}: ${response.statusCode}`);assert.doesNotMatch(response.body,/never-serve|Veilnivo home/);
      if(url==='/api/unknown')assert.match(response.headers['content-type']||'',/application\/json/);
    }
  }finally{await app.close();await removeFixture(directory);}
});

