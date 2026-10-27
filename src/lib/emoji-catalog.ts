import data from './emoji-data.json';

export interface EmojiEntry {emoji:string;label:string;category:string;baseId:string;tone:number;keywords:string[]}
export interface EmojiCategory {id:string;label:string;emoji:string}
export const EMOJI_VERSION=data.version;
export const EMOJI_CATEGORIES:EmojiCategory[]=data.categories.map(([id,label,emoji])=>({id,label,emoji}));

const toneNames=['light','medium-light','medium','medium-dark','dark'];
const skinDescriptor=/(?:medium-light|medium-dark|light|medium|dark) skin tone/g;
const normalize=(value:string)=>value.normalize('NFKD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[_:\-,’']/g,' ').replace(/\s+/g,' ').trim();
function baseName(label:string){return label.replace(skinDescriptor,'').replace(/:\s*,\s*/g,': ').replace(/,\s*,\s*/g,', ').replace(/[:,]\s*$/g,'').replace(/\s+/g,' ').trim()}
function skinTone(emoji:string){const tones=[...emoji].map(character=>character.codePointAt(0)!).filter(code=>code>=0x1f3fb&&code<=0x1f3ff);return tones.length===0?0:tones.every(code=>code===tones[0])?tones[0]-0x1f3fa:-1}
function keywords(emoji:string,label:string){
 const words:string[]=[];
 if(/grinning|smiling|beaming|star-struck|partying|tears of joy|laughing/.test(label))words.push('happy','joy','smile');
 if(/heart|kiss/.test(label))words.push('love','romance');
 if(/crying|sad|frowning|disappointed/.test(label))words.push('sad','upset');
 if(/tears of joy|laughing/.test(label))words.push('lol','laugh');
 if(label==='rolling on the floor laughing')words.push('rofl');
 if(label==='thumbs up')words.push('like','approve','yes','thumbsup','+1');
 if(label==='thumbs down')words.push('dislike','no','thumbsdown','-1');
 if(label==='waving hand')words.push('hello','hi','goodbye','wave');
 if(label==='pile of poo')words.push('poop','poo');
 if(label==='party popper')words.push('celebrate','celebration','birthday');
 if(label.startsWith('flag:')){
  const codes=[...emoji].map(value=>value.codePointAt(0)!);
  if(codes.length===2&&codes.every(code=>code>=0x1f1e6&&code<=0x1f1ff))words.push(codes.map(code=>String.fromCharCode(code-0x1f1e6+97)).join(''));
  if(label==='flag: United States')words.push('usa','america');
  if(label==='flag: United Kingdom')words.push('uk','britain');
 }
 return words;
}

export const ALL_EMOJI:EmojiEntry[]=data.rows.map(([emoji,label,category])=>({emoji,label,category,baseId:baseName(label),tone:skinTone(emoji),keywords:keywords(emoji,baseName(label))}));
const byEmoji=new Map(ALL_EMOJI.map(entry=>[entry.emoji,entry]));
const groups=new Map<string,EmojiEntry[]>();
for(const entry of ALL_EMOJI){const group=groups.get(entry.baseId);if(group)group.push(entry);else groups.set(entry.baseId,[entry])}
const baseEntries=[...groups.values()].map(group=>group.find(entry=>entry.tone===0)??group[0]);
const searchIndex=new Map(ALL_EMOJI.map(entry=>[entry.emoji,normalize([entry.label,...entry.keywords].join(' '))]));

export function getEmojiEntry(value:string){return byEmoji.get(value)}
export function getEmojiVariants(value:string):EmojiEntry[]{const entry=byEmoji.get(value);return entry?groups.get(entry.baseId)??[]:[]}
export function getEmojiWithTone(value:string,tone:number):EmojiEntry|undefined{
 const entry=byEmoji.get(value);if(!entry)return;
 const variants=groups.get(entry.baseId)!;
 return variants.find(candidate=>candidate.tone===tone)??variants.find(candidate=>candidate.tone===0)??entry;
}

/** Search locally; base rows expose every exact original variant through getEmojiVariants. */
export function getPickerEmojis(query='',category='all',skinTonePreference=0):EmojiEntry[]{
 const raw=query.trim();
 const exact=byEmoji.get(raw);
 if(exact)return category==='all'||category===exact.category?[exact]:[];
 const terms=normalize(raw).split(' ').filter(Boolean);
 const explicitTone=terms.includes('skin')||toneNames.some(tone=>normalize(tone).split(' ').every(term=>terms.includes(term)));
 const candidates=explicitTone?ALL_EMOJI:baseEntries;
 const preferred=Number.isInteger(skinTonePreference)&&skinTonePreference>=0&&skinTonePreference<=5?skinTonePreference:0;
 return candidates.filter(entry=>(category==='all'||entry.category===category)&&terms.every(term=>searchIndex.get(entry.emoji)!.includes(term))).map(entry=>explicitTone?entry:getEmojiWithTone(entry.emoji,preferred)!);
}
