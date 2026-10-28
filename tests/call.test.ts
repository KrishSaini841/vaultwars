import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createHandler,type RoomStore} from '../lib/service.ts';
class Store implements RoomStore {
 records=new Map<string,{data:unknown;v:number}>();conflicts=0;
 async getWithMetadata(key:string,options:{type:'json';consistency:'strong'}){assert.equal(options.consistency,'strong');const r=this.records.get(key);return r?{data:structuredClone(r.data),etag:String(r.v)}:null}
 async setJSON(key:string,value:unknown,options:{onlyIfNew?:boolean;onlyIfMatch?:string}){const old=this.records.get(key);assert.ok(options.onlyIfNew||options.onlyIfMatch);if((options.onlyIfNew&&old)||(options.onlyIfMatch&&String(old?.v)!==options.onlyIfMatch)){this.conflicts++;return {modified:false}}this.records.set(key,{data:structuredClone(value),v:(old?.v||0)+1});return {modified:true}}
}
function setup(){const store=new Store();let now=100000;const handler=createHandler(()=>store,{clock:()=>now});const call=async(action:string,s?:any,data:Record<string,unknown>={})=>{const response=await handler(new Request('https://game.test/.netlify/functions/game',{method:'POST',headers:{...(s?{Authorization:'Bearer '+s.token}:{})},body:JSON.stringify({action,room:s?.room,requestId:randomUUID(),...data})}));return {status:response.status,...await response.json()}};return {store,call,advance:(ms:number)=>{now+=ms}}}
async function crew(f:ReturnType<typeof setup>,n=2){const a=await f.call('create',undefined,{name:'Player0'}),all=[a];for(let i=1;i<n;i++)all.push(await f.call('join',undefined,{code:a.room,name:'Player'+i}));return all}
test('eight callers join concurrently; signaling is private, conditional, and independent of game state',async()=>{
 const f=setup(),players=await crew(f,8),sessions=players.map(()=>randomUUID());const gameBefore=structuredClone(f.store.records.get(players[0].room));
 const joins=await Promise.all(players.map((p,i)=>f.call('call-join',p,{callSession:sessions[i],mic:true,camera:i%2===0})));assert.ok(joins.every(r=>r.status===200));
 const state=await f.call('call-state',players[0],{callSession:sessions[0]});assert.equal(state.members.length,8);assert.ok(f.store.conflicts>0);
 const id=randomUUID(),description={type:'offer',sdp:'v=0\r\na=test offer'};
 const sent=await f.call('call-signal',players[0],{callSession:sessions[0],to:players[1].id,toSession:sessions[1],description,requestId:id});assert.equal(sent.status,200);assert.equal(sent.signals.length,0);
 const target=await f.call('call-state',players[1],{callSession:sessions[1]});assert.equal(target.signals.length,1);assert.equal(target.signals[0].from,players[0].id);assert.equal(target.signals[0].description.sdp,description.sdp);
 assert.equal((await f.call('call-state',players[2],{callSession:sessions[2]})).signals.length,0);
 await f.call('call-signal',players[0],{callSession:sessions[0],to:players[1].id,toSession:sessions[1],description,requestId:id});assert.equal((await f.call('call-state',players[1],{callSession:sessions[1]})).signals.length,1);
 assert.equal((await f.call('call-state',players[1],{callSession:sessions[1],ack:[id]})).signals.length,0);
 assert.deepEqual(f.store.records.get(players[0].room),gameBefore,'Calls do not mutate game rules, balances or bids');
});
test('mute/camera presence, leave cleanup, reconnect identity and expiration',async()=>{
 const f=setup(),[a,b]=await crew(f),sa=randomUUID(),sb=randomUUID();
 await f.call('call-join',a,{callSession:sa,mic:true,camera:true});await f.call('call-join',b,{callSession:sb,mic:true,camera:false});
 const muted=await f.call('call-status',a,{callSession:sa,mic:false,camera:false});assert.equal(muted.members.find((m:any)=>m.id===a.id).mic,false);assert.equal(muted.members.find((m:any)=>m.id===a.id).camera,false);
 const newSession=randomUUID();await f.call('call-join',a,{callSession:newSession,mic:true,camera:false});assert.equal((await f.call('call-state',a,{callSession:sa})).status,409);
 await f.call('call-leave',a,{callSession:sa});assert.equal((await f.call('call-state',a,{callSession:newSession})).members.length,2,'stale tab cannot end new session');
 await f.call('call-leave',a,{callSession:newSession});assert.equal((await f.call('call-state',b,{callSession:sb})).members.length,1);
 f.advance(25001);assert.equal((await f.call('call-state',b)).members.length,0);
});
test('call endpoints reject strangers, wrong destinations, oversized SDP, and missing membership',async()=>{
 const f=setup(),[a,b]=await crew(f),sa=randomUUID();
 assert.equal((await f.call('call-state',{...a,token:'wrong'})).status,401);
 assert.equal((await f.call('call-status',a,{callSession:sa,mic:true,camera:true})).status,409);
 await f.call('call-join',a,{callSession:sa,mic:true,camera:true});
 assert.equal((await f.call('call-signal',a,{callSession:sa,to:b.id,toSession:randomUUID(),description:{type:'offer',sdp:'v=0'}})).status,409);
 const sb=randomUUID();await f.call('call-join',b,{callSession:sb,mic:true,camera:false});
 assert.equal((await f.call('call-signal',a,{callSession:sa,to:b.id,toSession:sb,description:{type:'offer',sdp:'v=0'+'x'.repeat(24000)}})).status,400);
 assert.equal((await f.call('call-signal',a,{callSession:sa,to:b.id,toSession:sb,description:{type:'invalid',sdp:'v=0'}})).status,400);
 assert.equal((await f.call('call-state',a,{callSession:sa})).signals.length,0);
});
