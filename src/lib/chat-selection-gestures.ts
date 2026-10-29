export const CHAT_SELECTION_HOLD_MS=500;
interface Start {id:string;pointerId:number;pointerType:string;x:number;y:number;time:number;primary?:boolean;button?:number}
interface Active extends Start {moved:boolean;held:boolean}

/** A stationary touch selects one row; scrolling and extra fingers cancel it. */
export class ChatSelectionGesture {
 private active:Active|null=null;
 private suppressed:{id:string;until:number}|null=null;
 begin(input:Start){
  this.active=null;
  if(!['touch','pen'].includes(input.pointerType)||input.primary===false||(input.button??0)!==0)return false;
  this.active={...input,moved:false,held:false};return true;
 }
 move(pointerId:number,x:number,y:number){
  const state=this.active;if(!state||state.pointerId!==pointerId)return true;
  if(Math.abs(x-state.x)>8||Math.abs(y-state.y)>8)state.moved=true;
  return state.moved;
 }
 hold(now:number){
  const state=this.active;if(!state||state.moved||state.held||now-state.time<CHAT_SELECTION_HOLD_MS)return null;
  state.held=true;this.suppressed={id:state.id,until:now+500};return state.id;
 }
 nativeHold(id:string,now:number){const state=this.active;if(!state||state.id!==id||state.moved)return false;state.held=true;this.suppressed={id,until:now+500};return true;}
 finish(pointerId:number,now:number){if(this.active?.pointerId!==pointerId)return;this.cancel(now);}
 cancel(now:number){const state=this.active;if(state&&(state.held||state.moved))this.suppressed={id:state.id,until:now+500};this.active=null;}
 suppressClick(id:string,now:number){return this.suppressed?.id===id&&now<this.suppressed.until;}
}
