import { isIP } from 'node:net';
import { resolve } from 'node:path';

export interface ServerConfig {
  origin: string;
  secure: boolean;
  host: string;
  port: number;
  trustProxy: false | string[];
  serveFrontend: boolean;
  frontendDir: string;
}

function flag(value: string | undefined, name: string): boolean {
  if (value === undefined || value === '' || value === 'false') return false;
  if (value === 'true') return true;
  throw new Error(`${name} must be true or false.`);
}

function trustedProxies(value: string | undefined): false | string[] {
  if (!value || value === 'false') return false;
  const entries = value.split(',').map(item => item.trim());
  if (entries.length > 32 || entries.some(item => {
    const [address, prefix, extra] = item.split('/');
    const family = isIP(address);
    return !family || extra !== undefined || (prefix !== undefined &&
      (!/^\d+$/.test(prefix) || Number(prefix) < 1 || Number(prefix) > (family === 4 ? 32 : 128)));
  })) throw new Error('TRUST_PROXY must be false or a comma-separated list of trusted proxy IP addresses/CIDRs.');
  return [...new Set(entries)];
}

export function readServerConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): ServerConfig {
  const secure = env.NODE_ENV === 'production';
  const configuredOrigin = env.CLIENT_ORIGIN || env.APP_ORIGIN || env.RENDER_EXTERNAL_URL || (secure ? '' : 'http://localhost:3000');
  let parsed: URL;
  try { parsed = new URL(configuredOrigin); }
  catch { throw new Error('Set CLIENT_ORIGIN, APP_ORIGIN, or RENDER_EXTERNAL_URL to the exact frontend HTTP(S) origin.'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hostname.includes('*') || parsed.pathname !== '/' || parsed.search || parsed.hash || configuredOrigin.trim() !== configuredOrigin) {
    throw new Error('The frontend origin must be an HTTP(S) origin without a path, credentials, query, or fragment.');
  }
  if (secure && parsed.protocol !== 'https:') throw new Error('Production frontend origin must use HTTPS.');
  const host = env.HOST || (secure ? '0.0.0.0' : '127.0.0.1');
  if (!isIP(host) && host !== 'localhost') throw new Error('HOST must be an IP address or localhost.');
  const rawPort = env.PORT || '3001';
  if (!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
  return {
    origin: parsed.origin, secure, host, port: Number(rawPort),
    trustProxy: trustedProxies(env.TRUST_PROXY),
    serveFrontend: flag(env.SERVE_FRONTEND, 'SERVE_FRONTEND'),
    frontendDir: resolve(cwd, env.FRONTEND_DIR || 'out'),
  };
}

