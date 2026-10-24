import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { waveBytes } from './mobile-ui-fixtures.mjs';

const root = process.env.VIBLOOM_TEST_DIST ? path.resolve(process.env.VIBLOOM_TEST_DIST) : fileURLToPath(new URL('../dist/', import.meta.url));
const profile = await mkdtemp(path.join(tmpdir(), 'vibloom-shuffle-'));
app.setPath('userData', profile);
app.on('window-all-closed', () => {});
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm' };
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://local').pathname;
    if (pathname === '/__fixture__') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Fixture setup</title>'); return; }
    const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(root)) throw new Error('Invalid path');
    response.setHeader('Content-Type', mime[path.extname(file)] ?? 'application/octet-stream');
    response.end(await readFile(file));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let window, exitCode = 0;
const deadline = setTimeout(() => { console.error('Shuffle queue smoke timed out'); app.exit(1); }, 120000);
async function smoke() {
try {
  await app.whenReady();
  console.log('READY Electron shuffle regression');
  window = new BrowserWindow({ width: 1280, height: 900, show: process.env.CI === 'true', webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  window.webContents.setAudioMuted(true);
  await window.loadURL(`${origin}/__fixture__`);
  window.webContents.debugger.attach('1.3');
  await window.webContents.debugger.sendCommand('Page.enable');
  await window.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `
    Math.random=()=>.999;
    window.__mediaActions={};
    const register=MediaSession.prototype.setActionHandler;
    MediaSession.prototype.setActionHandler=function(action,handler){window.__mediaActions[action]=handler;return register.call(this,action,handler);};
  ` });
  const run = code => window.webContents.executeJavaScript(code, true);
  const wait = async (code, label) => {
    console.log(`WAIT ${label}`);
    for (let i = 0; i < 150; i++) { if (await run(code)) return; await delay(100); }
    throw new Error(`Timeout: ${label}; ${await run(`JSON.stringify({title:navigator.mediaSession.metadata?.title,state:navigator.mediaSession.playbackState,message:document.querySelector('.library-status')?.textContent})`)}`);
  };
  const click = selector => run(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const tracks = ['a', 'b', 'c'].map(id => ({ id, fingerprint: id, name: `Shuffle ${id}.wav`, relativePath: `Shuffle ${id}.wav`, sourceLabel: 'Queue regression', size: waveBytes(20).length, lastModified: 1, duration: 20, availability: 'available', persistence: 'cached', lyrics: [], lyricsFileName: '', comparison: null }));
  await run(`(async()=>{
    const bytes=new Uint8Array(${JSON.stringify([...waveBytes(20)])}), dir=await(await navigator.storage.getDirectory()).getDirectoryHandle('tracks',{create:true});
    for(const id of ['a','b','c']){const writer=await(await dir.getFileHandle(id+'.audio',{create:true})).createWritable();await writer.write(bytes);await writer.close();}
    const r=indexedDB.open('vibloom-library',1);r.onupgradeneeded=()=>r.result.createObjectStore('state');
    const db=await new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    await new Promise((resolve,reject)=>{const tx=db.transaction('state','readwrite');tx.objectStore('state').put({version:3,tracks:${JSON.stringify(tracks)},albums:[],session:{queue:['a'],history:[],currentTrackId:'a',currentTime:0,shuffle:false,repeat:'off',volume:.4,cacheEnabled:true,companionId:'hong-xi'}},'library');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
  })()`);
  await window.loadURL(`${origin}/?ui=desktop`);
  await wait(`document.querySelector('.transport-play') && document.querySelector('[aria-label="Playback position"]')?.max==='20'`, 'desktop restored');
  const playing = title => wait(`navigator.mediaSession.metadata?.title===${JSON.stringify(title)} && document.querySelector('.transport-play[aria-label="Pause"]')`, `playing ${title}`);
  const finish = async () => { await run(`window.__mediaActions.seekto({seekTime:19.8})`); await delay(600); };
  const action = async (id, text) => {
    if (await run(`!!document.querySelector('.open-library-button')`)) await click('.open-library-button');
    await wait(`document.querySelector('[data-track-id="${id}"] .track-menu-wrap > button')`, 'library row');
    await click(`[data-track-id="${id}"] .track-menu-wrap > button`);
    await wait(`document.querySelector('.track-action-popover:popover-open')`, 'track actions');
    await run(`[...document.querySelectorAll('.track-action-popover button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`);
  };
  await click('.transport-play'); await playing('Shuffle a');
  await click('[aria-label="Shuffle"]');
  await action('b', 'Add to queue');
  await finish(); await playing('Shuffle b');
  console.log('PASS song appended after shuffle started plays at natural track end');
  // Explicit play-next can requeue a song already heard in this cycle.
  await action('c', 'Add to queue');
  await action('a', 'Play next');
  await finish(); await playing('Shuffle a');
  await finish(); await playing('Shuffle c');
  await finish();
  await wait(`document.querySelector('.transport-play[aria-label="Play"]')`, 'finite shuffle cycle completed');
  assert.equal(await run(`navigator.mediaSession.metadata?.title`), 'Shuffle c');
  console.log('PASS play-next priority and remaining songs; repeat off stops after the cycle');
  // Remove every other song, then enable repeat-all without toggling shuffle.
  await run(`[...document.querySelectorAll('.transport-secondary button')].find(b=>b.textContent.trim()==='Queue').click()`);
  await wait(`document.querySelector('.queue-sheet').parentElement.classList.contains('is-open')`, 'queue open');
  for (const name of ['Shuffle a', 'Shuffle b']) await run(`[...document.querySelectorAll('.queue-list > div')].find(row=>row.querySelector('strong')?.textContent===${JSON.stringify(name)}).querySelector('[aria-label="Remove from queue"]').click()`);
  await click('[aria-label="Close queue"]');
  await click('[aria-label="Repeat off"]');
  await click('.transport-play'); await playing('Shuffle c');
  await finish(); await playing('Shuffle c');
  await wait(`Number(document.querySelector('[aria-label="Playback position"]').value)<3`, 'single song restarted');
  assert.equal(await run(`document.querySelector('[aria-label="Shuffle"]').getAttribute('aria-pressed')`), 'true');
  console.log('PASS single-song shuffle repeats in repeat-all mode');
  // A restored shuffle session has no in-memory bag yet. Play next must not
  // replace all the other unplayed songs with just its requested song.
  await window.loadURL(`${origin}/__fixture__`);
  await run(`(async()=>{const r=indexedDB.open('vibloom-library',1);const db=await new Promise(resolve=>r.onsuccess=()=>resolve(r.result));await new Promise(resolve=>{const tx=db.transaction('state','readwrite');tx.objectStore('state').delete('session');tx.objectStore('state').put({version:3,tracks:${JSON.stringify(tracks)},albums:[],session:{queue:['a','b','c'],history:[],currentTrackId:'a',currentTime:0,shuffle:true,repeat:'off',volume:.4,cacheEnabled:true,companionId:'hong-xi'}},'library');tx.oncomplete=resolve;});db.close();})()`);
  await window.loadURL(`${origin}/?ui=desktop`);
  await wait(`document.querySelector('[aria-label="Playback position"]')?.max==='20'`, 'restored shuffle preload');
  await click('.transport-play'); await playing('Shuffle a');
  await action('c', 'Play next');
  await finish(); await playing('Shuffle c');
  await finish(); await playing('Shuffle b');
  await finish();
  await wait(`document.querySelector('.transport-play[aria-label="Play"]')`, 'restored cycle completed');
  console.log('PASS restored shuffle play-next preserves every remaining song');
  await click('[aria-label="Shuffle"]'); await click('[aria-label="Shuffle"]');
  await click('.transport-play'); await playing('Shuffle b');
  await run(`[...document.querySelectorAll('.transport-secondary button')].find(b=>b.textContent.trim()==='Queue').click()`);
  await wait(`document.querySelector('.queue-sheet').parentElement.classList.contains('is-open')`, 'queue removal');
  await run(`[...document.querySelectorAll('.queue-list > div')].find(row=>row.querySelector('strong')?.textContent==='Shuffle a').querySelector('[aria-label="Remove from queue"]').click()`);
  await click('[aria-label="Close queue"]');
  await finish(); await playing('Shuffle c');
  await finish();
  await wait(`document.querySelector('.transport-play[aria-label="Play"]')`, 'removed song skipped');
  assert.equal(await run(`navigator.mediaSession.metadata?.title`), 'Shuffle c');
  console.log('PASS removed songs leave the active shuffle cycle');
  await click('[aria-label="Shuffle"]'); await click('[aria-label="Shuffle"]');
  await run(`[...document.querySelectorAll('.transport-secondary button')].find(b=>b.textContent.trim()==='Queue').click()`);
  await wait(`document.querySelector('.queue-sheet').parentElement.classList.contains('is-open')`, 'manual queue selection');
  await run(`[...document.querySelectorAll('.queue-list > div')].find(row=>row.querySelector('strong')?.textContent==='Shuffle b').querySelector('button').click()`);
  await click('[aria-label="Close queue"]');
  await playing('Shuffle b');
  await finish();
  await wait(`document.querySelector('.transport-play[aria-label="Play"]')`, 'manual song consumed');
  assert.equal(await run(`navigator.mediaSession.metadata?.title`), 'Shuffle b');
  console.log('PASS manual queue selection consumes the song without an extra repeat');
} catch (error) { console.error(error); exitCode = 1; }
finally {
  clearTimeout(deadline); window?.destroy(); server.close(); server.closeAllConnections();
  await rm(profile, { recursive: true, force: true, maxRetries: 3 }); app.exit(exitCode);
}
}
void smoke();
