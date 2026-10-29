import test from 'node:test';
import assert from 'node:assert/strict';
import {AI_MAX_OUTPUT_TOKENS,AiProviderError,completionTokens,createAiProvider} from './ai-provider';

const env:NodeJS.ProcessEnv={NODE_ENV:'test',AI_PROVIDER:'ollama',OLLAMA_CLOUD_ENABLED:'true',OLLAMA_API_KEY:'synthetic-server-only-key',OLLAMA_MODEL:'synthetic-model:1b'};
const sse=(text:string)=>new Response(text,{headers:{'content-type':'text/event-stream; charset=utf-8'}});
async function collect(tokens:AsyncIterable<string>){let output='';for await(const token of tokens)output+=token;return output;}

test('cloud Ollama requires explicit activation, key and model and never guesses a free endpoint',async()=>{
 let calls=0;const fetcher=async()=>{calls++;throw new Error('must not reach provider')};
 for(const settings of [{},{OLLAMA_API_KEY:'synthetic'},{...env,OLLAMA_CLOUD_ENABLED:'false'},{...env,OLLAMA_MODEL:''},{...env,OLLAMA_API_KEY:''},{...env,OLLAMA_API_KEY:'accidental\nkey'}]){
  const provider=createAiProvider({NODE_ENV:'test',...settings},fetcher);assert.equal(provider.status().configured,false);assert.equal(provider.status().connected,false);assert.equal(JSON.stringify(provider.status()).includes('synthetic'),false);await assert.rejects(provider.open('A question',new AbortController().signal),(error:unknown)=>error instanceof AiProviderError&&error.statusCode===503);
 }
 assert.equal(calls,0);const legacy=createAiProvider({NODE_ENV:'test',BOT_API_KEY:'synthetic-key',BOT_MODEL:'synthetic-model',BOT_ZERO_RETENTION_CONFIRMED:'true'},fetcher);assert.equal(legacy.status().provider,'openai-compatible');assert.equal(legacy.status().configured,true);
 assert.equal(createAiProvider({...env,AI_PROVIDER:'ollama-local'},fetcher).status().configured,false,'an unsupported provider must not fall through to cloud');
});

test('explicit cloud requests keep credentials server-side and bound prompt/output parameters',async()=>{
 const requests:{url:string;options:RequestInit}[]=[];
 const provider=createAiProvider(env,async(input,options)=>{requests.push({url:String(input),options:options!});return sse('data: {"choices":[{"delta":{"content":"Hello "}}]}\n\ndata: {"choices":[{"delta":{"content":"there"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')});
 const session=await provider.open('Explain a synthetic fact',new AbortController().signal);assert.equal(await collect(session.tokens),'Hello there');session.release();await session.cancel();
 assert.equal(requests[0].url,'https://ollama.com/v1/chat/completions');assert.equal(requests[0].options.redirect,'error');assert.deepEqual(requests[0].options.headers,{Authorization:'Bearer synthetic-server-only-key','Content-Type':'application/json',Accept:'text/event-stream'});
 const body=JSON.parse(String(requests[0].options.body));assert.equal(body.max_tokens,AI_MAX_OUTPUT_TOKENS);assert.equal(body.store,false);assert.equal(body.stream,true);assert.equal(body.model,'synthetic-model:1b');assert.equal(body.messages[1].content,'Explain a synthetic fact');assert.equal(body.messages.length,2);
 assert.deepEqual(provider.status(),{provider:'ollama',mode:'cloud',configured:true,connected:true,model:'synthetic-model:1b'});assert.equal(JSON.stringify(provider.status()).includes(env.OLLAMA_API_KEY!),false);
});

test('provider errors are sanitized and quota errors cannot trigger retries or paid fallback',async()=>{
 for(const [upstreamStatus,status] of [[429,429],[402,429],[401,503],[403,503],[404,503],[500,502],[502,502]]){
  let calls=0;const provider=createAiProvider(env,async()=>{calls++;return new Response('private provider detail synthetic-server-only-key',{status:upstreamStatus})});
  await assert.rejects(provider.open('Synthetic question',new AbortController().signal),(error:unknown)=>{assert.ok(error instanceof AiProviderError);assert.equal(error.statusCode,status);assert.doesNotMatch(error.message,/private provider detail|synthetic-server-only-key/);return true});assert.equal(calls,1);assert.equal(provider.status().connected,false);
 }
 const html=createAiProvider(env,async()=>new Response('<html>sign-in gateway private detail</html>',{headers:{'content-type':'text/html'}}));await assert.rejects(html.open('Synthetic question',new AbortController().signal),/unexpected response/);
 const redirect=createAiProvider(env,async()=>{throw Error('redirect to secret-host?api_key=private')});await assert.rejects(redirect.open('Synthetic question',new AbortController().signal),(error:unknown)=>{assert.ok(error instanceof AiProviderError);assert.doesNotMatch(error.message,/secret-host|private/);return true});
});

test('provider concurrency is bounded and releasing a stream makes the next request available',async()=>{
 let calls=0;const provider=createAiProvider(env,async()=>{calls++;return sse('data: [DONE]\n\n')});const a=await provider.open('First',new AbortController().signal);
 await assert.rejects(provider.open('Second',new AbortController().signal),(error:unknown)=>error instanceof AiProviderError&&error.statusCode===429);assert.equal(calls,1);
 await collect(a.tokens);a.release();const b=await provider.open('Third',new AbortController().signal);await collect(b.tokens);b.release();assert.equal(calls,2);
});

test('SSE parsing handles split UTF-8, ignores metadata, and fails closed on errors or incomplete output',async()=>{
 const bytes=new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hello 🌍"}}]}\r\n\r\ndata: {"choices":[],"usage":{"tokens":2}}\n\ndata: [DONE]');
 const response=new Response(new ReadableStream({start(controller){for(const byte of bytes)controller.enqueue(new Uint8Array([byte]));controller.close()}}),{headers:{'content-type':'text/event-stream'}});
 assert.equal(await collect(completionTokens(response,new AbortController().signal)),'Hello 🌍');
 for(const payload of ['data: {"error":"private provider detail"}\n\n','data: not-json\n\n','data: {"choices":[{"delta":{"content":"truncated"}}]}\n\n','data: '+JSON.stringify({choices:[{delta:{content:'x'.repeat(40_000)}}]})+'\n\ndata: [DONE]\n\n','data: '+'x'.repeat(70_000)])await assert.rejects(collect(completionTokens(sse(payload),new AbortController().signal)),(error:unknown)=>{assert.ok(error instanceof AiProviderError);assert.doesNotMatch(error.message,/private provider detail/);return true});
 const abort=new AbortController();abort.abort();await assert.rejects(collect(completionTokens(sse('data: [DONE]\n\n'),abort.signal)),/abort|cancel/i);
});
