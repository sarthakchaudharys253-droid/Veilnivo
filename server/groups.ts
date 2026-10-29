import type {FastifyInstance,FastifyRequest} from 'fastify';
import {Prisma,type PrismaClient} from '@prisma/client';
import type {Server} from 'socket.io';
import {InputError,base64,id,object,encodeHistoryCursor,parseHistoryCursor} from './validation';

type Db=PrismaClient|Prisma.TransactionClient;
type GroupWithCount=Prisma.GroupGetPayload<{include:{_count:{select:{members:true}}}}>;
interface Options {app:FastifyInstance;database:PrismaClient;io:Server;authenticate:(request:FastifyRequest)=>Promise<void>;erasingUsers:Set<string>;tracked:<T>(participants:string[],fn:()=>Promise<T>)=>Promise<T>;ensureAvailable:(...ids:string[])=>void}
function fail(message:string,status=400):never {const error=new InputError(message);error.statusCode=status;throw error}
export function groupName(value:unknown){if(typeof value!=='string')fail('Enter a group name.');const name=value.trim();if(!name||[...name].length>80||/[\u0000-\u001f\u007f-\u009f]/.test(name))fail('Use a group name of 1–80 characters without control characters.');return name}
export function groupVersion(value:unknown){if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1||value>=2147483647)fail('The group key version is invalid.');return value}
function memberIds(value:unknown){if(!Array.isArray(value))fail('Choose the people to add.');const ids=value.map(id);if(new Set(ids).size!==ids.length)fail('Choose each person only once.');return ids}
function envelopes(value:unknown){if(!Array.isArray(value))fail('Provide an encrypted key for every member.');const keys=value.map(entry=>{const data=object(entry),ciphertext=base64(data.ciphertext,'encrypted group key',undefined,4096);if(Buffer.from(ciphertext,'base64').length<17)fail('The encrypted group key is too short.');return{recipientId:id(data.recipient_id),ciphertext,iv:base64(data.iv,'group key IV',12)}});if(new Set(keys.map(key=>key.recipientId)).size!==keys.length)fail('Provide one encrypted key per member.');return keys}
function exactRecipients(keys:{recipientId:string}[],members:string[]){const expected=new Set(members);if(keys.length!==expected.size||keys.some(key=>!expected.has(key.recipientId)))fail('The encrypted key recipients do not match the current group members.',409)}
function pageLimit(query:Record<string,unknown>){if(query.limit===undefined)return 100;const n=Number(query.limit);if(!Number.isInteger(n)||n<1||n>100)fail('Choose a page size between 1 and 100.');return n}
function cursorId(value:unknown){return value===undefined?undefined:id(value)}
function summary(group:GroupWithCount){return{id:group.id,name:group.name,ownerId:group.ownerId,keyVersion:group.keyVersion,needsRekey:group.needsRekey,memberCount:group._count.members,createdAt:group.createdAt,updatedAt:group.updatedAt,lastMessageAt:group.lastMessageAt}}
function wire(message:Prisma.GroupMessageGetPayload<{include:{sender:{select:{username:true}}}}>){return{id:message.id,groupId:message.groupId,senderId:message.senderId,senderUsername:message.sender.username,clientMessageId:message.clientMessageId,keyVersion:message.keyVersion,ciphertext:message.ciphertext,iv:message.iv,createdAt:message.createdAt}}

