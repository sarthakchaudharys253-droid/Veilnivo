import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveBackendConfig,backendConnectionError} from '../src/lib/backend-config';
import {api,ApiError,readApiResponse,streamBot,setExpectedAccountId} from '../src/lib/client';

test('backend selection distinguishes explicit same-origin live mode from the default demo',()=>{
 assert.deepEqual(resolveBackendConfig({}),{mode:'demo',enabled:false,apiUrl:'',socketUrl:'',error:null});
 assert.deepEqual(resolveBackendConfig({mode:'same-origin'}),{mode:'same-origin',enabled:true,apiUrl:'',socketUrl:'',error:null});
 assert.deepEqual(resolveBackendConfig({mode:'demo'}),{mode:'demo',enabled:false,apiUrl:'',socketUrl:'',error:null});
 const old=resolveBackendConfig({url:'https://api.example.com/'});assert.equal(old.mode,'remote');assert.equal(old.enabled,true);assert.equal(old.apiUrl,'https://api.example.com');assert.equal(old.error,null);
 assert.equal(resolveBackendConfig({mode:'remote',url:'http://127.0.0.1:3001'}).apiUrl,'http://127.0.0.1:3001');
});
test('invalid explicit configuration fails closed rather than silently selecting demo',()=>{
 for(const input of [{mode:'remote'},{mode:'unknown'},{mode:'same-origin',url:'https://api.example.com'},{mode:'demo',url:'https://api.example.com'}]){const c=resolveBackendConfig(input);assert.equal(c.enabled,true);assert.ok(c.error);assert.equal(backendConnectionError(c,'https://app.example.com'),c.error)}
});
test('remote API addresses accept origins only and reject embedded credentials without echoing them',()=>{
 const bad=['api.example.com','ftp://api.example.com','javascript:alert(1)','https://api.example.com/api','https://api.example.com/path/..','https://api.example.com/?token=secret','https://api.example.com/#fragment','https://api.example.com?','https://api.example.com#','https://api.example.com\\unexpected'];
 for(const url of bad){const c=resolveBackendConfig({url});assert.equal(c.enabled,true,url);assert.ok(c.error,url);assert.equal(c.mode,'remote')}
 const secret=resolveBackendConfig({url:'https://alice:my_secret_password@api.example.com'});assert.match(secret.error??'',/credentials|username or password/);assert.equal(secret.error!.includes('my_secret_password'),false);
 assert.equal(resolveBackendConfig({url:' https://api.example.com:443/ '}).apiUrl,'https://api.example.com');
 assert.equal(resolveBackendConfig({url:'http://[::1]:3001/'}).apiUrl,'http://[::1]:3001');
});
test('mixed-content requests are rejected while sibling origins remain supported without domain guessing',()=>{
 const http=resolveBackendConfig({url:'http://api.example.com'});assert.match(backendConnectionError(http,'https://app.example.com')??'',/HTTPS frontend cannot connect/);
 assert.equal(backendConnectionError(http,'http://app.example.com'),null);
 const https=resolveBackendConfig({url:'https://api.example.co.uk'});assert.equal(backendConnectionError(https,'https://app.example.co.uk'),null);assert.equal(backendConnectionError(https,'https://a.different.example'),null,'cookie/CORS topology is deployment responsibility, not an eTLD guess');
 assert.equal(backendConnectionError(resolveBackendConfig({mode:'same-origin'}),'https://app.example.com'),null);
});
test('API errors reject static HTML and malformed JSON and explain cookie/origin failures',async()=>{
 await assert.rejects(readApiResponse(new Response('<html>Sign in</html>',{headers:{'content-type':'text/html'}})),e=>e instanceof ApiError&&/web page instead of JSON/.test(e.message)&&/reverse proxy/.test(e.message));
 await assert.rejects(readApiResponse(new Response('{broken',{headers:{'content-type':'application/json'}})),/invalid JSON/);
 await assert.rejects(readApiResponse(new Response('[]',{headers:{'content-type':'application/json'}})),/invalid API response/);
 await assert.rejects(readApiResponse(new Response('{"error":"Sign in required"}',{status:401,headers:{'content-type':'application/json'}}),'/api/conversations'),/session cookies/);
 await assert.rejects(readApiResponse(new Response('{"error":"Origin rejected"}',{status:403,headers:{'content-type':'application/json'}})),/CLIENT_ORIGIN/);
 assert.deepEqual(await readApiResponse(new Response('{"ok":true}',{headers:{'content-type':'application/problem+json'}})),{ok:true});
 assert.equal(await readApiResponse(new Response(null,{status:204})),undefined);
});
test('backend network failures are readable and intentional aborts remain aborts',async()=>{
 const native=globalThis.fetch;try{globalThis.fetch=async()=>{throw new TypeError('fetch failed')};await assert.rejects(api('/api/health'),e=>e instanceof ApiError&&e.status===0&&/API address/.test(e.message)&&/share a site/.test(e.message));const cancellation=new DOMException('Cancelled','AbortError');globalThis.fetch=async()=>{throw cancellation};await assert.rejects(api('/api/health',{signal:AbortSignal.abort()}),e=>e===cancellation)}finally{globalThis.fetch=native}
});
test('assistant streaming rejects a wrong-host page and processes the final unterminated event',async()=>{
 const native=globalThis.fetch;try{globalThis.fetch=async()=>new Response('<html>Wrong host</html>',{headers:{'content-type':'text/html'}});await assert.rejects(streamBot('synthetic prompt',()=>undefined),/unexpected response/);globalThis.fetch=async()=>new Response('data: {"choices":[{"delta":{"content":"works"}}]}',{headers:{'content-type':'text/event-stream'}});const pieces:string[]=[];assert.equal(await streamBot('synthetic prompt',text=>pieces.push(text)),'works');assert.deepEqual(pieces,['works'])}finally{globalThis.fetch=native}
});

