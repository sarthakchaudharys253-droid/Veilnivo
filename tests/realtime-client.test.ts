import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {Server} from 'socket.io';
import type {Socket} from 'socket.io-client';

function event(socket:Socket,name:string,timeout=8000):Promise<any>{return new Promise((resolve,reject)=>{const handler=(value:any)=>{clearTimeout(timer);resolve(value);};const timer=setTimeout(()=>{socket.off(name,handler);reject(new Error(`No ${name} event`));},timeout);socket.once(name,handler);});}

test('ticket transport uses same-origin HTTP, refreshes reconnect authorization and cancels stale identities',{timeout:30_000},async t=>{
 const http=createServer(),server=new Server(http,{transports:['websocket']});
 await new Promise<void>(resolve=>http.listen(0,'127.0.0.1',resolve));const address=http.address();assert.ok(address&&typeof address==='object');const origin=`http://127.0.0.1:${address.port}`;
 process.env.NEXT_PUBLIC_API_MODE='same-origin';process.env.NEXT_PUBLIC_API_URL='';process.env.NEXT_PUBLIC_SOCKET_URL=origin;
 const client=await import('../src/lib/client');
 const nativeFetch=globalThis.fetch,sockets:Socket[]=[],tokens=new Set<string>(),handshakes:string[]=[];
 let readySeen:(()=>void)|undefined,readyLoading=false;
 let issued=0,mode:'valid'|'fail-once'|'malformed'|'held'='valid',release:(()=>void)|undefined,heldStarted:(()=>void)|undefined;
 const seen:Array<{path:string;options:RequestInit|undefined}>=[];
 globalThis.fetch=async(input,options)=>{
  const path=String(input);seen.push({path,options});
  if(path===origin+'/api/ready'){readySeen?.();return readyLoading?new Response('<html>Waking up</html>',{headers:{'content-type':'text/html'}}):new Response('{"ok":true}',{headers:{'content-type':'application/json'}});}
  if(path.startsWith('/api/auth/'))return new Response('{"ok":true}',{headers:{'content-type':'application/json'}});
  assert.equal(path,'/api/realtime/ticket');
  const respond=()=>{const ticket=randomBytes(32).toString('base64url');tokens.add(ticket);issued++;return new Response(JSON.stringify({ticket,expires_at:new Date(Date.now()+30_000).toISOString()}),{headers:{'content-type':'application/json'}});};
  if(mode==='fail-once'){mode='valid';return new Response('{"error":"Backend is waking up."}',{status:503,headers:{'content-type':'application/json'}});}
  if(mode==='malformed')return new Response('{"ticket":"invalid","expires_at":"2099-01-01T00:00:00.000Z"}',{headers:{'content-type':'application/json'}});
  if(mode==='held'){heldStarted?.();return new Promise<Response>(resolve=>release=()=>resolve(respond()));}
  return respond();
 };
 server.use((socket,next)=>{const {realtime_ticket,expected_user_id}=socket.handshake.auth;handshakes.push(realtime_ticket);if(!tokens.delete(realtime_ticket)||!expected_user_id)return next(new Error('Invalid realtime authorization.'));next();});
 server.on('connection',socket=>socket.on('probe',ack=>ack({ok:true})));
 function open(){const socket=client.openSocket();sockets.push(socket);return socket;}
 try{
  client.setExpectedAccountId('account-one');
  await t.test('authentication warms Render directly before one proxied mutation',async()=>{
   await client.api('/api/auth/login',{method:'POST',body:'{"synthetic":true}'});
   assert.equal(seen[0].path,origin+'/api/ready');assert.equal(seen[0].options?.credentials,'omit');assert.equal(seen[1].path,'/api/auth/login');assert.equal(seen[1].options?.method,'POST');assert.equal(seen[1].options?.credentials,'include');
   await client.api('/api/auth/register',{method:'POST',body:'{"synthetic":true}'});
   assert.equal(seen.filter(request=>request.path==='/api/auth/register').length,1);
   assert.equal(seen.filter(request=>request.path.endsWith('/api/ready')).length,1,'Brief readiness cache avoids duplicate warmups');
  });
  await t.test('one-use capabilities bind both account header and body; reconnect receives a new capability',async()=>{
   const socket=open();await event(socket,'connect');assert.equal(socket.io.opts.withCredentials,false);
   const request=seen.find(request=>request.path==='/api/realtime/ticket')!;
   assert.equal(new Headers(request.options?.headers).get('X-Veilnivo-Account'),'account-one');assert.deepEqual(JSON.parse(String(request.options?.body)),{expected_user_id:'account-one'});assert.equal(request.options?.credentials,'include');
   assert.deepEqual(await socket.timeout(2000).emitWithAck('probe'),{ok:true});const first=issued,connected=event(socket,'connect');
   for(const peer of server.sockets.sockets.values())peer.conn.close();
   await connected;assert.ok(issued>first);assert.notEqual(handshakes.at(-1),handshakes.at(-2));socket.disconnect();
  });
  await t.test('a temporarily unavailable ticket endpoint retries without cookie fallback',async()=>{
   mode='fail-once';const socket=open(),failure=await event(socket,'connect_error');assert.match(failure.message,/waking up/);assert.equal(handshakes.at(-1),'');await event(socket,'connect');assert.equal(socket.connected,true);socket.disconnect();
  });
  await t.test('malformed capabilities never reach a successful authenticated handshake',async()=>{
   mode='malformed';await assert.rejects(client.fetchRealtimeAuth('account-one'),/invalid realtime authorization/);const socket=open(),failure=await event(socket,'connect_error');assert.match(failure.message,/invalid realtime authorization/);assert.equal(handshakes.at(-1),'');assert.equal(socket.connected,false);socket.disconnect();mode='valid';
  });
  await t.test('a waking HTML page is not readiness and cancellation never submits the mutation',async()=>{
   const nativeNow=Date.now,requestsBefore=seen.filter(request=>request.path==='/api/auth/register').length;
   Date.now=()=>nativeNow()+6000;readyLoading=true;
   try{
    const controller=new AbortController(),started=new Promise<void>(resolve=>readySeen=resolve),pending=client.api('/api/auth/register',{method:'POST',body:'{}',signal:controller.signal});
    await started;await new Promise<void>(resolve=>setImmediate(resolve));controller.abort();
    await assert.rejects(pending,{name:'AbortError'});assert.equal(seen.filter(request=>request.path==='/api/auth/register').length,requestsBefore);
   }finally{Date.now=nativeNow;readyLoading=false;readySeen=undefined;}
  });
  await t.test('locking during a ticket request prevents its delayed response from connecting',async()=>{
   mode='held';const started=new Promise<void>(resolve=>heldStarted=resolve),socket=open();await started;
   const before=handshakes.length;client.setExpectedAccountId(null);release!();release=undefined;
   await new Promise<void>(resolve=>setImmediate(resolve));await new Promise<void>(resolve=>setImmediate(resolve));
   assert.equal(socket.connected,false);assert.equal(socket.active,false);assert.equal(handshakes.length,before);mode='valid';
  });
 }finally{
  release?.();for(const socket of sockets)socket.disconnect();client.setExpectedAccountId(null);globalThis.fetch=nativeFetch;
  await new Promise<void>(resolve=>server.close(()=>resolve()));
 }
});
