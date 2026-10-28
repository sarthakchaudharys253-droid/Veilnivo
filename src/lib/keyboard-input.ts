const segmenter=typeof Intl.Segmenter==='function'?new Intl.Segmenter(undefined,{granularity:'grapheme'}):null;
function boundaries(text:string){
 if(segmenter)return [...segmenter.segment(text)].map(part=>part.index).concat(text.length);
 // Older browsers still keep combining marks and emoji joins together.
 const result=[0];let offset=0,previous='',regional=0;
 for(const character of text){
  const point=character.codePointAt(0)!;
  const isRegional=point>=0x1f1e6&&point<=0x1f1ff;
  const joined=previous==='\u200d'||character==='\u200d'||/\p{Mark}/u.test(character)||point===0xfe0f||point>=0x1f3fb&&point<=0x1f3ff||point>=0xe0020&&point<=0xe007f||isRegional&&regional%2===1;
  if(offset&&!joined)result.push(offset);
  offset+=character.length;regional=isRegional?regional+1:0;previous=character;
 }
 if(result.at(-1)!==text.length)result.push(text.length);return result;
}

/** Edits text using grapheme boundaries, so one backspace removes one emoji. */
export function applyKeyboardInput(text:string,start:number,end:number,key:string|{text:string},maxLength=10000){
 const clamp=(value:number)=>Number.isFinite(value)?Math.max(0,Math.min(text.length,Math.trunc(value))):text.length;
 let from=clamp(start),to=clamp(end);if(from>to)[from,to]=[to,from];
 const points=boundaries(text),prior=(position:number,inclusive=false)=>{for(let index=points.length-1;index>=0;index--)if(inclusive?points[index]<=position:points[index]<position)return points[index];return 0};
 const floor=(position:number)=>prior(position,true),ceil=(position:number)=>points.find(point=>point>=position)??text.length;
 if(from===to)from=to=ceil(from);else{from=floor(from);to=ceil(to)}
 const before=(position:number)=>prior(position),after=(position:number)=>points.find(point=>point>position)??text.length;
 const command=typeof key==='string'?key:null;
 if(command==='ArrowLeft'||command==='ArrowRight'||command==='Home'||command==='End'){
  const caret=command==='Home'?0:command==='End'?text.length:command==='ArrowLeft'?(from!==to?from:before(from)):(from!==to?to:after(to));
  return{text,selectionStart:caret,selectionEnd:caret};
 }
 let insert=typeof key==='object'?key.text:command==='Enter'?'\n':key;
 if(command==='Backspace'){if(from===to)from=before(from);insert=''}
 if(command==='Delete'){if(from===to)to=after(to);insert=''}
 const result=text.slice(0,from)+insert+text.slice(to);if(result.length>maxLength)return null;
 const caret=from+insert.length;return{text:result,selectionStart:caret,selectionEnd:caret};
}
