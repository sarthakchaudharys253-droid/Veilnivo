import test from 'node:test';
import assert from 'node:assert/strict';
import {createTypingComposer} from '../src/lib/typing-composer';

test('typing stops after inactivity even while a draft remains',t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:10000});
 const events:boolean[]=[],composer=createTypingComposer(value=>events.push(value));
 assert.deepEqual(events,[],'opening a chat must not announce typing');
 composer.update(true);t.mock.timers.tick(1400);assert.deepEqual(events,[true]);
 t.mock.timers.tick(100);assert.deepEqual(events,[true,false]);
 t.mock.timers.tick(10000);assert.deepEqual(events,[true,false]);
});

test('continuous input renews typing with bounded heartbeats and a fresh idle deadline',t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:10000});
 const events:boolean[]=[],composer=createTypingComposer(value=>events.push(value));
 composer.update(true);t.mock.timers.tick(500);composer.update(true);
 t.mock.timers.tick(500);composer.update(true);assert.deepEqual(events,[true,true]);
 t.mock.timers.tick(1499);assert.deepEqual(events,[true,true]);
 t.mock.timers.tick(1);assert.deepEqual(events,[true,true,false]);
});

test('send, blur, clearing input and disposal stop typing without late events',t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:10000});
 const events:boolean[]=[],composer=createTypingComposer(value=>events.push(value));
 composer.update(true);composer.stop();composer.stop();assert.deepEqual(events,[true,false]);
 composer.update(true);composer.update(false);assert.deepEqual(events,[true,false,true,false]);
 composer.update(true);composer.dispose();composer.update(true);t.mock.timers.tick(10000);
 assert.deepEqual(events,[true,false,true,false,true,false]);
});
