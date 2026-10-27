import { SESSION_COOKIE_NAME } from '../src/lib/compat';
import test from "node:test";
import assert from "node:assert/strict";

import { randomBytes } from "node:crypto";

import type { Socket } from "socket.io-client";

import { deriveKeysFromPassword, generateIdentityKeyPair, wrapPrivateKey, unwrapPrivateKey, deriveSharedSecret, encryptPayload, decryptPayload } from "../src/lib/crypto";

function waitForEvent(socket:Socket,event:string):Promise<any[]> {
  return new Promise((resolve,reject) => {
    const handle=(...values:any[]) => {clearTimeout(timer);resolve(values);};
    const timer=setTimeout(() => {socket.off(event,handle);reject(new Error(`Timed out waiting for ${event}.`));},5000);
    socket.once(event,handle);
  });
}

// Deliberately opt-in: this test creates and permanently erases test accounts.
// Point TEST_DATABASE_URL only at an isolated, migrated test database.
test("PostgreSQL encrypted history, recovered keys, session revocation and peer erasure", {skip:!process.env.TEST_DATABASE_URL,timeout:60_000}, async () => {
  const {PrismaClient} = await import("@prisma/client");
  const {buildServer} = await import("./index");
  const {io:connectSocket} = await import("socket.io-client");
  const database = new PrismaClient({datasources:{db:{url:process.env.TEST_DATABASE_URL}}});
  const origin = "http://localhost:3000";
  const {app,io} = await buildServer({...process.env,DATABASE_URL:process.env.TEST_DATABASE_URL,JWT_SECRET:randomBytes(48).toString("base64url"),CLIENT_ORIGIN:origin,NODE_ENV:"test"},database);
  const sockets:Socket[] = [];
  const userIds:string[] = [];
  try {
    await app.listen({port:0,host:"127.0.0.1"});
    const address=app.server.address();
    assert.ok(address && typeof address !== "string");
    const endpoint=`http://127.0.0.1:${address.port}`;
    const password="correct-horse-long-private-phrase";
    async function registerAccount() {
      const handle=`test_${randomBytes(6).toString("hex")}`;
      const keys=await deriveKeysFromPassword(password);
      const pair=await generateIdentityKeyPair();
      const wrapped=await wrapPrivateKey(pair.privateKey,keys.masterWrappingKey);
      const response=await app.inject({method:"POST",url:"/api/auth/register",headers:{origin},payload:{username:handle,auth_hash:keys.authHash,auth_salt:keys.authSalt,wrap_salt:keys.wrapSalt,wrap_iv:wrapped.iv,public_key:pair.publicKeyJwk,encrypted_private_key:wrapped.ciphertext}});
      assert.equal(response.statusCode,201,response.body);
      const body=response.json();
      userIds.push(body.user.id);
      const setCookie=response.headers["set-cookie"];
      const cookie=(Array.isArray(setCookie) ? setCookie[0] : setCookie)!.split(";")[0];
      assert.ok(cookie.includes(SESSION_COOKIE_NAME+'='));
      return {handle,keys,pair,wrapped,cookie,body};
    }
    async function socketFor(cookie:string) {
      const socket=connectSocket(endpoint,{transports:["websocket"],extraHeaders:{Origin:origin,Cookie:cookie},reconnection:false});
      sockets.push(socket);
      await waitForEvent(socket,"connect");
      return socket;
    }
    const alice=await registerAccount();
    const bob=await registerAccount();
    const request=await app.inject({method:"POST",url:"/api/contacts/request",headers:{origin,cookie:alice.cookie},payload:{username:bob.handle}});
    assert.equal(request.statusCode,200,request.body);
    const pendingId=request.json().request.id;
    const accept=await app.inject({method:"POST",url:`/api/requests/${pendingId}/accept`,headers:{origin,cookie:bob.cookie},payload:{}});
    assert.equal(accept.statusCode,200,accept.body);
    const aliceSocket=await socketFor(alice.cookie);
    const bobSocket=await socketFor(bob.cookie);
    const shared=await deriveSharedSecret(alice.pair.privateKey,bob.pair.publicKeyJwk);
    const invite=await app.inject({method:"POST",url:"/api/invitations",headers:{origin,cookie:alice.cookie},payload:{expires_in:3600}});
    assert.equal(invite.statusCode,201,invite.body);
    const invitePreview=await app.inject({method:"GET",url:`/api/invitations/${invite.json().token}`});
    assert.equal(invitePreview.statusCode,200,invitePreview.body);
    assert.equal(invitePreview.json().username,alice.handle);
    assert.ok(!JSON.stringify(await database.invitation.findMany({where:{creatorId:alice.body.user.id}})).includes(invite.json().token));
    const inviteAccept=await app.inject({method:"POST",url:`/api/invitations/${invite.json().token}/accept`,headers:{origin,cookie:bob.cookie},payload:{}});
    assert.equal(inviteAccept.statusCode,200,inviteAccept.body);
    const inviteReplay=await app.inject({method:"POST",url:`/api/invitations/${invite.json().token}/accept`,headers:{origin,cookie:bob.cookie},payload:{}});
    assert.equal(inviteReplay.statusCode,410,inviteReplay.body);
    const texts=["Hello","Hello","A private plan","Meet at the library","Encryption stays on the client"];
    for (const text of texts) {
      const payload=await encryptPayload({text,timestamp:Date.now(),type:"text"},shared);
      const ack=await aliceSocket.timeout(5000).emitWithAck("message:send",{recipient_id:bob.body.user.id,client_message_id:crypto.randomUUID(),...payload});
      assert.ok(ack.message?.id,JSON.stringify(ack));
    }
    const retryCipher=await encryptPayload({text:"Retry operation",timestamp:Date.now(),type:"text"},shared);
    const retryBody={recipient_id:bob.body.user.id,client_message_id:crypto.randomUUID(),...retryCipher};
    const firstAck=await aliceSocket.timeout(5000).emitWithAck("message:send",retryBody);
    const replayAck=await aliceSocket.timeout(5000).emitWithAck("message:send",retryBody);
    assert.equal(firstAck.message.id,replayAck.message.id);assert.equal(replayAck.replayed,true);
    const conflict=await aliceSocket.timeout(5000).emitWithAck("message:send",{...retryBody,...await encryptPayload({text:"Different"},shared)});
    assert.ok(conflict.error,"Nonce reuse must not replace ciphertext");
    await database.message.update({where:{id:firstAck.message.id},data:{expiresAt:new Date(Date.now()-1000)}});
    const expiredAck=await aliceSocket.timeout(5000).emitWithAck("message:send",retryBody);assert.ok(expiredAck.error);
    const expirySetting=await app.inject({method:"PUT",url:`/api/conversations/${bob.body.user.id}/settings`,headers:{origin,cookie:alice.cookie},payload:{ttl_seconds:3600}});
    assert.equal(expirySetting.statusCode,200,expirySetting.body);
    const fileBody={recipient_id:bob.body.user.id,ciphertext:randomBytes(80).toString("base64"),iv:randomBytes(12).toString("base64"),size:64};
    const upload=await app.inject({method:"POST",url:"/api/attachments",headers:{origin,cookie:alice.cookie},payload:fileBody});
    assert.equal(upload.statusCode,201,upload.body);assert.equal(upload.json().attachment.expiresAt,null);
    const unbound=await app.inject({method:"GET",url:`/api/attachments/${upload.json().attachment.id}`,headers:{cookie:bob.cookie}});assert.equal(unbound.statusCode,404);
    const attachmentAck=await aliceSocket.timeout(5000).emitWithAck("message:send",{recipient_id:bob.body.user.id,client_message_id:crypto.randomUUID(),attachment_id:upload.json().attachment.id,...await encryptPayload({text:"encrypted attachment metadata"},shared)});
    assert.ok(attachmentAck.message.id);assert.ok(attachmentAck.message.expiresAt);
    const download=await app.inject({method:"GET",url:`/api/attachments/${upload.json().attachment.id}`,headers:{cookie:bob.cookie}});
    assert.equal(download.statusCode,200,download.body);assert.equal(download.json().ciphertext,fileBody.ciphertext);
    const block=await app.inject({method:"POST",url:`/api/contacts/${alice.body.user.id}/block`,headers:{origin,cookie:bob.cookie},payload:{}});
    assert.equal(block.statusCode,200,block.body);
    const blockedSend=await aliceSocket.timeout(5000).emitWithAck("message:send",{recipient_id:bob.body.user.id,...await encryptPayload({text:"blocked"},shared)});assert.ok(blockedSend.error);
    const blockedDownload=await app.inject({method:"GET",url:`/api/attachments/${upload.json().attachment.id}`,headers:{cookie:bob.cookie}});assert.equal(blockedDownload.statusCode,400);
    await app.inject({method:"POST",url:`/api/contacts/${alice.body.user.id}/unblock`,headers:{origin,cookie:bob.cookie},payload:{}});
    await database.message.delete({where:{id:attachmentAck.message.id}});
    assert.equal(await database.attachment.count({where:{id:upload.json().attachment.id}}),0,"Deleting the envelope cascades its encrypted attachment");
    await database.message.delete({where:{id:firstAck.message.id}});
    const deletedReplay=await aliceSocket.timeout(5000).emitWithAck("message:send",retryBody);assert.ok(deletedReplay.error,"TTL deletion must retain a replay tombstone");
    for (const text of ["Private bot prompt one","Local encrypted bot answer one","Private bot prompt two","Local encrypted bot answer two"]) {
      const payload=await encryptPayload({text,timestamp:Date.now(),type:"text"},alice.keys.masterWrappingKey);
      const response=await app.inject({method:"POST",url:"/api/bot/history",headers:{origin,cookie:alice.cookie},payload});
      assert.equal(response.statusCode,201,response.body);
    }
    const rows=await database.message.findMany({where:{senderId:alice.body.user.id},orderBy:{createdAt:"asc"}});
    assert.equal(rows.length,9);
    assert.equal(new Set(rows.map((row)=>row.iv)).size,9);
    assert.notEqual(rows[0].ciphertext,rows[1].ciphertext);
    const serialized=JSON.stringify(rows);
    for (const plaintext of [...texts,"Private bot prompt one","Local encrypted bot answer two"]) assert.ok(!serialized.includes(plaintext));

    const forbidden=await app.inject({method:"POST",url:"/api/account/nuke",headers:{cookie:alice.cookie}});
    assert.equal(forbidden.statusCode,403,"Cookie alone must not bypass Origin CSRF protection");
    const logout=await app.inject({method:"POST",url:"/api/auth/logout",headers:{origin,cookie:alice.cookie}});
    assert.equal(logout.statusCode,200);
    const revoked=await app.inject({method:"GET",url:"/api/conversations",headers:{cookie:alice.cookie}});
    assert.equal(revoked.statusCode,401);
    const salts=await app.inject({method:"GET",url:`/api/auth/salts?username=${alice.handle}`});
    const recovered=await deriveKeysFromPassword(password,salts.json().auth_salt,salts.json().wrap_salt);
    const login=await app.inject({method:"POST",url:"/api/auth/login",headers:{origin},payload:{username:alice.handle,auth_hash:recovered.authHash}});
    assert.equal(login.statusCode,200,login.body);
    const identity=login.json();
    const privateKey=await unwrapPrivateKey(identity.encrypted_private_key,identity.wrap_iv,recovered.masterWrappingKey);
    assert.equal(privateKey.extractable,false);
    const recoveredShared=await deriveSharedSecret(privateKey,bob.pair.publicKeyJwk);
    assert.equal((await decryptPayload<{text:string}>(rows[0].ciphertext,rows[0].iv,recoveredShared)).text,"Hello");
    const newSetCookie=login.headers["set-cookie"];
    const freshCookie=(Array.isArray(newSetCookie) ? newSetCookie[0] : newSetCookie)!.split(";")[0];
    const history=await app.inject({method:"GET",url:`/api/messages/${bob.body.user.id}`,headers:{cookie:freshCookie}});
    assert.equal(history.json().messages.length,5);
    // Force a timestamp tie across a page boundary. A timestamp-only cursor
    // would silently skip three of these five encrypted messages.
    await database.message.updateMany({where:{senderId:alice.body.user.id,recipientId:bob.body.user.id},data:{createdAt:new Date("2026-10-25T10:00:00.000Z")}});
    const seenIds:string[]=[];
    let nextCursor:string|null=null;
    for (let page=0;page<10;page++) {
      const response:{statusCode:number;body:string;json:()=>{messages:Array<{id:string}>;next_cursor:string|null}}=await app.inject({method:"GET",url:`/api/messages/${bob.body.user.id}?limit=2${nextCursor ? `&cursor=${encodeURIComponent(nextCursor)}` : ""}`,headers:{cookie:freshCookie}});
      assert.equal(response.statusCode,200,response.body);
      const batch:{messages:Array<{id:string}>;next_cursor:string|null}=response.json();
      seenIds.push(...batch.messages.map((message:{id:string})=>message.id));
      nextCursor=batch.next_cursor;
      if (!nextCursor) break;
    }
    assert.equal(nextCursor,null,"Pagination should terminate at the oldest page");
    assert.equal(seenIds.length,5,"Every message sharing the boundary timestamp must be returned");
    assert.equal(new Set(seenIds).size,5,"Composite cursors must not duplicate boundary rows");
    const mismatched=await app.inject({method:"POST",url:"/api/account/nuke",headers:{origin,cookie:freshCookie},payload:{expected_user_id:bob.body.user.id}});
    assert.equal(mismatched.statusCode,409,"A deletion retry must not target an identity changed by another tab");
    assert.equal(await database.user.count({where:{id:alice.body.user.id}}),1);
    const peerErased=waitForEvent(bobSocket,"peer:erased");
    const nuke=await app.inject({method:"POST",url:"/api/account/nuke",headers:{origin,cookie:freshCookie}});
    assert.equal(nuke.statusCode,200,nuke.body);
    const [erased]=await peerErased;
    assert.equal(erased.user_id,alice.body.user.id);
    assert.equal(await database.user.count({where:{id:alice.body.user.id}}),0);
    assert.equal(await database.message.count({where:{OR:[{senderId:alice.body.user.id},{recipientId:alice.body.user.id}]}}),0);
    assert.equal(await database.session.count({where:{userId:alice.body.user.id}}),0);
    assert.equal(await database.attachment.count({where:{OR:[{ownerId:alice.body.user.id},{recipientId:alice.body.user.id}]}}),0);
    assert.equal(await database.sendNonce.count({where:{OR:[{senderId:alice.body.user.id},{recipientId:alice.body.user.id}]}}),0);
    assert.equal(await database.invitation.count({where:{creatorId:alice.body.user.id}}),0);
  } finally {
    for (const socket of sockets) socket.disconnect();
    io.disconnectSockets(true);
    // Cleanup is constrained to the random account IDs created by this test.
    if (userIds.length) await database.user.deleteMany({where:{id:{in:userIds}}});
    await app.close();
  }
});






