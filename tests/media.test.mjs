import test from 'node:test';
import assert from 'node:assert/strict';
import {RoomCall,waitForIce} from '../src/room-call.js';
class Track {constructor(kind){this.kind=kind;this.id=crypto.randomUUID();this.enabled=true;this.readyState='live'}stop(){this.readyState='ended'}}
class Stream {constructor(tracks=[]){this.tracks=[...tracks]}getTracks(){return this.tracks}getAudioTracks(){return this.tracks.filter(t=>t.kind==='audio')}getVideoTracks(){return this.tracks.filter(t=>t.kind==='video')}addTrack(t){this.tracks.push(t)}removeTrack(t){this.tracks=this.tracks.filter(x=>x!==t)}}
class Peer {
 constructor(){this.signalingState='stable';this.connectionState='new';this.iceGatheringState='complete';this.transceivers=[]}
 addTransceiver(kind){const sender={track:null,async replaceTrack(t){this.track=t}};const tr={kind,sender};this.transceivers.push(tr);return tr}
 async createOffer(){return {type:'offer',sdp:'v=0\r\no=offer'}}async createAnswer(){return {type:'answer',sdp:'v=0\r\no=answer'}}
 async setLocalDescription(d){this.localDescription=d;this.signalingState=d.type==='offer'?'have-local-offer':'stable'}
 async setRemoteDescription(d){this.remoteDescription=d;this.signalingState=d.type==='offer'?'have-remote-offer':'stable'}close(){this.signalingState='closed';this.connectionState='closed'}
}
function fixture(getUserMedia){const requests=[],state={members:[],signals:[]};const devices={getUserMedia:getUserMedia||(async(c)=>new Stream([...(c.audio?[new Track('audio')]:[]),...(c.video?[new Track('video')]:[])]))};const call=new RoomCall({api:async(action,data)=>{requests.push({action,data});return structuredClone(state)},identity:()=>({id:'a'}),Peer,Stream,devices});return {call,requests,state}}
test('voice opt-in, mute, camera-on/off replace tracks, and leave stops every device',async()=>{
 const f=fixture();assert.equal(f.call.local,null);assert.equal(f.requests.length,0);
 try{await f.call.join(false);assert.equal(f.call.mic,true);assert.equal(f.call.camera,false);const local=f.call.local;
 const peer=f.call.makePeer({id:'z',session:'remote'});await peer.work;assert.equal(f.requests.filter(r=>r.action==='call-signal').length,1);assert.equal(peer.audio.sender.track.kind,'audio');
 await f.call.toggleMic();assert.equal(f.call.mic,false);assert.equal(f.requests.at(-1).data.mic,false);
 await f.call.toggleCamera();const camera=local.getVideoTracks()[0];assert.equal(f.call.camera,true);assert.equal(peer.video.sender.track,camera);
 await f.call.toggleCamera();assert.equal(camera.readyState,'ended');assert.equal(peer.video.sender.track,null);assert.equal(f.call.camera,false);
 await f.call.leave();assert.ok(local.getTracks().every(t=>t.readyState==='ended'));assert.equal(peer.pc.signalingState,'closed');assert.equal(f.call.session,null);assert.equal(f.requests.at(-1).action,'call-leave');
 }finally{f.call.cleanup()}
});
test('permission denial leaves no active call; cancelling pending permission stops late tracks',async()=>{
 const denied=fixture(async()=>{throw Object.assign(Error('Denied'),{name:'NotAllowedError'})});await assert.rejects(denied.call.join(true));assert.equal(denied.call.local,null);assert.equal(denied.call.busy,false);assert.equal(denied.requests.length,0);
 let resolve;const delayed=fixture(()=>new Promise(r=>resolve=r));const joining=delayed.call.join(true);await delayed.call.leave();const media=new Stream([new Track('audio'),new Track('video')]);resolve(media);await joining;assert.ok(media.getTracks().every(t=>t.readyState==='ended'));assert.equal(delayed.call.session,null);
});
test('deterministic offer/answer handling and all seven peer links for an eight-player room',async()=>{
 const f=fixture();try{await f.call.join(true);const peers=[];for(let i=0;i<7;i++)peers.push(f.call.makePeer({id:'b'+i,session:'s'+i}));await Promise.all(peers.map(p=>p.work));assert.equal(f.call.peers.size,7);assert.equal(f.requests.filter(r=>r.action==='call-signal').length,7);
 await f.call.receive(peers[0],{description:{type:'answer',sdp:'v=0'}},f.call.generation);assert.equal(peers[0].pc.signalingState,'stable');
 const receiver=f.call.makePeer({id:'0',session:'s8'});await receiver.work;await f.call.receive(receiver,{description:{type:'offer',sdp:'v=0'}},f.call.generation);assert.equal(receiver.pc.localDescription.type,'answer');
 }finally{f.call.cleanup()}
});
test('camera permission can be cancelled during an existing call without leaving capture active',async()=>{
 const f=fixture();await f.call.join(false);let resolve;f.call.devices.getUserMedia=()=>new Promise(r=>resolve=r);const pending=f.call.toggleCamera();await f.call.leave();const media=new Stream([new Track('video')]);resolve(media);await pending;assert.equal(media.getVideoTracks()[0].readyState,'ended');assert.equal(f.call.local,null);
});
test('ICE gathering wait has a bounded timeout',async()=>{
 const events=new Map();const pc={iceGatheringState:'gathering',addEventListener:(k,v)=>events.set(k,v),removeEventListener:k=>events.delete(k)};await waitForIce(pc,2);assert.equal(events.size,0);
});
