import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { Server } from 'socket.io';
import { webcrypto } from 'node:crypto';
import { InputError, base64, id, object, username } from './validation';

export const MAX_FILE_BYTES=10*1024*1024;
export const TTL_SECONDS=[0,3600,86400,604800] as const;
type Db=PrismaClient|Prisma.TransactionClient;
export function ttlSeconds(value:unknown):number {
  if(typeof value!=='number'||!TTL_SECONDS.includes(value as typeof TTL_SECONDS[number]))throw new InputError('Choose Off, 1 hour, 24 hours, or 7 days.');
  return value;
}
export function pair(a:string,b:string){return a<b?{userAId:a,userBId:b}:{userAId:b,userBId:a};}
export function expiresAt(ttl:number,now=new Date()){return ttl?new Date(now.getTime()+ttl*1000):null;}
export function liveWhere(now=new Date()):Prisma.MessageWhereInput{return {OR:[{expiresAt:null},{expiresAt:{gt:now}}]};}
export function invitationToken(value:unknown){if(typeof value!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(value)||Buffer.from(value,'base64url').toString('base64url')!==value)throw new InputError('This invitation is invalid.');return value;}
export async function tokenHash(token:string){return Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(token))).toString('hex');}
export function encryptedAttachment(value:unknown){const body=object(value);const size=body.size;if(typeof size!=='number'||!Number.isSafeInteger(size)||size<1||size>MAX_FILE_BYTES)throw new InputError('Choose a file of up to 10 MiB.');const ciphertext=base64(body.ciphertext,'encrypted file',undefined,MAX_FILE_BYTES+16);if(Buffer.from(ciphertext,'base64').length!==size+16)throw new InputError('Encrypted file size does not match its envelope.');return {recipientId:id(body.recipient_id),size,ciphertext,iv:base64(body.iv,'file IV',12)};}
export function clientMessageId(value:unknown){return value===undefined?undefined:id(value);}

