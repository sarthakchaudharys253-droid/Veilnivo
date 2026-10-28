'use client';
import {useState} from 'react';
import {Check,Forward,Pencil,Search,Trash2,X} from 'lucide-react';
import type {ChatMessage,Conversation} from '@/lib/store';
import {Avatar,Dialog} from './UI';
import styles from './ChatActions.module.css';

export function MessageSelectionBar({count,canForward,busy,onForward,onDelete,onCancel}:{count:number;canForward:boolean;busy:boolean;onForward:()=>void;onDelete:()=>void;onCancel:()=>void}){
 return <div className={styles.selection} role="toolbar" aria-label="Selected message actions"><button type="button" aria-label="Cancel message selection" onClick={onCancel}><X size={17}/></button><strong>{count} selected</strong><button type="button" disabled={!canForward||busy} onClick={onForward}><Forward size={17}/><span>Forward</span></button><button type="button" disabled={busy} onClick={onDelete}><Trash2 size={16}/><span>Delete</span></button></div>;
}

export function MessageEditBanner({message,onCancel}:{message:ChatMessage;onCancel:()=>void}){
 return <div className={styles.editBanner}><Pencil size={16}/><div><strong>{message.attachment?'Editing caption':'Editing message'}</strong><span>{message.text||message.attachment?.name}</span></div><button type="button" onClick={onCancel} aria-label="Cancel message edit"><X size={16}/></button></div>;
}

export function ForwardMessagesDialog({messages,contacts,busy,error,onClose,onForward}:{messages:ChatMessage[];contacts:Conversation[];busy:boolean;error:string|null;onClose:()=>void;onForward:(ids:string[])=>void}){
 const [query,setQuery]=useState(''),[chosen,setChosen]=useState<string[]>([]);
 const matches=contacts.filter(c=>`${c.name} ${c.username}`.toLowerCase().includes(query.toLowerCase().replace(/^@/,'')));
 const tooMany=chosen.length*messages.length>50;
 function toggle(id:string){setChosen(previous=>previous.includes(id)?previous.filter(value=>value!==id):previous.length<5?[...previous,id]:previous)}
 return <Dialog title={messages.length===1?'Forward message':'Forward messages'} onClose={onClose}>
  <p className={styles.intro}>Choose up to five conversations. Forwarded messages keep their remaining expiration time.</p>
  <div className={styles.preview}><Forward size={17}/><span>{messages.length===1?(messages[0].attachment?.name||messages[0].text):`${messages.length} selected messages`}</span></div>
  <div className={styles.search}><Search size={16}/><input aria-label="Search forwarding contacts" placeholder="Find a conversation" value={query} onChange={event=>setQuery(event.target.value)}/></div>
  <div className={styles.contacts} role="group" aria-label="Forward recipients">{matches.length?matches.map(contact=><button type="button" key={contact.id} aria-pressed={chosen.includes(contact.id)} disabled={busy||chosen.length===5&&!chosen.includes(contact.id)} onClick={()=>toggle(contact.id)}><Avatar contact={contact} small/><span><strong>{contact.name}</strong><small>@{contact.username.replace(/^@/,'')}</small></span><i>{chosen.includes(contact.id)&&<Check size={13}/>}</i></button>):<p className={styles.empty}>{contacts.length?'No matching conversations.':'Add an accepted contact to forward messages.'}</p>}</div>
  {tooMany&&<p className={styles.error} role="alert">Forward up to 50 copies at once. Select fewer messages or conversations.</p>}
  {error&&<p className={styles.error} role="alert">{error}</p>}
  <div className={styles.actions}><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button><button type="button" className="primary-button" disabled={busy||!chosen.length||tooMany} onClick={()=>onForward(chosen)}><Forward size={15}/>{busy?'Forwarding…':`Forward${chosen.length?` · ${chosen.length}`:''}`}</button></div>
 </Dialog>;
}

export function DeleteMessagesDialog({count,canDeleteEveryone,deleteEveryoneDisabledReason,deleteEveryoneExpiresAt,busy,error,onClose,onDelete}:{count:number;canDeleteEveryone:boolean;deleteEveryoneDisabledReason?:string;deleteEveryoneExpiresAt?:number;busy:boolean;error:string|null;onClose:()=>void;onDelete:(scope:'me'|'everyone')=>void}){
 return <Dialog title={count===1?'Delete message?':`Delete ${count} messages?`} onClose={onClose}>
  <p className={styles.intro}>Delete for me hides {count===1?'this message':'these messages'} from this device. Other people keep their copy.</p>
  {canDeleteEveryone&&<p className={styles.intro}>Delete for everyone replaces your sent {count===1?'message':'messages'} with a “Message deleted” marker and removes the original encrypted content and attachments from the server.</p>}
  {canDeleteEveryone&&<div className={styles.deleteNotice} role="status">{deleteEveryoneDisabledReason||<>Available while unread and for 30 minutes after the other person first reads it.{deleteEveryoneExpiresAt&&<> This selection can be deleted until {new Date(deleteEveryoneExpiresAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'})}.</>}</>}</div>}
  {error&&<p className={styles.error} role="alert">{error}</p>}
  <div className={styles.deleteActions}>{canDeleteEveryone&&<button type="button" className="danger-button" disabled={busy||!!deleteEveryoneDisabledReason} onClick={()=>onDelete('everyone')}><Trash2 size={15}/>{busy?'Deleting…':'Delete for everyone'}</button>}<button type="button" className="secondary-button" disabled={busy} onClick={()=>onDelete('me')}><Trash2 size={15}/>Delete for me</button><button type="button" className="text-button" disabled={busy} onClick={onClose}>Cancel</button></div>
 </Dialog>;
}
