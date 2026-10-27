import test from 'node:test';
import assert from 'node:assert/strict';
import {io as connectSocket,type Socket} from 'socket.io-client';
import type {PrismaClient} from '@prisma/client';
import {RealtimeTicketStore,RealtimeTicketCapacityError,realtimeTicketsEnabled} from './realtime-tickets';
import {buildServer} from './index';
import {SESSION_COOKIE_NAME} from '../src/lib/compat';

const account='0a9e03f2-33a0-4c08-a817-e15b27feb152',other='6bfa94d7-0df0-46c2-9ffc-06e494a0dbbd',sid='410b8a21-ee7e-4109-b6a8-390f52fcc30a';
const env:NodeJS.ProcessEnv={NODE_ENV:'test',CLIENT_ORIGIN:'https://veilnivo.netlify.app',JWT_SECRET:'realtime-ticket-test-secret-over-32-characters',REALTIME_TICKETS:'true'};
const principal={sub:account,sid,expiresAt:90_000};

test('realtime tickets are opt-in opaque single-use capabilities with bounded session replacement',()=>{
 assert.equal(realtimeTicketsEnabled(undefined),false);assert.equal(realtimeTicketsEnabled('false'),false);assert.equal(realtimeTicketsEnabled('true'),true);assert.throws(()=>realtimeTicketsEnabled('yes'));
 let now=10_000;const store=new RealtimeTicketStore(()=>now,2);
 const first=store.issue(principal);assert.match(first.ticket,/^[A-Za-z0-9_-]{43}$/);assert.equal(first.expires_at,new Date(40_000).toISOString());
 const replacement=store.issue(principal);assert.equal(store.size,1);assert.notEqual(replacement.ticket,first.ticket);assert.throws(()=>store.consume(first.ticket));
 assert.deepEqual(store.consume(replacement.ticket),principal);assert.equal(store.size,0);assert.throws(()=>store.consume(replacement.ticket));
 const short=store.issue({...principal,expiresAt:11_000});assert.equal(short.expires_at,new Date(11_000).toISOString());now=11_000;assert.throws(()=>store.consume(short.ticket));assert.equal(store.size,0);
 now=20_000;const a=store.issue(principal),b=store.issue({...principal,sid:'another-session'});assert.throws(()=>store.issue({...principal,sid:'third-session'}),RealtimeTicketCapacityError);assert.equal(store.size,2);
 store.revokeSession(sid);assert.throws(()=>store.consume(a.ticket));assert.equal(store.size,1);store.revokeUser(account);assert.throws(()=>store.consume(b.ticket));assert.equal(store.size,0);
 const expired=store.issue(principal);now=51_000;store.prune();assert.equal(store.size,0);assert.throws(()=>store.consume(expired.ticket));
 for(const input of [null,undefined,'',{},'a'.repeat(42),'a'.repeat(44),'not.a.session.jwt'])assert.throws(()=>store.consume(input));
 store.issue(principal);store.clear();assert.equal(store.size,0);assert.throws(()=>store.issue({...principal,expiresAt:now}));
});

async function fixture(enabled=true){
 let active=true,expiry=new Date(Date.now()+60_000),owner=account;
 const session={findUnique:async()=>active?{id:sid,userId:owner,expiresAt:expiry}:null,deleteMany:async()=>{active=false;return{count:1};}};
 const database={session,contact:{findMany:async()=>[]},$transaction:async(fn:(tx:unknown)=>Promise<unknown>)=>fn({session,contact:{findMany:async()=>[]},message:{findMany:async()=>[],deleteMany:async()=>({count:0})},attachment:{deleteMany:async()=>({count:0})},user:{delete:async()=>({id:account})}}),$disconnect:async()=>{}} as unknown as PrismaClient;
 const built=await buildServer({...env,REALTIME_TICKETS:String(enabled)},database);
 const cookie=`${SESSION_COOKIE_NAME}=${built.app.jwt.sign({sub:account,sid},{expiresIn:60})}`;
 const headers={origin:env.CLIENT_ORIGIN!,cookie,'x-veilnivo-account':account};
 const issue=(overrides:Record<string,string>={},body:Record<string,unknown>={expected_user_id:account})=>built.app.inject({method:'POST',url:'/api/realtime/ticket',headers:{...headers,...overrides},payload:body});
 return {...built,cookie,headers,issue,revoke:()=>{active=false;},expire:()=>{expiry=new Date(Date.now()-1);},transfer:()=>{owner=other;}};
}
function event<T>(socket:Socket,name:string):Promise<T>{return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{socket.off(name,handler);reject(new Error('Missing socket event: '+name));},5000);const handler=(value:T)=>{clearTimeout(timeout);resolve(value);};socket.once(name,handler);});}

