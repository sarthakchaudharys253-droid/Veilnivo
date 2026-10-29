'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {Check,LockKeyhole,Plus,Search,ShieldCheck,Users,X} from 'lucide-react';
import {useVeilnivo,type Conversation} from '@/lib/store';
import {Avatar,Dialog} from './UI';
import styles from './Groups.module.css';

function availableContacts(state:ReturnType<typeof useVeilnivo.getState>){return state.conversations.filter(contact=>!contact.isBot&&!contact.isGroup&&!contact.hidden&&!contact.blocked&&!contact.keyChanged&&contact.requestStatus==='accepted'&&(!contact.locked||state.lockedChatsOpen));}

function MemberPicker({contacts,selected,onChange,disabled=false,label='Select group members'}:{contacts:Conversation[];selected:string[];onChange:(ids:string[])=>void;disabled?:boolean;label?:string}){
 const [query,setQuery]=useState('');
 const matches=contacts.filter(contact=>`${contact.name} ${contact.username}`.toLowerCase().includes(query.toLowerCase().replace(/^@/,'')));
 const all=matches.length>0&&matches.every(contact=>selected.includes(contact.id));
 function toggle(id:string){onChange(selected.includes(id)?selected.filter(value=>value!==id):[...selected,id]);}
 function selectList(){onChange(all?selected.filter(id=>!matches.some(contact=>contact.id===id)):[...new Set([...selected,...matches.map(contact=>contact.id)])]);}
 return <div className={styles.picker}>
  <div className={styles.search}><Search size={16}/><input aria-label="Search group contacts" placeholder="Search your contacts" value={query} onChange={event=>setQuery(event.target.value)} disabled={disabled}/></div>
  <div className={styles.selection}><strong>{selected.length} selected</strong><button type="button" onClick={selectList} disabled={disabled||!matches.length}>{all?'Deselect list':'Select all'}</button>{selected.length>0&&<button type="button" onClick={()=>onChange([])} disabled={disabled}>Clear</button>}</div>
  <div className={styles.contacts} role="group" aria-label={label}>
   {matches.map(contact=><button type="button" role="checkbox" aria-checked={selected.includes(contact.id)} aria-label={`${selected.includes(contact.id)?'Deselect':'Add'} @${contact.username} to group`} key={contact.id} disabled={disabled} onClick={()=>toggle(contact.id)}><Avatar contact={contact} small/><span><strong>{contact.name}</strong><small>@{contact.username}</small></span><i>{selected.includes(contact.id)&&<Check size={14}/>}</i></button>)}
   {!matches.length&&<p className={styles.empty}>{contacts.length?'No matching contacts.':'Connect with someone first using Find username or an invitation.'}</p>}
  </div>
 </div>;
}

export function CreateGroup({onCreated,onClose}:{onCreated:()=>void;onClose:()=>void}){
 const s=useVeilnivo(),[name,setName]=useState(''),[selected,setSelected]=useState<string[]>([]),[error,setError]=useState('');
 const alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[]);
 const contacts=availableContacts(s),signature=contacts.map(contact=>contact.id).sort().join('|');
 useEffect(()=>{const ids=new Set(contacts.map(contact=>contact.id));setSelected(previous=>previous.filter(id=>ids.has(id)))},[signature]);
 async function create(){const owner=s.user?.id;if(!owner||s.busy)return;if(!name.trim()){setError('Give your group a name.');return}if(!selected.length){setError('Choose at least one contact.');return}setError('');const group=await s.createGroup(name.trim(),selected);if(group&&alive.current&&useVeilnivo.getState().user?.id===owner){onCreated();onClose()}}
 return <section className={styles.create}>
  <div className={styles.intro}><span><Users size={23}/></span><div><h3>Everyone in one conversation.</h3><p>Choose contacts and start a shared chat.</p></div></div>
  <label className={styles.name}>Group name<input aria-label="Group name" placeholder="Give your group a name" value={name} onChange={event=>{setName(event.target.value);setError('')}} maxLength={80} disabled={s.busy} autoComplete="off"/></label>
  <MemberPicker contacts={contacts} selected={selected} onChange={setSelected} disabled={s.busy}/>
  <p className={styles.note}><LockKeyhole size={14}/>Messages are encrypted for the group. Members can see one another; new members receive messages sent after they join.</p>
  {s.mode!=='live'&&<p className={styles.note}>Group chats need the connected backend. Sign in to the live website to create one.</p>}
  {(error||s.error)&&<p className={styles.error} role="alert">{error||s.error}</p>}
  <button type="button" className="primary-button full" disabled={s.busy||!name.trim()||!selected.length||s.mode!=='live'} onClick={()=>void create()}><Users size={16}/>{s.busy?'Creating group…':`Create group${selected.length?` · ${selected.length+1} people`:''}`}</button>
 </section>;
}

