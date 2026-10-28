export const ICE_CONFIG={iceServers:[{urls:'stun:stun.cloudflare.com:3478'}]};
export function waitForIce(pc,timeout=10000){
 if(pc.iceGatheringState==='complete')return Promise.resolve();
 return new Promise(resolve=>{const done=()=>{clearTimeout(timer);pc.removeEventListener('icegatheringstatechange',change);resolve()};const change=()=>{if(pc.iceGatheringState==='complete'||pc.signalingState==='closed')done()};const timer=setTimeout(done,timeout);pc.addEventListener('icegatheringstatechange',change)});
}
// Media is peer-to-peer. Only short-lived SDP signaling is sent to Netlify.
export class RoomCall {
 constructor({api,identity,update=()=>{},report=()=>{},Peer=globalThis.RTCPeerConnection,Stream=globalThis.MediaStream,devices=globalThis.navigator?.mediaDevices}){
  Object.assign(this,{api,identity,update,report,Peer,Stream,devices});this.peers=new Map();this.members=[];this.processed=new Set();this.acks=[];this.generation=0;this.busy=false;this.local=null;this.session=null;
 }
 emit(){this.update(this)}
 async join(video){
  if(this.session||this.busy)return;
  if(!this.devices?.getUserMedia||!this.Peer)throw Error('Voice and video need a supported browser over HTTPS.');
  this.busy=true;const generation=++this.generation;this.emit();
  let media;
  try{
   media=await this.devices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:video?{width:{ideal:320},height:{ideal:240},frameRate:{ideal:15,max:20},facingMode:'user'}:false});
   if(generation!==this.generation){media.getTracks().forEach(t=>t.stop());return;}
   this.local=media;this.session=crypto.randomUUID();
   const result=await this.api('call-join',{callSession:this.session,mic:true,camera:video});
   if(generation!==this.generation)return;
   this.members=result.members;this.bindEnded();this.emit();this.poll(generation);
  }catch(e){if(generation===this.generation){this.cleanup();throw e}else media?.getTracks().forEach(t=>t.stop())}
  finally{if(generation===this.generation){this.busy=false;this.emit()}}
 }
 bindEnded(){for(const track of this.local?.getTracks()||[])track.onended=()=>{this.emit();this.publishStatus().catch(e=>this.report(e))}}
 get mic(){return !!this.local?.getAudioTracks().some(t=>t.enabled&&t.readyState==='live')}
 get camera(){return !!this.local?.getVideoTracks().some(t=>t.enabled&&t.readyState==='live')}
 async publishStatus(){if(this.session)await this.api('call-status',{callSession:this.session,mic:this.mic,camera:this.camera})}
 async toggleMic(){
  if(!this.session)return;const track=this.local?.getAudioTracks()[0];
  if(!track||track.readyState!=='live')throw Error('Microphone disconnected. Leave and rejoin the call.');
  track.enabled=!track.enabled;this.emit();await this.publishStatus();
 }
 async toggleCamera(){
  if(!this.session||this.busy)return;const generation=this.generation;
  this.busy=true;this.emit();let acquired;
  try{
   const old=this.local.getVideoTracks()[0];
   if(old&&old.readyState==='live'){
    // Stop the device immediately; remote sender replacement follows.
    old.stop();this.local.removeTrack(old);
    await Promise.all([...this.peers.values()].map(p=>p.video.sender.replaceTrack(null)));
   }else{
    acquired=await this.devices.getUserMedia({audio:false,video:{width:{ideal:320},height:{ideal:240},frameRate:{ideal:15,max:20},facingMode:'user'}});
    if(generation!==this.generation){acquired.getTracks().forEach(t=>t.stop());return;}
    const track=acquired.getVideoTracks()[0];
    if(old)this.local.removeTrack(old);this.local.addTrack(track);this.bindEnded();
    await Promise.all([...this.peers.values()].map(p=>p.video.sender.replaceTrack(track)));
   }
   this.emit();await this.publishStatus();
  }catch(e){if(generation===this.generation)throw e;acquired?.getTracks().forEach(t=>t.stop())}
  finally{if(generation===this.generation){this.busy=false;this.emit()}}
 }
 async poll(generation){
  if(!this.session||generation!==this.generation)return;
  try{
   const ack=this.acks.splice(0,64);let result;
   try{result=await this.api('call-state',{callSession:this.session,ack})}catch(e){this.acks.unshift(...ack);throw e}
   if(generation!==this.generation)return;
   this.members=result.members;
   for(const [id,p] of this.peers){if(!result.members.some(m=>m.id===id&&m.session===p.session))this.drop(id)}
   for(const member of result.members){if(member.id!==this.identity().id&&!this.peers.has(member.id))this.makePeer(member)}
   // One offer/answer exchange per peer. Fixed audio/video transceivers avoid glare.
   for(const signal of result.signals){
    if(this.processed.has(signal.id)){this.acks.push(signal.id);continue;}
    const peer=this.peers.get(signal.from);
    if(!peer||peer.session!==signal.fromSession)continue;
    this.processed.add(signal.id);this.acks.push(signal.id);
    peer.work=peer.work.then(()=>this.receive(peer,signal,generation)).catch(e=>this.fail(peer,e));
   }
   if(this.processed.size>512)this.processed=new Set([...this.processed].slice(-256));
   this.emit();
  }catch(e){
   if(generation!==this.generation)return;
   if([401,404,409,410].includes(e.status)){this.cleanup();this.report(e);return;}
   this.report(Error('Call connection interrupted. Reconnecting…'));
  }finally{if(generation===this.generation&&this.session)this.timer=setTimeout(()=>this.poll(generation),1000)}
 }
 makePeer(member){
  const pc=new this.Peer(ICE_CONFIG),remote=new this.Stream();
  const audio=pc.addTransceiver('audio',{direction:'sendrecv',streams:[this.local]});
  const video=pc.addTransceiver('video',{direction:'sendrecv',streams:[this.local]});
  const peer={id:member.id,session:member.session,pc,audio,video,remote,status:'Connecting…',work:Promise.resolve()};this.peers.set(member.id,peer);
  pc.ontrack=e=>{if(!remote.getTracks().some(t=>t.id===e.track.id))remote.addTrack(e.track);this.emit()};
  pc.onconnectionstatechange=()=>{
   if(pc.connectionState==='connected'){clearTimeout(peer.timeout);peer.status='Connected'}
   else if(pc.connectionState==='failed')peer.status='Connection blocked. Try another network or rejoin.';
   else if(pc.connectionState==='disconnected')peer.status='Connection interrupted…';
   this.emit();
  };
  peer.timeout=setTimeout(()=>{if(pc.connectionState!=='connected'){peer.status='Could not connect. Try another network or rejoin.';this.emit()}},35000);
  const generation=this.generation;
  peer.work=Promise.all([audio.sender.replaceTrack(this.local.getAudioTracks()[0]||null),video.sender.replaceTrack(this.local.getVideoTracks()[0]||null)]).then(async()=>{
   if(generation!==this.generation)return;
   if(this.identity().id<member.id){await pc.setLocalDescription(await pc.createOffer());await waitForIce(pc);await this.send(peer,generation)}
  }).catch(e=>this.fail(peer,e));
  return peer;
 }
 async send(peer,generation){
  if(generation!==this.generation||peer.pc.signalingState==='closed')return;
  const description=peer.pc.localDescription?.toJSON?.()||peer.pc.localDescription;
  const data={callSession:this.session,to:peer.id,toSession:peer.session,description,requestId:crypto.randomUUID()};
  for(let i=0;i<3;i++){
   if(generation!==this.generation||peer.pc.signalingState==='closed')return;
   try{await this.api('call-signal',data);return}catch(e){if(i===2||[401,403,404,409,410].includes(e.status))throw e;await new Promise(r=>setTimeout(r,500))}
  }
 }
 async receive(peer,signal,generation){
  if(generation!==this.generation||peer.pc.signalingState==='closed')return;
  const d=signal.description;
  if(d.type==='offer'){
   if(this.identity().id<peer.id)return;
   await peer.pc.setRemoteDescription(d);await peer.pc.setLocalDescription(await peer.pc.createAnswer());await waitForIce(peer.pc);await this.send(peer,generation);
  }else if(d.type==='answer'&&peer.pc.signalingState==='have-local-offer')await peer.pc.setRemoteDescription(d);
 }
 fail(peer,e){if(peer.pc.signalingState==='closed')return;peer.status='Could not connect. Leave and rejoin the call.';this.emit();this.report(e)}
 drop(id){const p=this.peers.get(id);if(!p)return;clearTimeout(p.timeout);p.pc.ontrack=null;p.pc.onconnectionstatechange=null;p.pc.close();p.remote.getTracks().forEach(t=>t.stop());this.peers.delete(id)}
 cleanup(){
  ++this.generation;clearTimeout(this.timer);for(const id of this.peers.keys())this.drop(id);
  this.local?.getTracks().forEach(t=>{t.onended=null;t.stop()});this.local=null;this.session=null;this.members=[];this.processed.clear();this.acks=[];this.busy=false;this.emit();
 }
 async leave(){const callSession=this.session;this.cleanup();if(callSession)try{await this.api('call-leave',{callSession},{keepalive:true})}catch{/* Presence expires without retaining a media stream. */}}
}
