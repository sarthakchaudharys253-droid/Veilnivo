/** Build-time backend selection. Public values are inlined by Next at build time. */
export type BackendMode='demo'|'same-origin'|'remote';
export interface BackendConfig {mode:BackendMode;enabled:boolean;apiUrl:string;socketUrl:string;error:string|null}
export interface BackendConfigInput {mode?:string;url?:string;socketUrl?:string}
function originAddress(value:string,label:string):{origin:string;error:null}|{origin:'';error:string} {
 let parsed:URL;try{parsed=new URL(value)}catch{return{origin:'',error:`Invalid ${label}. Use a complete HTTP(S) origin.`};}
 if(!['http:','https:'].includes(parsed.protocol)||!parsed.hostname||parsed.origin==='null')return{origin:'',error:`The ${label} must use HTTP or HTTPS.`};
 if(parsed.username||parsed.password)return{origin:'',error:`The ${label} must not contain a username or password. Use an HTTP(S) origin without credentials.`};
 if(!/^https?:\/\/[^/?#\\]+\/?$/i.test(value)||parsed.pathname!=='/'||parsed.search||parsed.hash)return{origin:'',error:`The ${label} must be an origin only, without a path, query, or fragment.`};
 return{origin:parsed.origin,error:null};
}
export function resolveBackendConfig(input:BackendConfigInput):BackendConfig {
 const mode=input.mode?.trim()??'',url=input.url?.trim()??'',socketValue=input.socketUrl?.trim()??'';
 const invalid=(error:string):BackendConfig=>({mode:mode==='same-origin'?'same-origin':'remote',enabled:true,apiUrl:'',socketUrl:'',error});
 if(mode&&!['demo','same-origin','remote'].includes(mode))return invalid('Invalid backend mode. Set NEXT_PUBLIC_API_MODE to demo, same-origin, or remote, then rebuild the frontend.');
 if(mode==='demo'){if(url||socketValue)return invalid('Demo mode conflicts with NEXT_PUBLIC_API_URL or NEXT_PUBLIC_SOCKET_URL. Remove the server addresses for a demo build, or select a live backend mode.');return{mode:'demo',enabled:false,apiUrl:'',socketUrl:'',error:null}}
 const socket=socketValue?originAddress(socketValue,'realtime server address'):{origin:'',error:null};
 if(socket.error)return invalid(socket.error);
 if(mode==='same-origin'){if(url)return invalid('Same-origin mode must not include NEXT_PUBLIC_API_URL. Route /api to the backend on this frontend origin.');return{mode:'same-origin',enabled:true,apiUrl:'',socketUrl:socket.origin,error:null}}
 if(!url){if(mode==='remote')return invalid('Remote backend mode requires NEXT_PUBLIC_API_URL as an HTTP(S) origin.');if(socketValue)return invalid('NEXT_PUBLIC_SOCKET_URL requires an explicit live backend mode. Configure same-origin HTTP API routing or a remote API address.');return{mode:'demo',enabled:false,apiUrl:'',socketUrl:'',error:null}}
 const api=originAddress(url,'API address');if(api.error)return invalid(api.error);
 return{mode:'remote',enabled:true,apiUrl:api.origin,socketUrl:socket.origin,error:null};
}
/** Cookie same-site topology is deployment policy; never guess a registrable domain from hostnames. */
export function backendConnectionError(config:BackendConfig,pageOrigin?:string):string|null {
 if(config.error)return config.error;
 if(!config.enabled||!pageOrigin)return null;
 let frontend:URL;try{frontend=new URL(pageOrigin)}catch{return 'The frontend address is invalid. Open Veilnivo through its configured HTTP(S) origin.'}
 if(frontend.protocol==='https:'&&config.apiUrl&&new URL(config.apiUrl).protocol==='http:')return 'An HTTPS frontend cannot connect to an HTTP backend. Use HTTPS for the API, or deploy the API behind the same-origin reverse proxy.';
 if(frontend.protocol==='https:'&&config.socketUrl&&new URL(config.socketUrl).protocol==='http:')return 'An HTTPS frontend cannot connect to an HTTP realtime server. Use HTTPS for NEXT_PUBLIC_SOCKET_URL.';
 return null;
}
export const BACKEND_CONFIG=resolveBackendConfig({mode:process.env.NEXT_PUBLIC_API_MODE,url:process.env.NEXT_PUBLIC_API_URL,socketUrl:process.env.NEXT_PUBLIC_SOCKET_URL});
export const API_ENABLED=BACKEND_CONFIG.enabled;
export const API_URL=BACKEND_CONFIG.apiUrl;
export const SOCKET_URL=BACKEND_CONFIG.socketUrl;
export function currentBackendConnectionError():string|null{return backendConnectionError(BACKEND_CONFIG,typeof window==='undefined'?undefined:window.location.origin)}
