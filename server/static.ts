import type { FastifyInstance, FastifyReply } from 'fastify';
import fastifyStatic from '@fastify/static';
import { realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, sep } from 'node:path';

const publicExtensions = new Set(['.html', '.txt', '.js', '.css', '.svg', '.ico', '.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif', '.woff', '.woff2', '.ttf', '.otf', '.webmanifest']);
const privateDirectories = new Set(['src', 'server', 'prisma', 'node_modules', 'tests']);
const inside = (root: string, file: string) => {
  const child = relative(root, file);
  return child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
};

export async function validateFrontendDirectory(directory: string): Promise<string> {
  try {
    const root = await realpath(directory);
    const index = await realpath(join(root, 'index.html'));
    if (!inside(root, index) || !(await stat(index)).isFile()) throw new Error();
    return root;
  } catch { throw new Error('SERVE_FRONTEND requires a built frontend directory containing index.html. Build the frontend first.'); }
}

function notFound(reply: FastifyReply) {
  return reply.code(404).header('Cache-Control', 'no-store').send({error: 'Not found.'});
}

// Only the static export is reachable. Never fall back to HTML for unknown API
// routes, nor serve source/configuration files or symlinks outside the export.
export async function registerFrontend(app: FastifyInstance, root: string) {
  await app.register(fastifyStatic, {root, serve: false, cacheControl: false, dotfiles: 'deny'});
  app.get('/*', {config: {rateLimit: false}}, async (request, reply) => {
    let pathname: string;
    try { pathname = decodeURIComponent((request.raw.url || '/').split('?')[0]); }
    catch { return notFound(reply); }
    const parts = pathname.split('/').slice(1);
    if (!pathname.startsWith('/') || pathname.includes('\\') || pathname.includes('\0') || pathname.includes(':') ||
      parts.some((part, i) => part === '.' || part === '..' || part.startsWith('.') || privateDirectories.has(part.toLowerCase()) || (!part && i !== parts.length - 1)) ||
      /^\/(?:api|socket\.io)(?:\/|$)/i.test(pathname)) return notFound(reply);
    let logical = pathname.slice(1);
    let file = join(root, logical);
    try {
      const info = await stat(file);
      if (info.isDirectory()) {
        if (!pathname.endsWith('/')) {
          const index = await realpath(join(file, 'index.html'));
          if (!inside(root, index) || !(await stat(index)).isFile()) return notFound(reply);
          return reply.code(308).header('Location', `${pathname}/`).send();
        }
        logical += 'index.html';
        file = join(root, logical);
      }
      const extension = extname(logical).toLowerCase();
      const actual = await realpath(file);
      if (!inside(root, actual) || !(await stat(actual)).isFile() || !publicExtensions.has(extension)) return notFound(reply);
      const cache = logical.startsWith('_next/static/') ? 'public, max-age=31536000, immutable'
        : extension === '.html' || extension === '.txt' ? 'no-cache, max-age=0, must-revalidate'
        : 'public, max-age=3600, must-revalidate';
      reply.header('Cache-Control', cache);
      return reply.sendFile(logical, {cacheControl: false});
    } catch { return notFound(reply); }
  });
}
