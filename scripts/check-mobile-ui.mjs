/* global document, window, navigator, indexedDB, getComputedStyle, HTMLInputElement, AudioBufferSourceNode, AudioContext */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { snapshot, seedMobile, waveBytes } from './mobile-ui-fixtures.mjs';

const root = process.cwd(), output = path.join(root,'outputs/mobile-ui');
const packageArg = process.argv.indexOf('--playwright-module');
const modulePath = packageArg >= 0 ? process.argv[packageArg + 1] : 'playwright';
const { chromium, webkit } = await import(path.isAbsolute(modulePath) ? pathToFileURL(modulePath).href : modulePath);
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.png':'image/png','.jpg':'image/jpeg','.moc3':'application/octet-stream'};
const server = createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://local'),base=url.pathname.startsWith('/baseline/')?path.join(output,'desktop-baseline-dist'):path.join(root,'dist');
    const pathname=url.pathname.replace(/^\/baseline/u,'');
    const file=path.resolve(base,'.'+(pathname==='/'?'/index.html':decodeURIComponent(pathname)));
    if(!file.startsWith(base+path.sep)){res.writeHead(403);res.end();return;}
    const bytes=await readFile(file);res.setHeader('Content-Type',mime[path.extname(file)]??'application/octet-stream');res.end(bytes);
  }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
