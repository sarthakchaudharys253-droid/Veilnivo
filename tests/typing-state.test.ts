import test from 'node:test';
import assert from 'node:assert/strict';
import {TypingLease,TYPING_LEASE_MS} from '../src/lib/typing-state';

test('a missing stop event expires and further real typing refreshes its lease',t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
 let visible=false;
 const typing=new TypingLease(()=>{visible=typing.isTyping('alice')});
 typing.pulse('alice');assert.equal(visible,true);
 t.mock.timers.tick(TYPING_LEASE_MS-1);assert.equal(visible,true);
 typing.pulse('alice');
 t.mock.timers.tick(TYPING_LEASE_MS-1);assert.equal(visible,true,'old timer cannot expire a refreshed lease');
 t.mock.timers.tick(1);assert.equal(visible,false,'lost typing:false must not leave a permanent indicator');
});

test('typing state is scoped to its peer and stale stop events cannot clear a new conversation',t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
 const typing=new TypingLease(()=>{});
 typing.pulse('alice');assert.equal(typing.isTyping('bob'),false);
 typing.pulse('bob');typing.clear('alice');
 assert.equal(typing.isTyping('bob'),true);
 typing.clear();assert.equal(typing.isTyping('bob'),false);
 t.mock.timers.tick(TYPING_LEASE_MS*2);assert.equal(typing.isTyping('bob'),false);
});

test('clearing an offline, disconnected or locked conversation cancels its pending timeout',t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
 const states:boolean[]=[];
 const typing=new TypingLease(()=>states.push(typing.isTyping('alice')));
 typing.pulse('alice');typing.clear('alice');
 assert.deepEqual(states,[true,false]);
 t.mock.timers.tick(TYPING_LEASE_MS*2);
 assert.deepEqual(states,[true,false],'cleared account timers do not mutate a later session');
});
