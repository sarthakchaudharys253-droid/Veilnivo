// Unicode 17 character sequences only; labels/search data stay in the lazy picker.
// Same Unicode License V3 attribution as public/emoji-attribution.txt.
import sequences from './reaction-emoji-data.json';
const allowed=new Set(sequences);
export function isReactionEmoji(value:unknown):value is string{return typeof value==='string'&&allowed.has(value)}
