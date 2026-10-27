import {createHash, randomBytes} from 'node:crypto';

export interface RealtimePrincipal {sub:string;sid:string;expiresAt:number}
interface PendingTicket {principal:RealtimePrincipal;expiresAt:number}
const ticketHash=(ticket:string)=>createHash('sha256').update(ticket).digest('hex');
export class RealtimeTicketCapacityError extends Error {
  constructor(){super('Realtime authorization is busy. Try again shortly.');}
}
export function realtimeTicketsEnabled(value:string|undefined):boolean {
  if(value===undefined||value===''||value==='false')return false;
  if(value==='true')return true;
  throw new Error('REALTIME_TICKETS must be true or false.');
}

/** Opaque capabilities authorize one WebSocket handshake, never an HTTP API.
 * Only hashes remain in memory; one pending ticket per session bounds retries.
 * Tickets deliberately die on process restart; clients obtain a fresh one.
 */
export class RealtimeTicketStore {
  private pending=new Map<string,PendingTicket>();
  private sessions=new Map<string,string>();
  constructor(private readonly now=()=>Date.now(),private readonly capacity=1024,private readonly ttl=30_000){
    if(!Number.isSafeInteger(capacity)||capacity<1||capacity>10_000||!Number.isFinite(ttl)||ttl<1||ttl>30_000)throw new Error('Invalid realtime ticket limits.');
  }
  get size(){return this.pending.size;}
  private remove(hash:string){const found=this.pending.get(hash);if(found&&this.sessions.get(found.principal.sid)===hash)this.sessions.delete(found.principal.sid);this.pending.delete(hash);}
  prune(){const now=this.now();for(const [hash,ticket] of this.pending)if(ticket.expiresAt<=now)this.remove(hash);}
  issue(principal:RealtimePrincipal):{ticket:string;expires_at:string}{
    const now=this.now();this.prune();
    if(!principal.sub||!principal.sid||!Number.isFinite(principal.expiresAt)||principal.expiresAt<=now)throw new Error('Session expired.');
    const previous=this.sessions.get(principal.sid);
    if(!previous&&this.pending.size>=this.capacity)throw new RealtimeTicketCapacityError();
    if(previous)this.remove(previous);
    const ticket=randomBytes(32).toString('base64url'),hash=ticketHash(ticket),expiresAt=Math.min(now+this.ttl,principal.expiresAt);
    this.pending.set(hash,{principal:{...principal},expiresAt});this.sessions.set(principal.sid,hash);
    return {ticket,expires_at:new Date(expiresAt).toISOString()};
  }
  consume(value:unknown):RealtimePrincipal{
    if(typeof value!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(value)||Buffer.from(value,'base64url').toString('base64url')!==value)throw new Error('Invalid realtime ticket.');
    const hash=ticketHash(value),ticket=this.pending.get(hash);
    // Delete synchronously before the caller performs any asynchronous checks.
    // Concurrent replays cannot both enter the session revalidation stage.
    this.remove(hash);
    if(!ticket||ticket.expiresAt<=this.now()||ticket.principal.expiresAt<=this.now())throw new Error('Invalid realtime ticket.');
    return {...ticket.principal};
  }
  revokeSession(sid:string){const hash=this.sessions.get(sid);if(hash)this.remove(hash);}
  revokeUser(sub:string){for(const [hash,ticket] of this.pending)if(ticket.principal.sub===sub)this.remove(hash);}
  clear(){this.pending.clear();this.sessions.clear();}
}
