import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createHandler,type RoomStore} from '../lib/service.ts';
import type {Room} from '../lib/game.ts';
class MemoryStore implements RoomStore {
 data=new Map<string,{data:unknown;version:number}>(); conflicts=0;
 async getWithMetadata(key:string,options:{type:'json';consistency:'strong'}){assert.equal(options.consistency,'strong');const v=this.data.get(key);return v?{data:structuredClone(v.data),etag:String(v.version)}:null}
 async setJSON(key:string,value:unknown,options:{onlyIfNew?:boolean;onlyIfMatch?:string}){
  const v=this.data.get(key);assert.ok(options.onlyIfNew||options.onlyIfMatch,'Every write must be conditional');
  if((options.onlyIfNew&&v)||(options.onlyIfMatch&&options.onlyIfMatch!==String(v?.version))){this.conflicts++;return {modified:false}}
  this.data.set(key,{data:structuredClone(value),version:(v?.version||0)+1});return {modified:true};
 }
}
type Session={room:string;id:string;token:string};
function fixture(prizes?:number[]){
 const store=new MemoryStore();let now=100000;const handler=createHandler(()=>store,{clock:()=>now,prizes});
 const call=async(action:string,s?:Session,data:Record<string,unknown>={})=>{
  const room=s?store.data.get(s.room)?.data as Room:undefined;
  const response=await handler(new Request('https://game.test/.netlify/functions/game',{method:'POST',headers:{'Content-Type':'application/json',...(s?{Authorization:'Bearer '+s.token}:{})},body:JSON.stringify({action,room:s?.room,gameId:room?.gameId,round:room?.round,requestId:randomUUID(),...data})}));
  return {status:response.status,...await response.json()};
 };
 return {store,handler,call,advance:(ms:number)=>{now+=ms}};
}
async function crew(f:ReturnType<typeof fixture>){const a=await f.call('create',undefined,{name:'Alpha'});const b=await f.call('join',undefined,{code:a.room.toLowerCase(),name:'Beta'});assert.equal(a.status,200);assert.equal(b.status,200);assert.equal((await f.call('start',a)).status,200);return {a,b}}
test('complete THREE-round game: two players, tie carry, all-pay scoring and final winner',async()=>{
 const f=fixture([4,5,6]),{a,b}=await crew(f);
 for(const [round,ab,bb] of [[0,3,1],[1,2,2],[2,1,4]]){
  assert.equal((await f.call('bid',a,{bid:ab})).status,200);
  const hidden=await f.call('state',b);assert.equal(hidden.players[0].bid,undefined);assert.equal(hidden.players[0].locked,true);assert.equal(JSON.stringify(hidden).includes(a.token),false);
  const result=await f.call('bid',b,{bid:bb});assert.equal(result.status,200);
  if(round<2)assert.equal((await f.call('next',a)).status,200);
 }
 const end=await f.call('state',a);assert.equal(end.phase,'finished');assert.equal(end.history.length,3);assert.deepEqual(end.players.map((p:any)=>[p.score,p.credits]),[[4,18],[11,17]]);assert.deepEqual(end.winners,[b.id]);
});
test('production default remains six rounds and 40 total vault points',async()=>{
 const f=fixture(),{a,b}=await crew(f);
 for(let round=0;round<6;round++){
  await Promise.all([f.call('bid',a,{bid:1}),f.call('bid',b,{bid:0})]);
  const state=await f.call('state',a);assert.equal(state.phase,round===5?'finished':'reveal');if(round<5)await f.call('next',a);
 }
 const end=await f.call('state',b);assert.deepEqual(end.players.map((p:any)=>[p.score,p.credits]),[[40,18],[0,24]]);assert.deepEqual(end.winners,[a.id]);assert.ok(f.store.conflicts>0,'Concurrent writes exercised conflict retry');
});
test('deadline pass resolves once and late bid cannot mutate resolved round',async()=>{
 const f=fixture(),{a,b}=await crew(f);await f.call('bid',a,{bid:4});f.advance(30001);
 const late=await f.call('bid',b,{bid:8});assert.equal(late.status,400);
 const state=await f.call('state',a);assert.equal(state.players[0].score,4);assert.equal(state.players[0].credits,20);assert.equal(state.players[1].credits,24);assert.equal(state.history.length,1);
 await Promise.all([f.call('state',a),f.call('state',b)]);assert.equal((await f.call('state',a)).history.length,1);
});
test('max eight players, host permissions, invalid bids and immutable locks',async()=>{
 const f=fixture();const a=await f.call('create',undefined,{name:'Host'});
 const joins=await Promise.all(Array.from({length:7},(_,i)=>f.call('join',undefined,{code:a.room,name:'P'+i})));assert.ok(joins.every(j=>j.status===200));
 assert.equal((await f.call('join',undefined,{code:a.room,name:'Extra'})).status,400);
 assert.equal((await f.call('start',joins[0])).status,403);await f.call('start',a);
 for(const bid of [-1,9,1.5,'3'])assert.equal((await f.call('bid',a,{bid})).status,400);
 assert.equal((await f.call('bid',a,{bid:8})).status,200);assert.equal((await f.call('bid',a,{bid:7})).status,400);
 assert.equal((await f.call('state',{...a,token:'bad'})).status,401);
});
test('duplicate requests are idempotent; stale rematch requests are rejected',async()=>{
 const f=fixture([4]),{a,b}=await crew(f),requestId=randomUUID();
 const original=await f.call('state',a);await f.call('bid',a,{bid:2,requestId});await f.call('bid',b,{bid:1});
 assert.equal((await f.call('bid',a,{bid:2,requestId})).status,200);
 assert.equal((await f.call('state',a)).players[0].credits,22);
 await f.call('start',a);const state=await f.call('state',a);assert.equal(state.players[0].credits,24);assert.equal(state.players[0].score,0);
 assert.equal((await f.call('bid',b,{bid:3,gameId:original.gameId})).status,409);
});
test('zero-budget, final tied vault expiry and credit tiebreak',async()=>{
 const f=fixture([4,5,6]),{a,b}=await crew(f);
 for(let i=0;i<3;i++){await Promise.all([f.call('bid',a,{bid:8}),f.call('bid',b,{bid:8})]);if(i<2)await f.call('next',a)}
 const state=await f.call('state',a);assert.equal(state.phase,'finished');assert.deepEqual(state.players.map((p:any)=>[p.score,p.credits]),[[0,0],[0,0]]);assert.equal(state.carry,15);assert.deepEqual(state.winners,[a.id,b.id]);
 const f2=fixture([4,4]),c=await crew(f2);await f2.call('bid',c.a,{bid:2});await f2.call('bid',c.b,{bid:1});await f2.call('next',c.a);await f2.call('bid',c.a,{bid:0});await f2.call('bid',c.b,{bid:3});assert.deepEqual((await f2.call('state',c.a)).winners,[c.a.id]);
});
test('chat persists, join retries recover same seat, malformed requests are rejected',async()=>{
 const f=fixture();const a=await f.call('create',undefined,{name:'A'}),requestId=randomUUID();
 const b=await f.call('join',undefined,{code:a.room,name:'B',requestId});const repeat=await f.call('join',undefined,{code:a.room,name:'B',requestId});assert.equal(repeat.id,b.id);assert.equal(repeat.token,b.token);
 await f.call('chat',b,{text:'I am bidding eight.'});assert.equal((await f.call('state',a)).chat[0].text,'I am bidding eight.');
 assert.equal((await f.handler(new Request('https://game.test/.netlify/functions/game'))).status,405);
 assert.equal((await f.handler(new Request('https://game.test/.netlify/functions/game',{method:'POST',body:'{'}))).status,400);
});
