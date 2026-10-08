// Real application memory lifecycle audit. Run after npm run build.
import { app, BrowserWindow, net, protocol } from 'electron';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const output=path.join(root,'outputs/remaster-memory');
const rounds=Number(process.env.VIBLOOM_MEMORY_ROUNDS??6);
const profile=await mkdtemp(path.join(tmpdir(),'vibloom-memory-'));
app.setPath('userData',profile);app.on('window-all-closed',()=>{});
protocol.registerSchemesAsPrivileged([{scheme:'vibloom',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true}}]);
let window,exitCode=0;
const timer=setTimeout(()=>app.exit(1),300000),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function main(){try{
 await app.whenReady();await mkdir(output,{recursive:true});
 protocol.handle('vibloom',request=>{const file=path.resolve(root,'dist',`.${new URL(request.url).pathname}`);return file.startsWith(path.join(root,'dist')+path.sep)?net.fetch(pathToFileURL(file).href):new Response('Not found',{status:404});});
 window=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 window.webContents.on('console-message',event=>{if(event.level==='error')console.error('RENDERER',event.message);});
 window.webContents.setAudioMuted(true);window.webContents.debugger.attach('1.3');
 const run=code=>window.webContents.executeJavaScript(`try { ${code} } catch(error) { console.error(error.stack); throw error; }`,true);
 const waitFor=async(code,label)=>{console.log('WAIT',label);for(let i=0;i<1200;i++){if(await run(code))return;await delay(50);}throw new Error('Timeout '+label);};
 const click=selector=>run(`document.querySelector(${JSON.stringify(selector)}).click()`);
 const openRemaster=async()=>{if(!await run(`Boolean(document.querySelector('.remaster-dialog[open]'))`)){await run(`document.querySelector('[aria-label="Audio repair track 1"]').focus()`);await click('[aria-label="Audio repair track 1"]');await waitFor(`Boolean(document.querySelector('.remaster-dialog[open]'))`,'preset dialog');}};
 const remaster=async()=>{await openRemaster();await run(`(()=>{const select=document.querySelector('[aria-label="Output track"]');const value='1';select.click();document.querySelector('[role=option][data-value="'+value+'"]').click();})()`);await click('.remaster-submit');};
 await window.loadURL('vibloom://app/index.html');await waitFor(`document.querySelector('.live2d-stage[data-status="ready"]')`,'app');
 await run(`(()=>{
  window.__memory={activeWorkers:0,createdWorkers:0,endedWorkers:0,weakBuffers:[],urls:0};
  const decode=BaseAudioContext.prototype.decodeAudioData;
  BaseAudioContext.prototype.decodeAudioData=function(...args){return decode.apply(this,args).then(buffer=>{window.__memory.weakBuffers.push(new WeakRef(buffer));return buffer;});};
  const Worker=window.Worker;
  window.Worker=class extends Worker {constructor(...args){super(...args);this.remaster=String(args[0]).includes('remaster.worker');this.disposed=false;if(this.remaster){window.__memory.activeWorkers++;window.__memory.createdWorkers++;}}
   postMessage(...args){if(this.remaster&&window.__memory.failInit&&args[0].type==='init')throw new DOMException('Injected send failure','DataCloneError');return super.postMessage(...args);}
   terminate(){if(this.remaster&&!this.disposed){this.disposed=true;window.__memory.activeWorkers--;window.__memory.endedWorkers++;}super.terminate();}
  };
  const create=URL.createObjectURL,revoke=URL.revokeObjectURL;
  URL.createObjectURL=function(...args){window.__memory.urls++;return create.apply(this,args);};
  URL.revokeObjectURL=function(...args){window.__memory.urls--;return revoke.apply(this,args);};
  window.__memory.load=seconds=>{
   const rate=44100,n=rate*seconds,bytes=new ArrayBuffer(44+n*4),v=new DataView(bytes),str=(i,s)=>[...s].forEach((x,j)=>v.setUint8(i+j,x.charCodeAt(0)));
   str(0,'RIFF');v.setUint32(4,bytes.byteLength-8,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,2,true);v.setUint32(24,rate,true);v.setUint32(28,rate*4,true);v.setUint16(32,4,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,n*4,true);
   let seed=42;for(let i=0;i<n;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;const x=.15*Math.sin(2*Math.PI*1000*i/rate)+((seed>>>0)/2**32-.5)*.04;v.setInt16(44+i*4,x*32767,true);v.setInt16(46+i*4,-.5*x*32767,true);}
   const input=document.querySelector('input[type=file][multiple]'),dt=new DataTransfer();dt.items.add(new File([bytes],'Memory A.wav',{type:'audio/wav'}));input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));input.value='';
  };
  window.__memory.load(60);
 })()`);
 await waitFor(`document.querySelector('#import-title')?.textContent==='Import complete'`,'import');await click('[aria-label="Close import summary"]');
 await waitFor(`document.querySelector('[aria-label="Audio repair track 1"]')&&!document.querySelector('[aria-label="Audio repair track 1"]').disabled`,'decoded A');
 const samples=[];
 const measure=async(label)=>{
  await delay(150);
  // V8 and Blink/WebAudio collect in separate cycles; let both finish.
  for(let i=0;i<5;i++){await delay(20);await window.webContents.debugger.sendCommand('HeapProfiler.collectGarbage');}
  const heap=await window.webContents.debugger.sendCommand('Runtime.getHeapUsage');
  const resources=await run(`({activeWorkers:__memory.activeWorkers,createdWorkers:__memory.createdWorkers,endedWorkers:__memory.endedWorkers,decoded:__memory.weakBuffers.length,aliveBuffers:__memory.weakBuffers.reduce((sum,x)=>sum+Number(!!x.deref()),0),urls:__memory.urls})`);
  const metrics=app.getAppMetrics().find(x=>x.pid===window.webContents.getOSProcessId());
  const row={label,heap,resources,processMemory:metrics?.memory};samples.push(row);console.log(JSON.stringify(row));return row;
 };
 await measure('A loaded');
 for(let round=0;round<rounds;round++){
  await openRemaster();await click('.remaster-categories button');await click('[data-preset-id="full-safe"]');
  await remaster();await waitFor(`document.querySelector('.version-b.is-ready')&&!document.querySelector('.card-perimeter-progress')`,'replace B');
  assert.equal((await measure('success '+round)).resources.activeWorkers,0);
  if(round===0){
    const downloaded=new Promise((resolve,reject)=>window.webContents.session.once('will-download',(_event,item)=>{item.setSavePath(path.join(output,'download.wav'));item.once('done',(_event,state)=>state==='completed'?resolve():reject(new Error(state)));}));
    await click('[aria-label="Download track 2"]');
    await downloaded;assert.equal((await readFile(path.join(output,'download.wav'))).readUInt16LE(34),24);
  }
 }
 // Fail after creation: Worker must be terminated even when init postMessage throws.
 await run('__memory.failInit=true');await remaster();await waitFor(`!document.querySelector('.card-perimeter-progress')&&__memory.createdWorkers===${rounds+1}`,'send failure');
 assert.equal((await measure('init send failure')).resources.activeWorkers,0);await run('__memory.failInit=false');
 // Cancel real initialized jobs, including one after native allocation/processing begins.
 for(let i=0;i<3;i++){
  await remaster();await waitFor(`Boolean(document.querySelector('.card-perimeter-progress'))`,'progress');await delay(i===2?900:150);
  await click('.remaster-cancel');
  await waitFor('__memory.activeWorkers===0','terminated');assert.equal((await measure('cancel '+i)).resources.activeWorkers,0);
 }
 await click('[aria-label="Close audio repair"]');await click('[aria-label="Track 2 options"]');await click('[aria-label="Remove track 2"]');await waitFor(`!document.querySelector('.version-b')`,'remove B');
 assert.equal((await measure('B removed')).resources.aliveBuffers,1);
 // Clear queue through the actual application flow; decoded A and B must release.
 await run(`document.querySelector('.transport-secondary > button').click()`);
 await click('.queue-sheet .destructive-text-button');
 await waitFor(`Boolean(document.querySelector('.confirm-destructive'))`,'queue confirmation');
 await run(`document.querySelector('.confirm-destructive').click()`);
 await waitFor(`!document.querySelector('.version-b')&&document.querySelector('[aria-label="Audio repair track 1"]')?.disabled`,'cleared queue');
 await waitFor('__memory.urls===0','download URL released');
 const cleared=await measure('queue cleared');
 if(cleared.resources.aliveBuffers){
  const chunks=[],onMessage=(_event,method,params)=>{if(method==='HeapProfiler.addHeapSnapshotChunk')chunks.push(params.chunk);};
  window.webContents.debugger.on('message',onMessage);
  await window.webContents.debugger.sendCommand('HeapProfiler.takeHeapSnapshot');
  window.webContents.debugger.removeListener('message',onMessage);
  await writeFile(path.join(output,'after-clear.heapsnapshot'),chunks.join(''));
 }
 assert.equal(cleared.resources.aliveBuffers,0);assert.equal(cleared.resources.activeWorkers,0);
 assert.equal(cleared.resources.createdWorkers,cleared.resources.endedWorkers);
 // Reload A/B after clearing, then reset the library; it must release both again.
 await click('[title="Library"]');
 await waitFor(`Boolean(document.querySelector('[aria-label="Play Memory A"]'))`,'library navigation');
 await click('[aria-label="Play Memory A"]');
 await waitFor(`document.querySelector('.transport-track strong')?.textContent==='Memory A'`,'restored track');
 await click('[title="Player"]');
 await waitFor(`document.querySelector('[aria-label="Audio repair track 1"]')&&!document.querySelector('[aria-label="Audio repair track 1"]').disabled`,'A restored');
 await remaster();await waitFor(`document.querySelector('.version-b.is-ready')&&!document.querySelector('.card-perimeter-progress')`,'B restored');
 await measure('A/B restored');await click('.storage-actions .is-destructive');
 await waitFor(`Boolean(document.querySelector('.confirm-destructive'))`,'reset confirmation');await click('.confirm-destructive');
 await waitFor(`!document.querySelector('.version-b')&&document.querySelector('[aria-label="Audio repair track 1"]')?.disabled`,'reset');
 const reset=await measure('library reset');assert.equal(reset.resources.aliveBuffers,0);assert.equal(reset.resources.activeWorkers,0);assert.equal(reset.resources.urls,0);
 assert.ok(samples.filter(x=>x.label.startsWith('success ')).every(x=>x.resources.aliveBuffers===2),'only the current A and B buffers may remain');
 assert.ok(samples.filter(x=>x.label.startsWith('success ')).at(-1).heap.usedSize-samples.find(x=>x.label==='success 0').heap.usedSize<8*1024*1024,'repeated jobs do not continuously grow retained JS heap');
 await writeFile(path.join(output,'browser-results.json'),JSON.stringify({electron:process.versions.electron,samples},null,2));
 console.log('PASS resource lifecycle, repeated B replacements, init failure, cancellation, remove B and clear queue');
}catch(error){console.error(error);exitCode=1;}finally{clearTimeout(timer);window?.destroy();await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100}).catch(()=>{});app.exit(exitCode);}}
void main();
