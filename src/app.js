import {setupCall} from './call-ui.js';
const $=id=>document.getElementById(id), esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let session;try{session=JSON.parse(sessionStorage.getItem('vault-session')||'null')}catch{sessionStorage.removeItem('vault-session')}
let state,stream,selected=0,roundKey='',offset=0;
function error(e){$('error').textContent=e.message||e;setTimeout(()=>$('error').textContent='',6000)}
async function api(action,data={},options={}){
 const r=await fetch('/.netlify/functions/game',{method:'POST',headers:{'Content-Type':'application/json',...(session?{Authorization:'Bearer '+session.token}:{})},body:JSON.stringify({action,room:session?.room,gameId:state?.gameId,round:state?.round,requestId:crypto.randomUUID(),...data}),signal:AbortSignal.timeout(15000),keepalive:!!options.keepalive});
 let result;try{result=await r.json()}catch{throw Error('Game service unavailable. Check that the Netlify function was deployed.')}
 if(!r.ok){const e=Error(result.error||'Request failed.');e.status=r.status;throw e}return result;
}
const roomCall=setupCall(api,()=>session);
function accept(next){
 if(state&&state.code===next.code&&next.revision<state.revision)return;
 const changed=!state||state.code!==next.code||state.revision!==next.revision;
 state=next;offset=state.serverTime-Date.now();$('connection').textContent='● LIVE CONNECTION';
 roomCall.setRoster(state.players);if(changed)render();else tick();
}
async function enter(action){try{session=await api(action,{name:$('name').value,code:$('code').value});sessionStorage.setItem('vault-session',JSON.stringify(session));connect()}catch(e){error(e)}}
$('create').onclick=()=>enter('create');$('join').onclick=()=>enter('join');
$('leave').onclick=()=>{if(!confirm('Exit this device? Your seat stays in the room and will automatically pass. You will lose access to this seat.'))return;roomCall.leave();stream?.close();sessionStorage.removeItem('vault-session');location.href='/'};
function connect(){
 stream?.close();let stopped=false,timer;
 stream={close(){stopped=true;clearTimeout(timer)}};
 async function poll(){
  try{const next=await api('state');if(stopped)return;accept(next)}
  catch(e){if(stopped)return;$('connection').textContent='RECONNECTING…';
   if([401,404,410].includes(e.status)){roomCall.leave();stream.close();error(e);$('entry').hidden=false;$('game').hidden=true;state=null;session=null;sessionStorage.removeItem('vault-session');return;}
  }finally{if(!stopped)timer=setTimeout(poll,1000)}
 }
 poll();
}
async function action(type,data){try{accept(await api(type,data))}catch(e){error(e)}}
function render(){
 $('entry').hidden=true;$('game').hidden=false;$('roomcode').textContent=state.code;$('count').textContent=state.players.length+'/8';
 const me=state.players.find(p=>p.id===session.id),host=state.host===session.id,key=state.gameId+state.phase+state.round+state.history.length;if(key!==roundKey){selected=0;roundKey=key;}
 $('schedule').innerHTML=state.prizes.map((v,i)=>`<div class="vault ${i===state.round?'active':''} ${i<state.history.length?'done':''}">VAULT 0${i+1}<strong>${v} pts</strong></div>`).join('');
 $('players').innerHTML=[...state.players].sort((a,b)=>b.score-a.score||b.credits-a.credits).map(p=>`<div class="player"><div><span class="dot ${p.online?'online':''}"></span>${esc(p.name)}${p.id===session.id?' <small>You'+(p.id===state.host?' · Host':'')+'</small>':`<small>${p.id===state.host?'Host · ':''}${p.online?'Online':'Disconnected'}</small>`}</div><div class="stat">${p.score} pts<small>${p.credits} credits ${state.phase==='bidding'?(p.locked?'· Locked':'· Thinking'):''}</small></div></div>`).join('');
 let html='';if(state.phase==='lobby'){html=`<span class="eyebrow">THE CREW IS ASSEMBLING</span><div class="big">${state.players.length} / 8</div><h2>Every mastermind needs a rival.</h2><p class="muted">Share room code <b>${state.code}</b>. Open this URL in another tab to test as another player.</p>${host?`<button id="start" ${state.players.length<2?'disabled':''}>Start the heist →</button>`:'<p>Waiting for the host to start…</p>'}`;}
 else if(state.phase==='bidding'){html=`<span class="eyebrow">ROUND ${state.round+1} / ${state.prizes.length} · <span id="timer"></span></span><div class="big">${state.prizes[state.round]+state.carry}<span style="font-size:20px;letter-spacing:0"> pts</span></div><span class="muted">${state.carry?state.carry+' carried points included · ':''}${me.credits} credits left</span>${me.locked?`<h2 style="margin-top:30px">Bid locked: ${me.bid}</h2><p class="muted">${state.players.filter(p=>p.locked).length} / ${state.players.length} locked in. Waiting for the reveal…</p>`:`<div class="bids">${Array.from({length:9},(_,n)=>`<button data-bid="${n}" ${n>me.credits?'disabled':''} class="${n===selected?'selected':''}">${n}</button>`).join('')}</div><button id="lock">Lock ${selected===0?'pass':selected+' credits'} →</button><p class="muted">Every bid is spent. Locked bids cannot change.</p>`}`;}
 else{const last=state.history.at(-1),winner=state.players.find(p=>p.id===last.winner);html=state.phase==='finished'?`<span class="eyebrow">THE HEIST IS OVER</span><div class="big" style="font-size:38px">${state.winners.map(id=>esc(state.players.find(p=>p.id===id).name)).join(' & ')}</div><h2>${state.winners.length>1?'Share the victory.':'Takes the crown.'}</h2><p class="muted">Points first. Remaining credits break ties.${state.carry?' '+state.carry+' unclaimed points expired.':''}</p>${host?'<button id="start">Play again →</button>':'<p>Waiting for the host to start a rematch.</p>'}`:`<span class="eyebrow">VAULT ${state.round+1} · BIDS REVEALED</span><div class="big">${last.points} pts</div><h2>${winner?esc(winner.name)+' takes the vault.':'No winner. The stakes go up.'}</h2><p class="muted">${winner?'All bids have been spent.':last.points+' points carry into the next vault.'}</p>${host?'<button id="next">Next vault →</button>':'<p>Waiting for the host to open the next vault…</p>'}`;}
 $('arena').innerHTML=html;$('start')?.addEventListener('click',()=>action('start'));$('next')?.addEventListener('click',()=>action('next'));$('lock')?.addEventListener('click',()=>action('bid',{bid:selected,round:state.round,gameId:state.gameId}));document.querySelectorAll('[data-bid]').forEach(b=>b.onclick=()=>{selected=Number(b.dataset.bid);render()});
 $('history').innerHTML=state.history.length?[...state.history].reverse().map(h=>`<div class="record"><b>Vault ${h.round} · ${h.points} points</b><p>${h.bids.map(b=>esc(b.name)+': '+b.bid+(b.id===h.winner?' ★':'')).join(' · ')}</p><span class="muted">${h.winner?'Awarded to '+esc(h.bids.find(b=>b.id===h.winner).name):h.round===state.prizes.length?'Unclaimed points expired':'Points carried forward'}</span></div>`).join(''):'<p class="muted">Secret bids become public after each reveal.</p>';
 const chatBottom=$('messages').scrollHeight-$('messages').scrollTop-$('messages').clientHeight<30;$('messages').innerHTML=state.chat.length?state.chat.map(m=>`<p><b>${esc(m.name)}</b> ${esc(m.text)}</p>`).join(''):'<p class="muted">Promises are not binding. Let the mind games begin.</p>';if(chatBottom)$('messages').scrollTop=$('messages').scrollHeight;tick();
}
function tick(){if($('timer')&&state?.deadline)$('timer').textContent=Math.max(0,Math.ceil((state.deadline-Date.now()-offset)/1000))+'s LEFT'}setInterval(tick,200);
$('chat').onsubmit=async e=>{e.preventDefault();const text=$('message').value;if(!text.trim())return;try{accept(await api('chat',{text}));$('message').value=''}catch(e){error(e)}};
if(session)connect();
