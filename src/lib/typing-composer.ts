const IDLE_MS=1500;
const HEARTBEAT_MS=1000;

/** Advertise recent input, never an untouched draft or a focused textarea. */
export function createTypingComposer(send:(typing:boolean)=>void){
 let announced=false,disposed=false,lastHeartbeat=0;
 let idleTimer:ReturnType<typeof setTimeout>|undefined;
 const stop=()=>{
  if(idleTimer!==undefined)clearTimeout(idleTimer);
  idleTimer=undefined;
  if(announced){announced=false;send(false)}
 };
 return {
  update(hasText:boolean){
   if(disposed)return;
   if(!hasText){stop();return}
   const now=Date.now();
   if(!announced||now-lastHeartbeat>=HEARTBEAT_MS){announced=true;lastHeartbeat=now;send(true)}
   if(idleTimer!==undefined)clearTimeout(idleTimer);
   idleTimer=setTimeout(stop,IDLE_MS);
  },
  stop,
  dispose(){stop();disposed=true},
 };
}
