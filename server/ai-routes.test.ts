import test from 'node:test';
import assert from 'node:assert/strict';
import type {PrismaClient} from '@prisma/client';
import {buildServer} from './index';
import {SESSION_COOKIE_NAME} from '../src/lib/compat';

const origin='https://veilnivo.netlify.app',account='bf34994e-dee4-4f62-b0c9-4e39183c9673',sid='a59007e7-63e8-4af0-982c-c0b4a7b5095d';
async function fixture(enabled=false){
 const database={session:{findUnique:async()=>({id:sid,userId:account,expiresAt:new Date(Date.now()+60_000)})},$disconnect:async()=>{}} as unknown as PrismaClient;
 const env:NodeJS.ProcessEnv={NODE_ENV:'test',CLIENT_ORIGIN:origin,JWT_SECRET:'synthetic-ai-route-test-session-secret-over-32',AI_PROVIDER:'ollama',OLLAMA_CLOUD_ENABLED:String(enabled),OLLAMA_API_KEY:'synthetic-private-key',OLLAMA_MODEL:'synthetic-model:1b',BOT_API_KEY:'synthetic-legacy-key',BOT_MODEL:'synthetic-legacy-model',BOT_ZERO_RETENTION_CONFIRMED:'true'};
 const built=await buildServer(env,database),cookie=`${SESSION_COOKIE_NAME}=${built.app.jwt.sign({sub:account,sid},{expiresIn:60})}`,headers={origin,cookie,'x-veilnivo-account':account};
 return{...built,headers};
}

test('inactive Ollama status is authenticated and completion cannot contact either provider even with saved credentials',async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw new Error('must not contact a provider')});const f=await fixture();
 try{
  assert.equal((await f.app.inject('/api/bot/status')).statusCode,401);
  const wrong=await f.app.inject({url:'/api/bot/status',headers:{...f.headers,'x-veilnivo-account':'another-account'}});assert.equal(wrong.statusCode,409);
  const status=await f.app.inject({url:'/api/bot/status',headers:f.headers});assert.equal(status.statusCode,200);assert.deepEqual(status.json(),{provider:'ollama',mode:'cloud',configured:false,connected:false});assert.doesNotMatch(status.body,/synthetic-private|synthetic-legacy|api_key|endpoint/);
  const request=()=>f.app.inject({method:'POST',url:'/api/bot/completion',headers:f.headers,payload:{prompt:'A synthetic question'}});
  const response=await request();assert.equal(response.statusCode,503);assert.deepEqual(response.json(),{error:'Veil AI is inactive. Ollama Cloud has not been activated.'});assert.match(response.headers['content-type']||'',/application\/json/);assert.equal(calls,0);
  const invalid=await f.app.inject({method:'POST',url:'/api/bot/completion',headers:f.headers,payload:{prompt:'   '}});assert.equal(invalid.statusCode,400);assert.equal(calls,0);
  const wrongOrigin=await f.app.inject({method:'POST',url:'/api/bot/completion',headers:{...f.headers,origin:'https://untrusted.example'},payload:{prompt:'A question'}});assert.equal(wrongOrigin.statusCode,403);assert.equal(calls,0);
  assert.equal((await f.app.inject('/api/health')).json().bot_configured,false);
 }finally{await f.app.close()}
});

test('explicitly enabled mock provider streams canonical text and sanitized mid-stream errors',async t=>{
 let fail=false,calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response(fail?'data: {"choices":[{"delta":{"content":"Partial"}}]}\n\ndata: {"error":"private-provider-detail synthetic-private-key"}\n\n':'data: {"choices":[{"delta":{"content":"Synthetic answer"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}})});
 const f=await fixture(true);try{
  const ask=()=>f.app.inject({method:'POST',url:'/api/bot/completion',headers:f.headers,payload:{prompt:'A synthetic question'}});
  const complete=await ask();assert.equal(complete.statusCode,200);assert.match(complete.headers['content-type']||'',/text\/event-stream/);assert.equal(complete.body,'data: {"choices":[{"delta":{"content":"Synthetic answer"}}]}\n\ndata: [DONE]\n\n');
  fail=true;const interrupted=await ask();assert.equal(interrupted.statusCode,200);assert.match(interrupted.body,/"content":"Partial"/);assert.match(interrupted.body,/"error":"The AI response was interrupted\. Please retry\."/);assert.doesNotMatch(interrupted.body,/private-provider-detail|synthetic-private-key|\[DONE\]/);assert.equal(calls,2);
 }finally{await f.app.close()}
});
