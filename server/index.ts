import { authCapacity, AuthCapacityError } from './auth-capacity';
import { sessionDeadline, scheduleSessionExpiry } from './session-expiry';
import {RealtimeTicketStore, RealtimeTicketCapacityError, realtimeTicketsEnabled} from './realtime-tickets';
import { readServerConfig } from './config';
import { registerFrontend, validateFrontendDirectory } from './static';
import { registerLocalSourceDownload } from './source-download';
import { SESSION_COOKIE_NAME } from '../src/lib/compat';
import Fastify, { type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import { PrismaClient, Prisma } from "@prisma/client";
import argon2 from "argon2";
import { Server as SocketServer } from "socket.io";
import { webcrypto } from "node:crypto";
import { v2Services, clientMessageId, liveWhere } from "./v2";

import { InputError, base64, envelope, id, object, registration, username, encodeHistoryCursor, parseHistoryCursor } from "./validation";

interface Principal { sub: string; sid: string; expiresAt: number }
declare module "fastify" { interface FastifyRequest { principal: Principal } }
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const COOKIE = SESSION_COOKIE_NAME;
const publicSelect = {id:true, username:true, publicKeyJwk:true} as const;

export async function buildServer(env: NodeJS.ProcessEnv = process.env, database = new PrismaClient({log:[]})) {
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32 || env.JWT_SECRET.startsWith("replace-with")) throw new Error("Set a strong JWT_SECRET of at least 32 characters.");
  const config = readServerConfig(env);
  const realtimeTickets = realtimeTicketsEnabled(env.REALTIME_TICKETS) ? new RealtimeTicketStore() : null;
  const {origin, secure} = config;
  const frontendRoot = config.serveFrontend ? await validateFrontendDirectory(config.frontendDir) : undefined;
  const app = Fastify({logger:false, bodyLimit:192 * 1024, trustProxy:config.trustProxy});
  let shuttingDown = false;
  const io = new SocketServer(app.server, {
    cors:{origin, credentials:true, methods:["GET","POST","PUT","DELETE"]},
    maxHttpBufferSize:192 * 1024,
    allowRequest:(request, callback) => callback(null, request.headers.origin === origin),
    transports:["websocket"],
  });
  await app.register(cookie);
  await app.register(cors, {origin, credentials:true, methods:["GET","POST","PUT","DELETE"], allowedHeaders:["Content-Type","X-Veilnivo-Account"]});
  await app.register(jwt, {secret:env.JWT_SECRET, cookie:{cookieName:COOKIE,signed:false}});
  // The IP limiter is transient process memory and does not log request bodies.
  await app.register(rateLimit, {max:180,timeWindow:"1 minute"});
  app.decorateRequest("principal", null as unknown as Principal);
  app.addHook("onRequest", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    if (["POST","PUT","PATCH","DELETE"].includes(request.method) && request.headers.origin !== origin) {
      return reply.code(403).send({error:"Request origin rejected."});
    }
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AuthCapacityError || error instanceof RealtimeTicketCapacityError) return reply.code(429).header("Retry-After", "1").send({error:error.message});
    if (error instanceof InputError) return reply.code(error.statusCode).send({error:error.message});
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return reply.code(409).send({error:"That username is unavailable."});
    const status = typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : 500;
    return reply.code(status).send({error:status === 429 ? "Too many requests. Try again shortly." : status < 500 ? "Request rejected." : "Unable to complete this request."});
  });

  const erasingUsers = new Set<string>();
  let authorizationRevision = 0;
  const activeSends = new Map<string,Set<Promise<void>>>();
  const botRequests = new Map<string,Set<AbortController>>();
  const room = (userId:string) => `user:${userId}`;
  const online = (userId:string) => (io.sockets.adapter.rooms.get(room(userId))?.size || 0) > 0;
  async function verifySession(token:string):Promise<Principal> {
    const payload = app.jwt.verify<{sub:string;sid:string;exp?:number}>(token);
    if (!payload.sub || !payload.sid) throw new Error("No session");
    const session = await database.session.findUnique({where:{id:payload.sid}});
    if (!session || session.userId !== payload.sub || session.expiresAt.getTime() <= Date.now()) throw new Error("Session expired");
    return {sub:payload.sub,sid:payload.sid,expiresAt:sessionDeadline(session.expiresAt,payload.exp)};
  }
  async function authenticate(request:FastifyRequest) {
    try { request.principal = await verifySession(request.cookies[COOKIE] || ""); if (erasingUsers.has(request.principal.sub)) throw new Error("Account erasing"); }
    catch { const error = new InputError("Sign in to continue."); error.statusCode = 401; throw error; }
    const expected=request.headers["x-veilnivo-account"];
    if(expected!==undefined&&(typeof expected!=="string"||expected!==request.principal.sub)) {
      const error=new InputError("The active account changed. Lock this tab and sign in again.");error.statusCode=409;throw error;
    }
  }
  const identity = (user:{id:string; username:string; publicKeyJwk:string; encryptedPrivateKey:string; wrapIv:string}) => ({
    user:{id:user.id,username:user.username}, public_key:JSON.parse(user.publicKeyJwk),
    encrypted_private_key:user.encryptedPrivateKey, wrap_iv:user.wrapIv,
  });
  async function issueSession(userId:string, reply:any) {
    const session = await database.session.create({data:{userId,expiresAt:new Date(Date.now()+SESSION_SECONDS*1000)}});
    const token = app.jwt.sign({sub:userId,sid:session.id}, {expiresIn:SESSION_SECONDS});
    reply.setCookie(COOKIE,token,{httpOnly:true,secure,sameSite:"strict",path:"/",maxAge:SESSION_SECONDS});
  }
  if(realtimeTickets){
    const ticketCleanup=setInterval(()=>realtimeTickets.prune(),10_000);ticketCleanup.unref();
    app.addHook('onClose',async()=>{clearInterval(ticketCleanup);realtimeTickets.clear();});
    // Proxy egress addresses may be shared by unrelated accounts. Preserve an
    // ingress cap before session lookup, then limit the verified session itself.
    // A manual ingress check avoids the plugin's one-hook-per-request marker.
    const ticketIngress=app.createRateLimit({max:180,timeWindow:'1 minute'});
    app.post('/api/realtime/ticket',{
      config:{rateLimit:false},
      onRequest:async(request,reply)=>{
        const limit=await ticketIngress(request);
        if(!limit.isAllowed&&limit.isExceeded)return reply.code(429).header('Retry-After',limit.ttlInSeconds).send({error:'Too many realtime authorization requests. Try again shortly.'});
      },
      preHandler:[authenticate,app.rateLimit({max:20,timeWindow:'1 minute',keyGenerator:request=>request.principal.sid})],
    },async(request,reply)=>{
      const expected=id(object(request.body).expected_user_id);
      if(expected!==request.principal.sub)return reply.code(409).send({error:'The active account changed. Lock this tab and sign in again.'});
      return realtimeTickets.issue(request.principal);
    });
  }
  const v2=v2Services({app,database,io,authenticate,erasingUsers,activeSends,online});
  async function peerIds(userId:string) {
    const contacts=await database.contact.findMany({where:{status:"accepted",OR:[{userAId:userId},{userBId:userId}]},select:{userAId:true,userBId:true}});
    const peers=contacts.map(row=>row.userAId===userId?row.userBId:row.userAId);
    const visible=[];for(const peerId of peers)if(!await v2.blocked(userId,peerId))visible.push(peerId);return visible;
  }
  async function announcePresence(userId:string) {
    const peers=await peerIds(userId);
    const isOnline=online(userId);
    for (const peer of peers) io.to(room(peer)).emit("presence:update",{user_id:userId,online:isOnline});
  }

  app.get("/api/health", {config:{rateLimit:false}}, async () => ({ok:true, mode:"production", bot_configured:!!env.BOT_API_KEY && env.BOT_ZERO_RETENTION_CONFIRMED === "true"}));
  app.get("/api/ready", {config:{rateLimit:false}}, async (_request, reply) => {
    try {
      if (shuttingDown) throw new Error();
      await verifyDatabaseConnection(database);
      return {ok:true};
    } catch { return reply.code(503).send({ok:false, error:"Service is not ready."}); }
  });
  app.get("/api/auth/salts", {config:{rateLimit:{max:20,timeWindow:"1 minute"}}}, async (request,reply) => {
    const handle = username(object(request.query).username);
    const user = await database.user.findUnique({where:{username:handle},select:{authSalt:true,wrapSalt:true}});
    if (!user) return reply.code(404).send({error:"Account not found."});
    return {auth_salt:user.authSalt,wrap_salt:user.wrapSalt};
  });
  app.post("/api/auth/register", {config:{rateLimit:{max:5,timeWindow:"15 minutes"}}}, async (request,reply) => {
    const data = registration(request.body);
    await webcrypto.subtle.importKey("jwk", data.public_key, {name:"ECDH",namedCurve:"P-256"},false,[]).catch(() => {throw new InputError("Invalid public identity key.");});
    const digest = await authCapacity.run(()=>argon2.hash(data.auth_hash,{type:argon2.argon2id,memoryCost:65536,timeCost:3,parallelism:1}));
    const user = await database.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${data.username}))`;
      if(await v2.resolveUser(data.username,tx))throw new InputError("That username is unavailable.");
      return tx.user.create({data:{username:data.username,authHashDigest:digest,authSalt:data.auth_salt,wrapSalt:data.wrap_salt,wrapIv:data.wrap_iv,publicKeyJwk:JSON.stringify(data.public_key),encryptedPrivateKey:data.encrypted_private_key}});
    });
    await issueSession(user.id,reply);
    return reply.code(201).send(identity(user));
  });
  app.post("/api/auth/login", {config:{rateLimit:{max:10,timeWindow:"15 minutes"}}}, async (request,reply) => {
    const data = object(request.body);
    const handle = username(data.username);
    const proof = base64(data.auth_hash,"authentication proof",32);
    const user = await database.user.findUnique({where:{username:handle}});
    if (!user || !await authCapacity.run(()=>argon2.verify(user.authHashDigest,proof))) return reply.code(401).send({error:"Username or password is incorrect."});
    await issueSession(user.id,reply);
    return identity(user);
  });
  app.post("/api/auth/logout", {preHandler:authenticate}, async (request,reply) => {
    await database.session.deleteMany({where:{id:request.principal.sid,userId:request.principal.sub}});
    authorizationRevision++;
    realtimeTickets?.revokeSession(request.principal.sid);
    for (const socket of io.sockets.sockets.values()) if (socket.data.principal?.sid === request.principal.sid) socket.disconnect(true);
    reply.clearCookie(COOKIE,{path:"/",secure,sameSite:"strict",httpOnly:true});
    return {ok:true};
  });
  app.get("/api/users/:username/key", {preHandler:authenticate}, async (request,reply) => {
    const handle = username(object(request.params).username);
    const user = await v2.resolveUser(handle);
    if (!user) return reply.code(404).send({error:"No user with that exact username."});
    return {id:user.id,username:user.username,public_key:JSON.parse(user.publicKeyJwk),online:!await v2.blocked(request.principal.sub,user.id)&&online(user.id)};
  });
  app.get("/api/conversations", {preHandler:authenticate}, async (request) => {
    const userId=request.principal.sub;
    const rows=await database.contact.findMany({where:{status:"accepted",OR:[{userAId:userId},{userBId:userId}]},include:{userA:{select:publicSelect},userB:{select:publicSelect}}});
    const conversations=await Promise.all(rows.map(async row=>{
      const user=row.userAId===userId?row.userB:row.userA;
      const blocked=await v2.blocked(userId,user.id);
      return {id:user.id,username:user.username,public_key:JSON.parse(user.publicKeyJwk),online:!blocked&&online(user.id),blocked,ttl_seconds:row.ttlSeconds,last_message:await database.message.findFirst({where:{AND:[{OR:[{senderId:userId,recipientId:user.id},{senderId:user.id,recipientId:userId}]},liveWhere()]},orderBy:[{createdAt:"desc"},{id:"desc"}]})};
    }));
    conversations.sort((a,b)=>(b.last_message?.createdAt.getTime()||0)-(a.last_message?.createdAt.getTime()||0));return {conversations};
  });
  app.get("/api/messages/:peerId", {preHandler:authenticate}, async (request) => {
    const userId = request.principal.sub;
    const peer = id(object(request.params).peerId);
    if(peer!==userId)await v2.accepted(userId,peer);
    const query = object(request.query);
    const limit = Math.min(500,Math.max(1,Math.floor(Number(query.limit)) || 200));
    if (query.before !== undefined) throw new InputError("Use the composite history cursor.");
    const cursor=parseHistoryCursor(query.cursor);
    const where:Prisma.MessageWhereInput={AND:[
      liveWhere(),
      {OR:[{senderId:userId,recipientId:peer},{senderId:peer,recipientId:userId}]},
      ...(cursor ? [{OR:[{createdAt:{lt:cursor.createdAt}},{createdAt:cursor.createdAt,id:{lt:cursor.id}}]}] : []),
    ]};
    const page=await database.message.findMany({where,orderBy:[{createdAt:"desc"},{id:"desc"}],take:limit+1});
    const messages=page.slice(0,limit);
    const next_cursor=page.length > limit ? encodeHistoryCursor(messages[messages.length-1]) : null;
    const delivered = messages.filter((m) => m.recipientId === userId && !m.deliveredAt);
    if (delivered.length) {
      const now = new Date();
      await database.message.updateMany({where:{id:{in:delivered.map((m) => m.id)},recipientId:userId,deliveredAt:null},data:{deliveredAt:now}});
      for (const message of delivered) { message.deliveredAt = now; io.to(room(message.senderId)).emit("message:receipt",{message_id:message.id,status:"delivered",at:now.toISOString()}); }
    }
    return {messages:messages.reverse(),next_cursor};
  });

  app.post("/api/bot/history", {preHandler:authenticate}, async (request,reply) => {
    const body=object(request.body);const data=envelope({...body,recipient_id:request.principal.sub});
    const result=await v2.sendEncrypted(request.principal.sub,{...data,client_message_id:clientMessageId(body.client_message_id)});
    return reply.code(result.replayed?200:201).send(result);
  });
  app.post("/api/bot/completion", {preHandler:authenticate,config:{rateLimit:{max:20,timeWindow:"1 minute"}}}, async (request,reply) => {
    if (!env.BOT_API_KEY || !env.BOT_MODEL || env.BOT_ZERO_RETENTION_CONFIRMED !== "true") return reply.code(503).send({error:"The assistant is not configured with a verified zero-retention provider."});
    const data = object(request.body);
    if (typeof data.prompt !== "string" || !data.prompt.trim() || data.prompt.length > 32_000) throw new InputError("Enter a prompt of up to 32,000 characters.");
    const endpoint = new URL(env.BOT_API_URL || "https://api.openai.com/v1/chat/completions");
    if (endpoint.protocol !== "https:") return reply.code(503).send({error:"The assistant provider must use HTTPS."});
    if (erasingUsers.has(request.principal.sub)) return reply.code(409).send({error:"Account erasure is in progress."});
    const abort = new AbortController();
    const requests = botRequests.get(request.principal.sub) || new Set<AbortController>();
    requests.add(abort);
    botRequests.set(request.principal.sub,requests);
    const timer = setTimeout(() => abort.abort(),60_000);
    request.raw.on("aborted",() => abort.abort());
    try {
      // Prompt exists only in this request and the provider call. Never log or persist it.
      const upstream = await fetch(endpoint,{method:"POST",headers:{Authorization:`Bearer ${env.BOT_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({model:env.BOT_MODEL,stream:true,store:false,messages:[{role:"system",content:"You are Veilnivo's concise, helpful privacy assistant. Never claim that a provider is end-to-end encrypted or that erasure removes recipient screenshots."},{role:"user",content:data.prompt}]}),signal:abort.signal});
      if (!upstream.ok || !upstream.body) return reply.code(502).send({error:"The assistant provider is unavailable."});
      reply.hijack();
      reply.raw.writeHead(200,{"Content-Type":"text/event-stream; charset=utf-8","Cache-Control":"no-store","X-Accel-Buffering":"no","Access-Control-Allow-Origin":origin,"Access-Control-Allow-Credentials":"true"});
      const reader = upstream.body.getReader();
      reply.raw.on("close",() => {abort.abort(); void reader.cancel().catch(() => undefined);});
      try {
        while (true) {
          const {done,value} = await reader.read();
          if (done) break;
          if (!reply.raw.write(Buffer.from(value))) await new Promise<void>((resolve) => reply.raw.once("drain",resolve));
        }
      } catch { /* Connection cancellation never logs prompts or response fragments. */ }
      finally { reader.releaseLock(); reply.raw.end(); }
    } catch { if (!reply.raw.headersSent) return reply.code(502).send({error:"The assistant provider is unavailable."}); }
    finally { clearTimeout(timer); requests.delete(abort); if (!requests.size) botRequests.delete(request.principal.sub); }
  });

  app.post("/api/account/nuke", {preHandler:authenticate}, async (request,reply) => {
    const userId = request.principal.sub;
    const data=request.body === undefined ? {} : object(request.body);
    if (data.expected_user_id !== undefined && id(data.expected_user_id) !== userId) {
      return reply.code(409).send({error:"The active account changed. Server erasure was not performed."});
    }
    if (erasingUsers.has(userId)) return reply.code(409).send({error:"Account erasure is already in progress."});
    erasingUsers.add(userId);
    authorizationRevision++;
    realtimeTickets?.revokeUser(userId);
    for (const controller of botRequests.get(userId) || []) controller.abort();
    try {
    await Promise.allSettled([...(activeSends.get(userId) || [])]);
    let partners:string[] = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        partners = await database.$transaction(async (tx) => {
          const records = await tx.message.findMany({where:{OR:[{senderId:userId},{recipientId:userId}]},select:{senderId:true,recipientId:true},distinct:["senderId","recipientId"]});
          const contacts=await tx.contact.findMany({where:{OR:[{userAId:userId},{userBId:userId}]},select:{userAId:true,userBId:true}});
          const peers=[...new Set([...records.flatMap(m=>[m.senderId,m.recipientId]),...contacts.flatMap(c=>[c.userAId,c.userBId])].filter(peer=>peer!==userId))];
          await tx.attachment.deleteMany({where:{OR:[{ownerId:userId},{recipientId:userId}]}});
          await tx.message.deleteMany({where:{OR:[{senderId:userId},{recipientId:userId}]}});
          await tx.session.deleteMany({where:{userId}});
          await tx.user.delete({where:{id:userId}});
          return peers;
        },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
        break;
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2034" || attempt === 2) throw error;
      }
    }
    for (const peer of partners) io.to(room(peer)).emit("peer:erased",{user_id:userId});
    io.to(room(userId)).emit("account:erased",{user_id:userId});
    io.in(room(userId)).disconnectSockets(true);
    reply.clearCookie(COOKIE,{path:"/",secure,sameSite:"strict",httpOnly:true});
    return {ok:true,erased:true};
    } finally { authorizationRevision++;erasingUsers.delete(userId); activeSends.delete(userId); botRequests.delete(userId); }
  });

  io.use(async (socket,next) => {
    try {
      const revision=authorizationRevision;
      let principal:Principal;
      if(Object.prototype.hasOwnProperty.call(socket.handshake.auth||{},'realtime_ticket')){
        // A supplied invalid ticket never falls back to an ambient cookie.
        if(!realtimeTickets)throw new Error('Realtime tickets are disabled.');
        const issued=realtimeTickets.consume(socket.handshake.auth.realtime_ticket);
        if(typeof socket.handshake.auth.expected_user_id!=='string'||socket.handshake.auth.expected_user_id!==issued.sub)throw new Error('Account changed.');
        const session=await database.session.findUnique({where:{id:issued.sid}});
        if(!session||session.userId!==issued.sub)throw new Error('Session revoked.');
        const expiresAt=Math.min(issued.expiresAt,session.expiresAt.getTime());
        if(!Number.isFinite(expiresAt)||expiresAt<=Date.now())throw new Error('Session expired.');
        principal={...issued,expiresAt};
      }else principal=await verifySession(app.parseCookie(socket.request.headers.cookie || "")[COOKIE] || "");
      // Do not let a delayed database snapshot join after a revocation's
      // disconnect sweep has already completed. A fresh attempt revalidates.
      if(revision!==authorizationRevision||erasingUsers.has(principal.sub))throw new Error('Authorization changed.');
      const expected=socket.handshake.auth?.expected_user_id;
      if(expected!==undefined&&(typeof expected!=="string"||expected!==principal.sub))throw new Error("Account changed.");
      socket.data.principal=principal;
      next();
    } catch { next(new Error("Sign in to connect.")); }
  });
  io.on("connection",(socket) => {
    const principal:Principal = socket.data.principal;
    const userId = principal.sub;
    const cancelExpiry=scheduleSessionExpiry(principal.expiresAt,()=>socket.disconnect(true));
    socket.once("disconnect",cancelExpiry);
    if(!socket.connected)return;
    void socket.join(room(userId));
    void announcePresence(userId).catch(() => undefined);
    let windowStart = Date.now();
    let count = 0;
    async function allowed() {
      if (Date.now()-windowStart > 60_000) {windowStart=Date.now();count=0;}
      if (++count > 120) throw new Error("Slow down and try again shortly.");
      const session = await database.session.findUnique({where:{id:principal.sid}});
      if (!session || session.userId !== userId || session.expiresAt.getTime() <= Date.now()) {socket.disconnect(true);throw new Error("Session expired.");}
    }
    socket.on("message:send",async (body:unknown,ack?: (value:unknown)=>void) => {
      try {
        await allowed();
        const data = envelope(body);
        if (data.recipient_id === userId) throw new InputError("Use encrypted bot history for your assistant.");
        if (!await database.user.findUnique({where:{id:data.recipient_id},select:{id:true}})) throw new InputError("That user no longer exists.");
        if (erasingUsers.has(userId) || erasingUsers.has(data.recipient_id)) throw new InputError("This account is being erased.");
        const transport=object(body);
        const result=await v2.sendEncrypted(userId,{...data,client_message_id:clientMessageId(transport.client_message_id),attachment_id:transport.attachment_id===undefined?undefined:id(transport.attachment_id)},message=>{io.to(room(data.recipient_id)).emit("message:receive",message);socket.to(room(userId)).emit("message:receive",message);});
        if(typeof ack==="function")ack(result);
      } catch (error) {if (typeof ack === "function") ack({error:error instanceof InputError ? error.message : "Unable to send this message. Reconnect and try again."});}
    });
    let lastTyping = 0;
    socket.on("typing:send",async (body:unknown) => {
      try {
        const data=object(body);
        const recipient=id(data.recipient_id);
        if (typeof data.typing !== "boolean") return;
        // Never drop a stop signal just because it follows a recent keystroke.
        if (data.typing && Date.now()-lastTyping < 400) return;
        if (data.typing) lastTyping=Date.now();
        await allowed();
        await v2.accepted(userId,recipient);
        // Authorization may finish after this tab or session disconnected.
        if (!socket.connected) return;
        io.to(room(recipient)).emit("typing:receive",{user_id:userId,typing:data.typing});
      } catch { /* No logs or persistent typing metadata. */ }
    });
    socket.on("message:read",async (body:unknown) => {
      try {
        await allowed();
        const messageId=id(object(body).message_id);
        const message=await database.message.findFirst({where:{id:messageId,recipientId:userId,readAt:null,AND:[liveWhere()]},select:{id:true,senderId:true}});
        if (!message) return;
        await v2.accepted(userId,message.senderId);
        const at=new Date();
        await database.message.updateMany({where:{id:message.id,recipientId:userId,readAt:null},data:{readAt:at,deliveredAt:at}});
        io.to(room(message.senderId)).emit("message:receipt",{message_id:message.id,status:"read",at:at.toISOString()});
      } catch { /* Invalid receipts do not affect message contents. */ }
    });
    socket.on("disconnect",() => {if (!online(userId)) void announcePresence(userId).catch(() => undefined);});
  });
  registerLocalSourceDownload(app, env, config);
  if (frontendRoot) await registerFrontend(app, frontendRoot);
  app.addHook("preClose",async () => {shuttingDown = true;for (const requests of botRequests.values()) for (const controller of requests) controller.abort();io.disconnectSockets(true);});
  app.addHook("onClose",async () => {await database.$disconnect();});
  return {app,io,database,config};
}

