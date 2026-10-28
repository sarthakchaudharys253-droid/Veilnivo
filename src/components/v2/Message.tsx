'use client';
import {useEffect,useRef,useState,type CSSProperties,type PointerEvent as ReactPointerEvent} from 'react';
import dynamic from 'next/dynamic';
import {createPortal} from 'react-dom';
import {ArrowDownToLine,Check,CheckCheck,CheckSquare,Clock3,FileText,Forward,Image as ImageIcon,MoreHorizontal,Pencil,Reply,RotateCw,Smile,Trash2,AlertCircle} from 'lucide-react';
import {Avatar,formatBytes,formatTime} from './UI';
import {sanitizedFilename} from '@/lib/chat-utils';
import {MessageGesture,MESSAGE_HOLD_MS} from '@/lib/message-gestures';
import {useVeilnivo,type Conversation,type ChatMessage} from '@/lib/store';
import styles from './MessageActions.module.css';

const EmojiPicker=dynamic(()=>import('./EmojiPicker'),{ssr:false});
interface MessageProps {
 message:ChatMessage;
 contact:Conversation;
 onReply:()=>void;
 onEdit?:()=>void;
 onForward?:()=>void;
 onDelete?:()=>void;
 onToggleSelect?:()=>void;
 selected?:boolean;
 selectionMode?:boolean;
}

