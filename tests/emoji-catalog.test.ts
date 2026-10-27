import test from 'node:test';
import assert from 'node:assert/strict';
import data from '../src/lib/emoji-data.json';
import {ALL_EMOJI,EMOJI_CATEGORIES,EMOJI_VERSION,getEmojiEntry,getEmojiVariants,getEmojiWithTone,getPickerEmojis} from '../src/lib/emoji-catalog';

test('vendored catalog contains the entire pinned fully-qualified Unicode17 set',()=>{
 assert.equal(EMOJI_VERSION,'17.0');assert.equal(ALL_EMOJI.length,3944);
 assert.equal(new Set(ALL_EMOJI.map(entry=>entry.emoji)).size,3944);
 assert.equal(data.sourceSha256,'1d8a944f88d7952f7ef7c5167fef3c67995bcae24543949710231b03a201acda');
 assert.equal(EMOJI_CATEGORIES.length,9);
 for(const value of ['🫪','🩷','🐦‍🔥','🧑🏽‍🚀','🏳️‍🌈','🇮🇳','🏴\u{e0067}\u{e0062}\u{e0073}\u{e0063}\u{e0074}\u{e007f}','🫱🏻‍🫲🏿'])assert.ok(getEmojiEntry(value),value);
 assert.ok(ALL_EMOJI.every(entry=>EMOJI_CATEGORIES.some(category=>category.id===entry.category)));
});

test('every original sequence is reachable from a visible base row and its variants',()=>{
 const reachable=new Set(getPickerEmojis().flatMap(entry=>getEmojiVariants(entry.emoji).map(variant=>variant.emoji)));
 assert.equal(reachable.size,ALL_EMOJI.length);
 for(const entry of ALL_EMOJI)assert.ok(reachable.has(entry.emoji),entry.label);
});

test('preferred tones preserve names, gender joins and exact mixed-tone variants',()=>{
 assert.equal(getEmojiWithTone('👍',3)?.emoji,'👍🏽');
 assert.equal(getEmojiWithTone('👩‍💻',5)?.emoji,'👩🏿‍💻');
 assert.equal(getEmojiWithTone('❤️',4)?.emoji,'❤️');
 assert.ok(getEmojiVariants('🤝').some(entry=>entry.emoji==='🫱🏻‍🫲🏿'));
 assert.equal(getPickerEmojis('🫱🏻‍🫲🏿')[0]?.emoji,'🫱🏻‍🫲🏿');
 assert.equal(getEmojiWithTone('not an emoji',2),undefined);
});

test('search recognizes names, friendly aliases, country codes and exact emoji locally',()=>{
 assert.ok(getPickerEmojis('happy').some(entry=>entry.emoji==='😀'));
 assert.ok(getPickerEmojis('love').some(entry=>entry.emoji==='❤️'));
 assert.ok(getPickerEmojis('India','flags').some(entry=>entry.emoji==='🇮🇳'));
 assert.ok(getPickerEmojis('usa').some(entry=>entry.emoji==='🇺🇸'));
 assert.ok(getPickerEmojis(':thumbs_up:','people',3).some(entry=>entry.emoji==='👍🏽'));
 assert.deepEqual(getPickerEmojis('🇮🇳','food'),[]);
 assert.deepEqual(getPickerEmojis('nothingmatches12345'),[]);
 assert.ok(getPickerEmojis('handshake light skin tone').some(entry=>entry.emoji==='🤝🏻'));
});
