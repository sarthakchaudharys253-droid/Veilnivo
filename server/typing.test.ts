import test from 'node:test';
import assert from 'node:assert/strict';
import {io as connectSocket,type Socket} from 'socket.io-client';
import type {PrismaClient} from '@prisma/client';
import {buildServer} from './index';
import {SESSION_COOKIE_NAME} from '../src/lib/compat';

const alice='b76348cb-55cb-4464-bbe9-1bdf2e21733d',bob='cd89ae3a-94fa-4d3c-bbfc-ce0ab31ecf90';
const aliceSession='694a6b62-b277-4863-a559-705b42ec396f',bobSession='617cd744-a2e8-45cb-aa2d-1ddf17cb22f1';
const env:NodeJS.ProcessEnv={NODE_ENV:'test',CLIENT_ORIGIN:'http://localhost:3000',JWT_SECRET:'typing-regression-test-over-32-characters'};
type Presence={user_id:string;online:boolean};
type Typing={user_id:string;typing:boolean};
function event<T>(socket:Socket,name:string):Promise<T>{return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{socket.off(name,handler);reject(new Error(`Missing socket event: ${name}`));},5000);const handler=(value:T)=>{clearTimeout(timer);resolve(value)};socket.once(name,handler);});}
function gate(){let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(resolve=>{enter=resolve}),pending=new Promise<void>(resolve=>{release=resolve});return{entered,release,wait:async()=>{enter();await pending;}};}
const settle=()=>new Promise(resolve=>setTimeout(resolve,50));

async function fixture(){
 let sessionGate:ReturnType<typeof gate>|undefined,presenceGate:ReturnType<typeof gate>|undefined;
 const sessionRows=new Map([[aliceSession,{id:aliceSession,userId:alice,expiresAt:new Date(Date.now()+60_000)}],[bobSession,{id:bobSession,userId:bob,expiresAt:new Date(Date.now()+60_000)}]]);
 const contact={id:crypto.randomUUID(),userAId:alice,userBId:bob,status:'accepted'};
 const database={
  session:{findUnique:async({where}:{where:{id:string}})=>{if(where.id===aliceSession&&sessionGate){const held=sessionGate;sessionGate=undefined;await held.wait();}return sessionRows.get(where.id)??null;}},
  contact:{findUnique:async()=>contact,findMany:async({where}:{where:{OR:{userAId?:string}[]}})=>{if(where.OR[0].userAId===alice&&presenceGate){const held=presenceGate;presenceGate=undefined;await held.wait();}return[contact];}},
  block:{findFirst:async()=>null,findMany:async({where,select}:{where:{OR:[{blockerId:string;blockedId:{in:string[]}},{blockedId:string;blockerId:{in:string[]}}]};select:Record<string,boolean>})=>{
   const [outgoing,incoming]=where.OR,caller=outgoing.blockerId,other=caller===alice?bob:alice;
   assert.ok(caller===alice||caller===bob);assert.equal(incoming.blockedId,caller);
   assert.deepEqual(outgoing.blockedId.in,[other]);assert.deepEqual(incoming.blockerId.in,[other]);assert.deepEqual(select,{blockerId:true,blockedId:true});
   return[];
  }},$disconnect:async()=>{},
 } as unknown as PrismaClient;
 const {app,io}=await buildServer(env,database),sockets:Socket[]=[];
 await app.listen({host:'127.0.0.1',port:0});const address=app.server.address();assert.ok(address&&typeof address!=='string');const port=address.port;
 async function connect(userId:string){const sid=userId===alice?aliceSession:bobSession,cookie=`${SESSION_COOKIE_NAME}=${app.jwt.sign({sub:userId,sid},{expiresIn:60})}`;
  const socket=connectSocket(`http://127.0.0.1:${port}`,{autoConnect:false,transports:['websocket'],extraHeaders:{Origin:env.CLIENT_ORIGIN!,Cookie:cookie},reconnection:false});sockets.push(socket);const connected=event<void>(socket,'connect');socket.connect();await connected;return socket;
 }
 return{io,connect,holdSession:()=>sessionGate=gate(),holdPresence:()=>presenceGate=gate(),close:async()=>{sessionGate?.release();presenceGate?.release();for(const socket of sockets)socket.disconnect();await app.close();}};
}

test('typing stop immediately follows a start without being discarded by the keystroke throttle',async()=>{
 const f=await fixture();try{const recipient=await f.connect(bob),sender=await f.connect(alice);
  const started=event<Typing>(recipient,'typing:receive');sender.emit('typing:send',{recipient_id:bob,typing:true});assert.deepEqual(await started,{user_id:alice,typing:true});
  const stopped=event<Typing>(recipient,'typing:receive');sender.emit('typing:send',{recipient_id:bob,typing:false});assert.deepEqual(await stopped,{user_id:alice,typing:false});
 }finally{await f.close();}
});

test('a typing authorization completing after disconnect cannot revive an offline sender',async()=>{
 const f=await fixture();let held:ReturnType<typeof gate>|undefined;try{const recipient=await f.connect(bob),sender=await f.connect(alice);await settle();
  const received:Typing[]=[];recipient.on('typing:receive',value=>received.push(value));held=f.holdSession();sender.emit('typing:send',{recipient_id:bob,typing:true});await held.entered;
  const offline=event<Presence>(recipient,'presence:update');f.io.sockets.sockets.get(sender.id!)!.disconnect(true);assert.deepEqual(await offline,{user_id:alice,online:false});
  held.release();await settle();assert.deepEqual(received,[]);
 }finally{held?.release();await f.close();}
});

test('presence keeps another tab online and rechecks presence after a delayed disconnect lookup',async()=>{
 const f=await fixture();let held:ReturnType<typeof gate>|undefined;try{const recipient=await f.connect(bob),first=await f.connect(alice),second=await f.connect(alice);await settle();
  const updates:Presence[]=[];recipient.on('presence:update',value=>updates.push(value));first.disconnect();await settle();assert.deepEqual(updates,[],'one remaining tab keeps the identity online');
  held=f.holdPresence();second.disconnect();await held.entered;
  const reconnected=event<Presence>(recipient,'presence:update');await f.connect(alice);assert.deepEqual(await reconnected,{user_id:alice,online:true});
  const delayed=event<Presence>(recipient,'presence:update');held.release();assert.deepEqual(await delayed,{user_id:alice,online:true},'an old offline lookup must not override a new live tab');
 }finally{held?.release();await f.close();}
});
