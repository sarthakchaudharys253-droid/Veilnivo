import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageGesture,MESSAGE_HOLD_MS} from '../src/lib/message-gestures';

const start={pointerId:1,x:100,y:100,time:1000,own:false,pointerType:'touch'};

test('swipe-to-reply follows each message author direction and requires the threshold',()=>{
 const received=new MessageGesture();received.begin(start);assert.equal(received.move(1,165,102).claimed,true);assert.equal(received.finish(1,1200),true);
 const own=new MessageGesture();own.begin({...start,own:true});assert.equal(own.move(1,34,100).offset,-66);assert.equal(own.finish(1,1200),true);
 const wrong=new MessageGesture();wrong.begin(start);wrong.move(1,20,100);assert.equal(wrong.finish(1,1200),false);
 const short=new MessageGesture();short.begin(start);short.move(1,160,100);assert.equal(short.finish(1,1200),false);
});

test('vertical scrolling, pointer cancellation and a second touch cannot trigger reply or hold',()=>{
 const scroll=new MessageGesture();scroll.begin(start);assert.equal(scroll.move(1,105,140).claimed,false);assert.equal(scroll.hold(2000),false);assert.equal(scroll.finish(1,2100),false);
 const cancel=new MessageGesture();cancel.begin(start);cancel.move(1,180,100);cancel.cancel();assert.equal(cancel.finish(1,1200),false);
 const multi=new MessageGesture();multi.begin(start);assert.equal(multi.begin({...start,pointerId:2,primary:false}),false);assert.equal(multi.hold(2000),false);assert.equal(multi.finish(1,2000),false);
});

test('long press fires once, ignores moved/interactive/selected input and suppresses the ghost click',()=>{
 const hold=new MessageGesture();assert.equal(hold.begin(start),true);assert.equal(hold.hold(1000+MESSAGE_HOLD_MS-1),false);assert.equal(hold.hold(1500),true);assert.equal(hold.hold(1600),false);assert.equal(hold.finish(1,2000),false);assert.equal(hold.suppressClick(2100),true);assert.equal(hold.suppressClick(2600),false);
 const moved=new MessageGesture();moved.begin(start);moved.move(1,110,100);assert.equal(moved.hold(2000),false);
 const interactive=new MessageGesture();assert.equal(interactive.begin({...start,interactive:true}),false);assert.equal(interactive.hold(2000),false);
 assert.equal(interactive.begin({...start,hasSelection:true}),false);
 const mouse=new MessageGesture();mouse.begin({...start,pointerType:'mouse'});mouse.move(1,190,100);assert.equal(mouse.finish(1,2000),false,'text selection with a mouse is not a swipe');
});
