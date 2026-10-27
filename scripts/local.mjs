import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import net from 'node:net';
import {randomBytes,createHash} from 'node:crypto';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const stateDir=path.join(root,'.local');
const dataDir=path.join(stateDir,'postgres');
const credentialFile=path.join(stateDir,'credentials.json');
const configFile=path.join(stateDir,'config.json');
const controlPath=process.platform==='win32'?`\\\\.\\pipe\\veilnivo-${createHash('sha256').update(root).digest('hex').slice(0,20)}`:path.join(stateDir,'control.sock');
const action=process.argv[2]||'start';
if(Number(process.versions.node.split('.')[0])<22)throw new Error('Veilnivo requires Node.js 22 or newer. Install it, reopen your terminal, then follow LOCAL-RUN.md.');
const readJson=async file=>JSON.parse(await fs.readFile(file,'utf8'));
let config={};try{config=await readJson(configFile)}catch(error){if(error.code!=='ENOENT')throw error}
const port=Number(process.env.LOCAL_PORT||config.port||3001);
const pgPort=Number(process.env.LOCAL_PG_PORT||config.pgPort||54329);
if(![port,pgPort].every(n=>Number.isInteger(n)&&n>1024&&n<=65535)||port===pgPort)throw new Error('Set distinct LOCAL_PORT and LOCAL_PG_PORT from 1025 to 65535.');
const origin=`http://127.0.0.1:${port}`;
const postgresBin=process.env.PG_BIN||config.postgresBin;
const executable=name=>postgresBin?path.join(postgresBin,name+(process.platform==='win32'?'.exe':'')):name;