test('realtime ticket issuance requires exact origin, authenticated account binding and stays purpose-limited',async()=>{
 const f=await fixture();
 try{
  assert.equal((await f.issue({origin:'https://attacker.example'})).statusCode,403);
  assert.equal((await f.issue({origin:''})).statusCode,403);
  assert.equal((await f.issue({cookie:''})).statusCode,401);
  assert.equal((await f.issue({'x-veilnivo-account':other})).statusCode,409);
  assert.equal((await f.issue({}, {expected_user_id:other})).statusCode,409);
  assert.equal((await f.issue({}, {})).statusCode,400);
  const issued=await f.issue();assert.equal(issued.statusCode,200,issued.body);assert.equal(issued.headers['cache-control'],'no-store');
  const value=issued.json();assert.deepEqual(Object.keys(value).sort(),['expires_at','ticket']);assert.match(value.ticket,/^[A-Za-z0-9_-]{43}$/);assert.ok(Date.parse(value.expires_at)<=Date.now()+30_000);
  const cookieAttempt=await f.app.inject({url:'/api/conversations',headers:{cookie:`${SESSION_COOKIE_NAME}=${value.ticket}`}});assert.equal(cookieAttempt.statusCode,401);
  const bearerAttempt=await f.app.inject({url:'/api/conversations',headers:{authorization:`Bearer ${value.ticket}`}});assert.equal(bearerAttempt.statusCode,401);
 }finally{await f.app.close();}
 const disabled=await fixture(false);try{assert.equal((await disabled.issue()).statusCode,404);}finally{await disabled.app.close();}
});

test('cookie-free direct WebSockets consume one ticket, bind accounts and never fall back from invalid tickets',async()=>{
 const f=await fixture(),sockets:Socket[]=[];
 try{
  await f.app.listen({host:'127.0.0.1',port:0});const address=f.app.server.address();assert.ok(address&&typeof address!=='string');const endpoint=`http://127.0.0.1:${address.port}`;
  const socketFor=(auth:Record<string,unknown>,cookie='',origin=env.CLIENT_ORIGIN!)=>{const socket=connectSocket(endpoint,{autoConnect:false,transports:['websocket'],extraHeaders:{Origin:origin,...(cookie?{Cookie:cookie}:{})},auth,reconnection:false});sockets.push(socket);return socket;};
  const ticket=async()=>{const response=await f.issue();assert.equal(response.statusCode,200,response.body);return response.json().ticket as string;};
  const valid=await ticket(),socket=socketFor({realtime_ticket:valid,expected_user_id:account}),connected=event<void>(socket,'connect');socket.connect();await connected;assert.equal(socket.connected,true);socket.disconnect();
  for(const kind of ['replay','invalid','wrong-account','missing-account']){
   const auth=kind==='replay'?{realtime_ticket:valid,expected_user_id:account}:kind==='invalid'?{realtime_ticket:'invalid',expected_user_id:account}:kind==='wrong-account'?{realtime_ticket:await ticket(),expected_user_id:other}:{realtime_ticket:await ticket()};
   const denied=socketFor(auth,f.cookie),failed=event<Error>(denied,'connect_error');denied.connect();assert.match((await failed).message,/Sign in/);assert.equal(denied.connected,false);
  }
  const wrongOrigin=socketFor({realtime_ticket:await ticket(),expected_user_id:account},'','https://attacker.example'),originRejected=event<Error>(wrongOrigin,'connect_error');wrongOrigin.connect();await originRejected;assert.equal(wrongOrigin.connected,false);
  const legacy=socketFor({expected_user_id:account},f.cookie),legacyConnected=event<void>(legacy,'connect');legacy.connect();await legacyConnected;assert.equal(legacy.connected,true);
 }finally{for(const socket of sockets)socket.disconnect();await f.app.close();}
});

test('minted realtime tickets cannot survive logout, erasure, database expiry, ownership change or signed-session expiry',async()=>{
 for(const change of ['logout','erasure','expiry','owner','jwt'] as const){
  const f=await fixture(),sockets:Socket[]=[];
  try{
   await f.app.listen({host:'127.0.0.1',port:0});const address=f.app.server.address();assert.ok(address&&typeof address!=='string');
   const cookie=change==='jwt'?`${SESSION_COOKIE_NAME}=${f.app.jwt.sign({sub:account,sid},{expiresIn:1})}`:f.cookie;
   const issued=await f.issue({cookie});assert.equal(issued.statusCode,200,issued.body);const value=issued.json();
   if(change==='logout')assert.equal((await f.app.inject({method:'POST',url:'/api/auth/logout',headers:f.headers,payload:{}})).statusCode,200);
   if(change==='erasure')assert.equal((await f.app.inject({method:'POST',url:'/api/account/nuke',headers:f.headers,payload:{expected_user_id:account}})).statusCode,200);
   if(change==='expiry')f.expire();if(change==='owner')f.transfer();
   if(change==='jwt')await new Promise(resolve=>setTimeout(resolve,Math.max(0,Date.parse(value.expires_at)-Date.now()+20)));
   const socket=connectSocket(`http://127.0.0.1:${address.port}`,{autoConnect:false,transports:['websocket'],extraHeaders:{Origin:env.CLIENT_ORIGIN!},auth:{realtime_ticket:value.ticket,expected_user_id:account},reconnection:false});sockets.push(socket);const rejected=event<Error>(socket,'connect_error');socket.connect();assert.match((await rejected).message,/Sign in/);assert.equal(socket.connected,false,change);
  }finally{for(const socket of sockets)socket.disconnect();await f.app.close();}
 }
});

