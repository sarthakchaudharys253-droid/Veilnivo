/** Server-only provider configuration. Never import this module into browser code. */
export interface AiProviderStatus {provider:'ollama'|'openai-compatible'|'none';mode:'local'|'cloud';configured:boolean;connected:boolean;model?:string}
export interface AiProviderSession {tokens:AsyncIterable<string>;release:()=>void;cancel:()=>void|Promise<void>}
interface ProviderConfig {provider:AiProviderStatus['provider'];endpoint?:string;key?:string;model?:string;configured:boolean}
export class AiProviderError extends Error {
 constructor(message:string,public readonly statusCode:number,public readonly retryAfter?:number){super(message);this.name='AiProviderError'}
}
export const AI_MAX_PROMPT_CHARACTERS=32_000;
export const AI_MAX_OUTPUT_CHARACTERS=32_768;
export const AI_MAX_STREAM_BYTES=2*1024*1024;
export const AI_MAX_OUTPUT_TOKENS=2048;
const modelName=(value:string|undefined)=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value)?value:undefined;
const secret=(value:string|undefined)=>typeof value==='string'&&value.length>0&&value.length<=4096&&value.trim()===value&&!/[\r\n\x00]/.test(value)?value:undefined;
function config(env:NodeJS.ProcessEnv):ProviderConfig {
 const selection=env.AI_PROVIDER;
 if(selection!==undefined&&!['ollama','openai-compatible'].includes(selection))return{provider:'none',configured:false};
 const ollama=selection==='ollama'||selection===undefined&&(!!env.OLLAMA_API_KEY||!!env.OLLAMA_MODEL||env.OLLAMA_CLOUD_ENABLED!==undefined||!env.BOT_API_KEY);
 if(ollama){
  const key=secret(env.OLLAMA_API_KEY),model=modelName(env.OLLAMA_MODEL);
  // Ollama Cloud is currently metered. Require explicit operator activation;
  // a key alone must never opt an installation into provider usage charges.
  return{provider:'ollama',endpoint:'https://ollama.com/v1/chat/completions',key,model,configured:env.OLLAMA_CLOUD_ENABLED==='true'&&!!key&&!!model};
 }
 const key=secret(env.BOT_API_KEY),model=modelName(env.BOT_MODEL);let endpoint:string|undefined;
 try{const url=new URL(env.BOT_API_URL||'https://api.openai.com/v1/chat/completions');if(url.protocol==='https:'&&!url.username&&!url.password&&!url.search&&!url.hash)endpoint=url.href}catch{}
 return{provider:'openai-compatible',endpoint,key,model,configured:!!endpoint&&!!key&&!!model&&env.BOT_ZERO_RETENTION_CONFIRMED==='true'};
}
function publicStatus(value:ProviderConfig,connected:boolean):AiProviderStatus{return{provider:value.provider,mode:'cloud',configured:value.configured,connected,...(value.configured?{model:value.model}:{})}}
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);

