import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile,rm} from 'node:fs/promises';
import {resolve,dirname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {unzipSync} from 'fflate';
import {BlobsServer} from '@netlify/blobs/server';
import {getStore} from '@netlify/blobs';
const root=resolve('.verification');await rm(root,{recursive:true,force:true});await mkdir(root,{recursive:true});
const files=unzipSync(await readFile('packaged-functions/game.zip'));
assert.ok(files['netlify/functions/game.mjs']);assert.ok(files['___netlify-metadata.json']);
for(const [name,data] of Object.entries(files)){
 const file=resolve(root,'function',name);assert.ok(file.startsWith(resolve(root,'function')+sep));
 await mkdir(dirname(file),{recursive:true});await writeFile(file,data);
}
const manifest=JSON.parse(await readFile('packaged-functions/manifest.json','utf8'));
assert.equal(manifest.functions.length,1);assert.equal(manifest.functions[0].name,'game');
const blobServer=new BlobsServer({directory:resolve(root,'blobs'),logger:()=>{}});
const {port}=await blobServer.start();
const oldContext=globalThis.netlifyBlobsContext;
// Blobs 11.1.7's local emulator returns ETags on PUT but omits them on GET.
// Test-only bridge returns that exact server-issued ETag on subsequent reads.
// Production code has no shim and fails closed if an ETag is missing.
const originalFetch=globalThis.fetch,etags=new Map();let conditionalWrites=0;
globalThis.fetch=async(input,init)=>{
 const url=String(input),method=(init?.method||'GET').toUpperCase();
 const response=await originalFetch(input,init);
 if(url.startsWith(`http://127.0.0.1:${port}/`)){
  const key=new URL(url).pathname;
  if(method==='PUT'){
   const headers=new Headers(init?.headers);assert.ok(headers.has('if-match')||headers.has('if-none-match'));conditionalWrites++;
   if(response.ok&&response.headers.has('etag'))etags.set(key,response.headers.get('etag'));
  }
  if(method==='GET'&&response.ok&&etags.has(key)&&!response.headers.has('etag')){
   const headers=new Headers(response.headers);headers.set('etag',etags.get(key));return new Response(response.body,{status:response.status,headers});
  }
 }
 return response;
};
globalThis.netlifyBlobsContext=Buffer.from(JSON.stringify({siteID:'local-verification',token:'local-test-only',edgeURL:`http://127.0.0.1:${port}`,uncachedEdgeURL:`http://127.0.0.1:${port}`})).toString('base64');
try{
 const moduleURL=pathToFileURL(resolve(root,'function/netlify/functions/game.mjs')).href;
 const {default:handler}=await import(moduleURL);
 assert.equal(typeof handler,'function');
 const call=async(action,s,data={})=>{
  const res=await handler(new Request('https://vault.test/.netlify/functions/game',{method:'POST',headers:{'Content-Type':'application/json',...(s?{Authorization:'Bearer '+s.token}:{})},body:JSON.stringify({action,room:s?.room,requestId:randomUUID(),...data})}));
  const body=await res.json();assert.equal(res.status,200,JSON.stringify(body));return body;
 };
 for(const rounds of [3,6]){
  const a=await call('create',null,{name:'Alpha'}),b=await call('join',null,{name:'Beta',code:a.room});
  if(rounds===3){
   // Test fixture only: the deployed create endpoint always uses six rounds.
   const store=getStore({name:'vault-wars-rooms-v1',consistency:'strong'});
   const record=await store.getWithMetadata(a.room,{type:'json',consistency:'strong'});
   record.data.prizes=[4,5,6];assert.equal((await store.setJSON(a.room,record.data,{onlyIfMatch:record.etag})).modified,true);
  }
  const sa=crypto.randomUUID(),sb=crypto.randomUUID();
  await call('call-join',a,{callSession:sa,mic:true,camera:true});
  await call('call-join',b,{callSession:sb,mic:true,camera:false});
  const signalId=crypto.randomUUID();
  await call('call-signal',a,{callSession:sa,to:b.id,toSession:sb,requestId:signalId,description:{type:'offer',sdp:'v=0\r\na=packaged-signaling-test'}});
  const incoming=await call('call-state',b,{callSession:sb});assert.equal(incoming.signals[0].id,signalId);assert.equal(incoming.members.length,2);
  assert.equal((await call('call-state',a,{callSession:sa})).signals.length,0);
  await call('call-state',b,{callSession:sb,ack:[signalId]});
  let state=await call('state',a);state=await call('start',a,{gameId:state.gameId});
  for(let round=0;round<rounds;round++){
   const bids=rounds===3?[[3,1],[2,2],[1,4]][round]:[1,0];
   const params={gameId:state.gameId,round};
   const callState=await call('call-status',a,{callSession:sa,mic:round%2===0,camera:round%2===0});assert.equal(callState.members.length,2);
   await call('bid',a,{...params,bid:bids[0]});
   const hidden=await call('state',b);assert.equal(hidden.players[0].bid,undefined);assert.equal(JSON.stringify(hidden).includes(a.token),false);
   state=await call('bid',b,{...params,bid:bids[1]});
   if(round<rounds-1)state=await call('next',a,params);
  }
  assert.equal(state.phase,'finished');assert.equal(state.history.length,rounds);
  assert.deepEqual(state.players.map(p=>[p.score,p.credits]),rounds===3?[[4,18],[11,17]]:[[40,18],[0,24]]);
  assert.deepEqual(state.winners,[rounds===3?b.id:a.id]);
  // Reload the packaged module to emulate a fresh function instance; state survives.
  const cold=(await import(moduleURL+'?cold='+rounds)).default;
  const response=await cold(new Request('https://vault.test/.netlify/functions/game',{method:'POST',headers:{Authorization:'Bearer '+a.token},body:JSON.stringify({action:'state',room:a.room})}));
  assert.deepEqual((await response.json()).winners,state.winners);
  await call('call-leave',a,{callSession:sa});assert.equal((await call('call-state',b,{callSession:sb})).members.length,1);await call('call-leave',b,{callSession:sb});
  console.log(`PASS: packaged function + real Blobs SDK/emulator, complete ${rounds}-round game, call signaling/presence and cold-instance persistence`);
 }
 const html=await readFile('dist/index.html','utf8');
 for(const asset of [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)])await readFile('dist'+asset[1]);
 const frontend=await readFile('src/app.js','utf8');assert.ok(frontend.includes("fetch('/.netlify/functions/game'"));assert.ok(!frontend.includes('EventSource'));assert.ok(!frontend.includes("fetch('/api/"));
 assert.ok(conditionalWrites>20);
 console.log('PASS: production assets, direct native function endpoint, single packaged function');
}finally{
 globalThis.fetch=originalFetch;
 if(oldContext===undefined)delete globalThis.netlifyBlobsContext;else globalThis.netlifyBlobsContext=oldContext;
 await blobServer.stop();await rm(root,{recursive:true,force:true});
}
