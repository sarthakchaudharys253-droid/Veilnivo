import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { v2Services } from './v2';
import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import type { Server } from 'socket.io';

function harness(){
 const routes=new Map<string,any>(),hooks:any[]=[];
 const messages=new Map<string,any>(),nonces=new Map<string,any>();
 let contactStatus='accepted',isBlocked=false;
 const contacts:any={findUnique:async()=>({id:randomUUID(),status:contactStatus,ttlSeconds:3600})};
 const tx:any={contact:contacts,block:{findFirst:async()=>isBlocked?{id:randomUUID()}:null},message:{create:async({data}:any)=>{const row={id:randomUUID(),...data,createdAt:new Date(),readAt:null,revision:0,deletedAt:null};messages.set(row.id,row);return row;}},sendNonce:{findUnique:async({where}:any)=>{const nonce=nonces.get(where.senderId_clientMessageId.senderId+':'+where.senderId_clientMessageId.clientMessageId);return nonce?{...nonce,message:messages.get(nonce.messageId)||null}:null;},create:async({data}:any)=>{nonces.set(data.senderId+':'+data.clientMessageId,data);return data;}},attachment:{updateMany:async()=>({count:1})}};
 tx.$executeRaw=async()=>1;
 tx.sendNonce.findFirst=async({where}:any)=>[...nonces.values()].find(row=>row.clientMessageId===where.clientMessageId&&row.senderId!==where.senderId.not)??null;
 tx.message.findFirst=async({where}:any)=>{const row=messages.get(where.id);return row?.senderId===where.senderId?row:null;};
 tx.message.updateMany=async({where,data}:any)=>{const row=messages.get(where.id);if(!row||row.senderId!==where.senderId||row.revision!==where.revision||row.deletedAt)return{count:0};Object.assign(row,{...data,revision:row.revision+1});return{count:1};};
 tx.message.findUniqueOrThrow=async({where}:any)=>{const row=messages.get(where.id);if(!row)throw new Error('missing fixture');return row;};
 tx.attachment.deleteMany=async()=>({count:0});
 tx.groupMessage={findFirst:async()=>null};
 const database:any={...tx,$transaction:async(fn:any)=>fn(tx)};
 const app:any={addHook:(_name:string,fn:any)=>hooks.push(fn)};
 for(const method of ['get','post','put','patch','delete'])app[method]=(path:string,...args:any[])=>routes.set(method+' '+path,args[args.length-1]);
 const events:any[]=[];const io:any={to:(room:string)=>({emit:(event:string,data:unknown)=>events.push({room,event,data})})};
 const erasing=new Set<string>(),active=new Map<string,Set<Promise<void>>>();
 const services=v2Services({app:app as FastifyInstance,database:database as PrismaClient,io:io as Server,authenticate:async()=>{},erasingUsers:erasing,activeSends:active,online:()=>true});
 return {services,tx,messages,nonces,events,erasing,active,routes,close:()=>hooks.forEach(fn=>fn()),setStatus:(s:string)=>contactStatus=s,setBlocked:(b:boolean)=>isBlocked=b};
}
const envelope=(recipient_id:string)=>({recipient_id,client_message_id:randomUUID(),ciphertext:randomBytes(48).toString('base64'),iv:randomBytes(12).toString('base64')});

test('encrypted delivery is idempotent and rejects ciphertext, recipient, and expired-operation replay',async()=>{
 const h=harness();try{
  const sender=randomUUID(),recipient=randomUUID(),data=envelope(recipient);let emitted=0;
  const first=await h.services.sendEncrypted(sender,data,()=>emitted++);
  const replay=await h.services.sendEncrypted(sender,data,()=>emitted++);
  assert.equal(first.message.id,replay.message.id);assert.equal(replay.replayed,true);assert.equal(emitted,1);assert.equal(h.messages.size,1);
  await assert.rejects(()=>h.services.sendEncrypted(sender,{...data,ciphertext:randomBytes(48).toString('base64')}),/different encrypted content/);
  await assert.rejects(()=>h.services.sendEncrypted(sender,{...data,recipient_id:randomUUID()}),/another conversation/);
  h.messages.get(first.message.id).expiresAt=new Date(Date.now()-1);
  await assert.rejects(()=>h.services.sendEncrypted(sender,data),/expired/);
  h.messages.delete(first.message.id);
  await assert.rejects(()=>h.services.sendEncrypted(sender,data),/expired/);
  assert.equal(h.nonces.size,1,'Content-free nonce remains after ciphertext deletion');
 }finally{h.close();}
});

test('pending requests and blocks prevent encrypted delivery',async()=>{
 const h=harness();try{
  const sender=randomUUID(),recipient=randomUUID();h.setStatus('pending');
  await assert.rejects(()=>h.services.sendEncrypted(sender,envelope(recipient)),/Accept the message request/);
  h.setStatus('accepted');h.setBlocked(true);
  await assert.rejects(()=>h.services.sendEncrypted(sender,envelope(recipient)),/blocked/);assert.equal(h.messages.size,0);
 }finally{h.close();}
});

test('erasure sees in-flight delivery and suppresses post-erasure emission',async()=>{
 const h=harness();try{
  const sender=randomUUID(),recipient=randomUUID();let proceed!:(value:unknown)=>void,entered!:(value:unknown)=>void;const hasEntered=new Promise(resolve=>entered=resolve);
  const original=h.tx.message.create;
  h.tx.message.create=async(args:any)=>{entered(true);await new Promise(resolve=>proceed=resolve);return original(args);};
  let emitted=0;const pending=h.services.sendEncrypted(sender,envelope(recipient),()=>emitted++);await hasEntered;
  assert.equal(h.active.get(sender)?.size,1);assert.equal(h.active.get(recipient)?.size,1);
  h.erasing.add(recipient);await assert.rejects(()=>h.services.sendEncrypted(sender,envelope(recipient)),/erasure/);
  proceed(true);await pending;assert.equal(emitted,0);assert.equal(h.active.size,0);
 }finally{h.close();}
});


test('message mutations participate in erasure coordination and suppress late broadcasts',async()=>{
 const h=harness();try{
  const sender=randomUUID(),recipient=randomUUID(),original=await h.services.sendEncrypted(sender,envelope(recipient));
  let proceed!:(value:unknown)=>void,entered!:(value:unknown)=>void;const hasEntered=new Promise(resolve=>entered=resolve),update=h.tx.message.updateMany;
  h.tx.message.updateMany=async(args:any)=>{entered(true);await new Promise(resolve=>proceed=resolve);return update(args)};
  const pending=h.services.mutateMessage(sender,original.message.id,0,{ciphertext:randomBytes(64).toString('base64'),iv:randomBytes(12).toString('base64')});await hasEntered;
  assert.equal(h.active.get(sender)?.size,1);assert.equal(h.active.get(recipient)?.size,1);
  h.erasing.add(recipient);await assert.rejects(()=>h.services.mutateMessage(sender,original.message.id,0),/erasure/);
  proceed(true);await pending;assert.deepEqual(h.events,[]);assert.equal(h.active.size,0);
 }finally{h.close()}
});
