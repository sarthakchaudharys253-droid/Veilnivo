'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {ArrowUpRight,Check,Clock3,MessageSquare,Search,UserRound,Users} from 'lucide-react';
import {useVeilnivo,type UserSearchResult} from '@/lib/store';

export function FindUsername({onClose,onOpened,onRequests}:{onClose:()=>void;onOpened:()=>void;onRequests:()=>void}) {
 const s=useVeilnivo();
 const [username,setUsername]=useState(''),[results,setResults]=useState<UserSearchResult[]|null>(null),[searching,setSearching]=useState(false),[sending,setSending]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const current=useRef(0),controller=useRef<AbortController|null>(null),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;current.current++;controller.current?.abort();}},[]);
 const visible=results?.filter(result=>!s.blockedContacts.some(contact=>contact.id===result.id)&&!s.conversations.some(contact=>contact.id===result.id&&(contact.hidden||contact.locked&&!s.lockedChatsOpen)));
 function edit(value:string){current.current++;controller.current?.abort();setUsername(value.replace(/^@/,'').toLowerCase());setResults(null);setSearching(false);setError('');setNotice('');}
 async function search(event:FormEvent){
  event.preventDefault();controller.current?.abort();const task=++current.current,accountId=s.user?.id,request=new AbortController();controller.current=request;setSearching(true);setResults(null);setError('');setNotice('');s.clearError();
  try{const users=await s.searchUsers(username,request.signal);if(mounted.current&&task===current.current&&useVeilnivo.getState().user?.id===accountId)setResults(users);}
  catch(reason){if(mounted.current&&task===current.current&&!request.signal.aborted)setError(reason instanceof Error?reason.message:'Search is unavailable. Try again.');}
  finally{if(mounted.current&&task===current.current)setSearching(false);}
 }
 function open(result:UserSearchResult){
  const state=useVeilnivo.getState();if(state.user?.id!==s.user?.id)return;
  const contact=state.conversations.find(contact=>contact.id===result.id&&!contact.blocked&&!contact.hidden&&(!contact.locked||state.lockedChatsOpen));
  if(!contact){setError('This conversation changed. Search again to refresh its status.');setResults(null);return;}
  state.selectChat(contact.id);onOpened();onClose();
 }
 async function request(result:UserSearchResult){
  const task=current.current,accountId=s.user?.id;setSending(true);setError('');s.clearError();
  await s.findUser(result.username);
  if(!mounted.current||task!==current.current||useVeilnivo.getState().user?.id!==accountId)return;
  setSending(false);const state=useVeilnivo.getState();
  if(state.error){setError(state.error);return;}
  const contact=state.conversations.find(contact=>contact.id===result.id);
  const relationship=contact?.requestStatus==='accepted'?'accepted':'outgoing';
  setResults([{...result,relationship}]);setNotice(relationship==='accepted'?'You are connected. Open your conversation.':'Connection request sent. Messaging opens when they accept.');
 }
 const descriptions:Record<UserSearchResult['relationship'],string>={self:'This is your identity.',none:'Send a request. They choose whether to connect.',incoming:'They sent you a connection request.',outgoing:'Waiting for them to accept your request.',accepted:'You are connected.'};
 return <section className="find-username">
  <form className="auth-form" onSubmit={search}>
   <p className="modal-copy left-copy">Enter a full username to find one person. Searching does not send a request.</p>
   <label>Exact username<div className="username-field"><span>@</span><input aria-label="Find username" placeholder="their_alias" value={username} onChange={event=>edit(event.target.value)} minLength={3} maxLength={25} required autoFocus autoComplete="off" spellCheck={false} disabled={sending}/></div></label>
   <button className="primary-button" disabled={searching||sending||s.busy} type="submit"><Search size={16}/>{searching?'Searching…':'Search user'}<ArrowUpRight size={17}/></button>
  </form>
  <div className="user-search-results" aria-live="polite" aria-busy={searching}>
   {searching&&<p className="search-feedback"><Search size={17}/>Looking for an exact match…</p>}
   {!searching&&visible?.length===0&&<div className="search-no-result"><UserRound size={25}/><strong>No available user found.</strong><p>Check the full username or ask them for an invitation link.</p></div>}
   {!searching&&visible?.map(result=><article className="user-search-card" key={result.id}>
    <span className="search-user-avatar" aria-hidden="true">{result.username.slice(0,2).toUpperCase()}</span>
    <div className="search-user-copy"><strong>@{result.username}</strong><p>{descriptions[result.relationship]}</p>
     {result.relationship==='none'&&<button type="button" className="primary-button" disabled={sending||s.busy} onClick={()=>void request(result)}><MessageSquare size={15}/>{sending?'Sending request…':'Send connection request'}</button>}
     {result.relationship==='incoming'&&<button type="button" className="primary-button" onClick={()=>{onRequests();onClose();}}><Users size={15}/>Review request</button>}
     {result.relationship==='accepted'&&<button type="button" className="primary-button" onClick={()=>open(result)}><MessageSquare size={15}/>Open chat<ArrowUpRight size={15}/></button>}
     {result.relationship==='outgoing'&&<><span className="search-request-status"><Clock3 size={14}/>Request sent</span><button type="button" className="text-button" onClick={()=>open(result)}>View conversation<ArrowUpRight size={14}/></button></>}
    </div>
   </article>)}
   {notice&&<p className="search-success" role="status"><Check size={16}/>{notice}</p>}
  </div>
  {error&&<p className="form-error" role="alert">{error}</p>}
  <p className="local-notice">{s.user?.id==='preview-cipher'?'Your sample contacts are already connected. Try @nova or @atlas.':s.mode==='demo'?'Local preview searches identities registered in this browser.':'Only an exact username or alias returns a result. No public directory.'}</p>
 </section>;
}
