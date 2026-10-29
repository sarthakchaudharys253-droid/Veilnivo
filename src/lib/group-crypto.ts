import {
  base64ToBytes, bytesToBase64, decryptPayload, deriveSharedSecret,
  encryptPayload, type EncryptedPayload,
} from './crypto';

export type GroupKeyEnvelope = EncryptedPayload;
export interface GroupKeyIdentities {wrappedById:string;recipientId:string}
const KEY_DOMAIN='veilnivo-group-key-v1';
const MESSAGE_DOMAIN='veilnivo-group-message-v1';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const encoder=new TextEncoder();
const MAX_KEY_ENVELOPE_BYTES=4096;
const MAX_MESSAGE_ENVELOPE_BYTES=131_072;

function identifier(value:unknown){
  if(typeof value!=='string'||!UUID.test(value))throw new Error('Invalid group encryption identifier.');
  return value;
}
function context(groupId:string,keyVersion:number){
  identifier(groupId);
  if(!Number.isSafeInteger(keyVersion)||keyVersion<1||keyVersion>2_147_483_647)throw new Error('Invalid group encryption key version.');
}
function identities(value:GroupKeyIdentities){
  if(!value||typeof value!=='object')throw new Error('Group key identities are required.');
  identifier(value.wrappedById);identifier(value.recipientId);
}
function aesKey(key:CryptoKey){
  if(!key||key.type!=='secret'||key.algorithm?.name!=='AES-GCM'||(key.algorithm as AesKeyAlgorithm).length!==256)throw new Error('An AES-256-GCM group key is required.');
}
function canonicalBase64(value:unknown,maximum:number,exact?:number){
  if(typeof value!=='string'||value.length>Math.ceil(maximum/3)*4)throw new Error('Invalid group encryption envelope.');
  const bytes=base64ToBytes(value);
  if(!bytes.length||bytes.length>maximum||exact!==undefined&&bytes.length!==exact||bytesToBase64(bytes)!==value)throw new Error('Invalid group encryption envelope.');
  return bytes;
}
function encryptedEnvelope(envelope:GroupKeyEnvelope,maximum:number){
  if(!envelope||typeof envelope!=='object')throw new Error('Invalid group encryption envelope.');
  const cipher=canonicalBase64(envelope.ciphertext,maximum);
  if(cipher.length<17)throw new Error('Invalid group encryption envelope.');
  canonicalBase64(envelope.iv,12,12);
}
function record(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid encrypted group context.');
  return value as Record<string,unknown>;
}

/** Exportability is needed only while distributing a fresh version to members. */
export async function generateGroupKey():Promise<CryptoKey>{
  return crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt','decrypt']);
}

/** The recipient and wrapper identities are bound even though ECDH is symmetric. */
export async function wrapGroupKey(
  key:CryptoKey,identityPrivate:CryptoKey,recipientPublic:JsonWebKey,
  groupId:string,keyVersion:number,participants:GroupKeyIdentities,
):Promise<GroupKeyEnvelope>{
  context(groupId,keyVersion);identities(participants);aesKey(key);
  if(!key.extractable)throw new Error('Distribute a newly generated group key.');
  const raw=new Uint8Array(await crypto.subtle.exportKey('raw',key));
  try{
    if(raw.length!==32)throw new Error('An AES-256-GCM group key is required.');
    const wrappingKey=await deriveSharedSecret(identityPrivate,recipientPublic);
    return await encryptPayload({type:KEY_DOMAIN,groupId,keyVersion,wrappedById:participants.wrappedById,recipientId:participants.recipientId,key:bytesToBase64(raw)},wrappingKey);
  }finally{raw.fill(0)}
}

/** Recovered content keys stay nonextractable and are scoped to one key version. */
export async function unwrapGroupKey(
  envelope:GroupKeyEnvelope,identityPrivate:CryptoKey,wrapperPublic:JsonWebKey,
  groupId:string,keyVersion:number,participants:GroupKeyIdentities,
):Promise<CryptoKey>{
  context(groupId,keyVersion);identities(participants);encryptedEnvelope(envelope,MAX_KEY_ENVELOPE_BYTES);
  const wrappingKey=await deriveSharedSecret(identityPrivate,wrapperPublic);
  const value=record(await decryptPayload(envelope.ciphertext,envelope.iv,wrappingKey));
  if(value.type!==KEY_DOMAIN||value.groupId!==groupId||value.keyVersion!==keyVersion||value.wrappedById!==participants.wrappedById||value.recipientId!==participants.recipientId)throw new Error('The group key envelope does not match this member and key version.');
  const raw=canonicalBase64(value.key,32,32);
  try{return await crypto.subtle.importKey('raw',raw,{name:'AES-GCM',length:256},false,['encrypt','decrypt'])}
  finally{raw.fill(0)}
}

/** The caller also validates the authenticated server author and logical message ID. */
export async function encryptGroupPayload(payload:unknown,key:CryptoKey,groupId:string,keyVersion:number):Promise<EncryptedPayload>{
  context(groupId,keyVersion);aesKey(key);
  if(payload===undefined)throw new Error('A group message payload is required.');
  const bound={type:MESSAGE_DOMAIN,groupId,keyVersion,payload};
  const serialized=JSON.stringify(bound);
  if(encoder.encode(serialized).length>MAX_MESSAGE_ENVELOPE_BYTES-16)throw new Error('The encrypted group message is too large.');
  return encryptPayload(bound,key);
}

export async function decryptGroupPayload<T=unknown>(ciphertext:string,iv:string,key:CryptoKey,groupId:string,keyVersion:number):Promise<T>{
  context(groupId,keyVersion);aesKey(key);encryptedEnvelope({ciphertext,iv},MAX_MESSAGE_ENVELOPE_BYTES);
  const value=record(await decryptPayload(ciphertext,iv,key));
  if(value.type!==MESSAGE_DOMAIN||value.groupId!==groupId||value.keyVersion!==keyVersion||!Object.prototype.hasOwnProperty.call(value,'payload'))throw new Error('The group message does not match this conversation and key version.');
  return value.payload as T;
}
