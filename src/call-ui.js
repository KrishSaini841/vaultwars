import {RoomCall} from './room-call.js';
const $=id=>document.getElementById(id);
export function setupCall(api,identity){
 let roster=[],tiles=new Map();
 const report=e=>{$('call-note').textContent=e.name==='NotAllowedError'?'Permission was not granted. Allow microphone/camera access in your browser, then try again.':e.name==='NotFoundError'?'No microphone or camera found. Try voice only or connect a device.':e.message||'Call unavailable.'};
 const call=new RoomCall({api,identity,report,update:render});
 function render(){
  $('call-join-options').hidden=!!call.session;$('call-controls').hidden=!call.session&&!call.busy;
  $('join-voice').disabled=call.busy;$('join-video').disabled=call.busy;
  $('call-mic').disabled=!call.session||call.busy;
  $('call-mic').textContent=call.mic?'Mute microphone':'Unmute microphone';$('call-mic').setAttribute('aria-pressed',String(!call.mic));
  $('call-camera').textContent=call.camera?'Turn camera off':'Turn camera on';$('call-camera').setAttribute('aria-pressed',String(call.camera));$('call-camera').disabled=call.busy||!call.session;
  $('call-count').textContent=call.session?call.members.length+' in call':'Optional';
  for(const [id,t] of tiles)if(!roster.some(p=>p.id===id)){t.root.remove();tiles.delete(id)}
  for(const person of roster){
   let tile=tiles.get(person.id);
   if(!tile){
    const root=document.createElement('div');root.className='call-tile';
    const video=document.createElement('video');video.autoplay=true;video.playsInline=true;
    const avatar=document.createElement('span');avatar.className='call-avatar';avatar.setAttribute('aria-hidden','true');
    const label=document.createElement('strong'),status=document.createElement('span');status.className='call-tile-status';
    root.append(video,avatar,label,status);$('call-grid').append(root);tile={root,video,avatar,label,status};tiles.set(person.id,tile);
   }
   const self=person.id===identity()?.id,peer=call.peers.get(person.id),member=call.members.find(m=>m.id===person.id);
   const media=self?call.local:peer?.remote;tile.video.muted=self;
   if(tile.video.srcObject!==media){tile.video.srcObject=media||null;if(media)tile.video.play().catch(()=>{$('call-play').hidden=false})}
   const camera=self?call.camera:member?.camera&&peer?.status==='Connected';
   tile.root.classList.toggle('camera-on',!!camera);tile.avatar.textContent=person.name.slice(0,1).toUpperCase();
   tile.label.textContent=person.name+(self?' · You':'');tile.video.setAttribute('aria-label',person.name+' video');
   tile.status.textContent=self?(call.session?(call.mic?'Mic on':'Mic muted')+(call.camera?' · Camera on':' · Camera off'):'Not in call'):member?(peer?.status||'Joining…')+(member.mic?'':' · Muted'):'Not in call';
  }
 }
 async function join(video){$('call-note').textContent='Waiting for device permission…';try{await call.join(video);if(call.session)$('call-note').textContent='You are in the room call. Use headphones to avoid echo.'}catch(e){report(e)}}
 $('join-voice').onclick=()=>join(false);$('join-video').onclick=()=>join(true);
 $('call-mic').onclick=()=>call.toggleMic().catch(report);$('call-camera').onclick=()=>call.toggleCamera().catch(report);
 $('call-leave').onclick=()=>{call.leave();$('call-note').textContent='You left the call. Your microphone and camera are off.'};
 $('call-play').onclick=async()=>{try{await Promise.all([...tiles.values()].filter(t=>t.video.srcObject).map(t=>t.video.play()));$('call-play').hidden=true}catch{report(Error('Audio playback blocked. Tap again to enable sound.'))}};
 window.addEventListener('pagehide',()=>call.leave());
 return {setRoster(players){roster=players;render()},leave:()=>call.leave()};
}
