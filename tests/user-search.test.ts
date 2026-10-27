import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {normalizeSearchUsername,parseUserSearchResponse} from '../src/lib/user-search';
import {db,type CachedAccount} from '../src/lib/db';

test('exact username search validates a full handle and strips extra response data',()=>{
 assert.equal(normalizeSearchUsername(' @Some_User '),'some_user');
 for(const handle of ['','al','everyone*','alice bob','a'.repeat(25)])assert.throws(()=>normalizeSearchUsername(handle),/full username/);
 assert.deepEqual(parseUserSearchResponse({users:[{id:'id',username:'some_user',relationship:'none',online:true,public_key:'private-search-surface'}]}),[{id:'id',username:'some_user',relationship:'none'}]);
 for(const value of [{},{users:'invalid'},{users:[{},{}]},{users:[{id:'id',username:'bad handle',relationship:'none'}]},{users:[{id:'id',username:'valid',relationship:'blocked'}]}])assert.throws(()=>parseUserSearchResponse(value));
});

test('search is read-only and rejects cancelled or previous-identity results',{timeout:10000},async t=>{
 Object.defineProperty(globalThis,'window',{value:undefined,configurable:true});
 let release:(()=>void)|undefined,started:(()=>void)|undefined;
 let held=false,accountHeader='';
 const server=createServer((req,res)=>{
  const url=new URL(req.url!,'http://127.0.0.1');
  if(url.pathname==='/api/auth/logout'){res.writeHead(200,{'content-type':'application/json'});res.end('{"ok":true}');return;}
  accountHeader=String(req.headers['x-veilnivo-account']??'');
  const reply=()=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({users:[{id:'peer-id',username:'canonical_peer',relationship:'none'}]}));};
  if(held){release=reply;started?.();}else reply();
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address=server.address();assert.ok(address&&typeof address==='object');
 process.env.NEXT_PUBLIC_API_MODE='remote';process.env.NEXT_PUBLIC_API_URL=`http://127.0.0.1:${address.port}`;
 const {useVeilnivo}=await import('../src/lib/store');
 const {setExpectedAccountId}=await import('../src/lib/client');
 const state=()=>useVeilnivo.getState();
 const owner={id:crypto.randomUUID(),username:'search_owner',publicKeyJwk:{}};
 const account=(username:string):CachedAccount=>({id:crypto.randomUUID(),username,authDigest:'fixture',auth_salt:'fixture',wrap_salt:'fixture',wrap_iv:'fixture',public_key:{},encrypted_private_key:'fixture'});
 try{
  useVeilnivo.setState({user:owner,mode:'live',error:null,conversations:[],messageRequests:[]});setExpectedAccountId(owner.id);
  await t.test('live lookup binds the account and creates no contacts or requests',async()=>{
   assert.deepEqual(await state().searchUsers('@CANONICAL_PEER'),[{id:'peer-id',username:'canonical_peer',relationship:'none'}]);
   assert.equal(accountHeader,owner.id);assert.deepEqual(state().conversations,[]);assert.deepEqual(state().messageRequests,[]);
  });
  await t.test('a cancelled lookup cannot return a result',async()=>{
   const controller=new AbortController();controller.abort();await assert.rejects(state().searchUsers('canonical_peer',controller.signal),{name:'AbortError'});
  });
  await t.test('a late response cannot cross an identity boundary',async()=>{
   held=true;const waiting=new Promise<void>(resolve=>started=resolve),search=state().searchUsers('canonical_peer');await waiting;
   useVeilnivo.setState({user:{...owner,id:crypto.randomUUID()}});release!();release=undefined;
   await assert.rejects(search,/session changed/);assert.deepEqual(state().conversations,[]);held=false;
  });
  await t.test('local exact aliases resolve canonical identities without side effects',async()=>{
   const alice=account('search_alice'),bob=account('search_bob');await db.accounts.bulkPut([alice,bob]);await db.aliases.put({username:'alice_alias',ownerId:alice.id});
   useVeilnivo.setState({user:{id:bob.id,username:bob.username,publicKeyJwk:{}},mode:'demo',conversations:[],messageRequests:[]});
   assert.deepEqual(await state().searchUsers('alice_alias'),[{id:alice.id,username:alice.username,relationship:'none'}]);assert.equal(await db.requests.count(),0);assert.equal(await db.contacts.count(),0);
   assert.deepEqual(await state().searchUsers('search_ali'),[]);assert.deepEqual(await state().searchUsers('search_bob'),[{id:bob.id,username:bob.username,relationship:'self'}]);
   const requestId=crypto.randomUUID();await db.requests.put({id:requestId,fromId:alice.id,toId:bob.id,fromUsername:alice.username,toUsername:bob.username,fromKey:{},toKey:{},status:'pending',createdAt:Date.now()});
   assert.equal((await state().searchUsers('alice_alias'))[0]?.relationship,'incoming');
   await db.requests.update(requestId,{status:'declined'});assert.deepEqual(await state().searchUsers('alice_alias'),[]);
   await db.requests.update(requestId,{status:'accepted'});assert.equal((await state().searchUsers('alice_alias'))[0]?.relationship,'accepted');
   await db.contacts.put({cacheId:`${alice.id}:${bob.id}`,ownerId:alice.id,peerId:bob.id,username:bob.username,publicKeyJwk:{},blocked:true});assert.deepEqual(await state().searchUsers('alice_alias'),[]);
  });
 }finally{
  release?.();await state().logout();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();
 }
});
