export const MESSAGE_HOLD_MS=500;
export const MESSAGE_SWIPE_PX=64;

interface GestureStart {pointerId:number;x:number;y:number;time:number;own:boolean;pointerType:string;primary?:boolean;button?:number;interactive?:boolean;hasSelection?:boolean}
interface ActiveGesture extends GestureStart {dx:number;dy:number;moved:boolean;cancelled:boolean;held:boolean;horizontal:boolean}

/** Small, bounded state machine: scrolling and interactive controls never reply. */
export class MessageGesture {
 private active:ActiveGesture|null=null;
 private suppressUntil=0;

 begin(input:GestureStart){
  this.active=null;
  if(input.primary===false||(input.button??0)!==0||input.interactive||input.hasSelection)return false;
  this.active={...input,dx:0,dy:0,moved:false,cancelled:false,held:false,horizontal:false};
  return true;
 }

 move(pointerId:number,x:number,y:number){
  const state=this.active;
  if(!state||state.pointerId!==pointerId||state.cancelled||state.held)return{offset:0,claimed:false,cancelHold:true};
  state.dx=x-state.x;state.dy=y-state.y;
  const dx=Math.abs(state.dx),dy=Math.abs(state.dy),direction=state.own?-1:1;
  if(dx>8||dy>8)state.moved=true;
  if(dy>10&&dy>=dx*.8){state.cancelled=true;return{offset:0,claimed:false,cancelHold:true}}
  if(state.pointerType==='mouse')return{offset:0,claimed:false,cancelHold:state.moved};
  if(!state.horizontal&&dx>12){
   if(state.dx*direction<=0||dx<dy*1.4){state.cancelled=true;return{offset:0,claimed:false,cancelHold:true}}
   state.horizontal=true;
  }
  const offset=state.horizontal?direction*Math.min(82,Math.max(0,state.dx*direction)):0;
  return{offset,claimed:state.horizontal,cancelHold:state.moved};
 }

 hold(now:number){
  const state=this.active;
  if(!state||state.cancelled||state.moved||state.held||now-state.time<MESSAGE_HOLD_MS)return false;
  state.held=true;this.suppressUntil=now+500;
  return true;
 }

 finish(pointerId:number,now:number){
  const state=this.active;
  if(!state||state.pointerId!==pointerId)return false;
  this.active=null;
  const replied=!state.cancelled&&!state.held&&state.horizontal&&state.dx*(state.own?-1:1)>=MESSAGE_SWIPE_PX&&Math.abs(state.dx)>=Math.abs(state.dy)*1.4;
  if(state.held||replied)this.suppressUntil=now+500;
  return replied;
 }

 cancel(){this.active=null}
 suppressClick(now:number){return now<this.suppressUntil}
}
