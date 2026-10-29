'use client';
import {useEffect,useMemo,useRef,useState,type PointerEvent as ReactPointerEvent} from 'react';
import {Archive,ArrowLeft,Check,ChevronDown,Clock3,LockKeyhole,MessageSquare,Pin,Plus,Search,Settings2,ShieldCheck,Sparkles} from 'lucide-react';
import {useVeilnivo,type Conversation} from '@/lib/store';
import {Avatar,IconButton} from './UI';
import {ChatSelectionGesture,CHAT_SELECTION_HOLD_MS} from '@/lib/chat-selection-gestures';
import {ChatHistoryDialog,ChatSelectionBar} from './ChatManagement';
import styles from './ChatSidebar.module.css';

type Section='all'|'archived'|'locked';
type Action='pin'|'unpin'|'archive'|'unarchive'|'delete'|'lock'|'unlock';
interface Props {
 mobileHidden:boolean;nav:'messages'|'requests'|'security';
 onChoose:(contact:Conversation)=>void;onNew:(tab?:'invite'|'find'|'group')=>void;
 onSettings:()=>void;onConfigureLock:(ids:string[])=>void;onShowList:()=>void;onRequests:()=>void;
}

export default function ChatSidebar({mobileHidden,nav,onChoose,onNew,onSettings,onConfigureLock,onShowList,onRequests}:Props){
 const s=useVeilnivo();
 const [query,setQuery]=useState(''),[unreadOnly,setUnreadOnly]=useState(false),[options,setOptions]=useState(false);
 const [selecting,setSelecting]=useState(false),[selected,setSelected]=useState<string[]>([]);
 const [history,setHistory]=useState<{kind:'clear'|'delete';ids:string[];owner:string}|null>(null);
 const optionsRef=useRef<HTMLDivElement>(null);
 const gesture=useRef(new ChatSelectionGesture()),holdTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 const sidebarRef=useRef<HTMLElement>(null);
 const accessible=s.conversations.filter(contact=>!contact.hidden&&(!contact.locked||s.lockedChatsOpen));
 const peers=accessible.filter(contact=>!contact.isBot&&(s.chatSection==='locked'?contact.locked:s.chatSection==='archived'?contact.archived&&!contact.locked:!contact.archived&&!contact.locked));
 const assistant=s.chatSection!=='archived'?s.conversations.find(contact=>contact.isBot&&(s.preferences.aiEnabled||s.hasChatLockCode)):undefined;
 const matches=(contact:Conversation)=>`${contact.username} ${contact.name}`.toLowerCase().includes(query.toLowerCase().replace(/^@/,''));
 const shown=peers.filter(contact=>(!unreadOnly||contact.unread>0)&&matches(contact)).sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned)||(b.latestAt??0)-(a.latestAt??0));
 const chosen=accessible.filter(contact=>!contact.isBot&&selected.includes(contact.id));
 const pinCount=s.conversations.filter(contact=>!contact.isBot&&!contact.hidden&&contact.pinned).length;
 const extraPins=chosen.filter(contact=>!contact.pinned).length;
 const canPin=pinCount+extraPins<=s.pinLimit;
 const archivedCount=s.conversations.filter(contact=>!contact.isBot&&!contact.hidden&&!contact.locked&&contact.archived).length;
 const incoming=s.messageRequests.filter(request=>request.direction==='incoming');
 const unread=accessible.filter(contact=>!contact.isBot&&!contact.locked&&!contact.archived).reduce((count,contact)=>count+contact.unread,0);
 const everyShownSelected=shown.length>0&&shown.every(contact=>selected.includes(contact.id));
 const title=s.chatSection==='locked'?'Locked chats':s.chatSection==='archived'?'Archived':'Messages';
 const selectionKey=useMemo(()=>accessible.filter(contact=>!contact.isBot).map(contact=>contact.id).sort().join('|'),[s.conversations,s.lockedChatsOpen]);

 useEffect(()=>{setSelected([]);setSelecting(false);setOptions(false);setHistory(null);setQuery('');setUnreadOnly(false)},[s.user?.id,s.chatSection,s.lockedChatsOpen]);
 useEffect(()=>{const ids=new Set(accessible.filter(contact=>!contact.isBot).map(contact=>contact.id));setSelected(previous=>{const next=previous.filter(id=>ids.has(id));return next.length===previous.length?previous:next})},[selectionKey]);
 useEffect(()=>{if(!options)return;const outside=(event:PointerEvent)=>{if(event.target instanceof Node&&!optionsRef.current?.contains(event.target))setOptions(false)};const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setOptions(false)};document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape)}},[options]);

 function stopHoldTimer(){if(holdTimer.current!==undefined)clearTimeout(holdTimer.current);holdTimer.current=undefined}
 function cancelHold(){stopHoldTimer();gesture.current.cancel(Date.now())}
 useEffect(()=>{cancelHold()},[s.user?.id,s.chatSection,s.lockedChatsOpen,s.busy,mobileHidden,nav,query,unreadOnly]);
 useEffect(()=>{const secondary=(event:PointerEvent)=>{if(event.pointerType==='touch'&&!event.isPrimary)cancelHold()};const hide=()=>{if(document.visibilityState!=='visible')cancelHold()};document.addEventListener('pointerdown',secondary,true);document.addEventListener('scroll',cancelHold,true);document.addEventListener('visibilitychange',hide);window.addEventListener('blur',cancelHold);return()=>{cancelHold();document.removeEventListener('pointerdown',secondary,true);document.removeEventListener('scroll',cancelHold,true);document.removeEventListener('visibilitychange',hide);window.removeEventListener('blur',cancelHold)}},[]);
 function canSelect(id:string,owner=s.user?.id,section=s.chatSection){const current=useVeilnivo.getState(),contact=current.conversations.find(row=>row.id===id);return!!owner&&current.user?.id===owner&&current.chatSection===section&&!current.busy&&!!sidebarRef.current?.getClientRects().length&&!!contact&&!contact.isBot&&!contact.hidden&&(!contact.locked||current.lockedChatsOpen)}
 function enterSelection(id:string){if(!canSelect(id))return;setSelecting(true);setOptions(false);setSelected(previous=>previous.includes(id)?previous:[...previous,id]);onShowList()}
 function touchStart(event:ReactPointerEvent<HTMLDivElement>,contact:Conversation){cancelHold();if(selecting||contact.isBot||!canSelect(contact.id))return;const owner=s.user?.id,section=s.chatSection;if(!gesture.current.begin({id:contact.id,pointerId:event.pointerId,pointerType:event.pointerType,x:event.clientX,y:event.clientY,time:Date.now(),primary:event.isPrimary,button:event.button}))return;holdTimer.current=setTimeout(()=>{holdTimer.current=undefined;if(!canSelect(contact.id,owner,section)){cancelHold();return}const id=gesture.current.hold(Date.now());if(id)enterSelection(id)},CHAT_SELECTION_HOLD_MS)}
 function touchMove(event:ReactPointerEvent<HTMLDivElement>){if(gesture.current.move(event.pointerId,event.clientX,event.clientY))stopHoldTimer()}
 function touchEnd(event:ReactPointerEvent<HTMLDivElement>){stopHoldTimer();gesture.current.finish(event.pointerId,Date.now())}
 function toggle(id:string){if(!canSelect(id))return;setSelected(previous=>previous.includes(id)?previous.filter(value=>value!==id):[...previous,id])}
 function cancelSelection(){setSelected([]);setSelecting(false)}
 function section(value:Section){setOptions(false);setUnreadOnly(false);s.setChatSection(value);onShowList()}
 function selectAll(){setSelecting(true);setOptions(false);setSelected(previous=>everyShownSelected?previous.filter(id=>!shown.some(contact=>contact.id===id)):[...new Set([...previous,...shown.map(contact=>contact.id)])])}
 async function act(action:Action){
  const owner=s.user?.id,ids=chosen.map(contact=>contact.id);if(!owner||!ids.length||s.busy)return;
  if(action==='lock'&&!s.hasChatLockCode){onConfigureLock(ids);return}
  const ok=await s.organizeChats(ids,action);if(ok&&useVeilnivo.getState().user?.id===owner)cancelSelection();
 }
 function confirmHistory(kind:'clear'|'delete'){if(!s.user||!chosen.length)return;s.clearError();setHistory({kind,ids:chosen.map(contact=>contact.id),owner:s.user.id})}
 async function finishHistory(){const action=history,current=useVeilnivo.getState();if(!action||current.busy||current.user?.id!==action.owner)return;const ok=action.kind==='clear'?await current.clearChats(action.ids):await current.organizeChats(action.ids,'delete');if(ok&&useVeilnivo.getState().user?.id===action.owner){setHistory(null);cancelSelection()}}
 function row(contact:Conversation){
  const checked=selected.includes(contact.id);
  return <div className={`${styles.chatRow} ${checked?styles.checkedRow:''}`} key={contact.id} onPointerDown={event=>touchStart(event,contact)} onPointerMove={touchMove} onPointerUp={touchEnd} onPointerCancel={cancelHold} onContextMenu={event=>{if(contact.isBot)return;event.preventDefault();stopHoldTimer();gesture.current.nativeHold(contact.id,Date.now());enterSelection(contact.id)}} onClickCapture={event=>{if(gesture.current.suppressClick(contact.id,Date.now())){event.preventDefault();event.stopPropagation()}}}>
   {selecting&&!contact.isBot&&<button type="button" role="checkbox" aria-checked={checked} aria-label={`${checked?'Deselect':'Select'} chat with @${contact.username}`} className={styles.checkbox} onClick={()=>toggle(contact.id)} disabled={s.busy}>{checked&&<Check size={14}/>}</button>}
   <button className={`conversation ${s.activeId===contact.id&&nav==='messages'?'selected':''} ${contact.isBot?'bot-contact':''} ${styles.conversation}`} aria-describedby={contact.isBot?undefined:'chat-selection-instructions'} onKeyDown={event=>{if(!contact.isBot&&(event.key==='ContextMenu'||event.key==='F10'&&event.shiftKey)){event.preventDefault();cancelHold();enterSelection(contact.id)}}} onClick={()=>{if(selecting&&!contact.isBot)toggle(contact.id);else{cancelSelection();onChoose(contact)}}}>
    <Avatar contact={contact}/><div className="conversation-copy"><div className="conversation-top"><strong>{contact.name}{contact.verified&&<ShieldCheck size={12}/>}</strong><time>{contact.isBot?<span className="bot-chip">AI</span>:contact.pinned?<Pin size={13} aria-label="Pinned chat"/>:contact.time||''}</time></div><div className="conversation-bottom"><p>{contact.blocked?'Blocked contact':contact.requestStatus==='outgoing'?'Connection request sent':contact.preview||'Start a private conversation'}</p>{contact.unread>0&&<span className="unread-count">{contact.unread}</span>}{contact.locked?<LockKeyhole size={13}/>:contact.archived?<Archive size={13}/>:contact.ttlSeconds?<Clock3 size={13}/>:null}</div></div>
   </button>
  </div>;
 }

 if(!s.user)return null;
 return <aside ref={sidebarRef} className={`sidebar ${mobileHidden?'mobile-hidden':''}`} aria-label="Conversations">
  <div className="sidebar-title"><h1>{title}<span>{peers.length}</span></h1><div className="sidebar-title-actions">{s.chatSection!=='all'&&<IconButton title="Back to all chats" onClick={()=>section('all')}><ArrowLeft size={18}/></IconButton>}<IconButton title="Find user" onClick={()=>onNew('find')}><Search size={18}/></IconButton><IconButton title="New conversation" onClick={()=>onNew('group')}><Plus size={20}/></IconButton></div></div>
  <div className="search-box"><Search size={16}/><input aria-label="Search conversations" placeholder="Search conversations" value={query} onChange={event=>setQuery(event.target.value)}/><kbd>Ctrl K</kbd></div>
  <p id="chat-selection-instructions" className={styles.gestureHelp}>Touch and hold a chat, or right-click it, to select chats. Keyboard users can press Shift+F10. Then tap a chat or click its checkbox to toggle selection.</p>
  <div className={`conversation-tabs ${styles.tabs}`}>
   <div className={styles.allGroup} ref={optionsRef}><button onClick={()=>{section('all');setUnreadOnly(false)}} className={s.chatSection==='all'&&!unreadOnly&&nav==='messages'?'selected':''}>All chats</button><button type="button" className={styles.optionsTrigger} aria-label="All chats options" aria-haspopup="menu" aria-expanded={options} onClick={()=>setOptions(value=>!value)}><ChevronDown size={14}/></button>
    {options&&<div className={styles.options} role="menu" aria-label="Chat list options"><button role="menuitem" onClick={()=>section('archived')}><Archive size={15}/>Archived chats{archivedCount>0&&<span>{archivedCount}</span>}</button></div>}
   </div>
   <button onClick={()=>{if(s.chatSection!=='all')s.setChatSection('all');setUnreadOnly(true);onShowList()}} className={s.chatSection==='all'&&unreadOnly&&nav==='messages'?'selected':''}>Unread{unread>0&&<span>{unread}</span>}</button>
   <button className={nav==='requests'?'selected':''} onClick={onRequests}>Requests{incoming.length>0&&<span>{incoming.length}</span>}</button>
  </div>
  {s.chatSection!=='all'&&<div className={styles.sectionBar}><span>{title}</span>{s.chatSection==='locked'?<button type="button" onClick={()=>{s.closeLockedChats();onShowList()}}><LockKeyhole size={13}/>Close</button>:<button type="button" onClick={()=>section('all')}>All chats</button>}</div>}
  {selecting&&<><div className={styles.selectAll}><button type="button" onClick={selectAll} disabled={s.busy||!shown.length}>{everyShownSelected?'Deselect list':'Select all'}</button><span>{pinCount} / {s.pinLimit} pinned</span></div>{chosen.length?<ChatSelectionBar count={chosen.length} pinLimit={s.pinLimit} canPin={canPin} busy={s.busy} onCancel={cancelSelection} onPin={chosen.some(contact=>!contact.pinned)?()=>void act('pin'):undefined} onUnpin={chosen.some(contact=>contact.pinned)?()=>void act('unpin'):undefined} onArchive={chosen.some(contact=>!contact.archived)?()=>void act('archive'):undefined} onUnarchive={chosen.some(contact=>contact.archived)?()=>void act('unarchive'):undefined} onLock={chosen.some(contact=>!contact.locked)?()=>void act('lock'):undefined} onUnlock={chosen.some(contact=>contact.locked)?()=>void act('unlock'):undefined} onClear={()=>confirmHistory('clear')} onDelete={()=>confirmHistory('delete')}/>:<div className={styles.selectionHint}><span>Choose chats to organize.</span><button type="button" onClick={cancelSelection}>Cancel</button></div>}{!canPin&&chosen.length>0&&<p className={styles.limit}>Free supports {s.pinLimit} pinned chats. Unpin another chat first.</p>}{s.error&&<p className={styles.feedback} role="alert">{s.error}</p>}</>}
  <div className="conversation-list">
   {assistant&&!unreadOnly&&matches(assistant)&&<><div className="section-label"><span>OPTIONAL ASSISTANT</span><Sparkles size={12}/></div>{row(assistant)}<div className="section-label people-label"><span>{s.chatSection==='locked'?'LOCKED CONVERSATIONS':'YOUR CONVERSATIONS'}</span><span>{peers.length}</span></div></>}
   {shown.map(row)}
   {!shown.length&&<div className="no-conversations"><div className="empty-invite-icon">{s.chatSection==='locked'?<LockKeyhole size={25}/>:s.chatSection==='archived'?<Archive size={25}/>:<MessageSquare size={25}/>}</div><strong>{query?'No matching conversations':s.chatSection==='locked'?'No locked chats':s.chatSection==='archived'?'No archived chats':unreadOnly?'You’re all caught up.':'Your next conversation starts here.'}</strong><span>{query?'Try another name or find an exact username.':s.chatSection==='locked'?'Choose conversations in Chat lock settings.':s.chatSection==='archived'?'Chats you archive will appear here.':unreadOnly?'No unread conversations in this list.':'Invite one person. Keep the details between you.'}</span>{s.chatSection==='locked'?<button className="secondary-button" onClick={()=>onConfigureLock([])}>Manage chat lock</button>:s.chatSection==='archived'?<button className="secondary-button" onClick={()=>section('all')}>Back to all chats</button>:!unreadOnly&&<button className="primary-button" onClick={()=>onNew(query?'find':'invite')}><Plus size={14}/>{query?'Find username':'Invite a contact'}</button>}</div>}
  </div>
  <div className="sidebar-bottom"><button className="identity-card" onClick={onSettings}><span className="identity-avatar">{s.user.username.slice(0,1).toUpperCase()}</span><span><strong>@{s.user.username}</strong><small><span className="live-dot"/>{s.user.id==='preview-cipher'?'Demo workspace':'Identity unlocked'}</small></span><Settings2 size={17}/></button></div>
  {history&&<ChatHistoryDialog kind={history.kind} count={history.ids.length} busy={s.busy} error={s.error} onClose={()=>{if(!s.busy)setHistory(null)}} onConfirm={()=>void finishHistory()}/>}
 </aside>;
}
