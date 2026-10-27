'use client';

import {useDeferredValue,useEffect,useId,useMemo,useRef,useState,type CSSProperties,type KeyboardEvent,type RefObject} from 'react';
import {createPortal} from 'react-dom';
import {ArrowLeft,ChevronDown,Clock3,Search,Smile,X} from 'lucide-react';
import {EMOJI_CATEGORIES,getEmojiEntry,getEmojiVariants,getPickerEmojis,type EmojiEntry} from '@/lib/emoji-catalog';
import styles from './EmojiPicker.module.css';

interface EmojiPickerProps {
 anchorRef:RefObject<HTMLDivElement|null>;
 onSelect:(emoji:string)=>void;
 onClose:(restoreFocus?:boolean)=>void;
 recentEmoji?:string[];
 skinTone?:number;
 onSkinToneChange?:(tone:number)=>void;
}

const TONES=[['🖐️','Default'],['🖐🏻','Light'],['🖐🏼','Medium-light'],['🖐🏽','Medium'],['🖐🏾','Medium-dark'],['🖐🏿','Dark']];

export default function EmojiPicker({anchorRef,onSelect,onClose,recentEmoji=[],skinTone=0,onSkinToneChange}:EmojiPickerProps){
 const [query,setQuery]=useState(''),[category,setCategory]=useState(()=>recentEmoji.length?'recent':EMOJI_CATEGORIES[0]?.id??'all');
 const [variantOf,setVariantOf]=useState<string|null>(null),[activeIndex,setActiveIndex]=useState(0),[hovered,setHovered]=useState('');
 const [position,setPosition]=useState<CSSProperties|null>(null);
 const panel=useRef<HTMLDivElement>(null),search=useRef<HTMLInputElement>(null),list=useRef<HTMLDivElement>(null);
 const closeRef=useRef(onClose);closeRef.current=onClose;
 const deferredQuery=useDeferredValue(query),resultsId=useId();
 const entries=useMemo(()=>{
  if(variantOf)return getEmojiVariants(variantOf);
  if(!deferredQuery.trim()&&category==='recent')return recentEmoji.map(value=>getEmojiEntry(value)).filter((entry):entry is EmojiEntry=>!!entry);
  return getPickerEmojis(deferredQuery,deferredQuery.trim()?'all':category,skinTone);
 },[variantOf,deferredQuery,category,skinTone,recentEmoji]);
 const categories=[{id:'recent',label:'Recently used',emoji:''},{id:'all',label:'All emoji',emoji:''},...EMOJI_CATEGORIES];
 const heading=variantOf?`${getEmojiEntry(variantOf)?.label??'Emoji'} variations`:query.trim()?'Search results':categories.find(value=>value.id===category)?.label??'Emoji';

 useEffect(()=>{
  const place=()=>{
   const anchor=anchorRef.current?.getBoundingClientRect();if(!anchor)return;
   const viewport=window.visualViewport,leftEdge=viewport?.offsetLeft??0,topEdge=viewport?.offsetTop??0;
   const width=viewport?.width??window.innerWidth,height=viewport?.height??window.innerHeight;
   const panelWidth=Math.min(360,Math.max(180,width-24));
   const above=anchor.top-topEdge-20,below=topEdge+height-anchor.bottom-20;
   const available=Math.max(above,below);
   const panelHeight=Math.min(400,Math.max(120,available),Math.max(120,height-24));
   const top=above>=below?anchor.top-panelHeight-10:anchor.bottom+10;
   setPosition({left:Math.max(leftEdge+12,Math.min(anchor.left-8,leftEdge+width-panelWidth-12)),top:Math.max(topEdge+12,Math.min(top,topEdge+height-panelHeight-12)),width:panelWidth,height:panelHeight});
  };
  place();
  window.addEventListener('resize',place);window.addEventListener('scroll',place,true);
  window.visualViewport?.addEventListener('resize',place);window.visualViewport?.addEventListener('scroll',place);
  const outside=(event:PointerEvent)=>{const target=event.target;if(target instanceof Node&&!panel.current?.contains(target)&&!anchorRef.current?.contains(target))closeRef.current(false)};
  const escape=(event:globalThis.KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeRef.current(true)}};
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape,true);
  const frame=requestAnimationFrame(()=>{
   if(window.matchMedia('(pointer: fine)').matches)search.current?.focus({preventScroll:true});
   else panel.current?.focus({preventScroll:true});
  });
  return()=>{cancelAnimationFrame(frame);window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);window.visualViewport?.removeEventListener('resize',place);window.visualViewport?.removeEventListener('scroll',place);document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape,true)};
 },[anchorRef]);

 useEffect(()=>{setActiveIndex(0);setHovered('');if(list.current)list.current.scrollTop=0;const frame=variantOf?requestAnimationFrame(()=>list.current?.querySelector<HTMLButtonElement>('[data-emoji-index="0"]')?.focus()):undefined;return()=>{if(frame!==undefined)cancelAnimationFrame(frame)}},[deferredQuery,category,skinTone,variantOf]);

 function chooseCategory(id:string){setCategory(id);setQuery('');setVariantOf(null)}
 function focusEmoji(index:number){
  const next=Math.max(0,Math.min(index,entries.length-1));setActiveIndex(next);
  list.current?.querySelector<HTMLButtonElement>(`[data-emoji-index="${next}"]`)?.focus();
 }
 function navigateGrid(event:KeyboardEvent<HTMLDivElement>){
  const target=event.target as HTMLElement,index=target.dataset.emojiIndex;if(index===undefined)return;
  const current=Number(index),columns=8;
  const next=event.key==='ArrowRight'?current+1:event.key==='ArrowLeft'?current-1:event.key==='ArrowDown'?current+columns:event.key==='ArrowUp'?current-columns:event.key==='Home'?0:event.key==='End'?entries.length-1:null;
  if(next!==null){event.preventDefault();focusEmoji(next)}
 }
 function navigateCategories(event:KeyboardEvent<HTMLDivElement>){
  const button=(event.target as HTMLElement).closest<HTMLButtonElement>('button[data-category]');if(!button)return;
  const current=categories.findIndex(value=>value.id===button.dataset.category);
  const next=event.key==='ArrowRight'?(current+1)%categories.length:event.key==='ArrowLeft'?(current+categories.length-1)%categories.length:null;
  if(next!==null){event.preventDefault();chooseCategory(categories[next].id);event.currentTarget.querySelector<HTMLButtonElement>(`[data-category="${categories[next].id}"]`)?.focus()}
 }

 return createPortal(<div ref={panel} className={styles.panel} style={position??{visibility:'hidden'}} role="dialog" aria-label="Emoji picker" tabIndex={-1}>
  <div className={styles.heading}><div><Smile size={16}/><strong>Emoji</strong></div><button type="button" aria-label="Close emoji picker" title="Close emoji picker" onClick={()=>onClose(true)}><X size={17}/></button></div>
  <div className={styles.search}><Search size={15}/><input ref={search} aria-label="Search emoji" placeholder="Search emoji" value={query} maxLength={80} onChange={event=>{setQuery(event.target.value);setVariantOf(null)}} onKeyDown={event=>{if(event.key==='ArrowDown'&&entries.length){event.preventDefault();focusEmoji(0)}}}/>{query&&<button type="button" aria-label="Clear emoji search" onClick={()=>{setQuery('');search.current?.focus()}}><X size={14}/></button>}</div>
  <div className={styles.categories} role="tablist" aria-label="Emoji categories" onKeyDown={navigateCategories}>{categories.map(value=><button type="button" key={value.id} role="tab" aria-label={value.label} title={value.label} aria-selected={!query.trim()&&category===value.id} tabIndex={category===value.id?0:-1} data-category={value.id} onClick={()=>chooseCategory(value.id)}>{value.id==='recent'?<Clock3 size={17}/>:value.id==='all'?<Smile size={17}/>:<span>{value.emoji}</span>}</button>)}</div>
  <div className={styles.toolbar}><span id={resultsId}>{heading}</span><label className={styles.tone}><span aria-hidden="true">{TONES[skinTone]?.[0]??TONES[0][0]}</span><select aria-label="Emoji skin tone" value={skinTone} onChange={event=>{onSkinToneChange?.(Number(event.target.value));setVariantOf(null)}}>{TONES.map((tone,index)=><option key={tone[1]} value={index}>{tone[1]} skin tone</option>)}</select><ChevronDown size={11} aria-hidden="true"/></label></div>
  {variantOf&&<button type="button" className={styles.back} onClick={()=>setVariantOf(null)}><ArrowLeft size={13}/>Back to emoji</button>}
  <div ref={list} className={styles.results} onKeyDown={navigateGrid} aria-labelledby={resultsId}>
   {entries.length?<div className={styles.grid} role="list">{entries.map((entry,index)=>{
    const hasVariants=!variantOf&&getEmojiVariants(entry.emoji).length>1;
    return <div key={entry.emoji} className={styles.cell} role="listitem"><button type="button" className={styles.emoji} data-emoji-index={index} aria-label={entry.label} title={entry.label} tabIndex={index===activeIndex?0:-1} onFocus={()=>{setActiveIndex(index);setHovered(entry.label)}} onMouseEnter={()=>setHovered(entry.label)} onClick={()=>onSelect(entry.emoji)}>{entry.emoji}</button>{hasVariants&&<button type="button" className={styles.variants} aria-label={`Variants of ${entry.label}`} title={`Variants of ${entry.label}`} tabIndex={index===activeIndex?0:-1} onClick={()=>setVariantOf(entry.emoji)}><ChevronDown size={9}/></button>}</div>;
   })}</div>:<div className={styles.empty}><Search size={23}/><strong>{category==='recent'&&!query.trim()?'Your favorites start here':'No emoji found'}</strong><p>{category==='recent'&&!query.trim()?'Emoji you choose appear here during this session.':'Try a word like “heart”, “cat” or “India”.'}</p></div>}
  </div>
  <div className={styles.footer}><span title={hovered}>{hovered||`${entries.length.toLocaleString()} emoji`}</span><small>Device emoji style</small></div>
 </div>,document.body);
}