test('authenticated browser requests bind their intended account while sign-in stays unbound',async()=>{
 const native=globalThis.fetch;const seen:Array<{path:string;account:string|null}>=[];
 try{globalThis.fetch=async(input,options)=>{seen.push({path:String(input),account:new Headers(options?.headers).get('X-Veilnivo-Account')});return new Response('{"ok":true}',{headers:{'content-type':'application/json'}})};setExpectedAccountId('account-a');await api('/api/aliases',{method:'POST',body:'{}'});await api('/api/auth/logout',{method:'POST',body:'{}'});await api('/api/auth/login',{method:'POST',body:'{}'});assert.deepEqual(seen.map(x=>x.account),['account-a','account-a',null]);setExpectedAccountId(null);await api('/api/health');assert.equal(seen.at(-1)?.account,null)}finally{setExpectedAccountId(null);globalThis.fetch=native}
});


test('an explicit realtime origin enables ticket transport only with a live API configuration',()=>{
 const bridge=resolveBackendConfig({mode:'same-origin',socketUrl:'https://api.example.com/'});
 assert.deepEqual(bridge,{mode:'same-origin',enabled:true,apiUrl:'',socketUrl:'https://api.example.com',error:null});
 assert.equal(backendConnectionError(bridge,'https://app.netlify.app'),null);
 for(const input of [{mode:'demo',socketUrl:'https://api.example.com'},{socketUrl:'https://api.example.com'},{mode:'same-origin',socketUrl:'wss://api.example.com'},{mode:'same-origin',socketUrl:'https://api.example.com/socket.io'},{mode:'same-origin',socketUrl:'https://api.example.com?ticket=secret'}])assert.ok(resolveBackendConfig(input).error);
 const secret=resolveBackendConfig({mode:'same-origin',socketUrl:'https://name:private-password@api.example.com'});assert.ok(secret.error);assert.doesNotMatch(secret.error!,/private-password/);
 assert.match(backendConnectionError(resolveBackendConfig({mode:'same-origin',socketUrl:'http://127.0.0.1:3001'}),'https://app.example.com')??'',/HTTP realtime server/);
});
