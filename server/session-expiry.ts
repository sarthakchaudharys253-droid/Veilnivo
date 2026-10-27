/** Both the database session and the signed token must still be valid. */
export function sessionDeadline(databaseExpiry:Date,jwtExpirySeconds:unknown,now=Date.now()):number {
  const databaseTime=databaseExpiry.getTime();
  if(!Number.isFinite(databaseTime)||typeof jwtExpirySeconds!=='number'||!Number.isFinite(jwtExpirySeconds))throw new Error('Session expired.');
  const deadline=Math.min(databaseTime,jwtExpirySeconds*1000);
  if(deadline<=now)throw new Error('Session expired.');
  return deadline;
}

/** Passive recipients must leave their realtime rooms when authorization ends. */
export function scheduleSessionExpiry(deadline:number,disconnect:()=>void):()=>void {
  let cancelled=false;
  let timer:ReturnType<typeof setTimeout>|undefined;
  const check=()=>{
    if(cancelled)return;
    const remaining=deadline-Date.now();
    if(!Number.isFinite(remaining)||remaining<=0){cancelled=true;disconnect();return;}
    timer=setTimeout(check,Math.min(remaining,2_147_483_647));
    timer.unref?.();
  };
  check();
  return()=>{cancelled=true;if(timer)clearTimeout(timer);};
}
