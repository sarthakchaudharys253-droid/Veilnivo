import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { registerLocalSourceDownload } from './source-download';
import { readServerConfig } from './config';

const url = '/downloads/Veilnivo-source.zip';
test('source download is opt-in, loopback-only and unavailable in production', async () => {
  const app = Fastify();
  try {
    registerLocalSourceDownload(app, {NODE_ENV:'development'}, readServerConfig({NODE_ENV:'development'}));
    assert.equal((await app.inject(url)).statusCode, 404);
    for (const env of [
      {SOURCE_ARCHIVE_PATH:'source.zip', NODE_ENV:'development', HOST:'0.0.0.0'},
      {SOURCE_ARCHIVE_PATH:'source.zip', NODE_ENV:'production', CLIENT_ORIGIN:'https://app.example.test'},
    ] satisfies NodeJS.ProcessEnv[]) assert.throws(() => registerLocalSourceDownload(app, env, readServerConfig(env)), /loopback local deployment/);
  } finally { await app.close(); }
});

test('local source download delivers only the configured ZIP with attachment headers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'veilnivo-source-download-'));
  const archive = join(directory, 'source.zip');
  const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);
  await writeFile(archive, bytes);
  const app = Fastify();
  registerLocalSourceDownload(app, {NODE_ENV:'development',SOURCE_ARCHIVE_PATH:archive}, readServerConfig({NODE_ENV:'development',CLIENT_ORIGIN:'http://127.0.0.1:3001'}));
  try {
    const headers = {host:'127.0.0.1:3001'};
    const download = await app.inject({url, remoteAddress:'127.0.0.1',headers});
    assert.equal(download.statusCode, 200);assert.deepEqual(download.rawPayload, bytes);
    assert.equal(download.headers['content-type'], 'application/zip');
    assert.equal(download.headers['content-disposition'], 'attachment; filename="Veilnivo-source.zip"');
    assert.equal(download.headers['content-length'], String(bytes.length));
    assert.equal(download.headers['cache-control'], 'no-store');
    assert.equal((await app.inject({method:'HEAD',url,remoteAddress:'127.0.0.1',headers})).body, '');
    assert.equal((await app.inject({url,remoteAddress:'203.0.113.10',headers})).statusCode,403);
    assert.equal((await app.inject({url,remoteAddress:'127.0.0.1',headers:{...headers,origin:'https://other.example'}})).statusCode,403);
    assert.equal((await app.inject({url,remoteAddress:'127.0.0.1',headers:{host:'attacker.example'}})).statusCode,403);
    assert.equal((await app.inject({url:'/downloads/other.zip',remoteAddress:'127.0.0.1'})).statusCode,404);
    await writeFile(archive,'SECRET=never-serve');
    const invalid=await app.inject({url,remoteAddress:'127.0.0.1',headers});
    assert.equal(invalid.statusCode,404);assert.doesNotMatch(invalid.body,/SECRET|never-serve/);
    await rm(archive);
    assert.equal((await app.inject({url,remoteAddress:'127.0.0.1',headers})).statusCode,404);
  } finally {
    await app.close();
    const target=resolve(directory);
    if (!target.startsWith(resolve(tmpdir())+sep) || !basename(target).startsWith('veilnivo-source-download-')) throw new Error('Unsafe fixture cleanup.');
    await rm(target,{recursive:true,force:true});
  }
});
