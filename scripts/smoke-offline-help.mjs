import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshot, waveBytes } from './mobile-ui-fixtures.mjs';
const root=fileURLToPath(new URL('../dist/',import.meta.url));
const profile=await mkdtemp(path.join(tmpdir(),'vibloom-offline-help-'));
const output=fileURLToPath(new URL('../outputs/offline-help/',import.meta.url));
app.setPath('userData',profile);app.on('window-all-closed',()=>{});
let updated=false;
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.css':'text/css','.wasm':'application/wasm','.webmanifest':'application/manifest+json'};
const server=createServer(async(request,response)=>{
  try {
    const pathname=decodeURIComponent(new URL(request.url,'http://local').pathname);
    if(!pathname.startsWith('/Vibloom/'))throw new Error('outside scope');
    const relative=pathname.slice('/Vibloom/'.length)||'index.html',file=path.resolve(root,relative);
    if(!file.startsWith(root))throw new Error('outside root');
    let bytes=await readFile(file);if(relative==='sw.js'&&updated)bytes=Buffer.from(bytes.toString().replace(/const BUILD = "[^"]+";/,'const BUILD = "smoke-update";'));
    response.setHeader('Content-Type',mime[path.extname(file)]??'application/octet-stream');response.setHeader('Cache-Control','no-store');response.end(bytes);
  }catch {response.writeHead(404);response.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/Vibloom/?ui=mobile`;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let window,exitCode=0;
const deadline=setTimeout(()=>{console.error('Offline/help smoke timed out');app.exit(1);},90000);
async function smoke(){
  try {
    await app.whenReady();await mkdir(output,{recursive:true});await mkdir(path.join(profile,'downloads'));
    window=new BrowserWindow({width:390,height:844,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
    window.webContents.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 Version/18.4 Mobile/15E148 Safari/604.1');
    window.webContents.setAudioMuted(true);
    const run=code=>window.webContents.executeJavaScript(code,true);
    const wait=async(code,label)=>{for(let i=0;i<250;i++){if(await run(code))return;await delay(100);}throw new Error(`Timeout: ${label}`);};
    const click=selector=>run(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const text=label=>run(`(()=>{const target=[...document.querySelectorAll('dialog[open] button')].find(button=>button.textContent.trim()===${JSON.stringify(label)});if(!target)throw new Error('Button missing');target.click();})()`);
    const storage=async()=>{await click('[aria-label="Open navigation"]');await click('[aria-label="Storage"]');};
    await window.loadURL(url);await wait(`document.querySelector('[data-picker="files"]')`,'mobile loaded');
    await wait(`(async()=>{const r=await navigator.serviceWorker.getRegistration();return !!r?.active && !!navigator.serviceWorker.controller;})()`,'offline shell installed');
    await delay(600);
    const library=snapshot();library.tracks=[library.tracks[0]];library.tracks[0].comparisons=[];library.tracks[0].comparison=null;library.albums=[];library.session.queue=[library.tracks[0].id];library.session.repeat='all';
    library.tracks[0].lyrics=[{time:0,text:'First lyric'},{time:2,text:'Second lyric'}];
    const bytes=[...waveBytes(30)];
    await run(`(async()=>{const request=indexedDB.open('vibloom-mobile-library',2);const db=await new Promise(resolve=>request.onsuccess=()=>resolve(request.result));await new Promise((resolve,reject)=>{const tx=db.transaction(['state','audio'],'readwrite');tx.objectStore('state').put(${JSON.stringify(library)},'library');tx.objectStore('state').delete('session');tx.objectStore('audio').put({bytes:new Uint8Array(${JSON.stringify(bytes)}).buffer,type:'audio/wav'},${JSON.stringify(library.tracks[0].id)});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();})()`);
    await window.loadURL(url);await wait(`document.querySelector('.m-play-main')`,'restored song');await storage();
    await wait(`document.querySelector('[aria-label="Offline access"]')?.textContent.includes('Ready to open offline')`,'offline ready status');
    await delay(350);await writeFile(path.join(output,'storage.png'),(await window.webContents.capturePage()).toPNG());await click('[aria-label="Close panel"]');
    await click('[aria-label="Listening options"]');
    await click('[aria-label="Lock-screen & car lyrics"]');await wait(`navigator.mediaSession.metadata?.artist==='Vibloom'`,'system lyrics disabled');
    await text('Lyrics');await wait(`document.querySelector('[aria-label="Edit lyric timing"]')`,'direct lyric actions');
    assert.equal(await run(`!![...document.querySelectorAll('dialog[open] button')].find(b=>b.textContent.trim()==='Export TXT')`),true);
    await delay(350);await writeFile(path.join(output,'lyrics.png'),(await window.webContents.capturePage()).toPNG());await click('[aria-label="Close panel"]');
    await delay(450);await window.loadURL(url);await wait(`document.querySelector('.m-play-main')`,'reload preference');
    await click('[aria-label="Listening options"]');assert.equal(await run(`document.querySelector('[aria-label="Lock-screen & car lyrics"]').checked`),false);
    await click('[aria-label="Lock-screen & car lyrics"]');await wait(`navigator.mediaSession.metadata?.artist!=='Vibloom'`,'system lyrics enabled');await click('[aria-label="Close panel"]');
    // Cause one real transport failure, then use the visible help/retry action.
    await run(`(()=>{const original=AudioBufferSourceNode.prototype.start;window.__failStart=true;AudioBufferSourceNode.prototype.start=function(...args){if(window.__failStart)throw new DOMException('private filename must never enter diagnostics','NotAllowedError');return original.apply(this,args);};Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.__copiedDiagnostics=text;}}});})()`);
    await click('.m-play-main');await wait(`document.querySelector('.playback-problem')`,'persistent playback error');await click('.playback-problem');
    await wait(`document.querySelector('.playback-help[open]')`,'help dialog');
    await text('Copy diagnostics');await wait(`!!window.__copiedDiagnostics`,'privacy report copied');
    assert.doesNotMatch(await run(`window.__copiedDiagnostics`),/private filename|fixture|wav|First lyric/);
    await delay(150);await writeFile(path.join(output,'playback-help.png'),(await window.webContents.capturePage()).toPNG());
    await run(`window.__failStart=false`);await text('Retry playback');await wait(`navigator.mediaSession.playbackState==='playing'`,'retry starts audio');
    // Update installation must leave a playing document alive until requested.
    await run(`window.__beforeUpdate=true`);updated=true;
    await run(`(async()=>{await(await navigator.serviceWorker.getRegistration()).update();})()`);
    await wait(`(async()=>!!(await navigator.serviceWorker.getRegistration()).waiting)()`,'waiting update');await storage();
    await wait(`[...document.querySelectorAll('button')].some(b=>b.textContent==='Update & reload')`,'update prompt');
    assert.equal(await run(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Update & reload').disabled`),true);
    assert.equal(await run(`window.__beforeUpdate`),true);assert.equal(await run(`navigator.mediaSession.playbackState`),'playing');
    await click('[aria-label="Close panel"]');await click('.m-play-main');await storage();await text('Update & reload');
    await wait(`!window.__beforeUpdate && !!document.querySelector('.m-play-main')`,'explicit update reload');
    await wait(`(async()=>{const names=await caches.keys();return names.includes('vibloom-shell:/Vibloom/:smoke-update');})()`,'new shell activated');
    // Remove HTTP cache and network so a successful cold reload must use SW.
    await window.webContents.session.clearCache();server.close();server.closeAllConnections();window.webContents.session.enableNetworkEmulation({offline:true});
    await window.loadURL(url);await wait(`document.querySelector('.m-play-main')`,'offline cold startup');
    await wait(`document.querySelector('.live2d-stage[data-status="ready"]')`,'offline companion');
    await click('.m-play-main');await wait(`navigator.mediaSession.playbackState==='playing'`,'offline cached audio');
    await storage();await wait(`document.querySelector('[aria-label="Offline access"]')?.textContent.includes('Ready to open offline') || document.querySelector('[aria-label="Offline access"]')?.textContent.includes('Offline ·')`,'offline status');
    await writeFile(path.join(output,'offline.png'),(await window.webContents.capturePage()).toPNG());
    await window.loadURL(url.replace('ui=mobile','ui=desktop'));
    await wait(`document.querySelector('.library-app')`,'desktop offline startup');
    await wait(`document.querySelector('.live2d-stage[data-status="ready"]')`,'desktop offline companion');
    console.log('PASS subpath mobile/desktop offline startup with network+HTTP cache disabled, cached music/models, deferred updates, lyric shortcuts, persisted car switch, private diagnostics and actual retry');
  }catch(error){console.error(error);exitCode=1;}
  finally{clearTimeout(deadline);window?.destroy();server.close();try{await rm(profile,{recursive:true,force:true,maxRetries:3});}finally{app.exit(exitCode);}}
}
void smoke();
