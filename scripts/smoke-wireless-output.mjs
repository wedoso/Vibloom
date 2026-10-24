import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshot, waveBytes } from './mobile-ui-fixtures.mjs';

// Real mobile UI/transport with an injected output timestamp. This verifies
// delayed-output semantics; it does not emulate WebKit or an actual HomePod.
const root = fileURLToPath(new URL('../dist/', import.meta.url));
const profile = await mkdtemp(path.join(tmpdir(), 'vibloom-wireless-'));
app.setPath('userData', profile); app.on('window-all-closed', () => {});
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.wasm':'application/wasm', '.webmanifest':'application/manifest+json' };
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://local').pathname;
    if (pathname === '/__fixture__') { response.setHeader('Content-Type','text/html'); response.end('<!doctype html><title>Fixture setup</title>'); return; }
    const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(root)) throw new Error('Invalid path');
    response.setHeader('Content-Type', mime[path.extname(file)] ?? 'application/octet-stream'); response.end(await readFile(file));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let window, exitCode = 0;
const deadline = setTimeout(() => { console.error('Wireless output smoke timed out'); app.exit(1); }, 90000);
async function smoke() {
try {
  await app.whenReady(); console.log('READY Electron');
  window = new BrowserWindow({ width:390, height:844, show:false, webPreferences:{ sandbox:true, contextIsolation:true, nodeIntegration:false, backgroundThrottling:false } });
  window.webContents.setAudioMuted(true);
  window.webContents.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148');
  await window.loadURL(`${origin}/__fixture__`);
  window.webContents.debugger.attach('1.3');
  await window.webContents.debugger.sendCommand('Page.enable');
  await window.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `
    Object.defineProperty(navigator,'audioSession',{value:{type:'auto'},configurable:true});
    window.__holdOutput=true; window.__mediaActions={}; window.__positions=[]; window.__audioElements=0; window.__audioInstances=[]; window.__lyricWrites=[];
    const artist=Object.getOwnPropertyDescriptor(MediaMetadata.prototype,'artist');
    Object.defineProperty(MediaMetadata.prototype,'artist',{...artist,set(value){window.__lyricWrites.push(value);artist.set.call(this,value);}});
    window.Audio=new Proxy(window.Audio,{construct(target,args){window.__audioElements++;const audio=Reflect.construct(target,args);window.__audioInstances.push(audio);return audio;}});
    AudioContext.prototype.getOutputTimestamp=function(){return {contextTime:window.__holdOutput?0:Math.max(0,this.currentTime-2),performanceTime:performance.now()};};
    const start=AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start=function(...args){window.__sourceStart=args;window.__musicContext=this.context;return start.apply(this,args);};
    const handler=MediaSession.prototype.setActionHandler,position=MediaSession.prototype.setPositionState;
    MediaSession.prototype.setActionHandler=function(action,callback){window.__mediaActions[action]=callback;return handler.call(this,action,callback);};
    MediaSession.prototype.setPositionState=function(value){window.__positions.push(value);return position.call(this,value);};
  ` });
  console.log('READY clock instrumentation');
  const run = code => window.webContents.executeJavaScript(code, true);
  const wait = async (code, label) => { console.log(`WAIT ${label}`); for (let i=0;i<250;i++) { if(await run(code))return; await delay(100); } throw new Error(`Timeout: ${label}; ${await run(`JSON.stringify({ui:document.body.innerText.slice(0,300),state:navigator.mediaSession.playbackState,position:document.querySelector('[aria-label="Playback position"]')?.value})`)}`); };
  const library = snapshot(); library.tracks=[library.tracks[0]]; library.tracks[0].comparisons=[]; library.tracks[0].comparison=null;
  const fastLyrics=Array.from({length:8},(_,index)=>({time:5+index*.08,text:'Rapid '+index}));
  library.tracks[0].lyrics=[{time:0,text:'Beginning'},{time:1,text:'After output starts'},...fastLyrics]; library.albums=[];
  Object.assign(library.session,{currentTime:0,queue:[library.tracks[0].id],repeat:'off'});
  await run(`(async()=>{const r=indexedDB.open('vibloom-mobile-library',2);r.onupgradeneeded=()=>{for(const name of ['state','audio'])r.result.createObjectStore(name);};const db=await new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});await new Promise((resolve,reject)=>{const tx=db.transaction(['state','audio'],'readwrite');tx.objectStore('state').put(${JSON.stringify(library)},'library');tx.objectStore('audio').put({bytes:new Uint8Array(${JSON.stringify([...waveBytes(30)])}).buffer,type:'audio/wav'},${JSON.stringify(library.tracks[0].id)});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();})()`);
  console.log('READY seeded library');
  await window.loadURL(`${origin}/?ui=mobile`); await wait(`document.querySelector('.m-play-main')`,'mobile restored');
  await run(`document.querySelector('.m-play-main').click()`);
  await wait(`window.__musicContext && document.querySelector('.m-play-main[aria-label="Pause"]:not(:disabled)')`,'transport started');
  await delay(1600);
  assert.equal(await run(`navigator.audioSession.type`),'playback');
  assert.equal(await run(`window.__audioElements`),1,'WebKit keeps one empty metadata observer');
  assert.equal(await run(`window.__audioInstances.every(audio=>audio.paused && !audio.getAttribute('src') && audio.currentSrc==='' && audio.preload==='none')`),true,'metadata observer has no playable source or output timeline');
  assert.equal(await run(`Number(document.querySelector('[aria-label="Playback position"]').value)`),0,'UI waits for output while render clock advances');
  assert.equal(await run(`navigator.mediaSession.playbackState`),'paused');
  assert.equal(await run(`navigator.mediaSession.metadata.artist`),'Beginning');
  await run(`window.__holdOutput=false`);
  await wait(`Number(document.querySelector('[aria-label="Playback position"]').value)>1 && navigator.mediaSession.playbackState==='playing'`,'output advancing');
  const drift = await run(`Math.abs(window.__positions.at(-1).position-Number(document.querySelector('[aria-label="Playback position"]').value))`);
  assert.ok(drift<1.2,'system progress and UI use the same output clock');
  assert.equal(await run(`window.__positions.at(-1).duration`),30);
  await wait(`navigator.mediaSession.metadata.artist==='Rapid 7'`,'rapid lyric boundaries');
  assert.deepEqual(await run(`window.__lyricWrites.filter(value=>value.startsWith('Rapid '))`),fastLyrics.map(line=>line.text),'each short lyric reaches native metadata');
  console.log('PASS real mobile UI publishes every 80 ms lyric to native MediaMetadata');
  await run(`window.__mediaActions.seekto({seekTime:20})`);
  await wait(`Math.abs(Number(document.querySelector('[aria-label="Playback position"]').value)-20)<.1 && navigator.mediaSession.playbackState==='paused'`,'seek holds requested position during output delay');
  await wait(`Number(document.querySelector('[aria-label="Playback position"]').value)>20.2 && navigator.mediaSession.playbackState==='playing'`,'seek output resumed');
  await run(`window.__mediaActions.pause({})`);
  await wait(`document.querySelector('.m-play-main[aria-label="Play"]')`,'system pause');
  const paused = await run(`Number(document.querySelector('[aria-label="Playback position"]').value)`);
  await delay(500);
  assert.equal(await run(`Number(document.querySelector('[aria-label="Playback position"]').value)`),paused);
  await run(`window.__mediaActions.play({})`);
  await wait(`document.querySelector('.m-play-main[aria-label="Pause"]:not(:disabled)')`,'system resume');
  assert.ok(Math.abs(await run(`Number(document.querySelector('[aria-label="Playback position"]').value)`)-paused)<.1,'resume retains heard position');
  assert.equal(await run(`window.__audioInstances.every(audio=>audio.paused && !audio.getAttribute('src') && audio.currentSrc==='')`),true,'observer stays inert across output delay, seek and pause/resume');
  console.log('PASS simulated delayed output: real mobile UI, lyrics and system position share the output clock; no competing WebKit carrier; seek and pause/resume retain heard position');
} catch(error) { console.error(error); exitCode=1; }
finally { clearTimeout(deadline); window?.destroy(); server.close(); server.closeAllConnections(); await rm(profile,{recursive:true,force:true,maxRetries:3}); app.exit(exitCode); }
}
void smoke();
