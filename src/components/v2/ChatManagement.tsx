'use client';
import {useEffect,useRef,useState} from 'react';
import {Archive,ArchiveRestore,Check,Eye,EyeOff,KeyRound,LockKeyhole,Pin,PinOff,ShieldCheck,Trash2,UnlockKeyhole,X} from 'lucide-react';
import {useVeilnivo} from '@/lib/store';
import {countChatLockCharacters,MAX_CHAT_LOCK_CODE_UNITS,validateChatLockCode} from '@/lib/chat-lock';
import {Avatar,Dialog} from './UI';
import styles from './ChatManagement.module.css';

export interface ChatSelectionBarProps {
 count:number;pinLimit:number;canPin?:boolean;busy:boolean;
 onCancel:()=>void;onDelete:()=>void;onPin?:()=>void;onUnpin?:()=>void;
 onArchive?:()=>void;onUnarchive?:()=>void;onLock?:()=>void;onUnlock?:()=>void;onClear?:()=>void;
}

export function ChatSelectionBar({count,pinLimit,canPin=true,busy,onCancel,onDelete,onPin,onUnpin,onArchive,onUnarchive,onLock,onUnlock,onClear}:ChatSelectionBarProps){
 return <div className={styles.selection} role="toolbar" aria-label="Selected chat actions">
  <div className={styles.selectionHeading}><button type="button" aria-label="Cancel chat selection" onClick={onCancel} disabled={busy}><X size={17}/></button><strong>{count} selected</strong></div>
  <div className={styles.selectionActions}>
   {onPin&&<button type="button" onClick={onPin} disabled={busy||!canPin} title={`Pin up to ${pinLimit} chats`}><Pin size={15}/>Pin</button>}
   {onUnpin&&<button type="button" onClick={onUnpin} disabled={busy}><PinOff size={15}/>Unpin</button>}
   {onArchive&&<button type="button" onClick={onArchive} disabled={busy}><Archive size={15}/>Archive</button>}
   {onUnarchive&&<button type="button" onClick={onUnarchive} disabled={busy}><ArchiveRestore size={15}/>Unarchive</button>}
   {onLock&&<button type="button" onClick={onLock} disabled={busy}><LockKeyhole size={15}/>Lock</button>}
   {onUnlock&&<button type="button" onClick={onUnlock} disabled={busy}><UnlockKeyhole size={15}/>Unlock</button>}
   {onClear&&<button type="button" onClick={onClear} disabled={busy}><Trash2 size={15}/>Clear</button>}
   <button type="button" className={styles.dangerText} onClick={onDelete} disabled={busy}><Trash2 size={15}/>Delete</button>
  </div>
 </div>;
}

export function ChatHistoryDialog({kind,count=1,busy,error,onClose,onConfirm}:{kind:'clear'|'delete';count?:number;busy:boolean;error:string|null;onClose:()=>void;onConfirm:()=>void}){
 const noun=count===1?'chat':`${count} chats`,clear=kind==='clear';
 return <Dialog title={`${clear?'Clear':'Delete'} ${noun}?`} onClose={()=>{if(!busy)onClose()}}>
  <p className={styles.copy}>{clear?`This clears messages in ${count===1?'this chat':'these chats'} from this device. The conversation stays in your list.`:`This removes ${count===1?'this conversation':'these conversations'} and their messages from this device. New messages can bring a chat back.`}</p>
  <div className={styles.notice}>Other people and your other devices keep their copies.</div>
  {error&&<p className={styles.error} role="alert">{error}</p>}
  <div className={styles.dialogActions}><button type="button" className="secondary-button" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="danger-button" onClick={onConfirm} disabled={busy}><Trash2 size={15}/>{busy?'Updating…':`${clear?'Clear':'Delete'} ${count===1?'chat':'chats'}`}</button></div>
 </Dialog>;
}

