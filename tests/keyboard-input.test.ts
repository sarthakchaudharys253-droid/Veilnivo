import test from 'node:test';
import assert from 'node:assert/strict';
import {applyKeyboardInput} from '../src/lib/keyboard-input';

test('website keyboard inserts at the caret, replaces a selection and supports newlines',()=>{
 assert.deepEqual(applyKeyboardInput('hello world',6,11,'friend'),{text:'hello friend',selectionStart:12,selectionEnd:12});
 assert.deepEqual(applyKeyboardInput('abc',1,1,'Enter'),{text:'a\nbc',selectionStart:2,selectionEnd:2});
 assert.equal(applyKeyboardInput('1234',4,4,'5',4),null);
});

test('backspace and delete remove whole joined emoji, flags and skin-tone sequences',()=>{
 for(const emoji of ['👨‍👩‍👧‍👦','🇮🇳','👍🏽','🫱🏻‍🫲🏿','1️⃣']){
  assert.deepEqual(applyKeyboardInput('A'+emoji,1+emoji.length,1+emoji.length,'Backspace'),{text:'A',selectionStart:1,selectionEnd:1});
  assert.deepEqual(applyKeyboardInput(emoji+'B',0,0,'Delete'),{text:'B',selectionStart:0,selectionEnd:0});
 }
});

test('cursor keys move over complete characters and collapse selections safely',()=>{
 const text='A👩🏾‍💻B',position=text.length-1;
 assert.equal(applyKeyboardInput(text,position,position,'ArrowLeft')?.selectionStart,1);
 assert.equal(applyKeyboardInput(text,1,1,'ArrowRight')?.selectionStart,position);
 assert.equal(applyKeyboardInput(text,1,position,'ArrowRight')?.selectionStart,position);
 assert.equal(applyKeyboardInput(text,position,position,'Home')?.selectionStart,0);
});

test('pasted text is literal even when it looks like a keyboard command',()=>{
 for(const text of ['Backspace','Enter','ArrowLeft'])assert.equal(applyKeyboardInput('A',1,1,{text})?.text,'A'+text);
});
