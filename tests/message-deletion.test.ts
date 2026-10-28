import test from 'node:test';
import assert from 'node:assert/strict';
import {DELETE_FOR_EVERYONE_WINDOW_MS,earliestReadAt,getMessageDeletionState} from '../src/lib/message-deletion';

test('unread deletion remains available and the first-read window closes exactly at 30 minutes',()=>{
 const now=2_000_000_000_000,message={own:true,status:'sent'};
 assert.deepEqual(getMessageDeletionState(message,now),{allowed:true});
 const readAt=now-DELETE_FOR_EVERYONE_WINDOW_MS;
 assert.deepEqual(getMessageDeletionState({...message,status:'read',readAt},now-1),{allowed:true,expiresAt:now});
 assert.equal(getMessageDeletionState({...message,status:'read',readAt},now).allowed,false);
 assert.equal(getMessageDeletionState({...message,status:'sent',readAt},now+1).allowed,false,'an old sent snapshot cannot clear an authoritative first read');
 assert.equal(earliestReadAt(readAt,now,undefined,NaN),readAt,'a duplicate receipt never extends the window');
});

test('missing or malformed read metadata fails closed without restricting Delete for me',()=>{
 const now=2_000_000_000_000;
 for(const readAt of [undefined,0,-1,NaN,Infinity]){
  const state=getMessageDeletionState({own:true,status:'read',readAt},now);
  assert.equal(state.allowed,false);assert.match(state.reason??'',/Refresh/);
 }
 assert.equal(getMessageDeletionState({own:true,status:'sent',readAt:NaN},now).allowed,false);
 for(const status of ['queued','sending','failed'])assert.equal(getMessageDeletionState({own:true,status},now).allowed,false);
 for(const changed of [{own:false},{deleted:true},{system:true},{isBot:true},{expiresAt:now}])assert.equal(getMessageDeletionState({own:true,status:'sent',...changed},now).allowed,false);
});