await mkdir(path.join(output,'screenshots'),{recursive:true});
const results={startedAt:new Date().toISOString(),engines:[],flows:[],renders:[],desktop:[],errors:[],limitations:['WebKit and Chromium use mobile viewport/input emulation, not physical iPhone Safari/Chrome.','Native iCloud Drive availability, OS folder picker, keyboard and background interruption require physical-device verification.']};
const iphone='Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1';
const android='Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const waitReady=page=>page.waitForFunction(()=>document.querySelector('.m-content')?.getAttribute('aria-busy')==='false');
const navigate=async(page,name)=>{const menu=page.getByRole('navigation',{name:'Main navigation'});if(!await menu.count()){await close(page);await page.getByRole('button',{name:'Open navigation',exact:true}).click();}await menu.getByRole('button',{name,exact:true}).click();};
const close=async page=>{const button=page.getByRole('button',{name:'Close panel',exact:true});if(await button.count())await button.click();};
const listen = async (page, number) => {
  for(let attempt=0;attempt<3;attempt++) {
    const circle=page.getByRole('button',{name:`Listen to track ${number}`,exact:true});
    if(await circle.count()){await circle.click();return;}
    await page.getByRole('button',{name:'Show other comparison tracks',exact:true}).click();
  }
  throw new Error(`Track ${number} is unreachable from the orbit`);
};
const options = page => page.getByRole('button',{name:'Listening options',exact:true}).click();
const openTools = async (page,number) => {
  await options(page);await page.getByRole('dialog').getByRole('button',{name:'Manage tracks',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:`Open track ${number} controls`,exact:true}).click();
};
const wave=waveBytes();
await writeFile(path.join(output,'test-song.wav'),wave);
await writeFile(path.join(output,'test-song.lrc'),'[00:00.00]First line\n[00:03.00]第二行歌词\n[00:10.00]A much longer line to check wrapping in a small listening room\n');
const evaluateLayout=async page=>page.evaluate(()=>{
  const issues=[],viewport=window.innerWidth;
  const visible=element=>{const css=getComputedStyle(element),rect=element.getBoundingClientRect();return rect.width>0&&rect.height>0&&css.visibility!=='hidden'&&css.display!=='none'&&(!element.closest('dialog')||element.closest('dialog').open);};
  if(document.documentElement.scrollWidth>viewport+1)issues.push({kind:'page overflow',width:document.documentElement.scrollWidth,viewport});
  for(const group of document.querySelectorAll('.m-song-row,.m-mini,.m-version-heading,.m-playback-footer,.m-direct-seek,.m-transport,.m-navigation,.m-queue-row,.m-setting-row,.m-import-option,.m-sheet-actions,.m-player-secondary,.m-managed-track,.m-header,.camera-capsule,.m-live-lyrics > header,.m-footer-extras')){
    if(!visible(group))continue;
    const children=[...group.children].filter(visible);
    for(let i=0;i<children.length;i++)for(let j=i+1;j<children.length;j++){
      const a=children[i].getBoundingClientRect(),b=children[j].getBoundingClientRect();
      if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)issues.push({kind:'sibling overlap',group:group.className,a:children[i].className,b:children[j].className});
    }
  }
  for(const element of document.querySelectorAll('.m-song-copy strong,.m-version-heading strong,.m-page-heading h1,.m-import-option strong,.m-queue-song strong,.m-sheet > header h2,.m-setting-row > span')){
    if(!visible(element))continue;
    if(element.scrollWidth>element.clientWidth+1)issues.push({kind:'text overflow',text:element.textContent.slice(0,80),class:element.className});
  }
  const room=document.querySelector('.mobile-app.is-room .m-room-orbit');
  if(room){
    const circles=[...room.querySelectorAll('.m-orbit-track,.m-orbit-bank')].filter(visible);
    const stage=room.getBoundingClientRect();
    const original=room.querySelector('.m-orbit-original');
    if(original&&visible(original)&&original.getBoundingClientRect().right>stage.left+stage.width/2)issues.push({kind:'original is not left of companion'});
    const camera=[...document.querySelectorAll('.camera-capsule button')].filter(visible);
    for(const circle of circles)for(const button of camera){const a=circle.getBoundingClientRect(),b=button.getBoundingClientRect();if(Math.min(a.right,b.right)>Math.max(a.left,b.left)+1&&Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top)+1)issues.push({kind:'camera overlaps track circle'});}
    for(let i=0;i<circles.length;i++){
      const a=circles[i].getBoundingClientRect();
      if(a.width<43.5||a.height<43.5)issues.push({kind:'orbit touch target too small'});
      if(a.left<stage.left-.5||a.right>stage.right+.5||a.top<stage.top-.5||a.bottom>stage.bottom+.5)issues.push({kind:'orbit outside stage',label:circles[i].getAttribute('aria-label')});
      if(circles[i]!==original&&a.left<stage.left+stage.width/2)issues.push({kind:'comparison is not right of companion'});
      for(let j=i+1;j<circles.length;j++){const b=circles[j].getBoundingClientRect();if(Math.min(a.right,b.right)>Math.max(a.left,b.left)+1&&Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top)+1)issues.push({kind:'orbit circles overlap'});}
    }
  }
  const footer=document.querySelector('.m-playback-footer');
  if(footer&&visible(footer)){
    const f=footer.getBoundingClientRect();
    if(Math.abs(f.bottom-window.innerHeight)>1)issues.push({kind:'playback is not pinned to bottom'});
    const lyric=document.querySelector('.m-content > .m-live-lyrics');
    if(lyric&&visible(lyric)&&lyric.getBoundingClientRect().bottom>f.top+1)issues.push({kind:'footer overlaps lyric viewport'});
    for(const button of footer.querySelectorAll('button'))if(visible(button)){const b=button.getBoundingClientRect();if(b.left<0||b.right>viewport+.5||b.bottom>window.innerHeight+.5)issues.push({kind:'footer control outside viewport'});}
  }
  const dialog=document.querySelector('dialog[open]');
  if(dialog){const rect=dialog.getBoundingClientRect();if(rect.left<-.5||rect.right>viewport+.5||rect.height>window.innerHeight+1)issues.push({kind:'dialog outside viewport',x:rect.x,width:rect.width,height:rect.height});}
  return {issues,width:viewport,height:window.innerHeight,scrollHeight:document.documentElement.scrollHeight,styles:[...document.querySelectorAll('link[rel="stylesheet"]')].map(link=>link.href)};
});
async function capture(page,engine,width,height,theme,state){
  await page.evaluate(()=>document.fonts.ready);
  await page.waitForTimeout(280); // Let entry transforms settle before geometry checks.
  if(['empty','player','nine-versions'].includes(state)){await page.waitForSelector('.live2d-stage[data-status="ready"]',{timeout:20000});await page.waitForTimeout(300);}
  const layout=await evaluateLayout(page);
  const file=`${engine}-${width}x${height}-${theme}-${state}.jpg`;
  // Keep representative images; every state still runs geometry assertions.
  const keep=width===390||width===320||width===844||state==='empty'||state==='player';
  if(keep)await page.screenshot({path:path.join(output,'screenshots',file),type:'jpeg',quality:72,fullPage:!await page.locator('dialog[open]').count()});
  results.renders.push({engine,width,height,theme,state,...layout,screenshot:keep?'screenshots/'+file:null});
  if(layout.issues.length)results.errors.push({engine,width,height,theme,state,issues:layout.issues});
}
async function checkFlow(engineName,browser){
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,userAgent:engineName==='webkit'?iphone:android});
  await context.addInitScript(()=>{
    window.__mobileStarts=[];const start=AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start=function(when,offset,...args){if(this.context instanceof AudioContext)window.__mobileStarts.push({when,offset:offset??0,contextTime:this.context.currentTime});return start.call(this,when,offset,...args);};
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin);await waitReady(page);assert.equal(await page.locator('.mobile-app').count(),1,'automatic device routing');
  const desktopCss=await page.evaluate(()=>[...document.styleSheets].some(sheet=>[...sheet.cssRules].some(rule=>rule.selectorText==='.library-app')));assert.equal(desktopCss,false,'mobile never loads desktop CSS');
  await page.getByRole('button',{name:'Import music',exact:true}).click();
  const chooserPromise=page.waitForEvent('filechooser');await page.getByRole('button',{name:/Choose files/}).first().click();const chooser=await chooserPromise;
  await chooser.setFiles([path.join(output,'test-song.wav'),path.join(output,'test-song.lrc')]);
  await page.getByRole('button',{name:'Continue to library',exact:true}).click();await waitReady(page);
  await navigate(page,'Library');assert.equal(await page.locator('.m-song-row').count(),1,'song imported');
  await page.getByRole('button',{name:'Play test-song',exact:true}).click();await page.waitForFunction(()=>document.title.startsWith('Playing'));
  await navigate(page,'Player');await page.waitForSelector('.live2d-stage[data-status="ready"]');
  const rhythmDisc=await page.evaluate(async()=>{
    const samples=[];for(let i=0;i<45;i++){await new Promise(window.requestAnimationFrame);const stage=document.querySelector('.live2d-stage'),disc=document.querySelector('.stage-music-disc'),css=getComputedStyle(disc);samples.push({scale:Number(css.transform.match(/matrix\(([^,]+)/)?.[1]),energy:Number(stage.style.getPropertyValue('--music-energy-long')),beat:Number(stage.style.getPropertyValue('--beat-pulse')),display:getComputedStyle(disc.parentElement).display});}return samples;
  });
  assert.ok(rhythmDisc.every(sample=>sample.display!=='none'),'desktop circular background remains visible');
  assert.ok(rhythmDisc.some(sample=>sample.energy>0),'background uses real audio analysis');
  assert.ok(Math.max(...rhythmDisc.map(sample=>sample.scale))-Math.min(...rhythmDisc.map(sample=>sample.scale))>.0001,'background size responds during playback');
  await page.emulateMedia({reducedMotion:'reduce'});const reducedScale=await page.evaluate(()=>Number(getComputedStyle(document.querySelector('.stage-music-disc')).transform.match(/matrix\(([^,]+)/)?.[1]));assert.ok(Math.abs(reducedScale-.94)<.001,'reduced-motion disc stays static');await page.emulateMedia({reducedMotion:'no-preference'});
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  const range=page.getByRole('slider',{name:'Playback position',exact:true});
  await range.focus();await page.keyboard.press('Home');await page.waitForFunction(()=>document.querySelector('.m-direct-seek output')?.textContent==='0:00');
  await page.getByRole('button',{name:'Play',exact:true}).click();await page.waitForFunction(()=>document.title.startsWith('Playing'));
  const bounds=await range.boundingBox();
  await page.mouse.move(bounds.x+8,bounds.y+bounds.height/2);await page.mouse.down();
  const startsBefore=await page.evaluate(()=>window.__mobileStarts.length);
  await page.mouse.move(bounds.x+bounds.width*.4,bounds.y+bounds.height/2,{steps:4});
  assert.equal(await page.evaluate(()=>window.__mobileStarts.length),startsBefore,'scrub preview does not restart audio on each move');
  const preview=await page.locator('.m-direct-seek output').first().textContent();assert.ok(preview!=='0:00','drag previews target time');
  await page.mouse.up();await page.waitForFunction(count=>window.__mobileStarts.length>count,startsBefore);
  assert.equal(await page.evaluate(()=>window.__mobileStarts.length),startsBefore+1,'one seek on drag release');assert.ok((await page.title()).startsWith('Playing'));assert.equal(await page.locator('dialog[open]').count(),0);
  // A cancelled gesture leaves the engine on its current timeline.
  await range.dispatchEvent('pointerdown');const cancelledStarts=await page.evaluate(()=>window.__mobileStarts.length);await range.evaluate(input=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'22');input.dispatchEvent(new Event('input',{bubbles:true}));});await range.dispatchEvent('pointercancel');assert.equal(await page.evaluate(()=>window.__mobileStarts.length),cancelledStarts);
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  await range.focus();await page.keyboard.press('Home');assert.ok((await page.title()).startsWith('Ready'),'paused keyboard seek stays paused');
  await page.getByRole('button',{name:'Open navigation',exact:true}).click();
  assert.equal(await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Compare',exact:true}).count(),0,'comparison is part of Player');
  assert.equal(await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Settings',exact:true}).count(),0,'storage is a drawer');await page.keyboard.press('Escape');assert.equal(await page.getByRole('button',{name:'Open navigation',exact:true}).evaluate(button=>button===document.activeElement),true,'Escape restores menu trigger focus');
  // Focus must be a real stage/layout state, preserve audio, and always be escapable.
  const beforeFocusStarts=await page.evaluate(()=>{window.__focusCanvas=document.querySelector('.live2d-host canvas');return window.__mobileStarts.length;});
  await options(page);assert.equal(await page.getByRole('dialog').evaluate(node=>getComputedStyle(node).animationName),'m-sheet-enter');
  await page.getByRole('dialog').getByRole('button',{name:'Focus mode',exact:true}).click();
  await page.waitForSelector('.mobile-app.is-focus .live2d-stage.is-focused');
  assert.equal(await page.locator('.m-source-controls').getAttribute('inert'),'');
  assert.equal(await page.locator('.m-header').isVisible(),false);
  assert.equal(await page.locator('.m-focus-header').getByRole('button',{name:'Exit focus mode',exact:true}).isVisible(),true);
  assert.equal(await page.evaluate(()=>document.querySelector('.live2d-host canvas')===window.__focusCanvas),true,'focus keeps model instance');
  assert.equal(await page.evaluate(()=>window.__mobileStarts.length),beforeFocusStarts,'focus keeps paused audio state');
  await options(page);await page.keyboard.press('Escape');assert.equal(await page.locator('.mobile-app.is-focus').count(),1,'Escape dismisses panel before focus');
  await page.locator('.m-focus-header').getByRole('button',{name:'Exit focus mode',exact:true}).click();assert.equal(await page.locator('.live2d-stage.is-focused').count(),0);
  await navigate(page,'Library');assert.equal(await page.locator('.m-library-page').evaluate(node=>getComputedStyle(node).animationName),'m-page-enter');
  await options(page);await page.getByRole('dialog').getByRole('button',{name:'Focus mode',exact:true}).click();await page.waitForSelector('.mobile-app.is-focus .live2d-stage.is-focused');assert.equal(await page.locator('main').getAttribute('data-workspace'),'player','Library focus opens Player');
  await page.keyboard.press('Escape');assert.equal(await page.locator('.mobile-app.is-focus').count(),0);
  await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('button',{name:'Open navigation',exact:true}).click();assert.equal(await page.getByRole('dialog').evaluate(node=>getComputedStyle(node).animationName),'none','reduced motion disables entry animation');await close(page);await page.emulateMedia({reducedMotion:'no-preference'});
  for(const [button,preset] of [['Portrait camera','portrait'],['Wide camera','wide'],['Automatic camera','director']]) {
    await page.getByRole('button',{name:button,exact:true}).click();
    await page.waitForFunction(preset=>document.querySelector('.camera-capsule > button.is-active')?.textContent.trim().toLowerCase()===preset,preset);
    assert.equal(await page.getByRole('button',{name:button,exact:true}).getAttribute('aria-pressed'),'true','camera UI matches actual shared stage');
  }
  await options(page);await page.getByRole('button',{name:'Lyrics',exact:true}).click();assert.equal(await page.getByRole('dialog').locator('.m-lyrics button').count(),3,'matching LRC attached');await close(page);
  await page.getByRole('button',{name:'Play',exact:true}).click();await page.waitForFunction(()=>document.title.startsWith('Playing'));
  await page.locator('[aria-label="Playback position"]').evaluate(input=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'7');input.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.waitForFunction(()=>document.querySelector('.m-direct-seek output')?.textContent==='0:07');assert.equal(await page.locator('dialog[open]').count(),0,'direct seek never opens a panel');assert.ok((await page.title()).startsWith('Playing'),'seeking preserves playing state');
  await page.waitForFunction(()=>document.querySelector('.m-content .m-lyrics .is-current')?.textContent==='第二行歌词');
  await page.getByRole('button',{name:'Pause',exact:true}).click();

  await page.locator('[aria-label="Playback position"]').evaluate(input=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'12');input.dispatchEvent(new Event('input',{bubbles:true}));});await close(page);
  await page.waitForFunction(()=>{const box=document.querySelector('.m-content .m-lyrics-viewport'),row=box.querySelector('[aria-current="true"]');if(!row?.textContent.includes('A much longer'))return false;const a=box.getBoundingClientRect(),b=row.getBoundingClientRect();return Math.abs((a.top+a.bottom-b.top-b.bottom)/2)<3;});
  await page.locator('.m-content .m-lyrics-viewport').dispatchEvent('pointerdown');assert.equal(await page.getByRole('button',{name:'Follow current lyric',exact:true}).count(),1);await page.getByRole('button',{name:'Follow current lyric',exact:true}).click();
  await page.getByRole('button',{name:'Play',exact:true}).click();

  await page.getByRole('button',{name:'Pause',exact:true}).click();
  await navigate(page,'Player');await page.locator('.m-orbit-add').click({trial:true});
  const comparisonPicker=page.waitForEvent('filechooser');await page.locator('.m-orbit-add').click();await(await comparisonPicker).setFiles({name:'alternate.wav',mimeType:'audio/wav',buffer:waveBytes(30,440)});
  await page.waitForSelector('[aria-label="Listen to track 2"]');
  await page.getByRole('button',{name:'Play',exact:true}).click();await page.waitForFunction(()=>document.title.startsWith('Playing'));
  await listen(page,2);await page.waitForFunction(()=>document.querySelector('[aria-label="Listen to track 2"]')?.getAttribute('aria-pressed')==='true');
  assert.equal(await page.locator('dialog[open]').count(),0,'switching does not open tools');
  const offsetBefore=await page.evaluate(()=>window.__mobileStarts.at(-1).offset);
  const switchTimes=[];
  for(const number of [1,2,1,2,1,2]){
    await page.evaluate(number=>{window.__switchStart=performance.now();document.querySelector(`[aria-label="Listen to track ${number}"]`).addEventListener('click',()=>{window.__switchStart=performance.now();},{once:true});},number);
    await listen(page,number);await page.waitForFunction(number=>document.querySelector(`[aria-label="Listen to track ${number}"]`)?.getAttribute('aria-pressed')==='true',number,{polling:'raf'});
    switchTimes.push(await page.evaluate(()=>performance.now()-window.__switchStart));
    assert.ok((await page.title()).startsWith('Playing'),'playback continues during rapid switching');
    assert.equal(await page.locator('dialog[open]').count(),0);
  }
  const offsetAfter=await page.evaluate(()=>window.__mobileStarts.at(-1).offset);assert.ok(offsetAfter>=offsetBefore-.05,'source changes preserve playback clock');
  await page.getByRole('button',{name:'Pause',exact:true}).click();await listen(page,1);await openTools(page,1);
  await page.getByRole('button',{name:'Sound',exact:true}).click();await page.getByRole('combobox',{name:'EQ preset',exact:true}).selectOption('warm');await page.getByRole('button',{name:'Create comparison version',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.m-orbit-track[aria-pressed]').length===3&&!document.querySelector('dialog[open]'),{timeout:60000});
  await listen(page,3);await page.waitForFunction(()=>document.querySelector('[aria-label="Listen to track 3"]')?.getAttribute('aria-pressed')==='true');
  // Rotation/resizing must preserve source selection and playback state.
  await close(page);await page.setViewportSize({width:844,height:390});assert.equal(await page.locator('[aria-label="Listen to track 3"]').getAttribute('aria-pressed'),'true');await page.setViewportSize({width:390,height:844});
  const beforeNavigation=await page.evaluate(()=>window.__mobileStarts.length);await navigate(page,'Library');assert.equal(await page.getByRole('slider',{name:'Playback position',exact:true}).count(),1,'library retains direct transport');assert.equal(await page.evaluate(()=>window.__mobileStarts.length),beforeNavigation,'navigation does not recreate audio');await page.getByRole('button',{name:'Albums',exact:true}).click();await page.getByRole('button',{name:'New album',exact:true}).click();await page.getByRole('textbox',{name:'Album name',exact:true}).fill('Evening collection');await page.locator('.m-album-song-selection input').check();await page.getByRole('button',{name:'Save album',exact:true}).click();assert.equal(await page.locator('.m-album-card').count(),1);
  await page.waitForTimeout(500); // Allow the documented metadata-save debounce to commit before reload.
  await page.reload();await waitReady(page);await navigate(page,'Library');assert.equal(await page.locator('.m-song-row').count(),1,'cached mobile library restored');await page.getByRole('button',{name:'Play test-song',exact:true}).click();await page.waitForFunction(()=>document.title.startsWith('Playing'));await page.getByRole('button',{name:'Pause',exact:true}).click();await navigate(page,'Player');await page.waitForFunction(()=>document.querySelectorAll('.m-orbit-track[aria-pressed]').length===3);
  await page.getByRole('button',{name:'Play',exact:true}).click();await page.waitForFunction(()=>document.title.startsWith('Playing'));
  await page.evaluate(()=>{const read=window.FileReader.prototype.readAsArrayBuffer;window.FileReader.prototype.readAsArrayBuffer=function(blob){window.setTimeout(()=>read.call(this,blob),350);};});
  await listen(page,2);await page.waitForTimeout(60);await listen(page,1);await page.waitForTimeout(500);
  assert.equal(await page.locator('[aria-label="Listen to track 1"]').getAttribute('aria-pressed'),'true','a superseded cold read cannot change the selected track');
  const coldOffsetBefore=await page.evaluate(()=>window.__mobileStarts.at(-1).offset);
  await listen(page,3);await page.waitForTimeout(80);assert.equal(await page.locator('[aria-label="Listen to track 3"]').getAttribute('aria-busy'),'true','cold source shows a pending ring');
  assert.ok((await page.title()).startsWith('Playing'),'old audio stays playing during a cold read');
  assert.equal(await page.locator('[aria-label="Listen to track 1"]').getAttribute('aria-pressed'),'true');
  await page.waitForFunction(()=>document.querySelector('[aria-label="Listen to track 3"]')?.getAttribute('aria-pressed')==='true');
  const coldOffsetAfter=await page.evaluate(()=>window.__mobileStarts.at(-1).offset);assert.ok(coldOffsetAfter>coldOffsetBefore+.3,'cold source starts at the continuing clock');await page.getByRole('button',{name:'Pause',exact:true}).click();

  // Desktop sentinel survives mobile reset, including its OPFS directory.
  const expectedOpfs=await page.evaluate(async()=>{
    const request=indexedDB.open('vibloom-library',1);const db=await new Promise((resolve,reject)=>{request.onupgradeneeded=()=>request.result.createObjectStore('state');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});await new Promise(resolve=>{const tx=db.transaction('state','readwrite');tx.objectStore('state').put({sentinel:'desktop-untouched'},'library');tx.oncomplete=resolve;});db.close();
    try{const folder=await(await navigator.storage.getDirectory()).getDirectoryHandle('tracks',{create:true});const handle=await folder.getFileHandle('desktop-sentinel.audio',{create:true});try{const writer=await handle.createWritable();await writer.write('desktop-untouched');await writer.close();}catch{ /* WebKit may only support OPFS sync writers. Keep an empty sentinel. */ }return await(await handle.getFile()).text();}catch{ return null; /* Storage API unavailable: DB isolation is still checked. */ }
  });
  await navigate(page,'Queue');await page.getByRole('button',{name:'Clear queue only',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Clear queue only',exact:true}).click();assert.equal(await page.locator('.m-queue-row').count(),0);await close(page);
  await navigate(page,'Storage');await page.getByRole('button',{name:'Clear cached audio',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Clear cached audio',exact:true}).click();await waitReady(page);await page.waitForFunction(()=>!document.querySelector('.m-loading'));await page.waitForTimeout(700);
  await navigate(page,'Library');assert.equal(await page.locator('.m-song-row').count(),1,'clear cache preserves song index');await page.getByRole('button',{name:'Albums',exact:true}).click();assert.equal(await page.locator('.m-album-card').count(),1,'clear cache preserves albums');await navigate(page,'Player');assert.equal(await page.locator('.m-content .m-lyrics button').count(),3,'clear cache preserves lyrics');
  await navigate(page,'Storage');await page.getByRole('button',{name:'Clear mobile library',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Clear mobile library',exact:true}).click();await page.waitForTimeout(600);
  const sentinel=await page.evaluate(async()=>{
    const db=await new Promise(resolve=>{const request=indexedDB.open('vibloom-library',1);request.onsuccess=()=>resolve(request.result);});const value=await new Promise(resolve=>{const request=db.transaction('state').objectStore('state').get('library');request.onsuccess=()=>resolve(request.result);});db.close();let opfs=null;try{const file=await(await(await navigator.storage.getDirectory()).getDirectoryHandle('tracks')).getFileHandle('desktop-sentinel.audio');opfs=await(await file.getFile()).text();}catch{ /* Disabled OPFS. */ }return [value.sentinel,opfs];
  });assert.deepEqual(sentinel,['desktop-untouched',expectedOpfs],'mobile reset preserves desktop DB and any available OPFS sentinel');
  assert.deepEqual(errors,[],'no page errors');results.flows.push({engine:engineName,status:'passed',warmSwitchUiMs:switchTimes,clockOffsets:{before:offsetBefore,after:offsetAfter},coldClockOffsets:{before:coldOffsetBefore,after:coldOffsetAfter},rhythmDisc:{samples:rhythmDisc.length,minScale:Math.min(...rhythmDisc.map(sample=>sample.scale)),maxScale:Math.max(...rhythmDisc.map(sample=>sample.scale)),reducedScale},checks:['automatic routing','collapsed navigation + Escape focus return','persistent bottom transport in both workspaces','direct pointer drag seeks once on release','scrub previews time without restarting audio','cancelled drag preserves timeline','paused keyboard seek stays paused','two workspaces + queue/storage drawers','real Focus stage/layout + visible exit','Library focus enters Player','Focus preserves model and paused audio','Escape closes panel before focus','workspace/sheet entry motion + reduced motion','real Director/Portrait/Wide camera controls','paused seek centers current lyric','touch lyric browsing + follow','clear queue only','clear cache preserves songs/albums/lyrics','CSS isolation','file chooser tap','music+LRC import','play/pause','real audio-driven circular background','reduced motion','rapid switching without modal or playback restart','same audio clock','cold read keeps old audio playing','superseded cold reads never select late','EQ render','rotation retains source','album creation','cache restore','desktop DB sentinel isolation',...(sentinel[1]===null?['OPFS unavailable in this engine']:['desktop OPFS sentinel isolation'])]});
  await context.close();
}
async function checkRenders(engineName,browser){
  const sizes=process.argv.includes('--quick')?[[390,844]]:[[320,568],[360,800],[390,844],[430,932],[768,1024],[844,390]];
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,userAgent:engineName==='webkit'?iphone:android});const page=await context.newPage();page.on('pageerror',error=>results.errors.push({engine:engineName,pageError:error.message}));
  await page.goto(origin);await waitReady(page);await capture(page,engineName,390,844,'hong-xi','empty');
  await seedMobile(page,snapshot(),wave);
  for(const theme of ['hong-xi','hiyori']){
    for(const [width,height] of sizes){
      await page.setViewportSize({width,height});const fixture=snapshot(theme);await seedMobile(page,fixture,wave);await page.reload();await waitReady(page);
      await navigate(page,'Library');await capture(page,engineName,width,height,theme,'library');
      await page.getByRole('button',{name:'Import music',exact:true}).click();await capture(page,engineName,width,height,theme,'import');await close(page);
      await page.locator('.m-song-row').nth(1).getByRole('button',{name:/Options for/}).click();await capture(page,engineName,width,height,theme,'song-options');await page.getByRole('button',{name:'Remove from library',exact:true}).click();await capture(page,engineName,width,height,theme,'remove-song');await close(page);
      await page.getByRole('button',{name:'Open queue',exact:true}).click();await capture(page,engineName,width,height,theme,'queue');await page.getByRole('button',{name:'Clear queue only',exact:true}).click();await capture(page,engineName,width,height,theme,'clear-queue');await close(page);
      await page.getByRole('button',{name:'Albums',exact:true}).click();await capture(page,engineName,width,height,theme,'albums');await page.getByRole('button',{name:/Edit album Evening/}).click();await capture(page,engineName,width,height,theme,'edit-album');await page.getByRole('button',{name:'Delete album',exact:true}).click();await capture(page,engineName,width,height,theme,'delete-album');await close(page);await page.getByRole('button',{name:'New album',exact:true}).click();await page.getByRole('textbox',{name:'Album name',exact:true}).fill('A long album name · 长标题检查');await capture(page,engineName,width,height,theme,'album-editor');await close(page);
      await navigate(page,'Player');await capture(page,engineName,width,height,theme,'player');await page.getByRole('button',{name:'Open navigation',exact:true}).click();await capture(page,engineName,width,height,theme,'navigation');await close(page);await navigate(page,'Music companion');await capture(page,engineName,width,height,theme,'companion-camera');await close(page);await options(page);await page.getByRole('dialog').getByRole('button',{name:'Focus mode',exact:true}).click();await capture(page,engineName,width,height,theme,'focus');await options(page);await page.getByRole('dialog').getByRole('button',{name:'Exit focus mode',exact:true}).click();await options(page);await capture(page,engineName,width,height,theme,'listening-options');await page.getByRole('dialog').getByRole('button',{name:'Vocal lip sync',exact:true}).click();await capture(page,engineName,width,height,theme,'vocal-lip-sync');await close(page);await capture(page,engineName,width,height,theme,'direct-seek');await options(page);await page.getByRole('button',{name:'Adjust volume',exact:true}).click();await capture(page,engineName,width,height,theme,'volume');await close(page);await options(page);await page.getByRole('button',{name:'Lyrics',exact:true}).click();await capture(page,engineName,width,height,theme,'lyrics');await page.getByRole('button',{name:'Edit lyric timing',exact:true}).click();await capture(page,engineName,width,height,theme,'lyrics-editor');await close(page);
      await navigate(page,'Player');await capture(page,engineName,width,height,theme,'nine-versions');await page.getByRole('button',{name:'Show other comparison tracks',exact:true}).click();await capture(page,engineName,width,height,theme,'track-bank');await options(page);await page.getByRole('dialog').getByRole('button',{name:'Manage tracks',exact:true}).click();assert.equal(await page.locator('.m-managed-track').count(),9);await capture(page,engineName,width,height,theme,'manage-tracks');await close(page);await openTools(page,1);await capture(page,engineName,width,height,theme,'version-controls');await page.getByRole('button',{name:'Sound',exact:true}).click();await capture(page,engineName,width,height,theme,'eq');await page.getByRole('switch',{name:'Include mastering',exact:true}).check();await capture(page,engineName,width,height,theme,'mastering');await close(page);
      await openTools(page,1);await page.getByRole('button',{name:'Repair',exact:true}).click();await capture(page,engineName,width,height,theme,'repair');await close(page);
      await navigate(page,'Storage');await capture(page,engineName,width,height,theme,'storage');await page.getByRole('button',{name:'Clear cached audio',exact:true}).click();await capture(page,engineName,width,height,theme,'clear-cache');await close(page);await navigate(page,'Storage');await page.getByRole('button',{name:'Clear mobile library',exact:true}).click();await capture(page,engineName,width,height,theme,'clear-confirm');await close(page);
      // Narrowed visual viewport approximates available keyboard space; this is not a native keyboard test.
      await navigate(page,'Library');await page.getByRole('button',{name:'Albums',exact:true}).click();await page.getByRole('button',{name:'New album',exact:true}).click();await page.setViewportSize({width,height:Math.min(height,420)});await page.getByRole('textbox',{name:'Album name',exact:true}).focus();await capture(page,engineName,width,Math.min(height,420),theme,'short-input-viewport');await close(page);
      console.log(`${engineName} render ${width}×${height} ${theme} complete`);
    }
  }
  // Missing sources and long/unbroken file names remain actionable.
  const missing=snapshot();missing.tracks.forEach(track=>track.persistence='indexed');missing.tracks[0].comparisons.forEach(version=>version.persistence='indexed');await page.setViewportSize({width:390,height:844});await seedMobile(page,missing,wave);await page.reload();await waitReady(page);await navigate(page,'Library');await capture(page,engineName,390,844,'hong-xi','missing-sources');await navigate(page,'Player');await openTools(page,2);await capture(page,engineName,390,844,'hong-xi','missing-version');await close(page);
  await context.close();
}
async function checkDesktop(browser){
  const context=await browser.newContext({viewport:{width:1440,height:1000}});const baseline=await context.newPage(),current=await context.newPage();
  await baseline.goto(origin+'/baseline/');await current.goto(origin+'/');
  const ready=page=>page.waitForFunction(()=>document.querySelector('.companion-selector [role="combobox"]')?.disabled===false);await Promise.all([ready(baseline),ready(current)]);
  for(const width of [1440,1024,600,390]){
    await Promise.all([baseline.setViewportSize({width,height:1000}),current.setViewportSize({width,height:1000})]);await Promise.all([baseline.waitForTimeout(200),current.waitForTimeout(200)]);
    const geometry=page=>page.evaluate(()=>['.library-header','.library-welcome','.welcome-import-primary','.library-welcome-stage','.library-header .brand','.library-header-actions'].map(selector=>{const rect=document.querySelector(selector)?.getBoundingClientRect();return {selector,rect:rect?[rect.x,rect.y,rect.width,rect.height].map(n=>Math.round(n*100)/100):null};}));
    const a=await geometry(baseline),b=await geometry(current);assert.deepEqual(b,a,`desktop geometry unchanged at ${width}`);
    const mobileCss=await current.evaluate(()=>document.body.dataset.vibloomUi==='mobile');assert.equal(mobileCss,false,'narrow desktop stays original');
    if(width===1440){await baseline.screenshot({path:path.join(output,'screenshots','desktop-before.jpg'),type:'jpeg',quality:75});await current.screenshot({path:path.join(output,'screenshots','desktop-after.jpg'),type:'jpeg',quality:75});}
    results.desktop.push({width,status:'passed',geometry:b});
  }
  await context.close();
}
let code=0;
try {
  for(const [name,engine] of Object.entries({chromium,webkit})){
    const browser=await engine.launch({headless:true});results.engines.push(name);
    try {await checkFlow(name,browser);if(!process.argv.includes('--flow-only'))await checkRenders(name,browser);if(name==='chromium')await checkDesktop(browser);}
    catch(error){
      const page=browser.contexts()[0]?.pages()[0];
      if(page){
        await page.screenshot({path:path.join(output,`failure-${name}.png`)}).catch(()=>{});
        const details=await page.evaluate(()=>({
          width:window.innerWidth,height:window.innerHeight,scrollY:window.scrollY,
          visual:{height:window.visualViewport.height,offsetTop:window.visualViewport.offsetTop,scale:window.visualViewport.scale},
          buttons:[...document.querySelectorAll('.m-bottom-nav button')].map(button=>{
            const r=button.getBoundingClientRect();
            return {rect:[r.x,r.y,r.width,r.height],atPoint:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML.slice(0,250)};
          }),html:document.querySelector('.m-content')?.innerHTML
        }));
        await writeFile(path.join(output,`failure-${name}.json`),JSON.stringify(details,null,2));
      }
      results.errors.push({engine:name,error:error.stack});console.error(name,error);code=1;
    }
    finally {await browser.close();}
  }
  if(results.errors.length)code=1;
}finally{
  results.finishedAt=new Date().toISOString();results.status=code?'failed':'passed';await writeFile(path.join(output,'audit-results.json'),JSON.stringify(results,null,2));server.close();
}
console.log(JSON.stringify({status:results.status,flows:results.flows.length,renders:results.renders.length,desktop:results.desktop.length,errors:results.errors.length}));
process.exitCode=code;
