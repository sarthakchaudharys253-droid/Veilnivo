/** Typing is a short-lived hint, never durable presence or message state. */
export const TYPING_LEASE_MS=6000;

export class TypingLease {
 private peerId:string|null=null;
 private expiresAt=0;
 private revision=0;
 private timer:ReturnType<typeof setTimeout>|undefined;

 constructor(private readonly changed:()=>void,private readonly ttlMs=TYPING_LEASE_MS){}

 pulse(peerId:string){
  if(this.timer!==undefined)clearTimeout(this.timer);
  const revision=++this.revision;
  this.peerId=peerId;
  this.expiresAt=Date.now()+this.ttlMs;
  this.timer=setTimeout(()=>{if(revision===this.revision)this.clear()},this.ttlMs);
  this.changed();
 }

 clear(peerId?:string){
  if(peerId!==undefined&&this.peerId!==peerId)return;
  this.revision++;
  if(this.timer!==undefined)clearTimeout(this.timer);
  this.timer=undefined;
  this.peerId=null;
  this.expiresAt=0;
  this.changed();
 }

 isTyping(peerId:string){return this.peerId===peerId&&this.expiresAt>Date.now()}
}
