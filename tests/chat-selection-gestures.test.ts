import assert from 'node:assert/strict';
import test from 'node:test';
import {ChatSelectionGesture,CHAT_SELECTION_HOLD_MS} from '../src/lib/chat-selection-gestures';

const touch={id:'first-chat',pointerId:1,pointerType:'touch',x:40,y:90,time:1000,primary:true,button:0};
test('a stationary hold selects once and suppresses only the held row through release',()=>{
 const gesture=new ChatSelectionGesture();assert.equal(gesture.begin(touch),true);
 assert.equal(gesture.hold(1000+CHAT_SELECTION_HOLD_MS-1),null);
 assert.equal(gesture.hold(1000+CHAT_SELECTION_HOLD_MS),'first-chat');
 assert.equal(gesture.hold(1700),null,'one hold cannot toggle its initial selection twice');
 assert.equal(gesture.suppressClick('second-chat',1700),false,'a tap on another chat remains available');
 gesture.finish(1,4000);assert.equal(gesture.suppressClick('first-chat',4001),true,'a long-held release cannot open or deselect the row');
 assert.equal(gesture.suppressClick('first-chat',4500),false);
});
test('scroll movement, pointer cancellation and a second touch cannot complete a hold',()=>{
 const gesture=new ChatSelectionGesture();gesture.begin(touch);assert.equal(gesture.move(1,41,110),true);assert.equal(gesture.hold(1800),null);gesture.finish(1,1900);assert.equal(gesture.suppressClick('first-chat',1901),true);
 gesture.begin({...touch,time:3000});gesture.cancel(3100);assert.equal(gesture.hold(3600),null);
 gesture.begin({...touch,time:4000});assert.equal(gesture.begin({...touch,pointerId:2,primary:false,time:4050}),false);assert.equal(gesture.hold(4700),null);
 gesture.begin({...touch,time:5000});assert.equal(gesture.move(1,60,91),true);assert.equal(gesture.hold(5700),null,'horizontal drags do not select a chat');
});
test('ordinary taps, mouse presses and unrelated pointers never trigger touch selection',()=>{
 const gesture=new ChatSelectionGesture();assert.equal(gesture.begin({...touch,pointerType:'mouse'}),false);assert.equal(gesture.hold(1800),null);
 assert.equal(gesture.begin({...touch,button:2}),false);
 gesture.begin(touch);gesture.finish(2,1200);assert.equal(gesture.hold(1499),null);gesture.finish(1,1200);assert.equal(gesture.suppressClick('first-chat',1201),false);assert.equal(gesture.hold(1700),null);
});
test('a native touch context menu also retains the initial selection through release',()=>{
 const gesture=new ChatSelectionGesture();assert.equal(gesture.nativeHold('first-chat',1000),false,'a desktop right-click has no touch click to suppress');gesture.begin(touch);assert.equal(gesture.nativeHold('first-chat',1400),true);assert.equal(gesture.hold(1700),null);gesture.finish(1,4000);assert.equal(gesture.suppressClick('first-chat',4001),true);assert.equal(gesture.suppressClick('second-chat',4001),false);
});
