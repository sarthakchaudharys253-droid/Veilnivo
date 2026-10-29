import {base64ToBytes,bytesToBase64} from './crypto';

export const MIN_CHAT_LOCK_CHARACTERS=4;
export const MAX_CHAT_LOCK_CHARACTERS=12;
export const MAX_CHAT_LOCK_CODE_UNITS=1024;
export const CHAT_LOCK_ITERATIONS=600_000;

export interface ChatLockVerifier {
 version:1;
 algorithm:'PBKDF2-SHA256';
 iterations:typeof CHAT_LOCK_ITERATIONS;
 salt:string;
 verifier:string;
}

const encoder=new TextEncoder();
let segmenter:Intl.Segmenter|undefined;
const mark=/\p{Mark}/u,pictograph=/\p{Extended_Pictographic}/u;
function hangul(point:number){
 if(point>=0x1100&&point<=0x115f||point>=0xa960&&point<=0xa97c)return'L';
 if(point>=0x1160&&point<=0x11a7||point>=0xd7b0&&point<=0xd7c6)return'V';
 if(point>=0x11a8&&point<=0x11ff||point>=0xd7cb&&point<=0xd7fb)return'T';
 if(point>=0xac00&&point<=0xd7a3)return(point-0xac00)%28===0?'LV':'LVT';
 return'';
}

// Conservative fallback for older engines: preserve emoji joins/modifiers/flags,
// combining marks and Hangul clusters. Current browsers use Unicode Segmenter.
function fallbackCount(code:string){
 let count=0,regionalRun=0,previousHangul='',clusterPictograph=false,joinPictograph=false;
 for(const character of code){
  const point=character.codePointAt(0)!,regional=point>=0x1f1e6&&point<=0x1f1ff;
  const extended=mark.test(character)||point===0xfe0e||point===0xfe0f||point>=0x1f3fb&&point<=0x1f3ff||point>=0xe0020&&point<=0xe007f;
  const currentHangul=hangul(point),picture=pictograph.test(character);
  const hangulJoin=previousHangul==='L'&&['L','V','LV','LVT'].includes(currentHangul)||['LV','V'].includes(previousHangul)&&['V','T'].includes(currentHangul)||['LVT','T'].includes(previousHangul)&&currentHangul==='T';
  const joins=count>0&&(extended||point===0x200d||joinPictograph&&picture||regional&&regionalRun%2===1||hangulJoin);
  if(!joins){count++;clusterPictograph=picture}else if(picture)clusterPictograph=true;
  if(point===0x200d)joinPictograph=clusterPictograph;
  else if(!extended)joinPictograph=false;
  regionalRun=regional?regionalRun+1:0;
  previousHangul=currentHangul;
 }
 return count;
}

/** The count is bounded; an oversized input always returns an over-limit value. */
export function countChatLockCharacters(code:string):number{
 if(code.length>MAX_CHAT_LOCK_CODE_UNITS)return code.length;
 if(typeof Intl.Segmenter==='function'){
  segmenter??=new Intl.Segmenter(undefined,{granularity:'grapheme'});
  let count=0;for(const _ of segmenter.segment(code))count++;
  return count;
 }
 return fallbackCount(code);
}

function wellFormed(code:string){
 for(let index=0;index<code.length;index++){
  const point=code.charCodeAt(index);
  if(point>=0xd800&&point<=0xdbff){const next=code.charCodeAt(++index);if(!(next>=0xdc00&&next<=0xdfff))return false}
  else if(point>=0xdc00&&point<=0xdfff)return false;
 }
 return true;
}

/** Codes are exact: spaces, casing and Unicode normalization are not changed. */
export function validateChatLockCode(code:unknown):string|null{
 if(typeof code!=='string')return'Enter a secret code.';
 if(code.length>MAX_CHAT_LOCK_CODE_UNITS)return'This secret code is too long.';
 if(!wellFormed(code)||/\p{Cc}/u.test(code))return'Use letters, numbers, spaces, symbols or emoji without control characters.';
 const length=countChatLockCharacters(code);
 return length<MIN_CHAT_LOCK_CHARACTERS||length>MAX_CHAT_LOCK_CHARACTERS?'Use a secret code of 4–12 characters.':null;
}

function parseVerifier(record:unknown):{salt:Uint8Array<ArrayBuffer>;verifier:Uint8Array<ArrayBuffer>}|undefined{
 try{
  if(typeof record!=='object'||record===null||Array.isArray(record))return;
  const value=record as Record<string,unknown>;
  if(Object.keys(value).length!==5||value.version!==1||value.algorithm!=='PBKDF2-SHA256'||value.iterations!==CHAT_LOCK_ITERATIONS||typeof value.salt!=='string'||value.salt.length!==24||typeof value.verifier!=='string'||value.verifier.length!==44)return;
  const salt=base64ToBytes(value.salt),verifier=base64ToBytes(value.verifier);
  if(salt.byteLength!==16||verifier.byteLength!==32||bytesToBase64(salt)!==value.salt||bytesToBase64(verifier)!==value.verifier)return;
  return{salt,verifier};
 }catch{return}
}

export function isChatLockVerifier(record:unknown):record is ChatLockVerifier{return parseVerifier(record)!==undefined}

async function deriveVerifier(code:string,salt:Uint8Array<ArrayBuffer>){
 const material=await crypto.subtle.importKey('raw',encoder.encode('veilnivo:chat-lock:v1\0'+code),'PBKDF2',false,['deriveBits']);
 return new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',iterations:CHAT_LOCK_ITERATIONS,salt},material,256));
}

export async function createChatLockVerifier(code:string):Promise<ChatLockVerifier>{
 const error=validateChatLockCode(code);if(error)throw new Error(error);
 const salt=crypto.getRandomValues(new Uint8Array(16)),verifier=await deriveVerifier(code,salt);
 return{version:1,algorithm:'PBKDF2-SHA256',iterations:CHAT_LOCK_ITERATIONS,salt:bytesToBase64(salt),verifier:bytesToBase64(verifier)};
}

export async function verifyChatLockCode(code:string,record:unknown):Promise<boolean>{
 if(validateChatLockCode(code)!==null)return false;
 const parsed=parseVerifier(record);if(!parsed)return false;
 const actual=await deriveVerifier(code,parsed.salt);
 // Compare every digest byte. JavaScript runtimes do not promise strict timing.
 let difference=0;for(let index=0;index<actual.length;index++)difference|=actual[index]^parsed.verifier[index];
 return difference===0;
}
