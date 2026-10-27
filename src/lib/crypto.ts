/** Veilnivo client cryptography: native WebCrypto only. */
export const PBKDF2_ITERATIONS = 600_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
export type EncryptedPayload = { ciphertext: string; iv: string };
export type PasswordKeys = { authHash: string; masterWrappingKey: CryptoKey; authSalt: string; wrapSalt: string };

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return btoa(binary);
}
export function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  if (typeof value !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error("Invalid Base64 encoding.");
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
function saltBytes(salt?: string): Uint8Array<ArrayBuffer> {
  const bytes = salt === undefined ? crypto.getRandomValues(new Uint8Array(16)) : base64ToBytes(salt);
  if (bytes.byteLength !== 16) throw new Error("PBKDF2 salts must be 16 bytes.");
  return bytes;
}
/** Independently salted and stretched authentication and wrapping keys. */
export async function deriveKeysFromPassword(password: string, authSalt?: string, wrapSalt?: string): Promise<PasswordKeys> {
  if (!password) throw new Error("A password is required.");
  const authBytes = saltBytes(authSalt);
  const wrapBytes = saltBytes(wrapSalt);
  if (bytesToBase64(authBytes) === bytesToBase64(wrapBytes)) throw new Error("Authentication and wrapping salts must be independent.");
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits", "deriveKey"]);
  const [authBits, masterWrappingKey] = await Promise.all([
    crypto.subtle.deriveBits({ name: "PBKDF2", salt: authBytes, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" }, material, 256),
    crypto.subtle.deriveKey({ name: "PBKDF2", salt: wrapBytes, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]),
  ]);
  return { authHash: bytesToBase64(new Uint8Array(authBits)), masterWrappingKey, authSalt: bytesToBase64(authBytes), wrapSalt: bytesToBase64(wrapBytes) };
}
/** Initial private key is exportable solely to encrypt it for storage. */
export async function generateIdentityKeyPair(): Promise<{ publicKey: CryptoKey; privateKey: CryptoKey; publicKeyJwk: JsonWebKey }> {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]);
  return { ...pair, publicKeyJwk: await crypto.subtle.exportKey("jwk", pair.publicKey) };
}
export async function wrapPrivateKey(privateKey: CryptoKey, key: CryptoKey): Promise<EncryptedPayload> {
  if (privateKey.type !== "private" || privateKey.algorithm.name !== "ECDH") throw new Error("An ECDH private key is required.");
  return encryptPayload(await crypto.subtle.exportKey("jwk", privateKey), key);
}
export async function unwrapPrivateKey(ciphertext: string, iv: string, key: CryptoKey): Promise<CryptoKey> {
  const jwk = await decryptPayload<JsonWebKey>(ciphertext, iv, key);
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.d) throw new Error("Invalid identity key.");
  return crypto.subtle.importKey("jwk", { ...jwk, ext: false }, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey"]);
}
export async function deriveSharedSecret(privateKey: CryptoKey, publicJwk: JsonWebKey): Promise<CryptoKey> {
  const publicKey = await crypto.subtle.importKey("jwk", canonicalPublicKey(publicJwk), { name: "ECDH", namedCurve: "P-256" }, false, []);
  return crypto.subtle.deriveKey({ name: "ECDH", public: publicKey }, privateKey, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
export async function encryptPayload(payload: unknown, key: CryptoKey): Promise<EncryptedPayload> {
  const serialized = JSON.stringify(payload);
  if (serialized === undefined) throw new Error("Payload must be JSON serializable.");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, tagLength: 128 }, key, encoder.encode(serialized));
  return { ciphertext: bytesToBase64(new Uint8Array(ciphertext)), iv: bytesToBase64(iv) };
}
export async function decryptPayload<T = unknown>(ciphertext: string, iv: string, key: CryptoKey): Promise<T> {
  const ivBytes = base64ToBytes(iv);
  if (ivBytes.byteLength !== 12) throw new Error("AES-GCM IVs must be 12 bytes.");
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: ivBytes, tagLength: 128 }, key, base64ToBytes(ciphertext));
  return JSON.parse(decoder.decode(plaintext)) as T;
}
function canonicalPublicKey(jwk: JsonWebKey): JsonWebKey {
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.x || !jwk.y || jwk.d) throw new Error("An ECDH P-256 public key is required.");
  return { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y };
}
async function sha256(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}
export async function fingerprint(publicJwk: JsonWebKey): Promise<string> {
  const digest = await sha256(JSON.stringify(canonicalPublicKey(publicJwk)));
  return digest.match(/.{1,4}/g)!.join(" ");
}
/** Symmetric in the identities so peers see the same SHA-256 safety number. */
export async function safetyNumber(a: JsonWebKey, b: JsonWebKey): Promise<string> {
  const identities = [JSON.stringify(canonicalPublicKey(a)), JSON.stringify(canonicalPublicKey(b))].sort();
  const digest = await sha256(identities.join("\n"));
  return digest.match(/.{1,4}/g)!.join(" ");
}