interface Options {app:FastifyInstance;database:PrismaClient;io:Server;authenticate:(request:FastifyRequest)=>Promise<void>;erasingUsers:Set<string>;activeSends:Map<string,Set<Promise<void>>>;online:(id:string)=>boolean}
export function v2Services({app,database,io,authenticate,erasingUsers,activeSends,online}:Options){
 const room=(userId:string)=>`user:${userId}`;
 const peer=(user:{id:string;username:string;publicKeyJwk:string})=>({id:user.id,username:user.username,public_key:JSON.parse(user.publicKeyJwk),online:online(user.id)});
 async function blocked(a:string,b:string,tx:Db=database){return !!await tx.block.findFirst({where:{OR:[{blockerId:a,blockedId:b},{blockerId:b,blockedId:a}]},select:{id:true}});}
 async function accepted(a:string,b:string,tx:Db=database){if(a===b)throw new InputError('Choose another person.');if(await blocked(a,b,tx))throw new InputError('This conversation is blocked.');const contact=await tx.contact.findUnique({where:{userAId_userBId:pair(a,b)}});if(!contact||contact.status!=='accepted'){const err=new InputError('Accept the message request before sending messages.');err.statusCode=403;throw err;}return contact;}
 function ensureAvailable(...ids:string[]){if(ids.some(user=>erasingUsers.has(user)))throw new InputError('Account erasure is in progress.');}
 async function tracked<T>(participants:string[],fn:()=>Promise<T>):Promise<T>{ensureAvailable(...participants);let result:T;const task=(async()=>{result=await fn();})();for(const participant of new Set(participants)){const tasks=activeSends.get(participant)||new Set<Promise<void>>();tasks.add(task);activeSends.set(participant,tasks);}try{await task;return result!;}finally{for(const participant of participants){const tasks=activeSends.get(participant);tasks?.delete(task);if(!tasks?.size)activeSends.delete(participant);}}}
 function updated(a:string,b:string){io.to(room(a)).emit('contacts:updated');io.to(room(b)).emit('contacts:updated');}
 async function resolveUser(handle:string,tx:Db=database){return await tx.user.findUnique({where:{username:handle},select:{id:true,username:true,publicKeyJwk:true}})||await tx.alias.findUnique({where:{username:handle},select:{user:{select:{id:true,username:true,publicKeyJwk:true}}}}).then(alias=>alias?.user||null);}
 async function sendEncrypted(senderId:string,data:{recipient_id:string;ciphertext:string;iv:string;client_message_id?:string;attachment_id?:string},onCreated?:(message:Prisma.MessageGetPayload<{}>)=>void){
  const recipientId=data.recipient_id;return tracked([senderId,recipientId],async()=>{
   const perform=()=>database.$transaction(async tx=>{
    const contact=senderId===recipientId?null:await accepted(senderId,recipientId,tx);
    if(data.client_message_id){const nonce=await tx.sendNonce.findUnique({where:{senderId_clientMessageId:{senderId,clientMessageId:data.client_message_id}},include:{message:true}});if(nonce){if(nonce.recipientId!==recipientId)throw new InputError('That delivery identifier belongs to another conversation.');const existing=nonce.message;if(!existing||existing.expiresAt&&existing.expiresAt.getTime()<=Date.now())throw new InputError('This message expired and cannot be resent.');if(existing.ciphertext!==data.ciphertext||existing.iv!==data.iv)throw new InputError('A delivery identifier cannot be reused for different encrypted content.');return {message:existing,replayed:true};}}
    const message=await tx.message.create({data:{senderId,recipientId,clientMessageId:data.client_message_id,ciphertext:data.ciphertext,iv:data.iv,expiresAt:expiresAt(contact?.ttlSeconds||0),deliveredAt:senderId!==recipientId&&online(recipientId)?new Date():null}});
    if(data.attachment_id){const attached=await tx.attachment.updateMany({where:{id:data.attachment_id,ownerId:senderId,recipientId,messageId:null,orphanExpiresAt:{gt:new Date()}},data:{messageId:message.id,orphanExpiresAt:null,expiresAt:message.expiresAt}});if(attached.count!==1)throw new InputError("This encrypted file is unavailable, expired, or already attached.");}
    if(data.client_message_id)await tx.sendNonce.create({data:{senderId,recipientId,clientMessageId:data.client_message_id,messageId:message.id}});
    return {message,replayed:false};
   });
   let result;try{result=await perform();}catch(error){if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2002'&&data.client_message_id)result=await perform();else throw error;}if(!result.replayed&&!erasingUsers.has(senderId)&&!erasingUsers.has(recipientId))onCreated?.(result.message);return result;
  });
 }
 app.get('/api/invitations',{preHandler:authenticate},async request=>({invitations:(await database.invitation.findMany({where:{creatorId:request.principal.sub},orderBy:{createdAt:'desc'},take:50,select:{id:true,expiresAt:true,usedAt:true,revokedAt:true}})).map(x=>({id:x.id,expires_at:x.expiresAt,used_at:x.usedAt,revoked_at:x.revokedAt}))}));
 app.post('/api/invitations',{preHandler:authenticate,config:{rateLimit:{max:20,timeWindow:'1 hour'}}},async(request,reply)=>{
  const userId=request.principal.sub;ensureAvailable(userId);const data=object(request.body);const ttl=ttlSeconds(data.expires_in??86400);if(!ttl)throw new InputError('Invitation must expire.');const token=Buffer.from(webcrypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  return tracked([userId],async()=>{const invite=await database.invitation.create({data:{creatorId:userId,tokenHash:await tokenHash(token),expiresAt:expiresAt(ttl)!}});return reply.code(201).send({id:invite.id,token,expires_at:invite.expiresAt});});
 });
 app.get('/api/invitations/:token',{config:{rateLimit:{max:30,timeWindow:'1 minute'}}},async(request,reply)=>{
  const token=invitationToken(object(request.params).token);const invite=await database.invitation.findUnique({where:{tokenHash:await tokenHash(token)},include:{creator:{select:{username:true,publicKeyJwk:true}}}});
  if(!invite||invite.usedAt||invite.revokedAt||invite.expiresAt.getTime()<=Date.now()||erasingUsers.has(invite.creatorId))return reply.code(410).send({error:'This invitation expired, was revoked, or has already been used.'});
  return {username:invite.creator.username,public_key:JSON.parse(invite.creator.publicKeyJwk),expires_at:invite.expiresAt};
 });
 app.post('/api/invitations/:token/accept',{preHandler:authenticate},async(request)=>{
  const userId=request.principal.sub;const hash=await tokenHash(invitationToken(object(request.params).token));const initial=await database.invitation.findUnique({where:{tokenHash:hash},select:{creatorId:true}});if(!initial)throw new InputError('This invitation is unavailable.');
  return tracked([userId,initial.creatorId],async()=>{const result=await database.$transaction(async tx=>{const invite=await tx.invitation.findUnique({where:{tokenHash:hash},include:{creator:{select:{id:true,username:true,publicKeyJwk:true}}}});if(!invite||invite.creatorId===userId||await blocked(userId,invite.creatorId,tx))throw new InputError('This invitation cannot be accepted.');const now=new Date();const consumed=await tx.invitation.updateMany({where:{id:invite.id,usedAt:null,revokedAt:null,expiresAt:{gt:now}},data:{usedAt:now,usedById:userId}});if(consumed.count!==1){const error=new InputError('This invitation has expired or was already used.');error.statusCode=410;throw error;}const pairIds=pair(userId,invite.creatorId);await tx.contact.upsert({where:{userAId_userBId:pairIds},create:{...pairIds,requestedById:invite.creatorId,status:'accepted'},update:{status:'accepted'}});return {peer:peer(invite.creator),accepted:true};},{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});updated(userId,initial.creatorId);return result;});
 });
 app.post('/api/invitations/:id/revoke',{preHandler:authenticate},async request=>{const result=await database.invitation.updateMany({where:{id:id(object(request.params).id),creatorId:request.principal.sub,usedAt:null},data:{revokedAt:new Date()}});if(!result.count)throw new InputError('No active invitation with that identifier.');return {ok:true};});
 // Exact authenticated lookup keeps discovery bounded to a known username or alias.
 // Results deliberately omit public keys and presence until a connection is made.
 app.get('/api/users/search',{preHandler:authenticate,config:{rateLimit:{max:20,timeWindow:'1 minute'}}},async request=>{
  const userId=request.principal.sub,other=await resolveUser(username(object(request.query).username));
  if(!other||erasingUsers.has(other.id)||await blocked(userId,other.id))return {users:[]};
  if(other.id===userId)return {users:[{id:other.id,username:other.username,relationship:'self'}]};
  const contact=await database.contact.findUnique({where:{userAId_userBId:pair(userId,other.id)},select:{status:true,requestedById:true}});
  if(contact?.status==='declined')return {users:[]};
  const relationship=contact?.status==='accepted'?'accepted':contact?.status==='pending'?(contact.requestedById===userId?'outgoing':'incoming'):'none';
  return {users:[{id:other.id,username:other.username,relationship}]};
 });
 app.get('/api/requests',{preHandler:authenticate},async request=>{
  const userId=request.principal.sub;const rows=await database.contact.findMany({where:{status:'pending',OR:[{userAId:userId},{userBId:userId}]},include:{userA:{select:{id:true,username:true,publicKeyJwk:true}},userB:{select:{id:true,username:true,publicKeyJwk:true}}},orderBy:{createdAt:'desc'}});
  const requests=[];for(const row of rows){const other=row.userAId===userId?row.userB:row.userA;if(!await blocked(userId,other.id))requests.push({id:row.id,direction:row.requestedById===userId?'outgoing':'incoming',peer:peer(other),status:row.status});}return {requests};
 });
 app.post('/api/contacts/request',{preHandler:authenticate,config:{rateLimit:{max:20,timeWindow:'1 hour'}}},async request=>{
  const userId=request.principal.sub;const other=await resolveUser(username(object(request.body).username));if(!other||other.id===userId)throw new InputError('Choose another registered username.');return tracked([userId,other.id],async()=>{if(await blocked(userId,other.id))throw new InputError('This conversation is unavailable.');const pairIds=pair(userId,other.id);const row=await database.contact.upsert({where:{userAId_userBId:pairIds},create:{...pairIds,requestedById:userId,status:'pending'},update:{}});if(row.status==='declined')throw new InputError('This request was declined. Ask the person to share an invitation.');updated(userId,other.id);return {request:{id:row.id,direction:row.requestedById===userId?'outgoing':'incoming',peer:peer(other),status:row.status},peer:peer(other),status:row.status};});
 });
 for(const action of ['accept','decline'] as const)app.post(`/api/requests/:id/${action}`,{preHandler:authenticate},async request=>{
  const userId=request.principal.sub;const record=await database.contact.findUnique({where:{id:id(object(request.params).id)},include:{userA:{select:{id:true,username:true,publicKeyJwk:true}},userB:{select:{id:true,username:true,publicKeyJwk:true}}}});if(!record||record.status!=='pending'||record.requestedById===userId||![record.userAId,record.userBId].includes(userId))throw new InputError('No incoming request with that identifier.');const other=record.userAId===userId?record.userB:record.userA;
  return tracked([userId,other.id],async()=>{if(await blocked(userId,other.id))throw new InputError('This conversation is blocked.');const changed=await database.contact.updateMany({where:{id:record.id,status:'pending',requestedById:{not:userId}},data:{status:action==='accept'?'accepted':'declined'}});if(!changed.count)throw new InputError('This request has already changed.');updated(userId,other.id);return {ok:true,peer:peer(other),status:action==='accept'?'accepted':'declined'};});
 });
 app.get('/api/blocks',{preHandler:authenticate},async request=>({blocks:(await database.block.findMany({where:{blockerId:request.principal.sub},include:{blocked:{select:{id:true,username:true,publicKeyJwk:true}}}})).map(row=>peer(row.blocked))}));
 for(const action of ['block','unblock'] as const)app.post(`/api/contacts/:peerId/${action}`,{preHandler:authenticate},async request=>{
  const userId=request.principal.sub,peerId=id(object(request.params).peerId);if(userId===peerId)throw new InputError('Choose another person.');
  return tracked([userId,peerId],async()=>{if(action==='block'){if(!await database.user.findUnique({where:{id:peerId},select:{id:true}}))throw new InputError('User not found.');await database.block.upsert({where:{blockerId_blockedId:{blockerId:userId,blockedId:peerId}},create:{blockerId:userId,blockedId:peerId},update:{}});}else await database.block.deleteMany({where:{blockerId:userId,blockedId:peerId}});updated(userId,peerId);return {ok:true};});
 });
 app.get('/api/conversations/:peerId/settings',{preHandler:authenticate},async request=>{const row=await accepted(request.principal.sub,id(object(request.params).peerId));return {ttl_seconds:row.ttlSeconds};});
 app.put('/api/conversations/:peerId/settings',{preHandler:authenticate},async request=>{
  const userId=request.principal.sub,peerId=id(object(request.params).peerId),ttl=ttlSeconds(object(request.body).ttl_seconds);return tracked([userId,peerId],async()=>{const row=await accepted(userId,peerId);await database.contact.update({where:{id:row.id},data:{ttlSeconds:ttl}});io.to(room(userId)).emit('conversation:settings',{peer_id:peerId,ttl_seconds:ttl,changed_by:userId});io.to(room(peerId)).emit('conversation:settings',{peer_id:userId,ttl_seconds:ttl,changed_by:userId});return {ttl_seconds:ttl};});
 });
 app.post('/api/attachments',{preHandler:authenticate,bodyLimit:15*1024*1024,config:{rateLimit:{max:30,timeWindow:'1 hour'}}},async(request,reply)=>{
  const data=encryptedAttachment(request.body),userId=request.principal.sub;return tracked([userId,data.recipientId],async()=>{const contact=await accepted(userId,data.recipientId);const attachment=await database.attachment.create({data:{ownerId:userId,...data,expiresAt:null,orphanExpiresAt:new Date(Date.now()+15*60*1000)}});return reply.code(201).send({attachment:{id:attachment.id,size:attachment.size,expiresAt:attachment.expiresAt}});});
 });
 app.get('/api/attachments/:id',{preHandler:authenticate},async(request,reply)=>{
  const userId=request.principal.sub;const file=await database.attachment.findUnique({where:{id:id(object(request.params).id)}});if(!file||![file.ownerId,file.recipientId].includes(userId)||file.expiresAt&&file.expiresAt.getTime()<=Date.now())return reply.code(404).send({error:'This encrypted file is unavailable or expired.'});if(file.orphanExpiresAt&&file.orphanExpiresAt.getTime()<=Date.now())return reply.code(404).send({error:'This upload expired before being sent.'});if(userId!==file.ownerId){if(!file.messageId)return reply.code(404).send({error:'This file has not been sent.'});await accepted(file.ownerId,file.recipientId);}return {ciphertext:file.ciphertext,iv:file.iv,size:file.size,expiresAt:file.expiresAt};
 });
 app.get('/api/aliases',{preHandler:authenticate},async request=>({aliases:(await database.alias.findMany({where:{userId:request.principal.sub},select:{username:true,createdAt:true}})).map(x=>({username:x.username,created_at:x.createdAt}))}));
 app.post('/api/aliases',{preHandler:authenticate,config:{rateLimit:{max:5,timeWindow:'1 hour'}}},async(request,reply)=>{
  const userId=request.principal.sub,handle=username(object(request.body).username);return tracked([userId],async()=>{const alias=await database.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${handle}))`;await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;if(await tx.alias.count({where:{userId}})>=3)throw new InputError('You can create up to three aliases.');if(await resolveUser(handle,tx))throw new InputError('That username is unavailable.');return tx.alias.create({data:{userId,username:handle},select:{username:true,createdAt:true}});});return reply.code(201).send({alias:{username:alias.username,created_at:alias.createdAt}});});
 });
 app.delete('/api/aliases/:username',{preHandler:authenticate},async request=>{await database.alias.deleteMany({where:{userId:request.principal.sub,username:username(object(request.params).username)}});return {ok:true};});
 async function cleanupExpired(){const now=new Date();const expired=await database.message.findMany({where:{expiresAt:{lte:now}},select:{id:true,senderId:true,recipientId:true},take:1000});if(expired.length){await database.message.deleteMany({where:{id:{in:expired.map(x=>x.id)},expiresAt:{lte:now}}});for(const row of expired){io.to(room(row.senderId)).emit('message:expired',{message_id:row.id});if(row.senderId!==row.recipientId)io.to(room(row.recipientId)).emit('message:expired',{message_id:row.id});}}await database.attachment.deleteMany({where:{OR:[{expiresAt:{lte:now}},{orphanExpiresAt:{lte:now}}]}});await database.invitation.deleteMany({where:{expiresAt:{lt:new Date(now.getTime()-7*86400000)}}});}
 const cleanupTimer=setInterval(()=>{void cleanupExpired().catch(()=>undefined);},30_000);cleanupTimer.unref();app.addHook('onClose',async()=>clearInterval(cleanupTimer));
 return {blocked,accepted,resolveUser,sendEncrypted,cleanupExpired,tracked,ensureAvailable};
}