export function ChatLockPreferences({onOpenChatLock,onResetDone,initialSelectedIds}:{onOpenChatLock?:()=>void;onResetDone?:()=>void;initialSelectedIds?:string[]}){
 const s=useVeilnivo();
 const [code,setCode]=useState(''),[confirmation,setConfirmation]=useState(''),[reveal,setReveal]=useState(false),[formError,setFormError]=useState<string|null>(null),[chosen,setChosen]=useState<string[]>(()=>[...new Set(initialSelectedIds??[])]),[resetConfirm,setResetConfirm]=useState(false);
 const owner=useRef(s.user?.id),operation=useRef(0);
 const lockedCount=new Set([...s.conversations,...s.blockedContacts,...s.messageRequests.map(request=>request.peer)].filter(contact=>contact.locked&&!contact.isBot).map(contact=>contact.id)).size;
 const peers=s.conversations.filter(contact=>!contact.isBot&&!contact.hidden&&(s.lockedChatsOpen||!contact.locked));
 const toLock=chosen.filter(id=>peers.some(contact=>contact.id===id&&!contact.locked)),toUnlock=chosen.filter(id=>peers.some(contact=>contact.id===id&&contact.locked));
 useEffect(()=>{if(owner.current===s.user?.id)return;owner.current=s.user?.id;operation.current++;setCode('');setConfirmation('');setReveal(false);setFormError(null);setChosen([]);setResetConfirm(false)},[s.user?.id]);
 useEffect(()=>()=>{operation.current++},[]);
 useEffect(()=>{setChosen(previous=>previous.filter(id=>peers.some(contact=>contact.id===id)))},[s.conversations,s.lockedChatsOpen]);
 const toggle=(id:string)=>setChosen(previous=>previous.includes(id)?previous.filter(value=>value!==id):[...previous,id]);
 async function saveCode(){
  const owner=s.user?.id;if(!owner||useVeilnivo.getState().user?.id!==owner)return;
  const error=validateChatLockCode(code);if(error){setFormError(error);return}if(code!==confirmation){setFormError('The two secret codes do not match.');return}
  const run=operation.current,firstSetup=!s.hasChatLockCode,selectedToLock=firstSetup?[...toLock]:[];
  setFormError(null);const ok=await useVeilnivo.getState().setChatLockCode(code);
  if(ok&&operation.current===run&&useVeilnivo.getState().user?.id===owner){
   setCode('');setConfirmation('');setReveal(false);
   const current=useVeilnivo.getState(),stillSelected=selectedToLock.filter(id=>current.conversations.some(contact=>contact.id===id&&!contact.isBot&&!contact.hidden&&!contact.locked));
   if(firstSetup&&stillSelected.length){const locked=await current.organizeChats(stillSelected,'lock');if(locked&&operation.current===run&&useVeilnivo.getState().user?.id===owner)setChosen([])}
  }
 }
 async function organize(action:'lock'|'unlock',ids:string[]){const owner=s.user?.id;if(!owner||useVeilnivo.getState().user?.id!==owner)return;const ok=await useVeilnivo.getState().organizeChats(ids,action);if(ok&&useVeilnivo.getState().user?.id===owner)setChosen([])}
 async function reset(){const owner=s.user?.id;if(!owner||useVeilnivo.getState().user?.id!==owner)return;const ok=await useVeilnivo.getState().resetChatLock();if(ok&&useVeilnivo.getState().user?.id===owner){setResetConfirm(false);setCode('');setConfirmation('');setChosen([]);onResetDone?.()}}
 return <div className={styles.lockPreferences}>
  <div className={styles.lockSummary}><span className={styles.lockMark}><LockKeyhole size={23}/></span><div><h3>Chat lock</h3><p>{s.hasChatLockCode?`${lockedCount} ${lockedCount===1?'chat':'chats'} locked on this device`:'A secret code for your private conversations.'}</p></div></div>
  <p className={styles.copy}>Choose a code with 4–12 characters. Letters, numbers, symbols, spaces and emoji all work. Enter and send it to Veil AI to open your locked chats. The code stays on this device.</p>
  {!s.hasChatLockCode&&toLock.length>0&&<div className={styles.notice}>Set a code to lock {toLock.length} selected {toLock.length===1?'chat':'chats'}.</div>}
  {s.hasChatLockCode&&!s.lockedChatsOpen?<div className={styles.notice}><strong>Open locked chats to change your code.</strong>{onOpenChatLock&&<button type="button" className="secondary-button" onClick={onOpenChatLock}><KeyRound size={14}/>Go to Veil AI</button>}</div>:<form className={styles.codeForm} onSubmit={event=>{event.preventDefault();void saveCode()}}>
   <label htmlFor="chat-lock-code">{s.hasChatLockCode?'New secret code':'Secret code'}<span>{countChatLockCharacters(code)} / 12 characters</span></label>
   <div className={styles.codeInput}><input id="chat-lock-code" aria-label={s.hasChatLockCode?'New chat-lock code':'Chat-lock secret code'} type={reveal?'text':'password'} value={code} onChange={event=>{setCode(event.target.value);setFormError(null)}} maxLength={MAX_CHAT_LOCK_CODE_UNITS} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} disabled={s.busy}/><button type="button" aria-label={reveal?'Hide secret code':'Show secret code'} aria-pressed={reveal} onClick={()=>setReveal(value=>!value)} disabled={s.busy}>{reveal?<EyeOff size={18}/>:<Eye size={18}/>}</button></div>
   <label htmlFor="chat-lock-confirm">Confirm secret code</label><input id="chat-lock-confirm" aria-label="Confirm chat-lock code" className={styles.confirmInput} type={reveal?'text':'password'} value={confirmation} onChange={event=>{setConfirmation(event.target.value);setFormError(null)}} maxLength={MAX_CHAT_LOCK_CODE_UNITS} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} disabled={s.busy}/>
   {formError&&<p className={styles.error} role="alert">{formError}</p>}
   <button type="submit" className="primary-button" disabled={s.busy||!code||!confirmation}><LockKeyhole size={15}/>{s.busy?'Saving…':s.hasChatLockCode?'Change secret code':'Set secret code'}</button>
  </form>}
  {s.hasChatLockCode&&<>
   <div className={styles.lockListHeading}><strong>Choose chats</strong>{s.lockedChatsOpen?<button type="button" className="text-button" onClick={s.closeLockedChats}>Close locked section</button>:<small>Locked names stay hidden until you enter your code.</small>}</div>
   <div className={styles.peerList} role="group" aria-label="Chats to lock or unlock">{peers.length?peers.map(contact=><button type="button" role="checkbox" aria-checked={chosen.includes(contact.id)} aria-label={`${chosen.includes(contact.id)?'Deselect':'Select'} ${contact.name}`} key={contact.id} onClick={()=>toggle(contact.id)} disabled={s.busy}><Avatar contact={contact} small/><span><strong>{contact.name}</strong><small>{contact.locked?'Locked':'Not locked'}</small></span><i>{chosen.includes(contact.id)&&<Check size={13}/>}</i></button>):<p className={styles.empty}>No available chats here yet.</p>}</div>
   <div className={styles.lockButtons}><button type="button" className="secondary-button" onClick={()=>void organize('lock',toLock)} disabled={s.busy||!toLock.length}><LockKeyhole size={14}/>Lock selected{toLock.length?` · ${toLock.length}`:''}</button>{s.lockedChatsOpen&&<button type="button" className="secondary-button" onClick={()=>void organize('unlock',toUnlock)} disabled={s.busy||!toUnlock.length}><UnlockKeyhole size={14}/>Unlock selected{toUnlock.length?` · ${toUnlock.length}`:''}</button>}</div>
   <button type="button" className={`text-button ${styles.forgot}`} onClick={()=>{s.clearError();setResetConfirm(true)}} disabled={s.busy}>Forgot chat-lock code?</button>
  </>}
  {resetConfirm&&<Dialog title="Reset chat lock?" onClose={()=>{if(!s.busy)setResetConfirm(false)}}><p className={styles.copy}>This clears messages in all {lockedCount} locked {lockedCount===1?'chat':'chats'} from this device, removes the secret code and returns the chats to All chats.</p><div className={styles.notice}>Other people and your other devices keep their copies. You cannot restore the cleared messages through this device&apos;s chat history.</div>{s.error&&<p className={styles.error} role="alert">{s.error}</p>}<div className={styles.dialogActions}><button type="button" className="secondary-button" onClick={()=>setResetConfirm(false)} disabled={s.busy}>Keep chat lock</button><button type="button" className="danger-button" onClick={()=>void reset()} disabled={s.busy}><Trash2 size={15}/>{s.busy?'Resetting…':'Clear locked messages and reset'}</button></div></Dialog>}
 </div>;
}
