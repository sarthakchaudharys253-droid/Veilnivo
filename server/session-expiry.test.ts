import test from 'node:test';
import assert from 'node:assert/strict';
import { io as connectSocket, type Socket } from 'socket.io-client';
import type { PrismaClient } from '@prisma/client';
import { sessionDeadline, scheduleSessionExpiry } from './session-expiry';
import { buildServer } from './index';
import { SESSION_COOKIE_NAME } from '../src/lib/compat';

const env:NodeJS.ProcessEnv={NODE_ENV:'test',CLIENT_ORIGIN:'http://localhost:3000',JWT_SECRET:'test-socket-expiry-over-32-characters'};
const account='d3ef1188-c6ae-4f22-99ef-45acac67b248',otherAccount='3c648d7a-fbc7-4279-9953-bfda5501ec92',sid='a33fe51e-bad1-45cf-a3bd-7d051a1ea5c4';
function event<T>(socket:Socket,name:string):Promise<T>{return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{socket.off(name,handler);reject(new Error(`Missing socket event: ${name}`));},5000);const handler=(value:T)=>{clearTimeout(timer);resolve(value)};socket.once(name,handler);});}

test('session deadline is the earliest signed-token or database expiry and rejects expired authorization',()=>{
  assert.equal(sessionDeadline(new Date(50_000),40,10_000),40_000);assert.equal(sessionDeadline(new Date(30_000),40,10_000),30_000);
  for(const expiry of [0,10,undefined,Infinity,'40'])assert.throws(()=>sessionDeadline(new Date(50_000),expiry,10_000),/Session expired/);
  assert.throws(()=>sessionDeadline(new Date(10_000),40,10_000),/Session expired/);
});

test('passive-session timers disconnect at the deadline and can be cancelled on disconnect/shutdown',context=>{
  context.mock.timers.enable({apis:['Date','setTimeout'],now:10_000});let disconnects=0;
  scheduleSessionExpiry(11_000,()=>disconnects++);context.mock.timers.tick(999);assert.equal(disconnects,0);context.mock.timers.tick(1);assert.equal(disconnects,1);
  const cancel=scheduleSessionExpiry(12_000,()=>disconnects++);cancel();context.mock.timers.tick(2000);assert.equal(disconnects,1);
  scheduleSessionExpiry(Date.now()-1,()=>disconnects++);assert.equal(disconnects,2);
});

test('HTTP account binding rejects a changed cookie identity before mutating another account',async()=>{
  let deletions=0;
  const database={session:{findUnique:async()=>({id:sid,userId:account,expiresAt:new Date(Date.now()+60_000)})},alias:{deleteMany:async()=>{deletions++;return{count:1};}},$disconnect:async()=>{}} as unknown as PrismaClient;
  const {app}=await buildServer(env,database);const cookie=`${SESSION_COOKIE_NAME}=${app.jwt.sign({sub:account,sid},{expiresIn:60})}`;
  try {
    const request=(expected?:string,cookieValue=cookie)=>app.inject({method:'DELETE',url:'/api/aliases/alias_handle',headers:{origin:env.CLIENT_ORIGIN!,cookie:cookieValue,...(expected?{'x-veilnivo-account':expected}:{})}});
    const stale=await request(otherAccount);assert.equal(stale.statusCode,409);assert.equal(deletions,0);assert.match(stale.json().error,/active account changed/);
    assert.equal((await request(account)).statusCode,200);assert.equal(deletions,1);
    assert.equal((await request()).statusCode,200);assert.equal(deletions,2,'Legacy raw clients remain compatible.');
    assert.equal((await request(otherAccount,`${SESSION_COOKIE_NAME}=invalid-token`)).statusCode,401);assert.equal(deletions,2);
    const preflight=await app.inject({method:'OPTIONS',url:'/api/aliases/alias_handle',headers:{origin:env.CLIENT_ORIGIN!,'access-control-request-method':'DELETE','access-control-request-headers':'content-type,x-veilnivo-account'}});assert.equal(preflight.statusCode,204);assert.match(String(preflight.headers['access-control-allow-headers']),/X-Veilnivo-Account/i);
  }finally{await app.close();}
});

test('realtime rejects a stale account binding and disconnects a passive recipient at database session expiry',async()=>{
  let expiry=new Date(Date.now()+60_000);
  const database={session:{findUnique:async()=>({id:sid,userId:account,expiresAt:expiry})},contact:{findMany:async()=>[]},$disconnect:async()=>{}} as unknown as PrismaClient;
  const {app}=await buildServer(env,database);const sockets:Socket[]=[];
  try {
    await app.listen({host:'127.0.0.1',port:0});const address=app.server.address();assert.ok(address&&typeof address!=='string');
    const endpoint=`http://127.0.0.1:${address.port}`,cookie=`${SESSION_COOKIE_NAME}=${app.jwt.sign({sub:account,sid},{expiresIn:60})}`;
    const socketFor=(expected:string)=>{const socket=connectSocket(endpoint,{autoConnect:false,transports:['websocket'],extraHeaders:{Origin:env.CLIENT_ORIGIN!,Cookie:cookie},auth:{expected_user_id:expected},reconnection:false});sockets.push(socket);return socket;};
    const stale=socketFor(otherAccount),denied=event<Error>(stale,'connect_error');stale.connect();const deniedError=await denied;assert.match(deniedError.message,/Sign in/,String((deniedError as Error&{description?:{message?:string}}).description?.message));assert.equal(stale.connected,false);
    expiry=new Date(Date.now()+500);const passive=socketFor(account),connected=event<void>(passive,'connect'),disconnected=event<string>(passive,'disconnect');passive.connect();await connected;
    assert.equal(await disconnected,'io server disconnect');assert.equal(passive.connected,false);
  }finally{for(const socket of sockets)socket.disconnect();await app.close();}
});
