'use client';
import {useState} from 'react';
import {ArrowDownToLine,Check,CheckCheck,Clock3,FileText,Image as ImageIcon,Reply,RotateCw,Smile,AlertCircle} from 'lucide-react';
import {Avatar,formatBytes,formatTime} from './UI';
import {sanitizedFilename} from '@/lib/chat-utils';
import {useVeilnivo,type Conversation,type ChatMessage} from '@/lib/store';
export default function Message({message:m,contact,onReply}:{message:ChatMessage,contact:Conversation,onReply:()=>void}) {
 const s=useVeilnivo();const [picker,setPicker]=useState(false);const [downloading,setDownloading]=useState(false);
 async function download(){if(!m.attachment)return;setDownloading(true);try{const blob=await s.downloadAttachment(m.attachment);if(blob){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=sanitizedFilename(m.attachment.name);a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}}finally{setDownloading(false)}}
 if(m.system)return <div className="system-message"><Clock3 size={12}/><span>{m.text}</span></div>;
 const status=m.status==='queued'?'Queued':m.status==='failed'?'Failed':m.status==='sending'?'Sending':m.status==='read'?'Read':m.status==='delivered'?'Delivered':s.mode==='demo'?'Saved locally':'Sent';
 return <div className={`message-row ${m.own?'own':''}`}><div className="message-avatar">{!m.own&&<Avatar contact={contact} small/>}</div><div className="message-stack"><div className={`message-bubble ${m.own?'outgoing':'incoming'} ${m.status==='failed'?'failed-bubble':''}`}>
 {m.replyTo&&<div className="quoted-message"><span>{m.replyTo.own?'You':contact.name}</span><p>{m.replyTo.text||'Encrypted attachment'}</p></div>}
 {m.attachment&&<button type="button" className="attachment-card" onClick={()=>void download()} disabled={downloading} aria-label={`Download ${m.attachment.name}`}><span className="file-icon">{m.attachment.mime.startsWith('image/')?<ImageIcon size={23}/>:<FileText size={23}/>}</span><span><strong>{m.attachment.name}</strong><small>{formatBytes(m.attachment.size)} · encrypted file</small></span><ArrowDownToLine size={18}/></button>}
 {m.text&&<p>{m.text}</p>}
 <div className="message-meta">{m.expiresAt&&<span className="expiry-marker" title={`Expires ${new Date(m.expiresAt).toLocaleString()}`}><Clock3 size={10}/></span>}<time>{formatTime(m.at)}</time>{m.own&&<><span className={`delivery-label ${m.status==='failed'?'delivery-error':''}`}>{status}</span>{m.status==='read'||m.status==='delivered'?<CheckCheck size={14}/>:m.status==='queued'||m.status==='sending'?<Clock3 size={12}/>:m.status==='failed'?<AlertCircle size={12}/>:<Check size={13}/>}</>}</div>
 </div><div className="message-reactions">{Object.entries(m.reactions||{}).filter(([,actors])=>actors.length>0).map(([emoji,actors])=><button key={emoji} className={actors.includes(s.user?.id||'')?'own-reaction':''} onClick={()=>void s.reactToMessage(m.id,emoji)} aria-label={`React ${emoji}`}>{emoji}<span>{actors.length}</span></button>)}</div>
 {m.status==='failed'&&m.own&&<button className="retry-message" onClick={()=>void s.retryMessage(m.id)}><RotateCw size={12}/>Retry encrypted message</button>}
 </div><div className="message-actions"><button title="Reply to message" aria-label="Reply to message" onClick={onReply}><Reply size={15}/></button><button disabled={contact.isBot} title="React to message" aria-label="React to message" onClick={()=>setPicker(!picker)}><Smile size={15}/></button>{picker&&<div className="reaction-picker">{['👍','💚','😂','✨','👀','🎉'].map(e=><button key={e} aria-label={`Add ${e} reaction`} onClick={()=>{void s.reactToMessage(m.id,e);setPicker(false)}}>{e}</button>)}</div>}</div></div>
}
