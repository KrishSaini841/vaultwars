import { callAction, CallError } from './call.ts';
import {randomBytes,randomUUID} from 'node:crypto';
import {PRIZES,player,begin,next,bid,settle,snapshot,type Room} from './game.ts';
export interface RoomStore {
 getWithMetadata(key:string,options:{type:'json';consistency:'strong'}):Promise<{data:unknown;etag?:string}|null>;
 setJSON(key:string,value:unknown,options:({onlyIfNew:true;onlyIfMatch?:never}|{onlyIfMatch:string;onlyIfNew?:never})):Promise<{modified:boolean}>;
}
class Problem extends Error {constructor(message:string,public status=400){super(message)}}
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
// Dependencies are injected for deterministic tests; production always uses the six-vault schedule.
export function createHandler(getStore:()=>RoomStore,{clock=Date.now,prizes=PRIZES}:{clock?:()=>number;prizes?:number[]}={}) {
 return async(req:Request):Promise<Response>=>{
  try {
   if(req.method!=='POST')return json({error:'Use POST.'},405);
   const origin=req.headers.get('origin');if(origin&&origin!==new URL(req.url).origin)return json({error:'Origin rejected.'},403);
   const raw=await req.text();if(raw.length>32768)throw new Problem('Request too large.',413);
   let body:Record<string,unknown>;try{body=JSON.parse(raw)}catch{throw new Problem('Invalid JSON.')}
   if(!body||Array.isArray(body)||typeof body!=='object')throw new Problem('Invalid request.');
   const action=String(body.action||'');if(!['create','join','state','start','bid','next','chat','call-join','call-leave','call-state','call-status','call-signal'].includes(action))throw new Problem('Unknown action.',404);
   const store=getStore(),now=clock();
   if(action==='create'){
    if(!String(body.name||'').trim())throw new Problem('Enter a player name.');
    const p=player(body.name,now);
    for(let attempt=0;attempt<8;attempt++){
     const code=randomBytes(3).toString('hex').toUpperCase();
     const r:Room={code,host:p.id,phase:'lobby',round:0,carry:0,history:[],chat:[],players:[p],deadline:null,touched:now,prizes:[...prizes],gameId:randomUUID(),revision:0,requests:[]};
     if((await store.setJSON(code,r,{onlyIfNew:true})).modified)return json({room:code,id:p.id,token:p.token});
    }
    throw new Problem('Could not reserve a room. Please retry.',503);
   }
   const code=String(body.room||body.code||'').trim().toUpperCase();if(!/^[A-F0-9]{6}$/.test(code))throw new Problem('Room code not found.',404);
   const token=req.headers.get('authorization')?.replace(/^Bearer /,'');
   if(action==='join'&&!String(body.name||'').trim())throw new Problem('Enter a player name.');
   if(action.startsWith('call-'))return json(await callAction(store,code,token,action,body,now));
   const joined=action==='join'?player(body.name,now):null;
   const requestId=String(body.requestId||'');
   if(action!=='state'&&(!/^[a-zA-Z0-9-]{8,80}$/.test(requestId)))throw new Problem('A request ID is required.');
   for(let attempt=0;attempt<20;attempt++){
    const record=await store.getWithMetadata(code,{type:'json',consistency:'strong'});
    if(!record)throw new Problem('Room not found. Create or join a new room.',404);
    if(!record.etag)throw new Problem('Storage version missing. Please retry.',503);
    const r=record.data as Room;
    if(now-r.touched>86400000)throw new Problem('Room expired. Create a new room.',410);
    let p=joined||r.players.find(p=>p.token===token);if(!p)throw new Problem('Your session is invalid. Rejoin the room.',401);
    // Join retries use their request ID to recover the same seat without duplicating it.
    const dedupeKey=(joined?'join':p.id)+':'+requestId;
    if(r.requests.includes(dedupeKey)){
     if(joined){const recovered=r.players.find(p=>p.token===r.requests[r.requests.indexOf(dedupeKey)+1]);if(recovered)return json({room:code,id:recovered.id,token:recovered.token});}
     else return json(snapshot(r,p.id,now));
    }
    let changed=settle(r,now),failure:Problem|undefined;
    try {
     if(action==='join'){
      if(r.phase!=='lobby')throw new Problem('This game has already started.');if(r.players.length>=8)throw new Problem('Room is full (8 players).');
      if(r.players.some(x=>x.name.toLowerCase()===p!.name.toLowerCase()))throw new Problem('Choose a different name.');
      r.players.push(p);changed=true;
     }else if(action==='state'){
      if(now-p.seen>=5000){p.seen=now;changed=true;}
     }else {
      if(body.gameId!==r.gameId)throw new Problem('Game changed. Refresh and try again.',409);
      if(action==='start'){
       if(p.id!==r.host)throw new Problem('Only the host can start.',403);
       if(!['lobby','finished'].includes(r.phase))throw new Problem('Game already in progress.');
       if(r.players.length<2)throw new Problem('At least 2 players are needed.');begin(r,now);
      }else if(action==='bid'){
       if(body.round!==r.round)throw new Problem('Round changed. Try again.',409);bid(r,p,body.bid);settle(r,now);
      }else if(action==='next'){
       if(p.id!==r.host||r.phase!=='reveal')throw new Problem('Waiting for the host to continue.');
       if(body.round!==r.round)throw new Problem('Round changed. Try again.',409);next(r,now);
      }else if(action==='chat'){
       const text=String(body.text||'').trim().slice(0,240);if(!text)throw new Problem('Enter a message.');
       if(now-(p.lastChat||0)<700)throw new Problem('Please wait a moment.',429);p.lastChat=now;r.chat.push({name:p.name,text});r.chat=r.chat.slice(-40);
      }
      p.seen=now;changed=true;
     }
    }catch(e){failure=e instanceof Problem?e:new Problem((e as Error).message)}
    if(changed){
     r.touched=now;r.revision++;
     if(!failure&&action!=='state'){r.requests.push(dedupeKey);if(joined)r.requests.push(p.token);r.requests=r.requests.slice(-160);}
     const result=await store.setJSON(code,r,{onlyIfMatch:record.etag});
     if(!result.modified){await new Promise(resolve=>setTimeout(resolve,Math.min(60,attempt*5)));continue;}
    }
    if(failure)throw failure;
    return joined?json({room:code,id:p.id,token:p.token}):json(snapshot(r,p.id,now));
   }
   throw new Problem('Room is busy. Please try again.',409);
  }catch(e){if(e instanceof Problem||e instanceof CallError)return json({error:e.message},e.status);console.error('Game request failed',e);return json({error:'Game service is temporarily unavailable. Please retry.'},503)}
 };
}
