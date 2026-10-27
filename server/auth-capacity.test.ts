import test from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import { AuthCapacity, AuthCapacityError, authCapacity } from './auth-capacity';
import { buildServer } from './index';

const env:NodeJS.ProcessEnv={NODE_ENV:'test',CLIENT_ORIGIN:'http://localhost:3000',JWT_SECRET:'test-auth-capacity-over-32-characters'};

test('Argon2 capacity admits two operations and rejects excess without a waiting queue',async()=>{
  const capacity=new AuthCapacity(2);let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);let entered=0;
  const first=capacity.run(async()=>{entered++;await gate;return 'first'}),second=capacity.run(async()=>{entered++;await gate;return 'second'});
  assert.equal(entered,2);await assert.rejects(()=>capacity.run(()=>{entered++;}),AuthCapacityError);assert.equal(entered,2);
  release();assert.deepEqual(await Promise.all([first,second]),['first','second']);assert.equal(await capacity.run(()=>3),3);
});

test('Argon2 capacity releases permits after synchronous and asynchronous failures',async()=>{
  const capacity=new AuthCapacity(1);await assert.rejects(()=>capacity.run(()=>{throw new Error('sync failure')}),/sync failure/);
  await assert.rejects(()=>capacity.run(async()=>{throw new Error('async failure')}),/async failure/);assert.equal(await capacity.run(()=>true),true);
});

test('saturated process-wide authentication returns retryable429 before Argon2 executes',async()=>{
  let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);const first=authCapacity.run(()=>gate),second=authCapacity.run(()=>gate);
  const database={user:{findUnique:async()=>({authHashDigest:'unused-while-busy'})},$disconnect:async()=>{}} as unknown as PrismaClient;
  const {app}=await buildServer(env,database);
  try {
    const response=await app.inject({method:'POST',url:'/api/auth/login',headers:{origin:env.CLIENT_ORIGIN!},payload:{username:'existing_user',auth_hash:Buffer.alloc(32).toString('base64')}});
    assert.equal(response.statusCode,429);assert.equal(response.headers['retry-after'],'1');assert.deepEqual(response.json(),{error:'Authentication is busy. Try again shortly.'});
  }finally{release();await Promise.all([first,second]);await app.close();}
});
