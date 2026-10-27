import type { FastifyInstance } from 'fastify';
import { open, realpath } from 'node:fs/promises';
import type { ServerConfig } from './config';

const downloadPath = '/downloads/Veilnivo-source.zip';
const loopback = (address: string | undefined) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address || '');

// This opt-in route delivers only the operator's sanitized source package on
// the local runner. It is never available on a public production deployment.
export function registerLocalSourceDownload(app: FastifyInstance, env: NodeJS.ProcessEnv, config: ServerConfig) {
  const archive = env.SOURCE_ARCHIVE_PATH;
  if (!archive) return;
  if (config.secure || !['127.0.0.1', '::1', 'localhost'].includes(config.host)) {
    throw new Error('SOURCE_ARCHIVE_PATH is supported only by a loopback local deployment.');
  }
  app.get(downloadPath, {config: {rateLimit: {max: 10, timeWindow: '1 minute'}}}, async (request, reply) => {
    if (!loopback(request.raw.socket.remoteAddress) || request.headers.host !== new URL(config.origin).host || (request.headers.origin && request.headers.origin !== config.origin)) {
      return reply.code(403).send({error: 'Local download access rejected.'});
    }
    let file;
    try {
      const actual = await realpath(archive);
      file = await open(actual, 'r');
      const info = await file.stat();
      const signature = Buffer.alloc(4);
      const {bytesRead} = await file.read(signature, 0, 4, 0);
      if (!info.isFile() || info.size < 4 || info.size > 25 * 1024 * 1024 || bytesRead !== 4 || !signature.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) throw new Error();
      const stream = file.createReadStream({start: 0, autoClose: true});
      file = undefined;
      return reply.type('application/zip')
        .header('Content-Disposition', 'attachment; filename="Veilnivo-source.zip"')
        .header('Content-Length', info.size)
        .header('Cache-Control', 'no-store')
        .header('X-Content-Type-Options', 'nosniff')
        .send(stream);
    } catch {
      await file?.close().catch(() => {});
      return reply.code(404).header('Cache-Control', 'no-store').send({error: 'Source package unavailable. Regenerate Veilnivo-source.zip, then try again.'});
    }
  });
}