export default function Message({message:m,contact,onReply,onEdit,onForward,onDelete,onToggleSelect,selected=false,selectionMode=false}:MessageProps){
 const s=useVeilnivo();
 const message=m as ChatMessage&{edited?:boolean;editedAt?:number;forwarded?:boolean;deleted?:boolean};
 const [picker,setPicker]=useState(false),[menu,setMenu]=useState<{x:number;y:number}|null>(null),[menuPosition,setMenuPosition]=useState<CSSProperties|null>(null);
 const [downloading,setDownloading]=useState(false),[offset,setOffset]=useState(0),[skinTone,setSkinTone]=useState(0),[recentEmoji,setRecentEmoji]=useState<string[]>([]);
 const bubble=useRef<HTMLDivElement>(null),menuPanel=useRef<HTMLDivElement>(null),moreButton=useRef<HTMLButtonElement>(null);
 const gesture=useRef(new MessageGesture()),holdTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),downloadTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 const stable=m.status!=='queued'&&m.status!=='sending'&&m.status!=='failed';
 const canReact=!message.deleted&&!contact.isBot&&!contact.blocked&&contact.requestStatus!=='outgoing'&&stable;
 const canEdit=!!onEdit&&m.own&&!message.deleted&&!contact.isBot&&stable;
 const clearHold=()=>{if(holdTimer.current!==undefined)clearTimeout(holdTimer.current);holdTimer.current=undefined};
 const cancelDownload=()=>{if(downloadTimer.current!==undefined)clearTimeout(downloadTimer.current);downloadTimer.current=undefined};
 const cancelGesture=()=>{clearHold();gesture.current.cancel();setOffset(0)};
 const current=()=>{const state=useVeilnivo.getState();return state.user?.id===s.user?.id&&state.activeId===contact.id};
 const interactive=(target:EventTarget|null)=>{const control=target instanceof Element?target.closest('button,a,input,textarea,select,[role="button"],[data-message-interactive]'):null;return !!control&&!control.classList.contains('attachment-card')};
 const selectedText=()=>{const selection=window.getSelection();return !!selection&&!selection.isCollapsed&&!!selection.anchorNode&&!!bubble.current?.contains(selection.anchorNode)};

 function openMenu(point?:{x:number;y:number}){
  if(!current())return;
  cancelGesture();cancelDownload();setPicker(false);
  const rect=bubble.current?.getBoundingClientRect();
  setMenuPosition(null);setMenu(point??{x:rect?.right??20,y:rect?.top??20});
 }
 function closeMenu(focus=false){setMenu(null);if(focus)moreButton.current?.focus({preventScroll:true})}
 function openReactions(){cancelDownload();if(!canReact||!current())return;cancelGesture();setMenu(null);setPicker(true)}
 function react(emoji:string){if(!canReact||!current())return;setRecentEmoji(previous=>[emoji,...previous.filter(value=>value!==emoji)].slice(0,24));void useVeilnivo.getState().reactToMessage(m.id,emoji);setMenu(null);setPicker(false);moreButton.current?.focus({preventScroll:true})}
 function run(action:(()=>void)|undefined){closeMenu();if(current())action?.()}

 useEffect(()=>{const secondary=(event:PointerEvent)=>{if(event.pointerType==='touch'&&!event.isPrimary){clearHold();cancelDownload();gesture.current.cancel();setOffset(0)}};document.addEventListener('pointerdown',secondary,true);return()=>{document.removeEventListener('pointerdown',secondary,true);if(holdTimer.current!==undefined)clearTimeout(holdTimer.current);if(downloadTimer.current!==undefined)clearTimeout(downloadTimer.current);gesture.current.cancel()}},[]);
 useEffect(()=>{if(message.deleted||selectionMode){setMenu(null);setPicker(false);cancelGesture();cancelDownload()}},[message.deleted,selectionMode]);
 useEffect(()=>{
  if(!menu)return;
  const place=()=>{
   const viewport=window.visualViewport,left=viewport?.offsetLeft??0,top=viewport?.offsetTop??0,width=viewport?.width??window.innerWidth,height=viewport?.height??window.innerHeight;
   const rect=menuPanel.current?.getBoundingClientRect(),menuWidth=Math.min(286,width-24),menuHeight=Math.min(rect?.height??310,height-24);
   setMenuPosition({left:Math.max(left+12,Math.min(menu.x-menuWidth+20,left+width-menuWidth-12)),top:Math.max(top+12,Math.min(menu.y-10,top+height-menuHeight-12)),width:menuWidth,maxHeight:Math.max(140,height-24)});
  };
  place();
  const outside=(event:PointerEvent)=>{if(event.target instanceof Node&&!menuPanel.current?.contains(event.target)&&!bubble.current?.contains(event.target))closeMenu()};
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeMenu(true)}};
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape,true);window.addEventListener('resize',place);window.visualViewport?.addEventListener('resize',place);
  const frame=requestAnimationFrame(()=>menuPanel.current?.querySelector<HTMLButtonElement>('button')?.focus({preventScroll:true}));
  return()=>{cancelAnimationFrame(frame);document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape,true);window.removeEventListener('resize',place);window.visualViewport?.removeEventListener('resize',place)};
 },[menu]);

 function pointerDown(event:ReactPointerEvent<HTMLDivElement>){
  clearHold();cancelDownload();
  const eligible=gesture.current.begin({pointerId:event.pointerId,x:event.clientX,y:event.clientY,time:Date.now(),own:m.own,pointerType:event.pointerType,primary:event.isPrimary,button:event.button,interactive:interactive(event.target),hasSelection:selectedText()});
  if(!eligible||selectionMode)return;
  const point={x:event.clientX,y:event.clientY};
  holdTimer.current=setTimeout(()=>{holdTimer.current=undefined;if(current()&&!selectedText()&&gesture.current.hold(Date.now())){cancelDownload();setOffset(0);setPicker(false);setMenuPosition(null);setMenu(point)}},MESSAGE_HOLD_MS);
 }
 function pointerMove(event:ReactPointerEvent<HTMLDivElement>){
  if(selectionMode||message.deleted)return;
  const movement=gesture.current.move(event.pointerId,event.clientX,event.clientY);
  if(movement.cancelHold)clearHold();setOffset(movement.offset);
  if(movement.claimed&&event.cancelable)event.preventDefault();
 }
 function pointerUp(event:ReactPointerEvent<HTMLDivElement>){
  clearHold();const reply=gesture.current.finish(event.pointerId,Date.now());setOffset(0);
  if(reply&&!selectionMode&&!message.deleted&&current()){cancelDownload();event.preventDefault();onReply()}
 }
 async function download(){if(!m.attachment||message.deleted)return;setDownloading(true);try{const blob=await s.downloadAttachment(m.attachment);if(blob){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=sanitizedFilename(m.attachment.name);a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}}finally{setDownloading(false)}}
 function queueDownload(){cancelDownload();downloadTimer.current=setTimeout(()=>{downloadTimer.current=undefined;if(current()&&!gesture.current.suppressClick(Date.now()))void download()},350)}

 if(m.system)return <div className="system-message"><Clock3 size={12}/><span>{m.text}</span></div>;
 const status=m.status==='queued'?'Queued':m.status==='failed'?'Failed':m.status==='sending'?'Sending':m.status==='read'?'Read':m.status==='delivered'?'Delivered':s.mode==='demo'?'Saved locally':'Sent';
 return <div className={`message-row ${m.own?'own':''} ${styles.row} ${selected?styles.selected:''}`} data-message-id={m.id}>
  {selectionMode&&onToggleSelect&&<button type="button" className={styles.select} role="checkbox" aria-checked={selected} aria-label={`${selected?'Deselect':'Select'} message`} onClick={onToggleSelect}>{selected?<Check size={15}/>:null}</button>}
  <div className="message-avatar">{!m.own&&<Avatar contact={contact} small/>}</div>
  <div className={`message-stack ${styles.stack}`}>
   <span className={`${styles.swipeHint} ${m.own?styles.swipeOwn:''}`} style={{opacity:Math.min(1,Math.abs(offset)/50)}} aria-hidden="true"><Reply size={17}/></span>
   <div ref={bubble} className={`message-bubble ${m.own?'outgoing':'incoming'} ${m.status==='failed'?'failed-bubble':''} ${styles.bubble} ${message.deleted?styles.deleted:''}`} style={{transform:offset?`translateX(${offset}px)`:undefined,transition:offset?'none':undefined}} tabIndex={0} role="group" aria-label={`${m.own?'Your message':`Message from ${contact.name}`}${message.deleted?', deleted':''}`} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={cancelGesture} onPointerLeave={event=>{if(event.pointerType==='mouse')cancelGesture()}} onLostPointerCapture={cancelGesture} onClickCapture={event=>{if(gesture.current.suppressClick(Date.now())){event.preventDefault();event.stopPropagation()}}} onClick={event=>{if(selectionMode&&!interactive(event.target)&&current())onToggleSelect?.()}} onDoubleClick={event=>{if(interactive(event.target)||selectionMode)return;event.preventDefault();cancelDownload();const selection=window.getSelection();if(selection?.anchorNode&&bubble.current?.contains(selection.anchorNode))selection.removeAllRanges();openReactions()}} onContextMenu={event=>{if(interactive(event.target))return;event.preventDefault();if(!menu)openMenu({x:event.clientX,y:event.clientY})}} onKeyDown={event=>{if(event.target!==event.currentTarget)return;if(event.key==='ContextMenu'||event.key==='F10'&&event.shiftKey||event.key==='Enter'||event.key===' '){event.preventDefault();if(selectionMode)onToggleSelect?.();else openMenu()}}}>
    {message.forwarded&&!message.deleted&&<div className={styles.forwarded}><Forward size={12}/>Forwarded</div>}
    {m.replyTo&&!message.deleted&&<div className="quoted-message"><span>{m.replyTo.own?'You':contact.name}</span><p>{m.replyTo.text||'Encrypted attachment'}</p></div>}
    {m.attachment&&!message.deleted&&<button type="button" className="attachment-card" onClick={event=>{if(selectionMode){event.preventDefault();event.stopPropagation();if(current())onToggleSelect?.();return}if(event.detail===0){if(current())void download()}else queueDownload()}} disabled={downloading} aria-label={`Download ${m.attachment.name}`}><span className="file-icon">{m.attachment.mime.startsWith('image/')?<ImageIcon size={23}/>:<FileText size={23}/>}</span><span><strong>{m.attachment.name}</strong><small>{formatBytes(m.attachment.size)} · encrypted file</small></span><ArrowDownToLine size={18}/></button>}
    {message.deleted?<p className={styles.deletedText}>This message was deleted</p>:m.text&&<p>{m.text}</p>}
    <div className="message-meta">{(message.edited||message.editedAt)&&!message.deleted&&<span className={styles.edited} title={message.editedAt?`Edited ${new Date(message.editedAt).toLocaleString()}`:undefined}>Edited</span>}{m.expiresAt&&<span className="expiry-marker" title={`Expires ${new Date(m.expiresAt).toLocaleString()}`}><Clock3 size={10}/></span>}<time>{formatTime(m.at)}</time>{m.own&&<><span className={`delivery-label ${m.status==='failed'?'delivery-error':''}`}>{status}</span>{m.status==='read'||m.status==='delivered'?<CheckCheck size={14}/>:m.status==='queued'||m.status==='sending'?<Clock3 size={12}/>:m.status==='failed'?<AlertCircle size={12}/>:<Check size={13}/>}</>}</div>
   </div>
   {!message.deleted&&<div className="message-reactions">{Object.entries(m.reactions||{}).filter(([,actors])=>actors.length>0).map(([emoji,actors])=><button type="button" key={emoji} className={actors.includes(s.user?.id||'')?'own-reaction':''} disabled={!canReact} onClick={()=>react(emoji)} aria-label={`${actors.includes(s.user?.id||'')?'Remove':'Add'} ${emoji} reaction`}>{emoji}<span>{actors.length}</span></button>)}</div>}
   {m.status==='failed'&&m.own&&!message.deleted&&<button type="button" className="retry-message" onClick={()=>void s.retryMessage(m.id)}><RotateCw size={12}/>Retry encrypted message</button>}
  </div>
  {!selectionMode&&<div className={styles.actions}><button type="button" className={styles.quick} title="Reply to message" aria-label="Reply to message" disabled={message.deleted} onClick={onReply}><Reply size={15}/></button><button type="button" className={styles.quick} title="React to message" aria-label="React to message" disabled={!canReact} onClick={openReactions}><Smile size={15}/></button><button ref={moreButton} type="button" title="Message actions" aria-label="Message actions" aria-haspopup="menu" aria-expanded={!!menu} onClick={()=>menu?closeMenu():openMenu()}><MoreHorizontal size={17}/></button></div>}
  {menu&&createPortal(<div ref={menuPanel} className={styles.menu} role="menu" aria-label="Message actions" style={menuPosition??{visibility:'hidden'}} onKeyDown={event=>{if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;const buttons=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));const index=buttons.indexOf(event.target as HTMLButtonElement);const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:event.key==='ArrowDown'?(index+1)%buttons.length:(index+buttons.length-1)%buttons.length;event.preventDefault();buttons[next]?.focus()}}>
   <div className={styles.menuTitle}>Message</div>
   {canReact&&<><div className={styles.quickReactions}>{['❤️','👍','😂','😮','😢','🙏'].map(emoji=><button type="button" key={emoji} role="menuitem" aria-label={`React with ${emoji}`} onClick={()=>react(emoji)}>{emoji}</button>)}</div><button type="button" role="menuitem" onClick={openReactions}><Smile size={16}/><span>More reactions</span></button></>}
   {!message.deleted&&<button type="button" role="menuitem" onClick={()=>run(onReply)}><Reply size={16}/><span>Reply</span></button>}
   {onForward&&!message.deleted&&!contact.isBot&&<button type="button" role="menuitem" onClick={()=>run(onForward)}><Forward size={16}/><span>Forward</span></button>}
   {canEdit&&<button type="button" role="menuitem" onClick={()=>run(onEdit)}><Pencil size={16}/><span>Edit</span></button>}
   {onToggleSelect&&<button type="button" role="menuitem" onClick={()=>run(onToggleSelect)}><CheckSquare size={16}/><span>{selected?'Deselect message':'Select message'}</span></button>}
   {onDelete&&<button type="button" className={styles.danger} role="menuitem" onClick={()=>run(onDelete)}><Trash2 size={16}/><span>Delete</span></button>}
  </div>,document.body)}
  {picker&&canReact&&<EmojiPicker anchorRef={bubble} onSelect={react} onClose={restore=>{setPicker(false);if(restore)moreButton.current?.focus({preventScroll:true})}} recentEmoji={recentEmoji} skinTone={skinTone} onSkinToneChange={setSkinTone}/>}
 </div>;
}