test('a delayed session snapshot cannot connect after the logout disconnect sweep',async()=>{
 let active=true,hold=false,release:(()=>void)|undefined,started:(()=>void)|undefined;
 const delayed=new Promise<void>(resolve=>started=resolve);
 const database={session:{findUnique:async()=>{
  const snapshot=active?{id:sid,userId:account,expiresAt:new Date(Date.now()+60_000)}:null;
  if(hold){hold=false;started!();await new Promise<void>(resolve=>release=resolve);}
  return snapshot;
 },deleteMany:async()=>{active=false;return{count:1};}},contact:{findMany:async()=>[]},$disconnect:async()=>{}} as unknown as PrismaClient;
 const {app}=await buildServer(env,database);let socket:Socket|undefined;
 try{
  await app.listen({host:'127.0.0.1',port:0});const address=app.server.address();assert.ok(address&&typeof address!=='string');
  const cookie=`${SESSION_COOKIE_NAME}=${app.jwt.sign({sub:account,sid},{expiresIn:60})}`,headers={origin:env.CLIENT_ORIGIN!,cookie,'x-veilnivo-account':account};
  const issued=await app.inject({method:'POST',url:'/api/realtime/ticket',headers,payload:{expected_user_id:account}});assert.equal(issued.statusCode,200);
  hold=true;socket=connectSocket(`http://127.0.0.1:${address.port}`,{autoConnect:false,transports:['websocket'],extraHeaders:{Origin:env.CLIENT_ORIGIN!},auth:{realtime_ticket:issued.json().ticket,expected_user_id:account},reconnection:false});const rejected=event<Error>(socket,'connect_error');socket.connect();await delayed;
  assert.equal((await app.inject({method:'POST',url:'/api/auth/logout',headers,payload:{}})).statusCode,200);
  release!();assert.match((await rejected).message,/Sign in/);assert.equal(socket.connected,false);
 }finally{release?.();socket?.disconnect();await app.close();}
});

test('ticket quotas follow verified sessions behind one proxy IP while anonymous ingress remains bounded',async()=>{
 const sessions=new Map([
  [sid,{id:sid,userId:account,expiresAt:new Date(Date.now()+60_000)}],
  ['bbcc84ae-11c2-40af-9daa-1007f63d3b04',{id:'bbcc84ae-11c2-40af-9daa-1007f63d3b04',userId:other,expiresAt:new Date(Date.now()+60_000)}],
 ]);
 let lookups=0;
 const database={session:{findUnique:async({where}:{where:{id:string}})=>{lookups++;return sessions.get(where.id)??null;}},$disconnect:async()=>{}} as unknown as PrismaClient;
 const {app}=await buildServer(env,database);
 try{
  const request=(userId:string,sessionId:string,remoteAddress='127.0.0.1',expected=userId)=>app.inject({method:'POST',url:'/api/realtime/ticket',remoteAddress,headers:{origin:env.CLIENT_ORIGIN!,cookie:`${SESSION_COOKIE_NAME}=${app.jwt.sign({sub:userId,sid:sessionId},{expiresIn:60})}`,'x-veilnivo-account':expected},payload:{expected_user_id:expected}});
  for(let index=0;index<20;index++)assert.equal((await request(account,sid)).statusCode,200);
  const limited=await request(account,sid);assert.equal(limited.statusCode,429);assert.ok(limited.headers['retry-after']);
  const second='bbcc84ae-11c2-40af-9daa-1007f63d3b04';
  assert.equal((await request(other,second)).statusCode,200,'Another verified session on the same IP keeps its own quota.');
  assert.equal((await request(account,sid,'127.0.0.1',other)).statusCode,409,'A forged account binding is rejected before selecting a session quota.');
  const invalidCookie=`${SESSION_COOKIE_NAME}=${app.jwt.sign({sub:account,sid:'missing-session'},{expiresIn:60})}`;
  const anonymous=()=>app.inject({method:'POST',url:'/api/realtime/ticket',remoteAddress:'127.0.0.2',headers:{origin:env.CLIENT_ORIGIN!,cookie:invalidCookie},payload:{expected_user_id:account}});
  for(let index=0;index<180;index++)assert.equal((await anonymous()).statusCode,401);
  const before=lookups,response=await anonymous();assert.equal(response.statusCode,429);assert.ok(response.headers['retry-after']);assert.equal(lookups,before,'The ingress cap rejects before another database lookup.');
 }finally{await app.close();}
});