/** Normalize upstream SSE into text only, with bounded frames and total output. */
export async function* completionTokens(response:Response,signal:AbortSignal):AsyncGenerator<string> {
 if(!response.body||!/^text\/event-stream(?:\s*;|$)/i.test(response.headers.get('content-type')||''))throw new AiProviderError('The AI provider returned an unexpected response. Please try again later.',502);
 const reader=response.body.getReader(),decoder=new TextDecoder();let pending='',bytes=0,characters=0,completed=false;
 function parse(line:string):string|undefined {
  if(!line.startsWith('data:'))return;
  const raw=line.slice(5).trim();if(!raw)return;
  if(raw==='[DONE]'){completed=true;return}
  let data:unknown;try{data=JSON.parse(raw)}catch{throw new AiProviderError('The AI response was interrupted. Please retry.',502)}
  if(!record(data)||data.error)throw new AiProviderError('The AI response was interrupted. Please retry.',502);
  if(!Array.isArray(data.choices))throw new AiProviderError('The AI provider returned an unexpected response. Please try again later.',502);
  if(!data.choices.length)return;
  const choice=data.choices[0];if(!record(choice))throw new AiProviderError('The AI response was interrupted. Please retry.',502);
  if(typeof choice.finish_reason==='string'&&choice.finish_reason)completed=true;
  const delta=record(choice.delta)?choice.delta:undefined,content=delta?.content;
  if(content==null)return;if(typeof content!=='string')throw new AiProviderError('The AI response was interrupted. Please retry.',502);
  characters+=content.length;if(characters>AI_MAX_OUTPUT_CHARACTERS)throw new AiProviderError('The AI response was too long. Please ask a shorter question.',502);
  return content;
 }
 try{
  while(true){
   if(signal.aborted)throw signal.reason??new DOMException('Cancelled.','AbortError');
   const chunk=await reader.read();if(chunk.done){pending+=decoder.decode();if(pending.trim()){const token=parse(pending);if(token)yield token}break}
   bytes+=chunk.value.byteLength;if(bytes>AI_MAX_STREAM_BYTES)throw new AiProviderError('The AI response exceeded its size limit. Please retry with a shorter question.',502);
   pending+=decoder.decode(chunk.value,{stream:true});const lines=pending.split('\n');pending=lines.pop()??'';
   if(pending.length>65_536)throw new AiProviderError('The AI response was interrupted. Please retry.',502);
   for(const line of lines){if(line.length>65_536)throw new AiProviderError('The AI response was interrupted. Please retry.',502);const token=parse(line.replace(/\r$/,''));if(token)yield token}
   if(completed)break;
  }
  if(!completed)throw new AiProviderError('The AI response ended before it was complete. Please retry.',502);
 }finally{try{await reader.cancel()}catch{}reader.releaseLock()}
}

export function createAiProvider(env:NodeJS.ProcessEnv,fetcher:typeof fetch=globalThis.fetch){
 const provider=config(env);let active=0,connected=false;
 return {
  status:()=>publicStatus(provider,connected),
  async open(prompt:string,signal:AbortSignal){
   if(!provider.configured)throw new AiProviderError(provider.provider==='ollama'?'Veil AI is inactive. Ollama Cloud has not been activated.':'The assistant provider is not configured.',503);
   if(typeof prompt!=='string'||!prompt.trim()||prompt.length>AI_MAX_PROMPT_CHARACTERS)throw new AiProviderError('Enter a question of up to 32,000 characters.',400);
   if(signal.aborted)throw signal.reason??new DOMException('Cancelled.','AbortError');
   if(active>=1)throw new AiProviderError('Veil AI is answering another request. Try again shortly.',429,2);
   active++;let released=false;const release=()=>{if(!released){released=true;active--}};
   try{
    const response=await fetcher(provider.endpoint!,{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${provider.key}`,'Content-Type':'application/json',Accept:'text/event-stream'},body:JSON.stringify({model:provider.model,stream:true,store:false,max_tokens:AI_MAX_OUTPUT_TOKENS,messages:[{role:'system',content:'You are Veil AI, a helpful general-purpose assistant. Answer questions directly and clearly. Do not claim that AI prompts are end-to-end encrypted.'},{role:'user',content:prompt}]}),signal});
    if(!response.ok){
     try{await response.body?.cancel()}catch{}
     if(response.status===429||response.status===402)throw new AiProviderError('The AI provider usage or rate limit has been reached. Try again later or ask the site owner to check its allowance.',429,30);
     if(response.status===401||response.status===403)throw new AiProviderError('Veil AI could not authenticate with its provider. Ask the site owner to check the server API key.',503);
     if(response.status===404)throw new AiProviderError('The configured AI model is unavailable. Ask the site owner to check its model setting.',503);
     throw new AiProviderError('The AI provider is temporarily unavailable. Please try again later.',502);
    }
    if(!response.body||!/^text\/event-stream(?:\s*;|$)/i.test(response.headers.get('content-type')||'')){try{await response.body?.cancel()}catch{}throw new AiProviderError('The AI provider returned an unexpected response. Please try again later.',502)}
    connected=true;
    return{tokens:completionTokens(response,signal),release,cancel:async()=>{try{await response.body?.cancel()}catch{}}};
   }catch(error){connected=false;release();if(signal.aborted||error instanceof AiProviderError)throw error;throw new AiProviderError('Veil AI could not reach its provider. Please try again later.',502)}
  },
 };
}