export async function verifyDatabaseConnection(database: Pick<PrismaClient, '$queryRaw'>) {
  await database.$queryRaw`SELECT 1`;
}

export async function startServer(env: NodeJS.ProcessEnv = process.env, database = new PrismaClient({log:[]})) {
  const server = await buildServer(env, database);
  try {
    await verifyDatabaseConnection(database);
    await server.app.listen({port:server.config.port, host:server.config.host});
    return server;
  } catch (error) {
    await server.app.close();
    throw error;
  }
}

if (process.argv[1] && /[\\/]server[\\/]index\.(?:ts|js)$/.test(process.argv[1])) {
  void startServer().then(({app,config}) => {
    process.stdout.write(`Veilnivo API ready on http://${config.host}:${config.port}\n`);
    let closing = false;
    const shutdown = () => {
      if (closing) return;
      closing = true;
      const timeout = setTimeout(() => process.exit(1), 30_000);
      timeout.unref();
      void app.close().then(() => {clearTimeout(timeout);process.exitCode=0;}, () => {clearTimeout(timeout);process.exitCode=1;});
    };
    for (const signal of ["SIGINT","SIGTERM"] as const) process.once(signal, shutdown);
  }).catch(() => {process.stderr.write("Veilnivo API could not start. Check database and server environment configuration.\n");process.exitCode=1;});
}
