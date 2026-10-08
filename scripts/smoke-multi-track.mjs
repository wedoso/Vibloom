import { app, BrowserWindow, net, protocol, session } from 'electron';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const uiControlsOnly = process.env.VIBLOOM_UI_CONTROLS_ONLY === '1';
const root=fileURLToPath(new URL('../',import.meta.url));
const profile=await mkdtemp(path.join(tmpdir(),'vibloom-multi-'));
const output=path.join(root,'outputs/multi-track-smoke');
app.commandLine.appendSwitch('js-flags','--expose-gc');
app.setPath('userData',profile);app.on('window-all-closed',()=>{});
protocol.registerSchemesAsPrivileged([{scheme:'vibloom',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true}}]);
let window,exitCode=0;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function main(){const timer=setTimeout(()=>app.exit(1),300000);try{
 await app.whenReady();await mkdir(output,{recursive:true});
 protocol.handle('vibloom',request=>{const file=path.resolve(root,'dist',`.${new URL(request.url).pathname}`);return file.startsWith(path.join(root,'dist')+path.sep)?net.fetch(pathToFileURL(file).href):new Response('Not found',{status:404});});
 window=new BrowserWindow({show:process.env.CI==='true',width:1440,height:1000,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 window.webContents.setAudioMuted(true);
 const errors=[];window.webContents.on('console-message',event=>{if(event.level==='error'){errors.push(event.message);console.error('RENDERER',event.message);}});
 const run=code=>window.webContents.executeJavaScript(code,true);
 const wait=async(code,label)=>{console.log('WAIT',label);for(let i=0;i<1200;i++){if(await run(code))return;await delay(50);}throw new Error('Timeout '+label+' | '+await run(`document.body.innerText.slice(-2000)`));};
 const click=selector=>run(`document.querySelector(${JSON.stringify(selector)}).click()`);
 const snapshot=()=>run(`new Promise((resolve,reject)=>{const req=indexedDB.open('vibloom-library');req.onsuccess=()=>{const db=req.result,load=db.transaction('state').objectStore('state').get('library');load.onsuccess=()=>{db.close();resolve(load.result);};load.onerror=()=>reject(load.error);};})`);
 const capture=async name=>{await delay(350);return writeFile(path.join(output,name+'.png'),(await window.webContents.capturePage()).toPNG());};
 await window.loadURL('vibloom://app/index.html');await wait(`document.querySelector('.live2d-stage[data-status="ready"]')`,'app');
 await run(`(()=>{
  window.__parameterFinite=true;const create=Live2DCubismCore.Model.fromMoc;Live2DCubismCore.Model.fromMoc=function(...args){const model=create.apply(this,args),update=model.update;model.update=function(...args){window.__parameterFinite&&=Array.from(model.parameters.values).every(Number.isFinite);return update.apply(this,args);};return model;};
  const start=AudioBufferSourceNode.prototype.start;window.__audibleBuffer=null;AudioBufferSourceNode.prototype.start=function(...args){if(this.context instanceof AudioContext && this.buffer)window.__audibleBuffer=new WeakRef(this.buffer);return start.apply(this,args);};
  window.__weak=[];const decode=BaseAudioContext.prototype.decodeAudioData;BaseAudioContext.prototype.decodeAudioData=function(...args){return decode.apply(this,args).then(buffer=>{window.__weak.push(new WeakRef(buffer));return buffer;});};
  const Worker=window.Worker;window.__workers=[];window.__hold=false;window.__fail=false;
  window.Worker=class extends Worker{constructor(...args){super(...args);this.remaster=String(args[0]).includes('remaster.worker');if(this.remaster)window.__workers.push(this);}postMessage(...args){if(this.remaster&&args[0].type==='init'){if(window.__hold)return;if(window.__fail){queueMicrotask(()=>this.onmessage({data:{type:'error',message:'Injected failure'}}));return;}}return super.postMessage(...args);}terminate(){this.ended=true;return super.terminate();}};
  window.__fixture=(name,seconds=4)=>{const rate=48000,frames=rate*seconds,bytes=new ArrayBuffer(44+frames*4),v=new DataView(bytes);const str=(at,s)=>[...s].forEach((x,i)=>v.setUint8(at+i,x.charCodeAt(0)));str(0,'RIFF');v.setUint32(4,bytes.byteLength-8,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,2,true);v.setUint32(24,rate,true);v.setUint32(28,rate*4,true);v.setUint16(32,4,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,frames*4,true);for(let i=0;i<frames;i++){const x=.3*Math.sin(i*2*Math.PI*997/rate);v.setInt16(44+i*4,x*32767,true);v.setInt16(46+i*4,-x*.5*32767,true);}return new File([bytes],name,{type:'audio/wav',lastModified:1});};
  window.__load=(file,compare=false)=>{const input=document.querySelector(compare?'input[type="file"][accept="audio/*,.flac,.aiff,.aif"]':'input[type="file"][multiple]'),transfer=new DataTransfer();transfer.items.add(file);input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));};window.__load(window.__fixture('Original.wav'));
 })()`);
 await wait(`document.querySelector('#import-title')?.textContent==='Import complete'`,'import');await click('[aria-label="Close import summary"]');await click('.transport-play');
 await wait(`document.querySelector('[aria-label="EQ track 1"]')&&!document.querySelector('[aria-label="EQ track 1"]').disabled`,'original decoded');
 const process=async(source,kind,preset,target)=>{
  const selectedBefore=await run(`document.querySelector('.waveform-card .source-selector[aria-pressed="true"]').textContent`);
  await click(`[aria-label="${kind==='eq'?'EQ':'Audio repair'} track ${source}"]`);await wait(`document.querySelector('dialog[open]')`,'dialog');
  if(kind==='remaster')await click('.remaster-categories button');await click(`[data-preset-id="${preset}"]`);
  if(target)await run(`(()=>{const s=document.querySelector('[aria-label="Output track"]');const value='${target-1}';s.click();document.querySelector('[role=option][data-value="'+value+'"]').click();})()`);
  const destination=target??Number(await run(`document.querySelector('[aria-label="Output track"]').value`))+1;
  await click('.remaster-submit');await wait(`document.querySelector('[data-track-number="${destination}"].is-ready')&&!document.querySelector('dialog')`,'output '+destination);
  assert.equal(await run(`document.querySelector('.waveform-card .source-selector[aria-pressed="true"]').textContent`),selectedBefore,'completion never selects its output');
 };
 if(uiControlsOnly){
  await click('.transport-play'); // Inspect configured previews without autoplay.
  for(const companion of ['hong-xi','hiyori']){
   await click('[aria-label="Music companion"]');await wait(`document.querySelector('.styled-select-menu:popover-open')`,'companion menu');
   await capture('themed-companion-'+companion);await click(`[role="option"][data-value="${companion}"]`);
   await wait(`document.querySelector('.live2d-stage[data-companion="${companion}"][data-status="ready"]')`,'selected companion');
   for(const [width,height] of [[1440,1000],[390,900],[320,600]]){
    window.setBounds({width,height});await delay(250);await click('[aria-label="EQ track 1"]');
    await click('.sound-preview-bar button');await wait(`document.querySelector('.sound-apply-status')?.dataset.state==='applied'`,'paused apply status');
    assert.ok(await run(`Boolean(document.querySelector('[aria-label="Play preview"]'))`),'preview preserves pause');
    const inspect=async(label,screenshot)=>{
     await run(`document.querySelector('[aria-label="${label}"]').scrollIntoView({block:'nearest'});`);assert.ok(await run(`document.querySelector('[aria-label="${label}"]').getBoundingClientRect().width>0`),'trigger is visible '+label);await click(`[aria-label="${label}"]`);
     await wait(`document.querySelector('.styled-select-menu:popover-open')`,'open '+label);
     const layout=await run(`(()=>{const r=document.querySelector('.styled-select-menu:popover-open').getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,w:innerWidth,h:innerHeight};})()`);
     assert.ok(layout.x>=0&&layout.y>=0&&layout.right<=layout.w&&layout.bottom<=layout.h,JSON.stringify({label,width,companion,layout}));
     if(screenshot)await capture(screenshot);
     window.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});window.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
     await wait(`!document.querySelector('.styled-select-menu:popover-open')&&document.activeElement?.getAttribute('aria-label')==='${label}'`,'Escape restores '+label);
    };
    await inspect('Output track','themed-output-'+companion+'-'+width);
    await click('.sound-tabs button:nth-child(2)');await inspect('Output sample rate');await inspect('Output bit depth','themed-format-'+companion+'-'+width);
    await click('[aria-label="Close eq"]');
   }
  }
  console.log('PASS all themed selectors in both companion themes at 1440 / 390 / 320 px; paused preview and keyboard dismissal');return;
 }
 await click('[aria-label="EQ track 1"]');await wait(`document.querySelectorAll('.remaster-preset').length===6`,'six EQ presets');await capture('eq-dialog');
 await click('[aria-label="Output track"]');await wait(`document.querySelector('.styled-select-menu:popover-open')`,'themed output list');
 const menuBounds=await run(`(()=>{const r=document.querySelector('.styled-select-menu:popover-open').getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width};})()`);
 assert.ok(menuBounds.x>=0&&menuBounds.right<=1440&&menuBounds.y>=0&&menuBounds.bottom<=1000,'output menu stays within the viewport');await capture('themed-output-menu');
 window.webContents.sendInputEvent({type:'keyDown',keyCode:'Down'});window.webContents.sendInputEvent({type:'keyUp',keyCode:'Down'});
 await wait(`document.activeElement?.dataset.value==='2'`,'listbox arrow focus');
 window.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});window.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
 await wait(`!document.querySelector('.styled-select-menu:popover-open')&&document.activeElement?.getAttribute('aria-label')==='Output track'`,'listbox Escape and focus restore');
 assert.equal(await run(`document.querySelector('[aria-label="Output track"]').value`),'1','navigation alone never changes the destination');
 console.log('EQ HEIGHT',await run(`document.querySelector('dialog').getBoundingClientRect().height`));assert.ok(await run(`document.querySelector('dialog').getBoundingClientRect().height<620`),'EQ dialog is compact');await click('[aria-label="Close eq"]');
 await process(1,'eq','vocal',2);assert.ok(await run(`window.__audibleBuffer.deref()===window.__weak[0].deref()`),'EQ completion preserves the original audible buffer');await click('[aria-label="Listen to track 2"]');assert.ok(await run(`window.__audibleBuffer.deref()===window.__weak[1].deref()`),'explicit selection plays the rendered EQ result');await click('[aria-label="Listen to track 1"]');await process(2,'remaster','gentle',3);
 await delay(700);let state=await snapshot();assert.equal(state.version,3);let versions=state.tracks[0].comparisons;
 assert.equal(versions[0].eq.presetId,'vocal');assert.equal(versions[0].source.number,1);assert.equal(versions[1].remaster.presetId,'gentle');assert.equal(versions[1].source.number,2);assert.equal(versions[1].source.id,versions[0].id);assert.ok(await run(`window.__workers.every(w=>w.ended)`));
 await click('[aria-label="EQ track 1"]');await click('[data-preset-id="bass"]');await click('[aria-label="Close eq"]');
 await click('[aria-label="EQ track 2"]');assert.equal(await run(`document.querySelector('.remaster-preset.is-selected').dataset.presetId`),'flat','a new version starts with an independent Flat draft, never double-applies its baked EQ');await click('[data-preset-id="bright"]');await click('[aria-label="Close eq"]');
 await click('[aria-label="EQ track 1"]');assert.equal(await run(`document.querySelector('.remaster-preset.is-selected').dataset.presetId`),'bass','track 1 keeps its own draft');await click('[aria-label="Close eq"]');
 await click('[aria-label="EQ track 2"]');assert.equal(await run(`document.querySelector('.remaster-preset.is-selected').dataset.presetId`),'bright','track 2 keeps its own draft');await click('[aria-label="Close eq"]');
 await click('[aria-label="EQ track 1"]');await click('.sound-tabs button:nth-child(2)');await click('.sound-mode button');
 assert.ok(await run(`document.querySelector('.sound-mode input').checked`),'full mastering requires an explicit choice');assert.equal(await run(`document.querySelector('[aria-label="Output bit depth"]').value`),'16');
 await capture('mastering-dialog');await run(`document.querySelector('.sound-detail').open=true`);await capture('mastering-output');await click('.sound-mode input');await click('[aria-label="Close eq"]');
 console.log('PASS independent per-version EQ drafts, no implicit double EQ');
 console.log('PASS native EQ → real WASM remaster → track 3, provenance, worker disposal');await click('[aria-label="Listen to track 3"]');await capture('chain-comparison');
 for(let track=4;track<=9;track++)await process(1,'eq',['flat','bass','bright','warm','suno','flat'][track-4],track);
 await click('[aria-label="Listen to track 1"]');
 if(await run(`Boolean(document.querySelector('[aria-label="Pause"]'))`))await click('.transport-play');
 await click('[aria-label="EQ track 2"]');await click('.sound-preview-bar button');await wait(`document.querySelector('[aria-label="Play preview"]')`,'paused preview');
 assert.equal(await run(`document.querySelector('.source-selector[aria-pressed="true"]').textContent`),'1','preview preserves user selection');assert.ok(await run(`!document.querySelector('[aria-label="Pause preview"]')`),'preview never starts paused audio');
 await click('[aria-label="Play preview"]');await wait(`document.querySelector('[aria-label="Pause preview"]')`,'explicit preview play');
 window.webContents.sendInputEvent({type:'keyDown',keyCode:'1'});window.webContents.sendInputEvent({type:'keyUp',keyCode:'1'});await wait(`!document.querySelector('[aria-label="Pause preview"]')`,'shortcut exits preview');
 await click('[aria-label="Close eq"]');assert.ok(await run(`Boolean(document.querySelector('[aria-label="Pause"]'))`),'exiting preview preserves playback requested by the user');
 await click('[aria-label="EQ track 1"]');await click('.sound-preview-bar button');
 await wait(`document.querySelector('.sound-apply-status')?.dataset.state==='applied'`,'audible EQ acknowledged');
 await run(`window.__previewStates=[];window.__previewObserver=new MutationObserver(()=>window.__previewStates.push(document.querySelector('.sound-apply-status')?.dataset.state));window.__previewObserver.observe(document.querySelector('.sound-apply-status'),{attributes:true});`);
 await click('[data-preset-id="vocal"]');await wait(`document.querySelector('.sound-apply-status')?.dataset.state==='applied'`,'EQ preset applied');
 assert.ok(await run(`window.__previewStates.includes('applying')`),'preset updates show applying before audible acknowledgement');
 await capture('eq-applied');await click('.sound-preview-bar button');await wait(`document.querySelector('.sound-apply-status')?.dataset.state==='bypassed'`,'bypass acknowledged');
 await click('[data-preset-id="bass"]');await wait(`document.querySelector('.sound-apply-status')?.dataset.state==='bypassed'`,'preset edit stays bypassed');
 await click('.sound-preview-bar button');await wait(`document.querySelector('.sound-apply-status')?.dataset.state==='applied'`,'processed output acknowledged');
 await run(`window.__previewObserver.disconnect();`);await click('[aria-label="Close eq"]');
 console.log('PASS paused preview, explicit play, audible apply/bypass status and preserved user selection');
 assert.equal(await run(`document.querySelectorAll('.waveform-card').length`),9);assert.equal(await run(`document.querySelector('[aria-label="Add comparison track"]')`),null);
 await run(`(()=>{const input=document.querySelector('[aria-label="Playback position"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,0);input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 if(!await run(`document.querySelector('[aria-label="Pause"]')`))await click('.transport-play');
 for(let track=1;track<=9;track++){window.webContents.sendInputEvent({type:'keyDown',keyCode:String(track)});window.webContents.sendInputEvent({type:'keyUp',keyCode:String(track)});await wait(`document.querySelector('[data-track-number="${track}"] .source-selector').getAttribute('aria-pressed')==='true'`,'shortcut '+track);}
 await delay(700);assert.ok(await run('window.__parameterFinite'),'all nine sources keep the actual Cubism parameters finite');
 assert.equal(await run(`document.querySelectorAll('.comparison-versions [data-expanded="true"]').length`),1);
 assert.equal(await run(`document.querySelectorAll('.precision-waveform').length`),2,'collapsed waveforms unmount after the transition');
 for(const [width,height] of [[1440,1000],[1280,900],[1280,720]]){
  window.setBounds({width,height});await delay(650);
  await wait(`document.querySelector('[data-track-number="9"]').getBoundingClientRect().height>=200`,'selected card expansion at '+width+'×'+height);
  const layout=await run(`(()=>{const stack=document.querySelector('.comparison-versions'),r=stack.getBoundingClientRect(),footer=document.querySelector('.console-footer').getBoundingClientRect();return {height:r.height,scrollHeight:stack.scrollHeight,clientHeight:stack.clientHeight,cards:[...stack.querySelectorAll('article')].map(card=>{const b=card.getBoundingClientRect();return {number:card.dataset.trackNumber,top:b.top,bottom:b.bottom,height:b.height};}),top:r.top,bottom:r.bottom,footer:footer.top};})()`);
  console.log('LAYOUT',width,height,JSON.stringify(layout));
  assert.ok(layout.scrollHeight<=layout.clientHeight+2,'no right-side scrolling at '+width+'×'+height);
  assert.ok(layout.cards.every(card=>card.top>=layout.top-1&&card.bottom<=layout.bottom+1&&card.bottom<=layout.footer),'all eight comparison cards fit at '+width+'×'+height);
  assert.ok(layout.cards.find(card=>card.number==='9').height>=200,'the selected card retains its full size at '+width+'×'+height);
  await capture('nine-tracks-'+height);
 }
 window.setBounds({width:1440,height:1000});await delay(500);await capture('nine-tracks');
 await click('[aria-label="Listen to track 1"]');await delay(350);
 assert.equal(await run(`document.querySelectorAll('.comparison-versions .precision-waveform').length`),1,'the last comparison stays expanded while original is selected');
 assert.equal(await run(`document.querySelectorAll('.comparison-versions [data-expanded="false"]').length`),7);
 await click('[aria-label="Listen to track 9"]');await delay(350);
 const sourceSwitch=await run(`(()=>{const r=document.querySelector('.source-switch').getBoundingClientRect(),volume=document.querySelector('.transport-secondary > label').getBoundingClientRect();return {width:r.width,height:r.height,border:getComputedStyle(document.querySelector('.source-switch')).borderStyle,volumeGap:volume.left-r.right};})()`);
 assert.equal(sourceSwitch.width,70);assert.equal(sourceSwitch.height,34);assert.equal(sourceSwitch.border,'solid');assert.ok(sourceSwitch.volumeGap>=0,'switch does not overlap volume');
 await click('.source-switch-picker');await wait(`document.querySelector('.source-switch-grid')`,'number picker');
 assert.equal(await run(`document.querySelectorAll('.source-switch-grid button').length`),9);
 await capture('source-picker');
 await click('.source-switch-grid [data-source="3"]');await wait(`document.querySelector('[data-track-number="4"] .source-selector').getAttribute('aria-pressed')==='true'`,'picker track 4');
 await click('.source-switch-picker');await click('.source-switch-grid [data-source="4"]');await wait(`document.querySelector('[data-track-number="5"] .source-selector').getAttribute('aria-pressed')==='true'`,'picker track 5');
 assert.ok(await run(`document.querySelector('.source-switch-number > span').getAnimations().some(animation=>animation.playState==='running')`),'comparison number animates on 4 → 5');
 await delay(180);await click('.source-switch-original');await wait(`document.querySelector('.source-switch-original').getAttribute('aria-pressed')==='true'`,'switch original');
 assert.equal(await run(`document.querySelector('.source-switch-comparison').getAttribute('aria-label')`),'Switch to track 5','returning to original remembers the comparison');
 await capture('source-switch');await click('.source-switch-comparison');await wait(`document.querySelector('[data-track-number="5"] .source-selector').getAttribute('aria-pressed')==='true'`,'one-click comparison return');
 await click('.source-switch-picker');window.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});window.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await wait(`!document.querySelector('.source-switch-grid')`,'picker Escape');
 assert.equal(await run(`document.activeElement.className`),'source-switch-picker','Escape restores trigger focus');
 const playing=await run(`Boolean(document.querySelector('[aria-label="Pause"]'))`);
 window.webContents.sendInputEvent({type:'keyDown',keyCode:'Space'});window.webContents.sendInputEvent({type:'keyUp',keyCode:'Space'});await wait(`document.querySelector('.source-switch-grid')`,'picker Space');
 assert.equal(await run(`Boolean(document.querySelector('[aria-label="Pause"]'))`),playing,'picker Space never toggles playback');
 window.webContents.sendInputEvent({type:'keyDown',keyCode:'Left'});window.webContents.sendInputEvent({type:'keyUp',keyCode:'Left'});
 await wait(`document.activeElement.dataset.source==='3'`,'arrow keys navigate the grid');
 window.webContents.sendInputEvent({type:'keyDown',keyCode:'9'});window.webContents.sendInputEvent({type:'keyUp',keyCode:'9'});await wait(`!document.querySelector('.source-switch-grid')&&document.querySelector('[data-track-number="9"] .source-selector').getAttribute('aria-pressed')==='true'`,'picker digit 9');
 await click('.source-switch-picker');await run(`document.querySelector('.transport-secondary > label').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`);await wait(`!document.querySelector('.source-switch-grid')`,'picker outside click');
 for(const [label,word] of [['EQ track 1','EQ'],['Audio repair track 1','Audio repair'],['Prepare vocals track 1','Vocal']]){
  await run(`document.querySelector('[aria-label="${label}"]').dispatchEvent(new MouseEvent('mouseover',{bubbles:true}))`);
  await wait(`document.querySelector('[role="tooltip"]')?.textContent.includes('${word}')`,'tooltip '+word);
  await capture('tooltip-'+word.toLowerCase());
  await run(`document.querySelector('[aria-label="${label}"]').dispatchEvent(new MouseEvent('mouseout',{bubbles:true}))`);
 }
 await click('[aria-label="EQ track 1"]');
 await click('[aria-label="Output track"]'); assert.ok(await run(`document.querySelector('[role="option"][data-value="8"]').disabled`),'the selected comparison cannot be replaced');
 await run(`(()=>{const value='8';document.querySelector('[role=option][data-value="'+value+'"]').click();})()`);
 assert.notEqual(await run(`document.querySelector('[aria-label="Output track"]').value`),'8','disabled options cannot change the destination');await click('[aria-label="Output track"]');
 await click('[aria-label="Close eq"]');
 console.log('PASS original/recent comparison switch, animated numbers, picker keyboard and outside dismissal, three tooltips and selected-target protection');
 console.log('PASS nine numbered tracks, shortcuts 1–9, animated compact cards and no right-side scrolling');
 const downloadPath=path.join(output,'eq-output.wav');const download=new Promise((resolve,reject)=>session.defaultSession.once('will-download',(_event,item)=>{item.setSavePath(downloadPath);item.once('done',(_event,status)=>status==='completed'?resolve():reject(new Error(status)));}));
 await click('[data-track-number="9"] [aria-label="Download track 9"]');await download;const wav=await readFile(downloadPath);assert.equal(wav.readUInt16LE(34),24);const originalFormat=await run(`({frames:window.__weak[0].deref().length,rate:window.__weak[0].deref().sampleRate,channels:window.__weak[0].deref().numberOfChannels})`);assert.equal(wav.readUInt32LE(24),originalFormat.rate);assert.equal(wav.readUInt32LE(40),originalFormat.frames*originalFormat.channels*3);console.log('PASS PCM24 download');
 const downloadTone=async number=>{
  const file=path.join(output,'eq-tone-'+number+'.wav');const done=new Promise((resolve,reject)=>session.defaultSession.once('will-download',(_event,item)=>{item.setSavePath(file);item.once('done',(_event,status)=>status==='completed'?resolve():reject(new Error(status)));}));
  await click(`[data-track-number="${number}"] [aria-label="Download track ${number}"]`);await done;
  const bytes=await readFile(file),channels=bytes.readUInt16LE(22),frames=bytes.readUInt32LE(40)/(channels*3);let power=0;for(let i=Math.floor(frames/2);i<frames;i++){const sample=bytes.readIntLE(44+i*channels*3,3)/8388607;power+=sample*sample;}return Math.sqrt(power/(frames-Math.floor(frames/2)));
 };
 const vocal=await downloadTone(2),bright=await downloadTone(6),flat=await downloadTone(9);
 const gains={vocalDb:20*Math.log10(vocal/flat),brightDb:20*Math.log10(bright/flat)};
 assert.ok(gains.vocalDb>2&&gains.vocalDb<2.3);assert.ok(gains.brightDb>1&&gains.brightDb<1.4);console.log('PASS downloaded EQ gains at 997 Hz',gains);
 // No change to an existing output if a replacement fails or is cancelled.
 await click('[aria-label="Audio repair track 1"]');await run(`window.__fail=true`);await click('.remaster-submit');await wait(`document.querySelector('.remaster-error')?.textContent==='Injected failure'`,'failure retained');await delay(500);assert.equal((await snapshot()).tracks[0].comparisons.length,8);
 await run(`window.__fail=false;window.__hold=true`);await click('.remaster-submit');await wait(`document.querySelector('.card-perimeter-progress')`,'perimeter progress');assert.ok(await run(`(()=>{const svg=document.querySelector('.version-a .card-perimeter-progress'),card=svg.parentElement,a=svg.getBoundingClientRect(),b=card.getBoundingClientRect();return Math.abs(a.width-b.width)<=2&&Math.abs(a.height-b.height)<=2;})()`),'progress follows its own card');await click('.remaster-processing-actions .remaster-submit');assert.equal(await run(`Boolean(document.querySelector('dialog'))`),false);
 await click('.source-switch-picker');assert.ok(await run(`document.querySelector('[aria-label="Listen to track 2"]').disabled&&document.querySelector('.source-switch-grid [data-source="1"]').disabled`),'replacement destination cannot be selected before commit');
 window.webContents.sendInputEvent({type:'keyDown',keyCode:'2'});window.webContents.sendInputEvent({type:'keyUp',keyCode:'2'});await delay(100);
 assert.equal(await run(`document.querySelector('.source-selector[aria-pressed="true"]').textContent`),'9','a replacement shortcut never steals the audible source');
 await click('[aria-label="Audio repair track 1"]');await click('.remaster-cancel');await click('[aria-label="Close audio repair"]');assert.ok(await run(`window.__workers.every(w=>w.ended)`));assert.equal(await run(`document.querySelectorAll('.waveform-card').length`),9);console.log('PASS background progress, failure and cancellation preserve all outputs');
 // Remove active 9 without renumbering 2–8; an empty slot is reusable.
 await click('[aria-label="Track 9 options"]');await click('[aria-label="Remove track 9"]');await wait(`!document.querySelector('[data-track-number="9"]')&&document.querySelector('[data-track-number="1"] .source-selector').getAttribute('aria-pressed')==='true'`,'remove active');
 assert.equal(await run(`document.querySelector('[data-track-number="8"] .source-selector').textContent`),'8');await process(1,'eq','warm',9);
 await delay(750);state=await snapshot();versions=state.tracks[0].comparisons;assert.equal(versions.length,8);assert.ok(versions.every(v=>v.persistence==='cached'));
 await window.reload();await wait(`document.querySelectorAll('.waveform-card').length===9&&!document.querySelector('[aria-label="EQ track 1"]').disabled`,'cache restored');
 await run(`window.__workers=[];const Worker=window.Worker;window.Worker=class extends Worker{constructor(...args){super(...args);this.remaster=String(args[0]).includes('remaster.worker');if(this.remaster)window.__workers.push(this);}postMessage(...args){if(this.remaster&&args[0].type==='init'&&window.__hold)return;return super.postMessage(...args);}terminate(){this.ended=true;return super.terminate();}};window.__weak=[];window.__coldDecodes=0;const decode=BaseAudioContext.prototype.decodeAudioData;BaseAudioContext.prototype.decodeAudioData=function(...args){window.__coldDecodes++;return decode.apply(this,args).then(buffer=>{window.__weak.push(new WeakRef(buffer));return buffer;});};void 0;`);
 for(let track=2;track<=9;track++){window.webContents.sendInputEvent({type:'keyDown',keyCode:String(track)});window.webContents.sendInputEvent({type:'keyUp',keyCode:String(track)});}
 await wait(`document.querySelector('[data-track-number="9"] .source-selector').getAttribute('aria-pressed')==='true'`,'latest rapid cold selection');
 assert.ok(await run('window.__coldDecodes<=2'),'rapid cold shortcuts decode only an admitted source and the latest requested one');
 console.log('PASS rapid cold switching coalesces unnecessary decoding');
 await click('[aria-label="Listen to track 8"]');await wait(`document.querySelector('[data-track-number="8"] .source-selector').getAttribute('aria-pressed')==='true'`,'lazy restored source');console.log('PASS stable slots and lazy restore of all eight cached versions');
 window.setBounds({width:390,height:900});await delay(1400);assert.ok(await run(`document.querySelector('.comparison-versions').getBoundingClientRect().top>=document.querySelector('.version-a-zone').getBoundingClientRect().bottom`),'narrow layouts do not overlap original and comparison cards');await capture('mobile-tracks');await click('[aria-label="EQ track 1"]');await delay(150);assert.ok(await run(`(()=>{const r=document.querySelector('dialog').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;})()`));await capture('mobile-eq');await click('[aria-label="Close eq"]');
 window.setBounds({width:1440,height:1000});await delay(500);
 await click('[title="Storage"]');await click('.storage-actions button:nth-child(2)');await click('.confirm-destructive');await wait(`!document.querySelector('.confirm-destructive')`,'cache cleared');
 await process(7,'eq','flat',2);
 await delay(600);const sessionOnly=await snapshot();assert.ok(sessionOnly.tracks[0].comparisons.every(v=>v.persistence==='indexed'));
 await click('[title="Storage"]');await click('.cache-toggle input');await wait(`document.querySelector('.library-status')?.textContent.includes('Automatic caching is on')`,'session files recached');await delay(600);assert.ok((await snapshot()).tracks[0].comparisons.every(v=>v.persistence==='cached'));
 console.log('PASS cache clear retains usable session versions and recaching');
 // Clear while a transformation is working: no delayed commit and no PCM/cache remnants.
 await click('[aria-label="Audio repair track 1"]');await run(`window.__hold=true`);await click('.remaster-submit');await wait(`document.querySelector('.card-perimeter-progress')`,'job before clear');await click('.remaster-processing-actions .remaster-submit');
 await click('[aria-label="Clear all comparisons"]');
 await wait(`document.querySelectorAll('.waveform-card').length===1&&!document.querySelector('.card-perimeter-progress')`,'one-click clear');await delay(1000);
 const cleared=await snapshot();assert.equal(cleared.tracks[0].comparisons.length,0);assert.equal(cleared.tracks[0].comparison,null);
 assert.ok(await run(`window.__workers.every(w=>w.ended)`),'all cancelled workers terminate');
 const disk=await run(`(async()=>{const root=await navigator.storage.getDirectory(),dir=await root.getDirectoryHandle('tracks');const names=[];for await(const name of dir.keys())names.push(name);return names;})()`);
 assert.ok(disk.every(name=>!name.includes('--version-')),'comparison audio files are deleted');
 await run(`window.gc()`);await delay(500);await run(`window.gc()`);
 // Original + currently audible original are the only retained decoded sources.
 const remaining=await run(`window.__weak?.filter(ref=>ref.deref()).length??0`);
 assert.equal(remaining,0,'comparison decoded buffers reclaimed after clear');
 console.log('PASS one-click clear cancels processing, deletes disk audio and reclaims decoded comparisons');
 assert.deepEqual(errors,[]);console.log('PASS mobile dialog, no renderer errors');
 await writeFile(path.join(output,'report.json'),JSON.stringify({checks:['EQ/remaster chain','nine tracks','digits 1–9','PCM24 download','cancel/error cleanup','stable removal','cached lazy restore','mobile layout','preserve expanded comparison on original','fixed-width original/recent comparison switch and 3×3 picker','compact EQ dialog','three in-app tooltips','manual output selection','selected target protection','replacement shortcut protection','downloaded EQ frequency response','one-click clear and resource reclamation','independent per-version EQ drafts','full mastering controls and explicit defaults','paused preview does not autoplay','explicit preview playback','numeric key exits preview'],eqDownloaded997Hz:gains,sourceSwitch,comparisonBuffersAfterClear:remaining,comparisonFilesAfterClear:disk.filter(name=>name.includes('--version-')).length,rendererErrors:errors},null,2));
}catch(error){console.error(error);exitCode=1;}finally{clearTimeout(timer);window?.destroy();await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100}).catch(()=>{});app.exit(exitCode);}}
void main();
