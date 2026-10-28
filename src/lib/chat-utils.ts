import { BOT_CONTACT_ID } from './compat';
import { base64ToBytes, bytesToBase64 } from './crypto';
import {isReactionEmoji} from './reaction-emoji';

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export interface AttachmentMeta {
  id: string;
  name: string;
  mime: string;
  size: number;
  key: string;
  iv: string;
}
export interface AttachmentInput {
  name: string;
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}
const SAFE_MIME = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf', 'text/plain', 'application/zip',
  'application/octet-stream',
]);
export function safeAttachmentMime(value: string): string {
  const mime = typeof value === 'string' ? value.toLowerCase().split(';')[0].trim() : '';
  return SAFE_MIME.has(mime) ? mime : 'application/octet-stream';
}
export function sanitizedFilename(value: string): string {
  const lastPart = (typeof value === 'string' ? value : '').split(/[\\/]/).pop() ?? '';
  let name = lastPart.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069<>:"|?*]/g, '').trim().replace(/[. ]+$/g, '');
  name = Array.from(name).slice(0, 180).join('');
  if (!name || name === '.' || name === '..') name = 'attachment.bin';
  if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)) name = '_' + name;
  return name;
}
function requireSize(size: number) {
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_ATTACHMENT_BYTES) {
    throw new Error('Choose a nonempty attachment of 10 MB or smaller.');
  }
}
/** Each file receives an independent AES key; only encrypted message metadata carries that key. */
export async function encryptAttachment(file: AttachmentInput): Promise<{
  metadata: Omit<AttachmentMeta, 'id'>;
  ciphertext: string;
  iv: string;
}> {
  requireSize(file.size);
  const plaintext = await file.arrayBuffer();
  requireSize(plaintext.byteLength);
  if (plaintext.byteLength !== file.size) throw new Error('The attachment size changed before encryption. Try selecting it again.');
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const ivBytes = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ivBytes, tagLength: 128 }, key, plaintext);
  const iv = bytesToBase64(ivBytes);
  const rawKey = new Uint8Array(await crypto.subtle.exportKey('raw', key));
  return {
    metadata: { name: sanitizedFilename(file.name), mime: safeAttachmentMime(file.type), size: plaintext.byteLength, key: bytesToBase64(rawKey), iv },
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)), iv,
  };
}
/** Caller must create short-lived object URLs only after an explicit user download action. */
export async function decryptAttachment(metadata: AttachmentMeta, ciphertext: string, iv: string): Promise<Blob> {
  requireSize(metadata.size);
  if (metadata.iv !== iv) throw new Error('The attachment envelope does not match its encrypted metadata.');
  const rawKey = base64ToBytes(metadata.key);
  const ivBytes = base64ToBytes(iv);
  const encrypted = base64ToBytes(ciphertext);
  if (rawKey.byteLength !== 32 || ivBytes.byteLength !== 12 || encrypted.byteLength < 16 || encrypted.byteLength > MAX_ATTACHMENT_BYTES + 16) {
    throw new Error('Invalid encrypted attachment.');
  }
  const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBytes, tagLength: 128 }, key, encrypted);
  if (plaintext.byteLength !== metadata.size) throw new Error('The attachment size does not match its authenticated metadata.');
  return new Blob([plaintext], { type: safeAttachmentMime(metadata.mime) });
}
/** A verified label is bound to the complete fingerprint, never merely a contact ID. */
export function isVerifiedFingerprint(stored: string | undefined, current: string): boolean {
  if (typeof stored !== 'string' || typeof current !== 'string') return false;
  const clean = (value: string) => value.replace(/\s/g, '').toUpperCase();
  const saved = clean(stored), active = clean(current);
  return /^[A-F0-9]{64}$/.test(saved) && /^[A-F0-9]{64}$/.test(active) && saved === active;
}
export const fingerprintMatches = isVerifiedFingerprint;


export interface ValidatedMessagePayload {
  id?: string;
  text: string;
  timestamp: number;
  senderId: string;
  type: 'text' | 'bot' | 'reaction' | 'system';
  expiresAt?: number;
  replyTo?: { id: string; text: string; own: boolean };
  attachment?: AttachmentMeta;
  targetId?: string;
  emoji?: string;
  active?: boolean;
  editedAt?: number;
  forwarded?: boolean;
}
const MESSAGE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function validTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
/** The authenticated transport sender, not peer-supplied JSON, decides authorship. */
export function validateMessagePayload(
  value: unknown, senderId: string, selfId: string, isBotHistory = false,
): asserts value is ValidatedMessagePayload {
  const invalid = () => { throw new Error('This encrypted message has invalid or mismatched metadata.'); };
  if (!record(value)) return invalid();
  if (typeof value.senderId !== 'string' || (isBotHistory
    ? senderId !== selfId || (value.senderId !== selfId && value.senderId !== BOT_CONTACT_ID)
    : value.senderId !== senderId)) return invalid();
  if (!validTimestamp(value.timestamp) || typeof value.text !== 'string' || value.text.length > 10_000 || !['text', 'bot', 'reaction', 'system'].includes(value.type as string)) return invalid();
  if (value.id !== undefined && (typeof value.id !== 'string' || !MESSAGE_UUID.test(value.id))) return invalid();
  if (value.expiresAt !== undefined && (!validTimestamp(value.expiresAt) || value.expiresAt <= value.timestamp)) return invalid();
  if (value.editedAt !== undefined && (!validTimestamp(value.editedAt) || value.editedAt < value.timestamp || value.type !== 'text')) return invalid();
  if (value.forwarded !== undefined && (typeof value.forwarded !== 'boolean' || value.type !== 'text')) return invalid();
  if (value.replyTo !== undefined) {
    const reply = value.replyTo;
    if (!record(reply) || typeof reply.id !== 'string' || !MESSAGE_UUID.test(reply.id) || typeof reply.text !== 'string' || reply.text.length > 160 || typeof reply.own !== 'boolean') return invalid();
  }
  if (value.type === 'reaction') {
    if (typeof value.targetId !== 'string' || !MESSAGE_UUID.test(value.targetId) || !isReactionEmoji(value.emoji) || typeof value.active !== 'boolean') return invalid();
  }
  if (value.attachment !== undefined) {
    const a = value.attachment;
    if (!record(a) || typeof a.id !== 'string' || !MESSAGE_UUID.test(a.id) || typeof a.name !== 'string' || a.name !== sanitizedFilename(a.name) || typeof a.mime !== 'string' || a.mime !== safeAttachmentMime(a.mime) || typeof a.key !== 'string' || typeof a.iv !== 'string' || typeof a.size !== 'number') return invalid();
    try {
      requireSize(a.size);
      if (base64ToBytes(a.key).byteLength !== 32 || base64ToBytes(a.iv).byteLength !== 12) return invalid();
    } catch { return invalid(); }
  }
}
