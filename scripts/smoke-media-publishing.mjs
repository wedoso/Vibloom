import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ts from 'typescript';

const profile = await mkdtemp(path.join(tmpdir(), 'vibloom-media-publishing-'));
app.setPath('userData', profile);
app.on('window-all-closed', () => {});
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(compile(source)).toString('base64')}`;
const sources = await Promise.all(['mediaArtwork', 'mediaPositionPublisher', 'mediaSession', 'mediaSessionLyrics'].map(name => readFile(new URL(`../src/platform/${name}.ts`, import.meta.url), 'utf8')));
const artworkUrl = moduleUrl(sources[0]), positionUrl = moduleUrl(sources[1].replace('from "./mediaSession"', `from ${JSON.stringify(moduleUrl(sources[2]))}`)), lyricsUrl = moduleUrl(sources[3]);
let window, exitCode = 0;
const deadline = setTimeout(() => { console.error('Media publishing smoke timed out'); app.exit(1); }, 30000);
async function smoke() {
try {
  await app.whenReady();
  window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  await window.loadURL('data:text/html,<title>Media publishing smoke</title>');
  const result = await window.webContents.executeJavaScript(`(async () => {
    const {prepareMediaArtwork} = await import(${JSON.stringify(artworkUrl)});
    const {createMediaPositionPublisher} = await import(${JSON.stringify(positionUrl)});
    const {bindMediaSessionLyrics} = await import(${JSON.stringify(lyricsUrl)});
    const original = document.createElement('canvas'); original.width = 4000; original.height = 2500;
    const ctx = original.getContext('2d'), gradient = ctx.createLinearGradient(0,0,4000,2500);
    gradient.addColorStop(0, '#104a7c'); gradient.addColorStop(1, '#edcb95'); ctx.fillStyle = gradient; ctx.fillRect(0,0,4000,2500);
    const source = original.toDataURL('image/png');
    const artwork = await prepareMediaArtwork(source, new AbortController().signal);
    const image = new Image(); image.src = artwork.src; await image.decode();
    navigator.mediaSession.metadata = new MediaMetadata({title:'Real canvas cover', artist:'Vibloom', album:'Smoke', artwork:[artwork]});
    const metadata = navigator.mediaSession.metadata;
    const nativePosition = navigator.mediaSession.setPositionState.bind(navigator.mediaSession), positions = [];
    navigator.mediaSession.setPositionState = value => { positions.push(value); nativePosition(value); };
    const started = performance.now();
    const getTime = () => (performance.now() - started) / 1000;
    const state = {trackId:'smoke',title:metadata.title,album:metadata.album,duration:120,isPlaying:true,positionRevision:0};
    const publisher = createMediaPositionPublisher(navigator.mediaSession,getTime);
    publisher.update(state);
    await new Promise(resolve => { const timer = setInterval(() => { publisher.update(state); if(getTime()>1.15) {clearInterval(timer);resolve();} },100); });
    const regularWrites = positions.length;
    const lyrics = bindMediaSessionLyrics(metadata,[{time:0,text:'Current lyric'}],getTime,120,false,document,()=>publisher.update(state,true));
    const changedWrites = positions.length; lyrics.refresh(); lyrics.refresh(); lyrics.dispose();
    return {width:image.naturalWidth,height:image.naturalHeight,mime:artwork.type,sizes:artwork.sizes,jpeg:artwork.src.startsWith('data:image/jpeg;'),bytes:artwork.src.length,regularWrites,changedWrites,totalWrites:positions.length,stable:navigator.mediaSession.metadata===metadata,artist:metadata.artist,cover:navigator.mediaSession.metadata.artwork[0].src===artwork.src};
  })()`, true);
  assert.equal(result.width, 512); assert.equal(result.height, 512);
  assert.equal(result.mime, 'image/jpeg'); assert.equal(result.sizes, '512x512'); assert.equal(result.jpeg, true);
  assert.ok(result.bytes < 150000, 'system cover stays small');
  assert.equal(result.regularWrites, 2, 'native position receives 1 Hz updates');
  assert.equal(result.changedWrites, 3); assert.equal(result.totalWrites, 3, 'unchanged lyrics do not republish');
  assert.equal(result.stable, true); assert.equal(result.artist, 'Current lyric'); assert.equal(result.cover, true);
  console.log('PASS real canvas JPEG decode, native MediaMetadata artwork, 1 Hz native position updates and stable lyric/cover metadata');
  console.log(JSON.stringify(result));
} catch (error) { console.error(error); exitCode = 1; }
finally { clearTimeout(deadline); window?.destroy(); try { await rm(profile, {recursive:true,force:true,maxRetries:3}); } finally { app.exit(exitCode); } }
}
void smoke();
