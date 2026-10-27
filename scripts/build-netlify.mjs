import {spawn} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const raw=process.env.VEILNIVO_BACKEND_ORIGIN||'';
let backend;
try {
  backend=new URL(raw);
  if(backend.protocol!=='https:'||backend.username||backend.password||backend.pathname!=='/'||backend.search||backend.hash||raw.trim()!==raw||!/^[a-z0-9.-]+$/i.test(backend.hostname)||backend.hostname==='localhost'||backend.hostname.endsWith('.localhost')||/^\d+(?:\.\d+){3}$/.test(backend.hostname))throw new Error();
} catch {
  throw new Error('Set VEILNIVO_BACKEND_ORIGIN to the exact public HTTPS origin returned by Render, without credentials, path, query, or fragment.');
}
const origin=backend.origin;
if(process.argv.includes('--check')) {
  process.stdout.write(`Netlify configuration validated for ${origin}.\n`);
} else {
  const env={...process.env,NEXT_PUBLIC_API_MODE:'same-origin',NEXT_PUBLIC_API_URL:'',NEXT_PUBLIC_SOCKET_URL:origin,NEXT_TELEMETRY_DISABLED:'1'};
  const code=await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['node_modules/next/dist/bin/next','build'],{cwd:root,env,stdio:'inherit',shell:false});
    child.once('error',reject);child.once('exit',code=>resolve(code??1));
  });
  if(code!==0)process.exit(code);
  // Only explicit API paths are proxied. Static Next exports retain /login/.
  await writeFile(path.join(root,'out','_redirects'),`/api/*  ${origin}/api/:splat  200!\n`,'utf8');
  process.stdout.write(`Netlify export prepared: same-origin API and direct realtime at ${origin}.\n`);
}
