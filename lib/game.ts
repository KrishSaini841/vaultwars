import { randomBytes, randomUUID } from 'node:crypto';
export const PRIZES = [4,5,6,7,8,10];
export type Phase = 'lobby' | 'bidding' | 'reveal' | 'finished';
export interface Player {id:string; token:string; name:string; credits:number; score:number; bid:number|null; seen:number; lastChat?:number}
export interface Result {round:number; points:number; bids:{id:string;name:string;bid:number}[]; winner:string|null}
export interface Room {code:string; host:string; phase:Phase; round:number; carry:number; history:Result[]; chat:{name:string;text:string}[]; players:Player[]; deadline:number|null; touched:number; prizes:number[]; gameId:string; revision:number; requests:string[]}
export function player(name:unknown, now:number):Player {
 const clean=String(name||'').trim().slice(0,20); if(!clean)throw Error('Enter a player name.');
 return {id:randomUUID(),token:randomBytes(24).toString('hex'),name:clean,credits:24,score:0,bid:null,seen:now};
}
export function begin(r:Room, now:number) {
 r.round=0;r.carry=0;r.history=[];r.phase='bidding';r.gameId=randomUUID();
 r.players.forEach(p=>{p.credits=24;p.score=0;p.bid=null});r.deadline=now+30000;
}
export function next(r:Room,now:number) {r.round++;r.phase='bidding';r.deadline=now+30000;r.players.forEach(p=>p.bid=null)}
export function bid(r:Room,p:Player,value:unknown) {
 if(r.phase!=='bidding')throw Error('Bidding is closed.');
 if(p.bid!==null)throw Error('Your bid is already locked.');
 if(typeof value!=='number'||!Number.isInteger(value)||value<0||value>Math.min(8,p.credits))throw Error('Invalid bid.');p.bid=value;
}
export function settle(r:Room,now:number) {
 if(r.phase!=='bidding'||(now<r.deadline!&&!r.players.every(p=>p.bid!==null)))return false;
 const bids=r.players.map(p=>({id:p.id,name:p.name,bid:p.bid??0}));
 const highest=Math.max(...bids.map(p=>p.bid)),leaders=bids.filter(p=>p.bid===highest);
 const winner=highest>0&&leaders.length===1?leaders[0]:null,points=r.prizes[r.round]+r.carry;
 for(const p of r.players){p.credits-=p.bid??0;if(p.id===winner?.id)p.score+=points}
 r.history.push({round:r.round+1,points,bids,winner:winner?.id??null});r.carry=winner?0:points;
 r.phase=r.round===r.prizes.length-1?'finished':'reveal';r.deadline=null;return true;
}
export function winners(r:Room){const sorted=[...r.players].sort((a,b)=>b.score-a.score||b.credits-a.credits);return sorted.filter(p=>p.score===sorted[0].score&&p.credits===sorted[0].credits).map(p=>p.id)}
export function snapshot(r:Room,id:string,now:number){return {code:r.code,host:r.host,phase:r.phase,round:r.round,carry:r.carry,deadline:r.deadline,serverTime:now,history:r.history,chat:r.chat,gameId:r.gameId,revision:r.revision,prizes:r.prizes,winners:r.phase==='finished'?winners(r):[],players:r.players.map(p=>({id:p.id,name:p.name,credits:p.credits,score:p.score,locked:p.bid!==null,bid:p.id===id?p.bid:undefined,online:now-p.seen<20000}))}}
