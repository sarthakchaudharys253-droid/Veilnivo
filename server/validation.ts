export class InputError extends Error {
  statusCode = 400;
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InputError("Invalid request.");
  return value as Record<string, unknown>;
}

export function username(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z0-9_]{3,24}$/.test(value)) throw new InputError("Use 3–24 lowercase letters, numbers, or underscores.");
  if (["bot", "ai_bot", "ai-bot", "system", "admin"].includes(value)) throw new InputError("That username is reserved.");
  return value;
}

export function base64(value: unknown, label: string, exactBytes?: number, maxBytes = 131_072): string {
  if (typeof value !== "string" || value.length > Math.ceil(maxBytes / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) throw new InputError(`Invalid ${label}.`);
  const decoded = Buffer.from(value, "base64");
  if (!decoded.length || decoded.toString("base64") !== value || (exactBytes !== undefined && decoded.length !== exactBytes) || decoded.length > maxBytes) throw new InputError(`Invalid ${label}.`);
  return value;
}

export function publicKey(value: unknown): JsonWebKey {
  const jwk = object(value);
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || "d" in jwk || typeof jwk.x !== "string" || typeof jwk.y !== "string") throw new InputError("Invalid public identity key.");
  for (const part of [jwk.x, jwk.y]) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(part) || Buffer.from(part, "base64url").length !== 32) throw new InputError("Invalid public identity key.");
  }
  return { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, ext: true, key_ops: [] };
}

export function id(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new InputError("Invalid identifier.");
  return value;
}

export function registration(value: unknown) {
  const data = object(value);
  return {
    username: username(data.username),
    auth_hash: base64(data.auth_hash, "authentication proof", 32),
    auth_salt: base64(data.auth_salt, "authentication salt", 16),
    wrap_salt: base64(data.wrap_salt, "wrapping salt", 16),
    wrap_iv: base64(data.wrap_iv, "wrapping IV", 12),
    public_key: publicKey(data.public_key),
    encrypted_private_key: base64(data.encrypted_private_key, "wrapped private key", undefined, 4096),
  };
}

export function envelope(value: unknown) {
  const data = object(value);
  const ciphertext = base64(data.ciphertext, "ciphertext");
  if (Buffer.from(ciphertext, "base64").length < 17) throw new InputError("Ciphertext is too short.");
  return { recipient_id: id(data.recipient_id), ciphertext, iv: base64(data.iv, "message IV", 12) };
}

export type HistoryCursor = {createdAt:Date; id:string};

export function encodeHistoryCursor(message:HistoryCursor):string {
  return Buffer.from(JSON.stringify({created_at:message.createdAt.toISOString(),id:message.id}),"utf8").toString("base64url");
}

export function parseHistoryCursor(value:unknown):HistoryCursor | undefined {
  if (value === undefined) return undefined;
  try {
    if (typeof value !== "string" || value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const bytes=Buffer.from(value,"base64url");
    if (bytes.toString("base64url") !== value) throw new Error();
    const data=object(JSON.parse(bytes.toString("utf8")));
    if (typeof data.created_at !== "string") throw new Error();
    const createdAt=new Date(data.created_at);
    if (Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== data.created_at) throw new Error();
    return {createdAt,id:id(data.id)};
  } catch {throw new InputError("Invalid history cursor.");}
}
