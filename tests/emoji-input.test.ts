import test from 'node:test';
import assert from 'node:assert/strict';
import {insertEmojiAtSelection} from '../src/lib/emoji-input';

test('emoji insertion replaces the selected text and preserves complete Unicode sequences',()=>{
 const family='👨‍👩‍👧‍👦',text=`Hello ${family} India!`;
 const start=text.indexOf('India');
 assert.deepEqual(insertEmojiAtSelection(text,'🇮🇳',start,start+5),{text:`Hello ${family} 🇮🇳!`,caret:start+'🇮🇳'.length});
 const toned='👍🏽';
 assert.deepEqual(insertEmojiAtSelection('hello world',toned,5,5),{text:`hello${toned} world`,caret:5+toned.length});
});

test('emoji picker insertion obeys the composer limit without truncating an emoji',()=>{
 assert.equal(insertEmojiAtSelection('1234','👩🏾‍💻',4,4,6),null);
 assert.deepEqual(insertEmojiAtSelection('1234','👍',2,4,4),{text:'12👍',caret:4});
});

test('malformed selections cannot split a surrogate pair or write outside the draft',()=>{
 assert.deepEqual(insertEmojiAtSelection('😀!','💚',1,1),{text:'😀💚!',caret:4});
 assert.deepEqual(insertEmojiAtSelection('hello','💚',99,-1),{text:'💚',caret:2});
});
