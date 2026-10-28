import type { RoomStore } from './service.ts';
import type { Room } from './game.ts';
export class CallError extends Error {constructor(message:string,public status=400){super(message)}}
interface Member {id:string;session:string;mic:boolean;camera:boolean;seen:number}
interface Signal {id:string;from:string;fromSession:string;to:string;toSession:string;description:{type:'offer'|'answer';sdp:string};expires:number}
interface Call {members:Member[];signals:Signal[];revision:number}
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9-]{36}$/i.test(v);
export async function callAction(store:RoomStore,code:string,token:string|undefined,action:string,b:Record<string,unknown>,now:number){
 const roomRecord=await store.getWithMetadata(code,{type:'json',consistency:'strong'});
 if(!roomRecord)throw new CallError('Room not found.',404);
 const room=roomRecord.data as Room,p=room.players.find(p=>p.token===token);
 if(!p)throw new CallError('Your session is invalid.',401);
 if(now-room.touched>86400000)throw new CallError('Room expired.',410);
 const key='call-'+code;
 for(let attempt=0;attempt<20;attempt++){
  const record=await store.getWithMetadata(key,{type:'json',consistency:'strong'});
  if(record&&!record.etag)throw new CallError('Storage version missing.',503);
  const call:Call=record?record.data as Call:{members:[],signals:[],revision:0};
  const before=JSON.stringify(call);
  call.members=call.members.filter(m=>now-m.seen<25000);
  call.signals=call.signals.filter(s=>s.expires>now&&call.members.some(m=>m.id===s.from&&m.session===s.fromSession)&&call.members.some(m=>m.id===s.to&&m.session===s.toSession));
  let me=call.members.find(m=>m.id===p.id);
  if(action==='call-join'){
   if(!uuid(b.callSession)||typeof b.mic!=='boolean'||typeof b.camera!=='boolean')throw new CallError('Invalid call settings.');
   if(me&&me.session!==b.callSession)call.signals=call.signals.filter(s=>s.from!==p.id&&s.to!==p.id);
   call.members=call.members.filter(m=>m.id!==p.id);
   me={id:p.id,session:b.callSession,mic:b.mic,camera:b.camera,seen:now};call.members.push(me);
  }else if(action==='call-leave'){
   if(me?.session===b.callSession){call.members=call.members.filter(m=>m.id!==p.id);call.signals=call.signals.filter(s=>s.from!==p.id&&s.to!==p.id);me=undefined;}
  }else if(action==='call-state'){
   if(b.callSession){
    if(!me||me.session!==b.callSession)throw new CallError('Call session expired or opened in another tab. Rejoin the call.',409);
    if(now-me.seen>=5000)me.seen=now;
    if(Array.isArray(b.ack)&&b.ack.length<=64)call.signals=call.signals.filter(s=>!(s.to===p.id&&s.toSession===me!.session&&(b.ack as unknown[]).includes(s.id)));
   }
  }else{
   if(!me||me.session!==b.callSession)throw new CallError('Join the call first.',409);
   if(action==='call-status'){
    if(typeof b.mic!=='boolean'||typeof b.camera!=='boolean')throw new CallError('Invalid call settings.');me.mic=b.mic;me.camera=b.camera;me.seen=now;
   }else if(action==='call-signal'){
    const to=call.members.find(m=>m.id===b.to&&m.session===b.toSession);
    const d=b.description as Signal['description']|undefined;
    if(!to||to.id===p.id)throw new CallError('Other player has left the call.',409);
    if(!uuid(b.requestId)||!d||!['offer','answer'].includes(d.type)||typeof d.sdp!=='string'||d.sdp.length>24000||!d.sdp.startsWith('v=0'))throw new CallError('Invalid call signal.');
    if(!call.signals.some(s=>s.id===b.requestId)){
     call.signals=call.signals.filter(s=>!(s.from===p.id&&s.to===to.id&&s.description.type===d.type));
     call.signals.push({id:b.requestId,from:p.id,fromSession:me.session,to:to.id,toSession:to.session,description:{type:d.type,sdp:d.sdp},expires:now+60000});
    }
    me.seen=now;
   }else throw new CallError('Unknown call action.',404);
  }
  if(JSON.stringify(call)!==before){
   call.revision++;
   const write=await store.setJSON(key,call,record?{onlyIfMatch:record.etag!}:{onlyIfNew:true});
   if(!write.modified){await new Promise(resolve=>setTimeout(resolve,Math.min(60,attempt*5)));continue;}
  }
  return {revision:call.revision,members:call.members.map(m=>({...m,name:room.players.find(p=>p.id===m.id)?.name||'Player'})),signals:me?.session===b.callSession?call.signals.filter(s=>s.to===p.id&&s.toSession===me!.session):[]};
 }
 throw new CallError('Call is busy. Please retry.',503);
}