export function groupServices({app,database,io,authenticate,erasingUsers,tracked,ensureAvailable}:Options){
 const room=(userId:string)=>`user:${userId}`;
 async function membership(groupId:string,userId:string,tx:Db=database){const member=await tx.groupMember.findUnique({where:{groupId_userId:{groupId,userId}}});if(!member)fail('This group is unavailable.',404);return member}
 async function participants(groupId:string){return(await database.groupMember.findMany({where:{groupId},select:{userId:true}})).map(row=>row.userId)}
 function updated(members:string[]){const rooms=[...new Set(members)].filter(userId=>!erasingUsers.has(userId)).map(room);if(rooms.length)io.to(rooms).emit('groups:updated')}
 async function acceptedMembers(ownerId:string,ids:string[],tx:Db){
  if(ids.includes(ownerId))fail('The group owner is included automatically.');
  if(!ids.length)return;
  const contacts=await tx.contact.findMany({where:{status:'accepted',OR:[{userAId:ownerId,userBId:{in:ids}},{userBId:ownerId,userAId:{in:ids}}]},select:{userAId:true,userBId:true}});
  const accepted=new Set(contacts.map(row=>row.userAId===ownerId?row.userBId:row.userAId));
  if(ids.some(userId=>!accepted.has(userId)))fail('Add people who have accepted your connection request.',403);
  const blocked=await tx.block.findFirst({where:{OR:[{blockerId:ownerId,blockedId:{in:ids}},{blockedId:ownerId,blockerId:{in:ids}}]},select:{id:true}});
  if(blocked)fail('A selected connection is blocked.',403);
 }
 async function lockGroup(tx:Prisma.TransactionClient,groupId:string,write:boolean){
  const rows=write?await tx.$queryRaw<Prisma.GroupGetPayload<{}>[]>`SELECT * FROM "Group" WHERE "id"=${groupId} FOR UPDATE`:await tx.$queryRaw<Prisma.GroupGetPayload<{}>[]>`SELECT * FROM "Group" WHERE "id"=${groupId} FOR SHARE`;
  if(!rows[0])fail('This group is unavailable.',404);return rows[0];
 }
 app.get('/api/groups',{preHandler:authenticate},async request=>{
  const userId=request.principal.sub,query=object(request.query),limit=pageLimit(query),cursor=cursorId(query.cursor);
  return tracked([userId],async()=>{const rows=await database.group.findMany({where:{members:{some:{userId}},...(cursor?{id:{gt:cursor}}:{})},include:{_count:{select:{members:true}}},orderBy:{id:'asc'},take:limit+1});ensureAvailable(userId);return{groups:rows.slice(0,limit).map(summary),next_cursor:rows.length>limit?rows[limit-1].id:null}});
 });
 app.post('/api/groups',{preHandler:authenticate,bodyLimit:8*1024*1024,config:{rateLimit:{max:20,timeWindow:'1 hour'}}},async(request,reply)=>{
  const userId=request.principal.sub,data=object(request.body),groupId=id(data.id),name=groupName(data.name),ids=memberIds(data.member_ids),keys=envelopes(data.envelopes);
  if(!ids.length)fail('Choose at least one other person.');const members=[userId,...ids];exactRecipients(keys,members);
  return tracked(members,async()=>{const group=await database.$transaction(async tx=>{ensureAvailable(...members);await acceptedMembers(userId,ids,tx);if(await tx.group.findUnique({where:{id:groupId},select:{id:true}}))fail('This group identifier is already in use.',409);const wrapper=await tx.user.findUniqueOrThrow({where:{id:userId},select:{publicKeyJwk:true}});await tx.group.create({data:{id:groupId,name,ownerId:userId}});await tx.groupMember.createMany({data:members.map(memberId=>({groupId,userId:memberId,joinedVersion:1}))});await tx.groupKeyEnvelope.createMany({data:keys.map(key=>({groupId,userId:key.recipientId,keyVersion:1,wrappedById:userId,wrappedByPublicKeyJwk:wrapper.publicKeyJwk,ciphertext:key.ciphertext,iv:key.iv}))});const row=await tx.group.findUniqueOrThrow({where:{id:groupId},include:{_count:{select:{members:true}}}});ensureAvailable(...members);return row});if(!erasingUsers.has(userId))updated(members);return reply.code(201).send({group:summary(group)})});
 });
 app.get('/api/groups/:id/members',{preHandler:authenticate},async request=>{
  const userId=request.principal.sub,groupId=id(object(request.params).id),query=object(request.query),limit=pageLimit(query),cursor=cursorId(query.cursor);
  return tracked([userId],async()=>{const [group]=await database.$queryRaw<{ownerId:string;keyVersion:number}[]>`SELECT g."ownerId",g."keyVersion" FROM "GroupMember" AS m JOIN "Group" AS g ON g."id"=m."groupId" WHERE m."groupId"=${groupId} AND m."userId"=${userId}`;if(!group)fail('This group is unavailable.',404);const rows=await database.groupMember.findMany({where:{groupId,...(cursor?{userId:{gt:cursor}}:{})},include:{user:{select:{id:true,username:true,publicKeyJwk:true}}},orderBy:{userId:'asc'},take:limit+1});ensureAvailable(userId);return{members:rows.slice(0,limit).map(row=>({id:row.userId,username:row.user.username,public_key:JSON.parse(row.user.publicKeyJwk),role:row.userId===group.ownerId?'owner':'member',joinedVersion:row.joinedVersion})),key_version:group.keyVersion,next_cursor:rows.length>limit?rows[limit-1].userId:null}});
 });
 app.get('/api/groups/:id/keys',{preHandler:authenticate},async request=>{
  const userId=request.principal.sub,groupId=id(object(request.params).id),query=object(request.query),limit=pageLimit(query);let cursor:number|undefined;if(query.cursor!==undefined){cursor=Number(query.cursor);groupVersion(cursor)}
  return tracked([userId],async()=>{const member=await membership(groupId,userId);const rows=await database.groupKeyEnvelope.findMany({where:{groupId,userId,keyVersion:{gte:member.joinedVersion,...(cursor?{gt:cursor}:{})}},orderBy:{keyVersion:'asc'},take:limit+1});ensureAvailable(userId);return{keys:rows.slice(0,limit).map(row=>({key_version:row.keyVersion,wrapped_by:{id:row.wrappedById,public_key:JSON.parse(row.wrappedByPublicKeyJwk)},ciphertext:row.ciphertext,iv:row.iv})),next_cursor:rows.length>limit?String(rows[limit-1].keyVersion):null}});
 });
 app.post('/api/groups/:id/members',{preHandler:authenticate,bodyLimit:8*1024*1024,config:{rateLimit:{max:30,timeWindow:'1 hour'}}},async request=>{
  const userId=request.principal.sub,groupId=id(object(request.params).id),data=object(request.body),expected=groupVersion(data.expected_version),ids=memberIds(data.member_ids),keys=envelopes(data.envelopes);await membership(groupId,userId);const initial=await participants(groupId);
  return tracked([...new Set([userId,...initial,...ids])],async()=>{const result=await database.$transaction(async tx=>{const group=await lockGroup(tx,groupId,true);await membership(groupId,userId,tx);if(group.keyVersion!==expected)fail('The group changed. Refresh its members and try again.',409);if(ids.length&&group.ownerId!==userId||!ids.length&&!group.needsRekey)fail(ids.length?'Only the group owner can add people.':'This group does not need a key repair.',403);await acceptedMembers(userId,ids,tx);const current=(await tx.groupMember.findMany({where:{groupId},select:{userId:true}})).map(row=>row.userId),existingMembers=new Set(current);if(ids.some(memberId=>existingMembers.has(memberId)))fail('A selected person is already in this group.',409);const members=[...current,...ids];ensureAvailable(...members);exactRecipients(keys,members);const next=group.keyVersion+1;groupVersion(next);const wrapper=await tx.user.findUniqueOrThrow({where:{id:userId},select:{publicKeyJwk:true}});if(ids.length)await tx.groupMember.createMany({data:ids.map(memberId=>({groupId,userId:memberId,joinedVersion:next}))});await tx.groupKeyEnvelope.createMany({data:keys.map(key=>({groupId,userId:key.recipientId,keyVersion:next,wrappedById:userId,wrappedByPublicKeyJwk:wrapper.publicKeyJwk,ciphertext:key.ciphertext,iv:key.iv}))});const changed=await tx.group.update({where:{id:groupId},data:{keyVersion:next,needsRekey:false},include:{_count:{select:{members:true}}}});ensureAvailable(...members);return{group:changed,members}});if(!erasingUsers.has(userId))updated(result.members);return{group:summary(result.group)}});
 });
 app.get('/api/groups/:id/messages',{preHandler:authenticate},async request=>{
  const userId=request.principal.sub,groupId=id(object(request.params).id),query=object(request.query),limit=pageLimit(query),cursor=parseHistoryCursor(query.cursor);
  return tracked([userId],async()=>{const member=await membership(groupId,userId);const rows=await database.groupMessage.findMany({where:{groupId,keyVersion:{gte:member.joinedVersion},...(cursor?{OR:[{createdAt:{lt:cursor.createdAt}},{createdAt:cursor.createdAt,id:{lt:cursor.id}}]}:{})},include:{sender:{select:{username:true}}},orderBy:[{createdAt:'desc'},{id:'desc'}],take:limit+1});ensureAvailable(userId);return{messages:rows.slice(0,limit).reverse().map(wire),next_cursor:rows.length>limit?encodeHistoryCursor(rows[limit-1]):null}});
 });
 app.post('/api/groups/:id/messages',{preHandler:authenticate,config:{rateLimit:{max:90,timeWindow:'1 minute'}}},async(request,reply)=>{
  const userId=request.principal.sub,groupId=id(object(request.params).id),data=object(request.body),clientMessageId=id(data.client_message_id),version=groupVersion(data.key_version),ciphertext=base64(data.ciphertext,'group ciphertext',undefined,65536),iv=base64(data.iv,'group message IV',12);if(Buffer.from(ciphertext,'base64').length<17)fail('The group ciphertext is too short.');await membership(groupId,userId);const initial=await participants(groupId);
  return tracked([...new Set([userId,...initial])],async()=>{const result=await database.$transaction(async tx=>{const group=await lockGroup(tx,groupId,true);await membership(groupId,userId,tx);await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${clientMessageId}))`;const previous=await tx.groupMessage.findUnique({where:{senderId_clientMessageId:{senderId:userId,clientMessageId}},include:{sender:{select:{username:true}}}});if(previous){if(previous.groupId!==groupId||previous.keyVersion!==version||previous.ciphertext!==ciphertext||previous.iv!==iv)fail('A group delivery identifier cannot be reused for different content.',409);return{message:previous,replayed:true,members:[] as string[]}}if(await tx.groupMessage.findFirst({where:{OR:[{id:clientMessageId},{clientMessageId}]},select:{id:true}})||await tx.sendNonce.findFirst({where:{clientMessageId},select:{id:true}})||await tx.message.findFirst({where:{id:clientMessageId},select:{id:true}}))fail('This delivery identifier is unavailable.',409);if(group.needsRekey)fail('The group needs a fresh encryption key after a member left. Refresh the group and try again.',409);if(group.keyVersion!==version)fail('The group encryption key changed. Refresh the group and try again.',409);const members=(await tx.groupMember.findMany({where:{groupId},select:{userId:true}})).map(member=>member.userId);ensureAvailable(...members);const message=await tx.groupMessage.create({data:{groupId,senderId:userId,clientMessageId,keyVersion:version,ciphertext,iv},include:{sender:{select:{username:true}}}});await tx.group.update({where:{id:groupId},data:{lastMessageAt:message.createdAt}});ensureAvailable(...members);return{message,replayed:false,members}});const message=wire(result.message);if(!result.replayed&&!erasingUsers.has(userId)){const rooms=result.members.filter(member=>!erasingUsers.has(member)).map(room);if(rooms.length)io.to(rooms).emit('group:message',message)}return reply.code(result.replayed?200:201).send({message,replayed:result.replayed})});
 });
 // Called inside the same serializable account-erasure transaction. A removed
 // member's old shared key must never protect messages sent after their removal.
 async function prepareUserErasure(tx:Prisma.TransactionClient,userId:string){
  const groups=await tx.$queryRaw<{id:string;ownerId:string}[]>`SELECT g."id",g."ownerId" FROM "Group" AS g JOIN "GroupMember" AS m ON m."groupId"=g."id" WHERE m."userId"=${userId} ORDER BY g."id" FOR UPDATE OF g`;
  if(!groups.length)return [];
  const groupIds=groups.map(group=>group.id),members=await tx.groupMember.findMany({where:{groupId:{in:groupIds}},select:{userId:true}}),surviving=groups.filter(group=>group.ownerId!==userId).map(group=>group.id);
  if(surviving.length)await tx.group.updateMany({where:{id:{in:surviving}},data:{needsRekey:true}});
  return[...new Set(members.map(member=>member.userId).filter(member=>member!==userId))];
 }
 return{prepareUserErasure,updated};
}
