import {timingSafeEqual} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import {Prisma,type PrismaClient} from '@prisma/client';

// Deliberately opt-in, read-only and unavailable during ordinary operation.
// The exporter runs inside the existing service; PostgreSQL stays off the
// public Internet. Never log its header, response bodies or database values.
export const migrationModels = {
  User:['id'], Session:['id'], Contact:['id'], Block:['id'], Invitation:['id'], Alias:['id'],
  Message:['id'], SendNonce:['id'], Attachment:['id'], Group:['id'],
  GroupMember:['groupId','userId'], GroupKeyEnvelope:['groupId','keyVersion','userId'], GroupMessage:['id'],
} as const;
export const migrationReadOnly=(env:NodeJS.ProcessEnv)=>env.MIGRATION_READ_ONLY==='true';
export function migrationAuthorized(expected:string|undefined,actual:unknown):boolean {
  if(!expected||expected.length<43||typeof actual!=='string')return false;
  const a=Buffer.from(expected),b=Buffer.from(actual);
  return a.length===b.length&&timingSafeEqual(a,b);
}
export function registerMigration(app:FastifyInstance,database:PrismaClient,env:NodeJS.ProcessEnv){
  const path='/api/migration/export';
  app.addHook('onRequest',async(request,reply)=>{
    if(!migrationReadOnly(env))return;
    if(request.url.split('?')[0]===path||['/api/health','/api/ready'].includes(request.url.split('?')[0]))return;
    if(request.url.startsWith('/api/'))return reply.code(503).header('Cache-Control','no-store').header('Retry-After','120').send({error:'Veilnivo is moving its encrypted data to the new server. Please try again shortly.'});
  });
  app.post(path,{config:{rateLimit:false}},async(request,reply)=>{
    if(!migrationAuthorized(env.MIGRATION_EXPORT_TOKEN,request.headers['x-veilnivo-migration']))return reply.code(404).send({error:'Not found.'});
    const body=request.body as Record<string,unknown>|null;
    if(!body||typeof body!=='object'||Array.isArray(body))return reply.code(400).send({error:'Invalid export request.'});
    const model=body.model;
    if(!migrationReadOnly(env)&&model!=='manifest')return reply.code(404).send({error:'Not found.'});
    if(model==='manifest'){
      const counts:Record<string,number>={};
      let payloadBytes=0;
      for(const name of Object.keys(migrationModels)){
        counts[name]=await (database as any)[name[0].toLowerCase()+name.slice(1)].count();
        // Only this fixed model allowlist supplies the SQL identifier.
        const result=await database.$queryRaw<{bytes:string}[]>(Prisma.sql`SELECT COALESCE(sum(octet_length(row_to_json(t)::text)),0)::text AS bytes FROM ${Prisma.raw('"'+name+'"')} AS t`);
        payloadBytes+=Number(result[0].bytes);
      }
      return {version:1,readOnly:migrationReadOnly(env),counts,payload_bytes:payloadBytes};
    }
    if(typeof model!=='string'||!Object.hasOwn(migrationModels,model))return reply.code(400).send({error:'Unknown export table.'});
    const offset=body.offset??0,limit=body.limit??50;
    if(!Number.isSafeInteger(offset)||Number(offset)<0||!Number.isSafeInteger(limit)||Number(limit)<1||Number(limit)>100)return reply.code(400).send({error:'Invalid export page.'});
    if(model==='Attachment'&&Number(limit)!==1)return reply.code(400).send({error:'Export encrypted files one at a time.'});
    const orderBy=(migrationModels as Record<string,readonly string[]>)[model].map(field=>({[field]:'asc'}));
    const rows=await (database as any)[model[0].toLowerCase()+model.slice(1)].findMany({orderBy,skip:offset,take:limit});
    const total=await (database as any)[model[0].toLowerCase()+model.slice(1)].count();
    return {version:1,model,offset,rows,nextOffset:Number(offset)+rows.length<total?Number(offset)+rows.length:null};
  });
}
