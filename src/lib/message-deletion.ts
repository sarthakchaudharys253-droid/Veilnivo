export const DELETE_FOR_EVERYONE_WINDOW_MS=30*60*1000;

interface DeletionMessage {own:boolean;status:string;readAt?:number;deleted?:boolean;system?:boolean;isBot?:boolean;expiresAt?:number}
export interface MessageDeletionState {allowed:boolean;reason?:string;expiresAt?:number}

/** A later receipt or snapshot must never restart the first-read deadline. */
export function earliestReadAt(...values:(number|undefined)[]){
 const valid=values.filter((value):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>0);
 return valid.length?Math.min(...valid):undefined;
}

/** Client guidance only: the server independently enforces its own clock. */
export function getMessageDeletionState(message:DeletionMessage,now=Date.now()):MessageDeletionState{
 if(!message.own||message.system||message.isBot)return{allowed:false,reason:'Only your sent peer messages can be deleted for everyone.'};
 if(message.deleted)return{allowed:false,reason:'This message was already deleted.'};
 if(['queued','sending','failed'].includes(message.status))return{allowed:false,reason:'Wait until this message has been sent.'};
 if(!Number.isFinite(now)||message.expiresAt!==undefined&&message.expiresAt<=now)return{allowed:false,reason:'This message is unavailable or expired.'};
 const readAt=earliestReadAt(message.readAt);
 if(readAt===undefined){
  if(message.status==='read'||message.readAt!==undefined)return{allowed:false,reason:'Refresh the conversation to confirm when this message was read.'};
  return{allowed:true};
 }
 const expiresAt=readAt+DELETE_FOR_EVERYONE_WINDOW_MS;
 return now<expiresAt?{allowed:true,expiresAt}:{allowed:false,expiresAt,reason:'Delete for everyone is only available for 30 minutes after the message is read.'};
}