export function GroupDetails({group,onClose}:{group:Conversation;onClose:()=>void}){
 const s=useVeilnivo(),[query,setQuery]=useState(''),[adding,setAdding]=useState(false),[selected,setSelected]=useState<string[]>([]),[loading,setLoading]=useState(true),[notice,setNotice]=useState('');
 const owner=s.user?.id,alive=useRef(true),request=useRef(0);
 const members=s.groupMembers[group.id]||[],isOwner=group.ownerId===owner;
 const memberIds=useMemo(()=>new Set(members.map(member=>member.id)),[members]);
 const candidates=availableContacts(s).filter(contact=>!memberIds.has(contact.id));
 useEffect(()=>{alive.current=true;const task=++request.current;setLoading(true);void s.loadGroupMembers(group.id).finally(()=>{if(alive.current&&request.current===task&&useVeilnivo.getState().user?.id===owner)setLoading(false)});return()=>{alive.current=false;request.current++}},[group.id,group.keyVersion,owner]);
 useEffect(()=>{const ids=new Set(candidates.map(contact=>contact.id));setSelected(previous=>previous.filter(id=>ids.has(id)))},[members,s.conversations,s.lockedChatsOpen]);
 async function add(){if(!owner||!selected.length||s.busy||loading)return;const ok=await s.addGroupMembers(group.id,selected);if(ok&&alive.current&&useVeilnivo.getState().user?.id===owner){setSelected([]);setAdding(false);setNotice('Members added. New messages are encrypted with the updated group key.')}}
 const shown=members.filter(member=>member.username.toLowerCase().includes(query.toLowerCase().replace(/^@/,'')));
 return <Dialog title="Group details" onClose={onClose} wide>
  <div className={styles.groupHeading}><Avatar contact={group}/><div><h3>{group.name}</h3><p>{group.memberCount??members.length} members · Encrypted group</p></div>{isOwner&&<span className={styles.owner}>Creator</span>}</div>
  <p className={styles.note}>Everyone in this group receives its messages and can see the member list. Blocking a direct chat does not hide messages in a shared group.</p>
  {group.needsRekey&&<p className={styles.note}><ShieldCheck size={15}/>Updating encryption after a membership change. Reopen this chat if it stays paused.</p>}
  <div className={styles.memberHeading}><strong>Members</strong>{isOwner&&<button type="button" className="text-button" onClick={()=>{s.clearError();setAdding(value=>!value);setNotice('')}} disabled={s.busy||loading}>{adding?<X size={14}/>:<Plus size={14}/>} {adding?'Cancel adding':'Add members'}</button>}</div>
  {adding?<><MemberPicker contacts={candidates} selected={selected} onChange={setSelected} disabled={s.busy||loading} label="Add members to this group"/><button type="button" className="primary-button full" disabled={s.busy||loading||!selected.length} onClick={()=>void add()}><Plus size={15}/>{s.busy?'Adding members…':`Add ${selected.length||''} ${selected.length===1?'member':'members'}`}</button></>:<><div className={styles.search}><Search size={16}/><input aria-label="Search group members" placeholder="Search members" value={query} onChange={event=>setQuery(event.target.value)}/></div><div className={styles.roster} aria-label="Group members" aria-busy={loading}>{loading?<p className={styles.empty}>Loading members…</p>:shown.map(member=><div key={member.id}><span className={styles.memberAvatar}>{member.username.slice(0,2).toUpperCase()}</span><span><strong>@{member.username}{member.id===owner?' (you)':''}</strong><small>{member.role==='owner'?'Group creator':'Member'}</small></span></div>)}{!loading&&!shown.length&&<p className={styles.empty}>No matching members.</p>}</div></>}
  {notice&&<p className={styles.success} role="status">{notice}</p>}{s.error&&<p className={styles.error} role="alert">{s.error}</p>}
 </Dialog>;
}
