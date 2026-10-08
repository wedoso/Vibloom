import { app, BrowserWindow, net, protocol, session } from 'electron';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const profile=await mkdtemp(path.join(tmpdir(),'vibloom-remaster-'));
const output=path.join(root,'outputs/remaster-smoke');
const seconds=Number(process.env.VIBLOOM_REMASTER_SECONDS??60);
assert.ok(Number.isInteger(seconds)&&seconds>=1&&seconds<=300);
app.setPath('userData',profile); app.on('window-all-closed',()=>{});
protocol.registerSchemesAsPrivileged([{scheme:'vibloom',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true}}]);
let window, exitCode=0;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const timer=setTimeout(()=>{console.error('Remaster smoke timed out');app.exit(1);},420000);
async function smoke() {
try {
  await app.whenReady(); await mkdir(output,{recursive:true});
  protocol.handle('vibloom',request=>{
    const file=path.resolve(root,'dist',`.${new URL(request.url).pathname}`);
    if(!file.startsWith(path.join(root,'dist')+path.sep)) return new Response('Not found',{status:404});
    return net.fetch(pathToFileURL(file).href);
  });
  window=new BrowserWindow({width:1440,height:1000,show:process.env.CI==='true',webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  window.webContents.setAudioMuted(true);
  const errors=[];window.webContents.on('console-message',event=>{if(event.level==='error'||event.level===3) {errors.push(event.message);console.error('RENDERER',event.message);}});
  const run=code=>window.webContents.executeJavaScript(code,true);
  const waitFor=async(code,label)=>{console.log('WAIT',label);for(let i=0;i<2400;i++){if(await run(code))return;await delay(50);}throw new Error(`Timed out: ${label} | ${await run("document.querySelector('.remaster-entry')?.textContent + ' | ' + document.querySelector('.transport-track')?.textContent")}`);};
  const click=selector=>run(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const openRemaster=async()=>{if(!await run(`Boolean(document.querySelector('.remaster-dialog[open]'))`)){await run(`document.querySelector('.remaster-entry').focus()`);await click('.remaster-entry');await waitFor(`Boolean(document.querySelector('.remaster-dialog[open]'))`,'preset dialog');}};
  const button=async text=>{
    if(text==='Download B')return click('[aria-label="Download B"]');
    await openRemaster();
    return text==='Remaster A'?click('.remaster-submit'):click('.remaster-cancel');
  };
  const preset=async id=>{await openRemaster();await click('.remaster-categories button');await click(`[data-preset-id="${id}"]`);};
  const snapshot=()=>run(`new Promise((resolve,reject)=>{const open=indexedDB.open('vibloom-library');open.onsuccess=()=>{const db=open.result;const req=db.transaction('state').objectStore('state').get('library');req.onsuccess=()=>{db.close();resolve(req.result);};req.onerror=()=>reject(req.error);};})`);
  await window.loadURL('vibloom://app/index.html');
  await waitFor(`document.querySelector('.live2d-stage[data-status="ready"]')`,'app');
  await run(`(()=>{
    window.__decodes=[];const decode=BaseAudioContext.prototype.decodeAudioData;
    BaseAudioContext.prototype.decodeAudioData=function(...args){return decode.apply(this,args).then(buffer=>{window.__decodes.push(buffer);return buffer;});};
    const Worker=window.Worker;window.__workers=[];window.__hold=false;window.__fail=false;
    window.Worker=class extends Worker {constructor(...args){super(...args);this.remaster=String(args[0]).includes('remaster.worker');if(this.remaster)window.__workers.push(this);}postMessage(...args){if(this.remaster&&args[0].type==='init'){if(window.__hold)return;if(window.__fail){queueMicrotask(()=>this.onmessage({data:{type:'error',message:'Injected failure'}}));return;}}return super.postMessage(...args);}terminate(){this.ended=true;return super.terminate();}};
    window.__starts=[];const start=AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start=function(...args){if(this.buffer?.duration>1)window.__starts.push({time:args[0],offset:args[1],duration:this.buffer.duration});return start.apply(this,args);};
    window.__fixture=(name,seconds=${seconds})=>{
      const rate=48000,frames=Math.floor(rate*seconds),bytes=new ArrayBuffer(44+frames*4),view=new DataView(bytes);
      const str=(at,value)=>[...value].forEach((x,i)=>view.setUint8(at+i,x.charCodeAt(0)));
      str(0,'RIFF');view.setUint32(4,bytes.byteLength-8,true);str(8,'WAVE');str(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,2,true);view.setUint32(24,rate,true);view.setUint32(28,rate*4,true);view.setUint16(32,4,true);view.setUint16(34,16,true);str(36,'data');view.setUint32(40,frames*4,true);
      let state=42;for(let i=0;i<frames;i++){state^=state<<13;state^=state>>>17;state^=state<<5;const value=.18*Math.sin(i*2*Math.PI*1000/rate)+.035*Math.sin(i*2*Math.PI*3500/rate)+((state>>>0)/2**32-.5)*.04;view.setInt16(44+i*4,value*32767,true);view.setInt16(46+i*4,value*-.5*32767,true);}
      return new File([bytes],name,{type:'audio/wav',lastModified:1});
    };
    window.__load=(file,compare=false)=>{const input=document.querySelector(compare?'input[type="file"][accept="audio/*,.flac,.aiff,.aif"]':'input[type="file"][multiple]');const transfer=new DataTransfer();transfer.items.add(file);input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));};
    window.__load(window.__fixture('Test A.wav'));
  })()`);
  await waitFor(`document.querySelector('#import-title')?.textContent==='Import complete'`,'import');
  await click('[aria-label="Close import summary"]');
  await waitFor(`document.querySelector('.transport-play')&&!document.querySelector('.transport-play').disabled`,'transport');
  if(!await run(`Boolean(document.querySelector('[aria-label="Pause"]'))`)) await click('.transport-play');
  await waitFor(`document.querySelector('.remaster-entry')&&!document.querySelector('.remaster-entry').disabled`,'A decoded');
  const before=await run(`window.__decodes[0].getChannelData(0).slice(0,128).reduce((a,x)=>a+x,0)`);
  await preset('full-safe');
  await run(`window.__maxGap=0;window.__last=performance.now();window.__tick=setInterval(()=>{const now=performance.now();window.__maxGap=Math.max(window.__maxGap,now-window.__last);window.__last=now;},16)`);
  await button('Remaster A');
  await waitFor(`document.querySelector('.waveform-card.version-b.is-ready')&&!document.querySelector('[aria-label="Remaster progress"]')`,'real worker B');
  await run(`clearInterval(window.__tick)`);
  const result=await run(`({maxTimerGapMs:window.__maxGap,a:window.__decodes[0].length,b:window.__decodes[1].length,rate:window.__decodes[0].sampleRate,checksum:window.__decodes[0].getChannelData(0).slice(0,128).reduce((a,x)=>a+x,0),workers:window.__workers.length,ended:window.__workers.every(x=>x.ended),starts:window.__starts})`);
  assert.equal(result.a,result.b);assert.equal(result.checksum,before);assert.equal(result.workers,1);assert.ok(result.ended);assert.ok(result.starts.length>=2,'B starts while A plays');
  await click('.version-b .source-selector');assert.equal(await run(`document.querySelector('.version-b .source-selector').getAttribute('aria-pressed')`),'true');
  const name=await run(`document.querySelector('.version-b .waveform-card-heading strong').textContent`);
  const downloadPath=path.join(output,'processed.wav');
  const download=new Promise((resolve,reject)=>session.defaultSession.once('will-download',(_event,item)=>{item.setSavePath(downloadPath);item.once('done',(_event,state)=>state==='completed'?resolve(item.getFilename()):reject(new Error(state)));}));
  await button('Download B');const filename=await download;assert.match(filename,/\.wav$/);
  const bytes=await readFile(downloadPath);assert.equal(bytes.readUInt16LE(34),24);assert.equal(bytes.readUInt32LE(40),result.b*2*3);
  console.log('PASS real worker, sample alignment, intact A, synchronized playback, 24-bit local download');
  await delay(650);
  assert.equal(await run(`Boolean(document.querySelector('.remaster-dialog'))`),false,'successful render closes optional tools');
  const bounds=await run(`(()=>{const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,height:r.height};};return {entry:rect('.remaster-entry'),a:rect('.version-a'),b:rect('.version-b'),vocals:rect('.vocal-lip-sync')};})()`);
  assert.ok(bounds.entry.x>=bounds.a.x&&bounds.entry.right<=bounds.a.right,'entry belongs to the A card');
  assert.ok(Math.abs(bounds.a.height-bounds.b.height)<4,'A/B card heights stay balanced');
  assert.equal(await run(`Boolean(document.querySelector('.remaster-controls'))`),false,'no permanent tool panel');
  await writeFile(path.join(output,'remaster.png'),(await window.webContents.capturePage()).toPNG());
  await openRemaster();
  assert.equal(await run(`document.querySelectorAll('.remaster-preset').length`),17);
  await click('.remaster-categories button:nth-child(3)');
  assert.equal(await run(`document.querySelectorAll('.remaster-preset').length`),2);
  await delay(300);await writeFile(path.join(output,'remaster-dialog.png'),(await window.webContents.capturePage()).toPNG());
  window.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});window.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
  await waitFor(`!document.querySelector('.remaster-dialog')`,'Escape dismisses dialog');
  assert.equal(await run(`document.activeElement?.classList.contains('remaster-entry')`),true,'focus returns to entry');
  window.setBounds({width:390,height:900});await delay(300);await openRemaster();
  assert.ok(await run(`(()=>{const panel=document.querySelector('.remaster-dialog').getBoundingClientRect(),list=document.querySelector('.remaster-presets');return panel.x>=0&&panel.right<=innerWidth&&panel.y>=0&&panel.bottom<=innerHeight&&list.scrollWidth<=list.clientWidth;})()`),'mobile dialog and preset list fit viewport');
  await delay(300);await writeFile(path.join(output,'remaster-mobile.png'),(await window.webContents.capturePage()).toPNG());
  await click('[aria-label="Close remaster"]');window.setBounds({width:1440,height:1000});await delay(300);
  console.log('PASS compact A/B layout, 17 presets and category browsing, Escape/focus restoration, mobile dialog');

  // Forced processor error must leave the previous B and its audible selection.
  await run(`window.__fail=true`);await button('Remaster A');await waitFor(`!document.querySelector('[aria-label="Remaster progress"]')&&window.__workers.length===2`,'failure');
  assert.equal(await run(`document.querySelector('.version-b .waveform-card-heading strong').textContent`),name);
  assert.equal(await run(`document.querySelector('.version-b .source-selector').getAttribute('aria-pressed')`),'true');
  await run(`window.__fail=false;window.__hold=true`);await button('Remaster A');await waitFor(`Boolean(document.querySelector('[aria-label="Remaster progress"]'))`,'cancel ready');await click('.remaster-processing-actions .remaster-submit');
  assert.ok(await run(`Boolean(document.querySelector('.remaster-activity'))&&!document.querySelector('.remaster-dialog')&&window.__workers.some(x=>!x.ended)`),'keep listening hides tools without cancelling work');
  await click('.remaster-activity');await button('Cancel remaster');await click('[aria-label="Close remaster"]');
  assert.ok(await run(`window.__workers.every(x=>x.ended)`));
  assert.equal(await run(`document.querySelector('.version-b .waveform-card-heading strong').textContent`),name);
  console.log('PASS failure and cancellation retain B and release worker');
  // Source changes cancel an active job before a different A can own its result.
  await run(`window.__hold=false;window.__load(window.__fixture('Second A.wav',3))`);
  await waitFor(`document.querySelector('#import-title')?.textContent==='Import complete'`,'second import');await click('[aria-label="Close import summary"]');
  await run(`window.__hold=true`);await button('Remaster A');await waitFor(`Boolean(document.querySelector('[aria-label="Remaster progress"]'))`,'source change job');await click('[aria-label="Close remaster"]');
  await click('[title="Library"]');await waitFor(`document.querySelector('[aria-label="Play Second A"]')`,'library navigation');await click('[aria-label="Play Second A"]');
  await waitFor(`window.__workers.every(x=>x.ended)&&document.querySelector('.transport-track strong')?.textContent==='Second A'`,'source change cleanup');
  await click('[aria-label="Play Test A"]');await waitFor(`document.querySelector('.transport-track strong')?.textContent==='Test A'`,'original A');await click('[title="Player"]');
  await waitFor(`document.querySelector('.version-b.is-ready')&&!document.querySelector('[aria-label="Remaster progress"]')`,'original comparison restored');
  console.log('PASS changing A terminates stale work');
  // Storage errors keep a playable/downloadable session result and remove partial files.
  await run(`(()=>{window.__hold=false;const get=FileSystemDirectoryHandle.prototype.getFileHandle;window.__originalGet=get;FileSystemDirectoryHandle.prototype.getFileHandle=function(name,options){if(name.includes('--remaster-')&&options?.create)return Promise.reject(new DOMException('Injected quota failure','QuotaExceededError'));return get.call(this,name,options);};})()`);
  await button('Remaster A');await waitFor(`document.querySelector('.version-b.is-ready')&&!document.querySelector('[aria-label="Remaster progress"]')`,'quota fallback');await delay(900);
  const sessionOnly=await snapshot();assert.equal(sessionOnly.tracks.find(x=>x.id===sessionOnly.session.currentTrackId).comparison.persistence,'indexed');
  assert.ok(await run(`Boolean(document.querySelector('[aria-label="Download B"]'))&&!document.querySelector('.remaster-entry').disabled`));
  assert.equal(await run(`(async()=>{const dir=await (await navigator.storage.getDirectory()).getDirectoryHandle('tracks');let count=0;for await(const name of dir.keys())if(name.includes('--remaster-'))count++;return count;})()`),0,'partial cache and replaced old result cleaned');
  await run(`void (FileSystemDirectoryHandle.prototype.getFileHandle=window.__originalGet)`);
  await button('Remaster A');await waitFor(`document.querySelector('.version-b.is-ready')&&!document.querySelector('[aria-label="Remaster progress"]')`,'retry after quota failure');
  console.log('PASS cache failure keeps session B and retry restores caching');
  // Persisted generated key must round-trip through OPFS / IndexedDB.
  await delay(900);const saved=await snapshot();const track=saved.tracks.find(x=>x.id===saved.session.currentTrackId);
  assert.equal(track.comparison.remaster.presetId,'full-safe');assert.equal(track.comparison.persistence,'cached');assert.match(track.comparison.cacheKey,/--remaster-/);
  await writeFile(path.join(output,'metrics.json'),JSON.stringify({result,metrics:track.comparison.remaster.metrics},null,2));
  await window.reload();await waitFor(`document.querySelector('.waveform-card.version-b.is-ready')`,'cached B reload');assert.equal(await run(`document.querySelector('.version-b .waveform-card-heading strong').textContent`),name);
  console.log(`PASS cached B reload; ${seconds} s stereo processing: ${track.comparison.remaster.metrics.elapsedMs.toFixed(0)} ms`);
  // Manual B replacement interrupts a held job; it cannot later attach stale PCM.
  await run(`(()=>{const Worker=window.Worker;window.__ended=false;window.Worker=class extends Worker{postMessage(data,...rest){if(data.type==='init')return;super.postMessage(data,...rest);}terminate(){window.__ended=true;super.terminate();}};})()`);
  await button('Remaster A');await waitFor(`Boolean(document.querySelector('[aria-label="Remaster progress"]'))`,'held job');
  await run(`(()=>{const frames=4800,bytes=new ArrayBuffer(44+frames*2),v=new DataView(bytes);const str=(p,s)=>[...s].forEach((x,i)=>v.setUint8(p+i,x.charCodeAt(0)));str(0,'RIFF');v.setUint32(4,bytes.byteLength-8,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,48000,true);v.setUint32(28,96000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,frames*2,true);const input=document.querySelector('input[type="file"][accept="audio/*,.flac,.aiff,.aif"]'),dt=new DataTransfer();dt.items.add(new File([bytes],'Manual B.wav',{type:'audio/wav'}));input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await waitFor(`document.querySelector('.version-b.is-ready .waveform-card-heading strong')?.textContent==='Manual B'`,'manual replacement');assert.ok(await run('window.__ended'));assert.equal(await run(`Boolean(document.querySelector('[aria-label="Remaster progress"]'))`),false);
  console.log('PASS manual replacement cancels stale job');
  assert.deepEqual(errors,[]);
} catch(error){exitCode=1;console.error(error);if(window&&!window.isDestroyed())console.error(await window.webContents.executeJavaScript('document.body.innerText'));}finally{clearTimeout(timer);window?.destroy();await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100}).catch(()=>{});app.exit(exitCode);}

}
void smoke();
