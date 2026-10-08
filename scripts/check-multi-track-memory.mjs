import { app, BrowserWindow, net, protocol } from 'electron';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const profile=await mkdtemp(path.join(tmpdir(),'vibloom-multi-memory-'));
const output=path.join(root,'outputs/multi-track-memory');
app.setPath('userData',profile);app.on('window-all-closed',()=>{});
protocol.registerSchemesAsPrivileged([{scheme:'vibloom',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true}}]);
let window,exitCode=0;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function main(){const timer=setTimeout(()=>app.exit(1),300000);try{
 await app.whenReady();await mkdir(output,{recursive:true});
 protocol.handle('vibloom',request=>{const file=path.resolve(root,'dist',`.${new URL(request.url).pathname}`);return file.startsWith(path.join(root,'dist')+path.sep)?net.fetch(pathToFileURL(file).href):new Response('Not found',{status:404});});
 window=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 window.webContents.setAudioMuted(true);
 const errors=[];window.webContents.on('console-message',event=>{if(event.level==='error'){errors.push(event.message);console.error('RENDERER',event.message);}});
 const run=code=>window.webContents.executeJavaScript(code,true);
 const wait=async(code,label)=>{console.log('WAIT',label);for(let i=0;i<1200;i++){if(await run(code))return;await delay(50);}throw new Error('Timeout '+label+' | '+await run(`document.body.innerText.slice(-2000)`));};
 const click=selector=>run(`document.querySelector(${JSON.stringify(selector)}).click()`);
 await window.loadURL('vibloom://app/index.html');await wait(`document.querySelector('.live2d-stage[data-status="ready"]')`,'app');
 await run(`(()=>{
  window.__parameterFinite=true;const create=Live2DCubismCore.Model.fromMoc;Live2DCubismCore.Model.fromMoc=function(...args){const model=create.apply(this,args),update=model.update;model.update=function(...args){window.__parameterFinite&&=Array.from(model.parameters.values).every(Number.isFinite);return update.apply(this,args);};return model;};
  window.__weak=[];const decode=BaseAudioContext.prototype.decodeAudioData;BaseAudioContext.prototype.decodeAudioData=function(...args){return decode.apply(this,args).then(buffer=>{window.__weak.push(new WeakRef(buffer));return buffer;});};
  const Worker=window.Worker;window.__workers=[];window.__hold=false;window.__fail=false;
  window.Worker=class extends Worker{constructor(...args){super(...args);this.remaster=String(args[0]).includes('remaster.worker');if(this.remaster)window.__workers.push(this);}postMessage(...args){if(this.remaster&&args[0].type==='init'){if(window.__hold)return;if(window.__fail){queueMicrotask(()=>this.onmessage({data:{type:'error',message:'Injected failure'}}));return;}}return super.postMessage(...args);}terminate(){this.ended=true;return super.terminate();}};
  window.__fixture=(name,seconds=4)=>{const rate=48000,frames=rate*seconds,bytes=new ArrayBuffer(44+frames*4),v=new DataView(bytes);const str=(at,s)=>[...s].forEach((x,i)=>v.setUint8(at+i,x.charCodeAt(0)));str(0,'RIFF');v.setUint32(4,bytes.byteLength-8,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,2,true);v.setUint32(24,rate,true);v.setUint32(28,rate*4,true);v.setUint16(32,4,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,frames*4,true);for(let i=0;i<frames;i++){const x=.3*Math.sin(i*2*Math.PI*997/rate);v.setInt16(44+i*4,x*32767,true);v.setInt16(46+i*4,-x*.5*32767,true);}return new File([bytes],name,{type:'audio/wav',lastModified:1});};
  window.__load=(file,compare=false)=>{const input=document.querySelector(compare?'input[type="file"][accept="audio/*,.flac,.aiff,.aif"]':'input[type="file"][multiple]'),transfer=new DataTransfer();transfer.items.add(file);input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));};window.__load(window.__fixture('Original.wav',180));
 })()`);
 await wait(`document.querySelector('#import-title')?.textContent==='Import complete'`,'import');await click('[aria-label="Close import summary"]');await click('.transport-play');
 await wait(`document.querySelector('[aria-label="EQ track 1"]')&&!document.querySelector('[aria-label="EQ track 1"]').disabled`,'original decoded');
 const process=async(source,kind,preset,target)=>{
  await click(`[aria-label="${kind==='eq'?'EQ':'Audio repair'} track ${source}"]`);await wait(`document.querySelector('dialog[open]')`,'dialog');
  if(kind==='remaster')await click('.remaster-categories button');await click(`[data-preset-id="${preset}"]`);
  if(target)await run(`(()=>{const s=document.querySelector('[aria-label="Output track"]');const value='${target-1}';s.click();document.querySelector('[role=option][data-value="'+value+'"]').click();})()`);
  const destination=target??Number(await run(`document.querySelector('[aria-label="Output track"]').value`))+1;
  await click('.remaster-submit');await wait(`document.querySelector('[data-track-number="${destination}"].is-ready')&&!document.querySelector('dialog')`,'output '+destination);
 };
 window.webContents.debugger.attach('1.3');
 const samples=[];
 const measure=async label=>{
  for(let i=0;i<5;i++){await delay(30);await window.webContents.debugger.sendCommand('HeapProfiler.collectGarbage');}
  const resources=await run(`(()=>{const alive=window.__weak.map(ref=>ref.deref()).filter(Boolean);return {decoded:window.__weak.length,alive:alive.length,pcmBytes:alive.reduce((n,b)=>n+b.length*b.numberOfChannels*4,0),workers:window.__workers.length,activeWorkers:window.__workers.filter(w=>!w.ended).length};})()`);
  const heap=await window.webContents.debugger.sendCommand('Runtime.getHeapUsage');samples.push({label,resources,heap});console.log(JSON.stringify(samples.at(-1)));return resources;
 };
 await click('[aria-label="Pause"]');
 for(let track=2;track<=9;track++){
  await process(1,'eq','warm',track);const resource=await measure('track '+track);
  assert.ok(resource.pcmBytes<=256*1024*1024,'resident decoded PCM budget');assert.ok(resource.alive<=4,'only the buffers that fit the decoded PCM budget remain');
 }
 await click('[aria-label="Listen to track 2"]');await wait(`document.querySelector('[data-track-number="2"] .source-selector').getAttribute('aria-pressed')==='true'`,'cold track decoded');
 const switched=await measure('cold switch');assert.ok(switched.pcmBytes<=256*1024*1024);assert.equal(switched.decoded,10);
 await process(2,'remaster','gentle',3);assert.equal((await measure('cold-source remaster chain')).activeWorkers,0);
 await click('.transport-secondary > button');await click('.queue-sheet .destructive-text-button');await wait(`document.querySelector('.confirm-destructive')`,'clear queue confirmation');await click('.confirm-destructive');await wait(`!document.querySelector('.version-b')`,'queue released');
 const cleared=await measure('queue cleared');assert.equal(cleared.alive,0);assert.equal(cleared.activeWorkers,0);
 assert.deepEqual(errors,[]);await writeFile(path.join(output,'report.json'),JSON.stringify({seconds:180,slots:9,pcmBudgetMiB:256,samples},null,2));console.log('PASS nine 3-minute stereo tracks, bounded PCM, lazy decoding, remaster from cold source and complete release');
}catch(error){console.error(error);exitCode=1;}finally{clearTimeout(timer);window?.destroy();await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100}).catch(()=>{});app.exit(exitCode);}}
void main();
