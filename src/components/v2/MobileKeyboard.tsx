'use client';

import {useEffect,useRef,useState,type PointerEvent as ReactPointerEvent} from 'react';
import {ArrowLeft,ArrowRight,ArrowUp,CornerDownLeft,Delete,Keyboard,Smile,ChevronDown} from 'lucide-react';
import styles from './MobileKeyboard.module.css';

interface MobileKeyboardProps {
 onKey:(key:string)=>void;
 onEmoji:()=>void;
 onClose:()=>void;
 onSend:()=>void;
 sendDisabled?:boolean;
}

const LETTERS=['qwertyuiop','asdfghjkl','zxcvbnm'];
const NUMBERS=[['1','2','3','4','5','6','7','8','9','0'],['-','/',':',';','(',')','₹','&','@','"']];
const SYMBOLS=[['[',']','{','}','#','%','^','*','+','='],['_','\\','|','~','<','>','€','£','¥','•']];
const PUNCTUATION=['.',',','?','!',"'"];

export default function MobileKeyboard({onKey,onEmoji,onClose,onSend,sendDisabled=false}:MobileKeyboardProps){
 const [page,setPage]=useState<'letters'|'numbers'|'symbols'>('letters'),[shift,setShift]=useState<'off'|'once'|'caps'>('off');
 const shiftTap=useRef(0),repeatDelay=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),repeat=useRef<ReturnType<typeof setInterval>|undefined>(undefined);
 const keyCallback=useRef(onKey);keyCallback.current=onKey;
 const keepFocus=(event:ReactPointerEvent)=>event.preventDefault();
 function stopRepeat(){if(repeatDelay.current!==undefined)clearTimeout(repeatDelay.current);if(repeat.current!==undefined)clearInterval(repeat.current);repeatDelay.current=undefined;repeat.current=undefined}
 useEffect(()=>{window.addEventListener('blur',stopRepeat);return()=>{window.removeEventListener('blur',stopRepeat);stopRepeat()}},[]);
 useEffect(()=>{stopRepeat()},[page]);
 function character(value:string){onKey(value);if(shift==='once')setShift('off')}
 function shiftKey(){const now=Date.now();if(now-shiftTap.current<350){shiftTap.current=0;setShift('caps')}else{shiftTap.current=now;setShift(value=>value==='off'?'once':'off')}}
 function backspace(event:ReactPointerEvent<HTMLButtonElement>){event.preventDefault();if(event.button!==0||!event.isPrimary)return;stopRepeat();const emit=keyCallback.current;emit('Backspace');repeatDelay.current=setTimeout(()=>{repeatDelay.current=undefined;repeat.current=setInterval(()=>emit('Backspace'),70)},350)}
 const remove=<button type="button" className={`${styles.key} ${styles.modifier}`} aria-label="Backspace" title="Backspace" onPointerDown={backspace} onPointerUp={stopRepeat} onPointerCancel={stopRepeat} onPointerLeave={stopRepeat} onClick={event=>{if(event.detail===0)onKey('Backspace')}}><Delete size={20}/></button>;
 const key=(value:string)=><button type="button" key={value} className={styles.key} aria-label={value===' '? 'Space':value} onPointerDown={keepFocus} onClick={()=>character(value)}>{value}</button>;

 return <section className={styles.keyboard} role="group" aria-label="Veilnivo keyboard" onContextMenu={event=>event.preventDefault()}>
  <div className={styles.toolbar}><span className={styles.brand}><Keyboard size={13}/>Veilnivo</span><div><button type="button" aria-label="Open emoji keyboard" title="Emoji" onPointerDown={keepFocus} onClick={onEmoji}><Smile size={18}/></button><button type="button" aria-label="Move cursor left" title="Move cursor left" onPointerDown={keepFocus} onClick={()=>onKey('ArrowLeft')}><ArrowLeft size={17}/></button><button type="button" aria-label="Move cursor right" title="Move cursor right" onPointerDown={keepFocus} onClick={()=>onKey('ArrowRight')}><ArrowRight size={17}/></button><button type="button" aria-label="Hide keyboard" title="Hide keyboard" onPointerDown={keepFocus} onClick={onClose}><ChevronDown size={19}/></button></div></div>
  {page==='letters'?<>
   <div className={styles.row}>{[...LETTERS[0]].map(value=>key(shift==='off'?value:value.toUpperCase()))}</div>
   <div className={`${styles.row} ${styles.indented}`}>{[...LETTERS[1]].map(value=>key(shift==='off'?value:value.toUpperCase()))}</div>
   <div className={styles.row}><button type="button" className={`${styles.key} ${styles.modifier} ${shift!=='off'?styles.shiftActive:''}`} aria-label={shift==='caps'?'Caps lock on':'Shift'} aria-pressed={shift!=='off'} title="Shift · tap twice for caps lock" onPointerDown={keepFocus} onClick={shiftKey}><ArrowUp size={19}/>{shift==='caps'&&<i/>}</button>{[...LETTERS[2]].map(value=>key(shift==='off'?value:value.toUpperCase()))}{remove}</div>
  </>:<>
   {(page==='numbers'?NUMBERS:SYMBOLS).map((row,index)=><div className={styles.row} key={index}>{row.map(key)}</div>)}
   <div className={styles.row}><button type="button" className={`${styles.key} ${styles.modifier} ${styles.pageSwitch}`} aria-label={page==='numbers'?'Show symbols':'Show numbers'} onPointerDown={keepFocus} onClick={()=>setPage(page==='numbers'?'symbols':'numbers')}>{page==='numbers'?'#+=':'123'}</button>{PUNCTUATION.map(key)}{remove}</div>
  </>}
  <div className={`${styles.row} ${styles.bottom}`}><button type="button" className={`${styles.key} ${styles.modifier} ${styles.pageSwitch}`} aria-label={page==='letters'?'Show numbers':'Show letters'} onPointerDown={keepFocus} onClick={()=>setPage(page==='letters'?'numbers':'letters')}>{page==='letters'?'123':'ABC'}</button>{key(',')}<button type="button" className={`${styles.key} ${styles.space}`} aria-label="Space" onPointerDown={keepFocus} onClick={()=>character(' ')}>space</button>{key('.')}<button type="button" className={`${styles.key} ${styles.modifier}`} aria-label="Insert new line" title="New line" onPointerDown={keepFocus} onClick={()=>onKey('Enter')}><CornerDownLeft size={18}/></button><button type="button" className={`${styles.key} ${styles.send}`} aria-label="Send message from keyboard" disabled={sendDisabled} onPointerDown={keepFocus} onClick={onSend}><ArrowUp size={18}/><span>Send</span></button></div>
 </section>;
}