function run(command,args,env=process.env,stdio='inherit'){
 return new Promise((resolve,reject)=>{const child=spawn(command,args,{cwd:root,env,shell:false,stdio});child.once('error',reject);child.once('exit',(code,signal)=>code===0?resolve():reject(new Error(`${path.basename(command)} exited with ${code??signal}.`)))});
}
async function requestControl(command,credentials){
 return new Promise((resolve,reject)=>{const socket=net.createConnection(controlPath);let text='';socket.setTimeout(2500,()=>socket.destroy(new Error('Local control request timed out.')));socket.on('connect',()=>socket.write(JSON.stringify({command,token:credentials.controlToken})+'\n'));socket.on('data',chunk=>text+=chunk);socket.on('end',()=>{try{resolve(JSON.parse(text))}catch{reject(new Error('Invalid local control response.'))}});socket.on('error',reject)});
}
if(action==='stop'||action==='status'){
 try{const result=await requestControl(action,await readJson(credentialFile));process.stdout.write(result.message+'\n');process.exitCode=result.ok?0:1}catch{process.stdout.write('Veilnivo local runner is not running.\n');process.exitCode=action==='status'?1:0}
}else if(action==='start'){
 await fs.mkdir(stateDir,{recursive:true,mode:0o700});
 let credentials;try{credentials=await readJson(credentialFile)}catch(error){if(error.code!=='ENOENT')throw error;credentials={databasePassword:randomBytes(32).toString('hex'),jwtSecret:randomBytes(48).toString('base64url'),controlToken:randomBytes(32).toString('hex')};await fs.writeFile(credentialFile,JSON.stringify(credentials),{mode:0o600,flag:'wx'})}
 if(!credentials.databasePassword||!credentials.jwtSecret||!credentials.controlToken)throw new Error('Local credentials are incomplete. Restore the local credentials file; do not replace it for an existing database.');
 try{const status=await requestControl('status',credentials);if(status.ok){process.stdout.write(status.message+'\n');process.exit(0)}}catch{}
 for(const file of ['node_modules/next/dist/bin/next','node_modules/prisma/build/index.js','node_modules/tsx/package.json'])if(!existsSync(path.join(root,file)))throw new Error('App dependencies are missing. In this folder run pnpm install --frozen-lockfile, then start again. See LOCAL-RUN.md for Node.js, pnpm, and PostgreSQL setup.');
 for(const name of ['initdb','pg_ctl','postgres']){
  if(postgresBin&&!existsSync(executable(name)))throw new Error(`PG_BIN must contain ${name}. See LOCAL-RUN.md.`);
  try{await run(executable(name),['--version'],process.env,'ignore')}catch{throw new Error(`PostgreSQL ${name} is unavailable. Set PG_BIN to the PostgreSQL bin folder, or add that folder to PATH. See LOCAL-RUN.md.`)}
 }
 const archiveCandidates=[process.env.SOURCE_ARCHIVE_PATH,config.sourceArchivePath,path.resolve(root,'..','..','Veilnivo-source.zip'),path.resolve(root,'..','Veilnivo-source.zip')].filter(Boolean);
 let sourceArchivePath='';
 for(const candidate of archiveCandidates){try{if((await fs.stat(candidate)).isFile()){sourceArchivePath=path.resolve(candidate);break}}catch{}}
 if(!process.argv.includes('--skip-build'))await run(process.execPath,['node_modules/next/dist/bin/next','build'],{...process.env,NEXT_PUBLIC_API_MODE:'same-origin',NEXT_PUBLIC_API_URL:'',NEXT_TELEMETRY_DISABLED:'1'});
 if(!existsSync(path.join(root,'out','index.html')))throw new Error('Build the frontend before using --skip-build.');
 let application,closing=false,startedDatabase=false,ownsControl=false,finishStartup;
 const startupSettled=new Promise(resolve=>finishStartup=resolve);
 let shutdownPromise;
 class StartupCancelled extends Error {}
 function ensureStarting(){if(closing)throw new StartupCancelled('Local startup was cancelled.');}
 const control=net.createServer(socket=>{let input='';socket.setTimeout(2000,()=>socket.destroy());socket.on('data',chunk=>{input+=chunk;if(input.length>1024)return socket.destroy();if(!input.includes('\n'))return;let value;try{value=JSON.parse(input)}catch{return socket.destroy()}if(value.token!==credentials.controlToken)return socket.end(JSON.stringify({ok:false,message:'Local control access rejected.'}));if(value.command==='status')return socket.end(JSON.stringify({ok:!closing,message:closing?'Veilnivo is stopping.':`Veilnivo is running at ${origin}`}));if(value.command==='stop'){socket.end(JSON.stringify({ok:true,message:'Stopping Veilnivo; local accounts and history are retained.'}));void shutdown()}else socket.end(JSON.stringify({ok:false,message:'Unknown local control command.'}))})});
 async function shutdown(){
  if(shutdownPromise)return shutdownPromise;
  closing=true;
  shutdownPromise=(async()=>{
   // Let initdb/pg_ctl/migrations finish their current operation, then prevent
   // every subsequent startup step before stopping the database they started.
   await startupSettled;
   if(application?.pid&&application.exitCode===null&&application.signalCode===null){
    const exited=new Promise(resolve=>application.once('exit',resolve));
    const wait=async milliseconds=>{let timer;try{await Promise.race([exited,new Promise(resolve=>timer=setTimeout(resolve,milliseconds))])}finally{clearTimeout(timer)}};
    application.kill('SIGTERM');await wait(5000);
    if(application.exitCode===null&&application.signalCode===null){application.kill('SIGKILL');await wait(2000)}
   }
   if(startedDatabase){await run(executable('pg_ctl'),['-D',dataDir,'-m','fast','-w','-t','30','stop'],process.env,'ignore').catch(()=>{process.exitCode=1;process.stderr.write('PostgreSQL did not confirm shutdown. Check .local/postgres.log.\n')})}
   if(ownsControl){control.close();if(process.platform!=='win32')await fs.rm(controlPath,{force:true});}
  })();
  return shutdownPromise;
 }
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void shutdown());
 try{
  await new Promise((resolve,reject)=>{control.once('error',reject);control.listen(controlPath,resolve)});ownsControl=true;ensureStarting();
  if(!existsSync(path.join(dataDir,'PG_VERSION'))){
   const passwordSource=process.platform==='win32'?`\\\\.\\pipe\\veilnivo-pg-init-${randomBytes(8).toString('hex')}`:path.join(stateDir,'.bootstrap-password');
   let pipe;
   try{if(process.platform==='win32'){pipe=net.createServer(socket=>socket.end(credentials.databasePassword+'\n'));await new Promise((resolve,reject)=>{pipe.once('error',reject);pipe.listen(passwordSource,resolve)})}else await fs.writeFile(passwordSource,credentials.databasePassword+'\n',{mode:0o600,flag:'wx'});
    await run(executable('initdb'),['-D',dataDir,'-U','veilnivo','--encoding=UTF8','--locale=C','--auth=scram-sha-256','--pwfile='+passwordSource],process.env,'ignore');
   }finally{if(pipe)pipe.close();else await fs.rm(passwordSource,{force:true})}
  }
  ensureStarting();
  await run(executable('pg_ctl'),['-D',dataDir,'-l',path.join(stateDir,'postgres.log'),'-o',`-h 127.0.0.1 -p ${pgPort}`,'-w','-t','30','start'],process.env,'ignore');startedDatabase=true;ensureStarting();
  const env={...process.env,NODE_ENV:'development',HOST:'127.0.0.1',PORT:String(port),CLIENT_ORIGIN:origin,SERVE_FRONTEND:'true',FRONTEND_DIR:'out',TRUST_PROXY:'false',JWT_SECRET:credentials.jwtSecret,DATABASE_URL:`postgresql://veilnivo:${encodeURIComponent(credentials.databasePassword)}@127.0.0.1:${pgPort}/postgres?schema=public`,BOT_API_KEY:'',BOT_ZERO_RETENTION_CONFIRMED:'false',SOURCE_ARCHIVE_PATH:sourceArchivePath};
  await run(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],env);ensureStarting();
  application=spawn(process.execPath,['--import','tsx','server/index.ts'],{cwd:root,env,stdio:'inherit',shell:false});
  application.once('error',()=>{process.exitCode=1;void shutdown()});
  application.once('exit',code=>{if(!closing)process.exitCode=code||1;void shutdown()});
  process.stdout.write(`Local PostgreSQL is connected. Open ${origin}\nUse pnpm local:stop to stop; data remains in .local/postgres.\n`);
  if(sourceArchivePath)process.stdout.write(`Source ZIP download: ${origin}/downloads/Veilnivo-source.zip\n`);
 }catch(error){finishStartup();await shutdown();if(!(error instanceof StartupCancelled))throw error}finally{finishStartup()}
}else throw new Error('Usage: node scripts/local.mjs start|stop|status [--skip-build]');
