/** Textarea selection and maxlength use UTF-16 offsets, including ZWJ emoji. */
export function insertEmojiAtSelection(text:string,emoji:string,start:number,end:number,maxLength=10000){
 const clamp=(value:number)=>Number.isFinite(value)?Math.max(0,Math.min(text.length,Math.trunc(value))):text.length;
 let from=clamp(start),to=clamp(end);
 if(from>to)[from,to]=[to,from];
 const insidePair=(index:number)=>index>0&&index<text.length&&/[\uD800-\uDBFF]/.test(text[index-1])&&/[\uDC00-\uDFFF]/.test(text[index]);
 if(from===to&&insidePair(from)){from++;to++}
 else{if(insidePair(from))from--;if(insidePair(to))to++}
 const result=text.slice(0,from)+emoji+text.slice(to);
 if(result.length>maxLength)return null;
 return{text:result,caret:from+emoji.length};
}
