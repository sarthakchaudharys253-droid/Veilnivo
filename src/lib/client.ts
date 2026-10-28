import {io,type Socket} from 'socket.io-client';
import {API_URL,SOCKET_URL,currentBackendConnectionError} from './backend-config';
export {API_URL,API_ENABLED,SOCKET_URL,currentBackendConnectionError} from './backend-config';
export interface ServerIdentity {user:{id:string;username:string};public_key:JsonWebKey|string;encrypted_private_key:string;wrap_iv:string}
export interface WireMessage {id:string;senderId:string;recipientId:string;ciphertext:string;iv:string;createdAt:string;clientMessageId?:string|null;expiresAt?:string|null;deliveredAt?:string|null;readAt?:string|null;revision?:number;deletedAt?:string|null}
export class ApiError extends Error {constructor(message:string,public readonly status:number){super(message);this.name='ApiError'}}
let expectedAccountId:string|null=null,accountRevision=0;
const closeTicketSockets=new Set<()=>void>();
export function setExpectedAccountId(id:string|null){if(id===expectedAccountId)return;expectedAccountId=id;accountRevision++;for(const close of [...closeTicketSockets])close();}
function accountHeaders(path:string):Record<string,string>{const publicAuth=['/api/auth/salts','/api/auth/login','/api/auth/register'].some(route=>path===route||path.startsWith(route+'?'));return expectedAccountId&&!publicAuth?{'X-Veilnivo-Account':expectedAccountId}:{}}
const addressHelp='Check the API address and reverse proxy. The backend CLIENT_ORIGIN must match this frontend, and both must share a site for session cookies.';
function ensureBackendConnection(){const error=currentBackendConnectionError();if(error)throw new ApiError(error,0)}
function endpoint(path:string){if(!path.startsWith('/api/')||path.startsWith('//')||/[\r\n\\]/.test(path))throw new ApiError('Invalid API route.',0);return`${API_URL}${path}`}
function aborted(error:unknown,signal?:AbortSignal|null){return!!signal?.aborted||error instanceof Error&&error.name==='AbortError'}
let backendReadyAt=0;
/** Wake a sleeping free service directly; the static host's proxy times out sooner. */
export async function wakeRealtimeBackend(signal?:AbortSignal|null):Promise<void>{
 if(signal?.aborted)throw signal.reason??new DOMException('Cancelled.','AbortError');
 if(!SOCKET_URL||Date.now()-backendReadyAt<5000)return;
 const deadline=Date.now()+90_000;
 while(Date.now()<deadline){
  if(signal?.aborted)throw signal.reason??new DOMException('Cancelled.','AbortError');
  try{
   const timeout=AbortSignal.timeout(Math.min(15_000,deadline-Date.now())),requestSignal=signal?AbortSignal.any([signal,timeout]):timeout;
   const response=await fetch(SOCKET_URL+'/api/ready',{method:'GET',credentials:'omit',cache:'no-store',signal:requestSignal});
   if(response.ok&&/\bapplication\/json\b/i.test(response.headers.get('content-type')??'')&&(await response.json()).ok===true){backendReadyAt=Date.now();return;}
  }catch(error){if(signal?.aborted)throw signal.reason??error;}
  const remaining=deadline-Date.now();if(remaining<=0)break;
  await new Promise<void>((resolve,reject)=>{const finish=()=>{signal?.removeEventListener('abort',cancel);resolve();},timer=setTimeout(finish,Math.min(4000,remaining)),cancel=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);reject(signal?.reason??new DOMException('Cancelled.','AbortError'));};signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();});
 }
 throw new ApiError('The backend is still waking up or unavailable. Render free services can take about a minute to start. Try signing in again shortly.',0);
}
async function backendFetch(path:string,options:RequestInit){
 ensureBackendConnection();
 if(SOCKET_URL&&['/api/auth/salts','/api/auth/login','/api/auth/register'].some(route=>path===route||path.startsWith(route+'?')))await wakeRealtimeBackend(options.signal);
 try{return await fetch(endpoint(path),options)}catch(error){if(aborted(error,options.signal))throw error;throw new ApiError(`The backend could not be reached. ${addressHelp}`,0)}
}
/** HTML from a static host or sign-in gateway must never masquerade as an API result. */
export async function readApiResponse<T>(response:Response,path='/api/'):Promise<T>{
 if(response.status===204&&response.ok)return undefined as T;
 const type=response.headers.get('content-type')?.toLowerCase()??'';
 if(!/\bapplication\/(?:[a-z0-9.+-]+\+)?json\b/.test(type))throw new ApiError(`The API address returned ${type.includes('html')?'a web page':'an unexpected response'} instead of JSON. ${addressHelp}`,response.status);
 let data:unknown;try{data=await response.json()}catch{throw new ApiError(`The backend returned invalid JSON. ${addressHelp}`,response.status)}
 if(!data||typeof data!=='object'||Array.isArray(data))throw new ApiError(`The backend returned an invalid API response. ${addressHelp}`,response.status);
 const object=data as Record<string,unknown>;
 if(!response.ok){const message=typeof object.message==='string'?object.message:typeof object.error==='string'?object.error:`Request failed (${response.status}).`;const hint=response.status===401&&!path.startsWith('/api/auth/')?' Sign in again. If you just signed in, check that the frontend and API share the same HTTPS site so session cookies are sent.':response.status===403?' Check that backend CLIENT_ORIGIN matches the frontend origin.':'';throw new ApiError(message+hint,response.status)}
 return data as T;
}
export async function api<T>(path:string,options:RequestInit={}):Promise<T>{const response=await backendFetch(path,{...options,credentials:'include',headers:{'Content-Type':'application/json',...options.headers,...accountHeaders(path)}});return readApiResponse<T>(response,path)}
export function identityJwk(value:JsonWebKey|string):JsonWebKey{return typeof value==='string'?JSON.parse(value) as JsonWebKey:value}
export interface RealtimeAuth {realtime_ticket:string;expected_user_id:string}
/** The one-use capability stays in memory and is never put in a URL or storage. */
export async function fetchRealtimeAuth(accountId:string,signal?:AbortSignal):Promise<RealtimeAuth>{
 const revision=accountRevision;
 if(!accountId||expectedAccountId!==accountId)throw new ApiError('Sign in before opening the realtime connection.',401);
 const value=await api<unknown>('/api/realtime/ticket',{method:'POST',body:JSON.stringify({expected_user_id:accountId}),signal});
 if(signal?.aborted)throw new DOMException('Realtime authorization cancelled.','AbortError');
 if(revision!==accountRevision||expectedAccountId!==accountId)throw new DOMException('The active account changed.','AbortError');
 const response=value as Record<string,unknown>,expires=typeof response?.expires_at==='string'?Date.parse(response.expires_at):NaN;
 if(typeof response?.ticket!=='string'||!/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(response.ticket)||!Number.isFinite(expires)||typeof response.expires_at!=='string'||new Date(expires).toISOString()!==response.expires_at||expires<=Date.now()||expires>Date.now()+45_000)throw new ApiError('The backend returned an invalid realtime authorization response.',502);
 return{realtime_ticket:response.ticket,expected_user_id:accountId};
}
export function openSocket():Socket{
 ensureBackendConnection();
 const options={withCredentials:!SOCKET_URL,transports:['websocket'],reconnection:true,reconnectionAttempts:Infinity,reconnectionDelay:1000,reconnectionDelayMax:10000,randomizationFactor:0.3,timeout:10000};
 if(!SOCKET_URL)return io(API_URL||undefined,{...options,auth:expectedAccountId?{expected_user_id:expectedAccountId}:{}});
 const accountId=expectedAccountId,revision=accountRevision;
 if(!accountId)throw new ApiError('Sign in before opening the realtime connection.',401);
 const connection=io(SOCKET_URL,{...options,autoConnect:false});
 let disposed=false,attempt=0,authRevision=0,retryTimer:ReturnType<typeof setTimeout>|undefined,pending:AbortController|undefined,lastAuthError:Error|undefined;
 const originalDisconnect=connection.disconnect.bind(connection);
 const current=()=>!disposed&&accountRevision===revision&&expectedAccountId===accountId;
 const close=()=>{if(disposed)return;disposed=true;clearTimeout(retryTimer);pending?.abort();closeTicketSockets.delete(close);originalDisconnect();};
 connection.disconnect=()=>{close();return connection;};
 closeTicketSockets.add(close);
 connection.auth=callback=>{
  pending?.abort();const request=new AbortController(),task=++authRevision,transport=connection.io.engine;pending=request;lastAuthError=undefined;
  void fetchRealtimeAuth(accountId,request.signal).then(auth=>{if(current()&&task===authRevision&&transport===connection.io.engine&&transport?.readyState==='open')callback(auth);}).catch(reason=>{
   if(!current()||request.signal.aborted||task!==authRevision)return;
   lastAuthError=reason instanceof Error?reason:new ApiError('Realtime authorization is unavailable. Retrying automatically.',0);
   // Explicit invalid capability: never fall back to a cross-site cookie.
   if(transport===connection.io.engine&&transport?.readyState==='open')callback({expected_user_id:accountId,realtime_ticket:''});
  });
 };
 connection.on('connect',()=>{attempt=0;lastAuthError=undefined;clearTimeout(retryTimer);retryTimer=undefined;});
 connection.on('connect_error',error=>{
  if(!current())return;if(lastAuthError)error.message=lastAuthError.message;
  // Socket.IO retries transport failures, but namespace authorization errors
  // require an explicit reconnect. Each retry fetches a fresh capability.
  if(connection.active||retryTimer)return;
  retryTimer=setTimeout(()=>{retryTimer=undefined;if(current()&&!connection.connected)connection.connect();},Math.min(10_000,1000*2**Math.min(attempt++,4)));
 });
 connection.connect();return connection;
}
export async function streamBot(prompt:string,onText:(text:string)=>void,signal?:AbortSignal):Promise<string>{
 const response=await backendFetch('/api/bot/completion',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json',...accountHeaders('/api/bot/completion')},body:JSON.stringify({prompt}),signal});
 if(!response.ok){await readApiResponse(response,'/api/bot/completion');throw new ApiError('The assistant request failed.',response.status)}
 const type=response.headers.get('content-type')?.toLowerCase()??'';
 const eventStream=type.includes('text/event-stream');if(!eventStream&&!type.includes('text/plain'))throw new ApiError(`The assistant endpoint returned an unexpected response. ${addressHelp}`,response.status);
 if(!response.body)throw new ApiError('The assistant returned an empty response.',response.status);
 const reader=response.body.getReader(),decoder=new TextDecoder();let fullText='',pending='';
 const handle=(line:string)=>{if(!line.startsWith('data:'))return;const value=line.slice(5).trim();if(!value||value==='[DONE]')return;let data:Record<string,unknown>;try{data=JSON.parse(value)}catch{return}if(data.error)throw new ApiError(typeof data.error==='string'?data.error:'The assistant returned a provider error.',response.status);const record=data as {choices?:{delta?:{content?:unknown}}[];delta?:unknown;text?:unknown};const token=record.choices?.[0]?.delta?.content??record.delta??record.text??'';if(typeof token==='string'){fullText+=token;onText(fullText)}};
 try{while(true){const chunk=await reader.read();if(chunk.done){pending+=decoder.decode();if(eventStream&&pending.trim())handle(pending);break}const text=decoder.decode(chunk.value,{stream:true});if(!eventStream){fullText+=text;onText(fullText);continue}pending+=text;const lines=pending.split('\n');pending=lines.pop()??'';for(const line of lines)handle(line)}}catch(error){if(aborted(error,signal)||error instanceof ApiError)throw error;throw new ApiError('The assistant connection was interrupted. Retry when the backend is available.',0)}finally{reader.releaseLock()}
 return fullText;
}
