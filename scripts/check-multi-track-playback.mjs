import { app, BrowserWindow, net, protocol } from 'electron';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Observe the actual master output on the audio rendering thread. UI timers
// alone cannot detect silent quanta while decoding or processing a long song.
const root = fileURLToPath(new URL('../', import.meta.url));
const profile = await mkdtemp(path.join(tmpdir(), 'vibloom-playback-'));
const url = process.env.VIBLOOM_PLAYBACK_TEST_URL ?? 'vibloom://app/index.html';
const output = path.join(root, 'outputs/multi-track-playback');
app.setPath('userData', profile); app.on('window-all-closed', () => {});
protocol.registerSchemesAsPrivileged([{ scheme: 'vibloom', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let window, exitCode = 0;
const timer = setTimeout(() => app.exit(1), 300000);
async function main() {
try {
  await app.whenReady(); await mkdir(output, { recursive: true });
  protocol.handle('vibloom', async request => {
    if (new URL(request.url).pathname === '/scripts/fixtures/output-probe.js') return new Response(await readFile(path.join(root, 'scripts/fixtures/output-probe.js')), { headers: { 'Content-Type': 'text/javascript' } });
    const file = path.resolve(root, 'dist', `.${new URL(request.url).pathname}`);
    return file.startsWith(path.join(root, 'dist') + path.sep) ? net.fetch(pathToFileURL(file).href) : new Response('Not found', { status: 404 });
  });
  window = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  window.webContents.setAudioMuted(true);
  const errors = []; window.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  const run = code => window.webContents.executeJavaScript(`(async()=>{try{return await (${code});}catch(error){throw new Error(error.name+': '+error.message);}})()`, true);
  const wait = async (code, label) => {
    for (let i = 0; i < 1200; i++) { if (await run(code)) return; await delay(50); }
    throw new Error('Timeout: ' + label);
  };
  const click = selector => run(`document.querySelector(${JSON.stringify(selector)}).click()`);
  await window.loadURL(url); await wait(`document.querySelector('.live2d-stage[data-status="ready"]')`, 'model ready'); console.log('Model ready',url);
  await run(`(() => {
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function(destination, ...args) {
      if (this.context instanceof AudioContext && destination === this.context.destination) { window.__master = this; window.__context = this.context; }
      return connect.call(this, destination, ...args);
    };
    window.__buffers=[];const decode=BaseAudioContext.prototype.decodeAudioData;
    BaseAudioContext.prototype.decodeAudioData=function(...args){return decode.apply(this,args).then(buffer=>{window.__buffers.push(new WeakRef(buffer));return buffer;});};
    const rate=48000,seconds=240,frames=rate*seconds,bytes=new ArrayBuffer(44+frames*4),v=new DataView(bytes);
    const str=(at,s)=>[...s].forEach((x,i)=>v.setUint8(at+i,x.charCodeAt(0)));
    str(0,'RIFF');v.setUint32(4,bytes.byteLength-8,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,2,true);v.setUint32(24,rate,true);v.setUint32(28,rate*4,true);v.setUint16(32,4,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,frames*4,true);
    for(let i=0;i<frames;i++){const x=.3*Math.sin(i*2*Math.PI*997/rate);v.setInt16(44+i*4,x*32767,true);v.setInt16(46+i*4,x*.5*32767,true);}
    const input=document.querySelector('input[type="file"][multiple]'),transfer=new DataTransfer();transfer.items.add(new File([bytes],'Continuous 4 minutes.wav',{type:'audio/wav',lastModified:1}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await wait(`document.querySelector('#import-title')?.textContent==='Import complete'`, 'import'); await click('[aria-label="Close import summary"]'); await click('.transport-play');
  await wait(`document.querySelector('[aria-label="Pause"]') && window.__master`, 'playing'); await delay(150); console.log('4-minute original playing');
  await run(`(async () => {
    await window.__context.audioWorklet.addModule(new URL('scripts/fixtures/output-probe.js',location.href).href);
    window.__probe=new AudioWorkletNode(window.__context,'output-probe');const mute=window.__context.createGain();mute.gain.value=0;
    window.__master.connect(window.__probe);window.__probe.connect(mute);mute.connect(window.__context.destination);
    window.__stats=()=>new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Audio render thread stopped')),5000);window.__probe.port.onmessage=event=>{clearTimeout(timeout);resolve(event.data);};window.__probe.port.postMessage('snapshot');});
  })()`);
  const samples = [], timings = [], rendererMemory = [];
  window.webContents.debugger.attach('1.3');
  const collect = async () => { for(let i=0;i<5;i++){await delay(30);await window.webContents.debugger.sendCommand('HeapProfiler.collectGarbage');} };
  const decodedMemory = () => run(`(()=>{const buffers=window.__buffers.map(ref=>ref.deref()).filter(Boolean);return {residentBuffers:buffers.length,pcmBytes:buffers.reduce((n,b)=>n+b.length*b.numberOfChannels*4,0)};})()`);
  let peakRendererKiB = 0;
  const rendererKiB = () => app.getAppMetrics().filter(item => item.type === 'Tab').reduce((sum,item) => sum + item.memory.workingSetSize,0);
  const memoryTimer = setInterval(() => { peakRendererKiB = Math.max(peakRendererKiB, rendererKiB()); },250);
  const recordMemory = async label => { await collect(); rendererMemory.push({ label, workingSetKiB: rendererKiB(), ...await decodedMemory() }); };
  const measure = async label => {
    const sample = { label, ...await run('window.__stats()') }; samples.push(sample); console.log(JSON.stringify(sample));
    assert.equal(sample.silentQuanta, 0, 'continuous master output: ' + label);
    assert.equal(sample.invalidSamples, 0, 'finite audio output: ' + label);
    assert.ok(await run(`Boolean(document.querySelector('[aria-label="Pause"]'))`), 'playback remains running');
  };
  const processTrack = async (source, target, kind, preset) => {
    await click(`[aria-label="${kind === 'eq' ? 'EQ' : 'Remaster'} track ${source}"]`); await wait(`document.querySelector('dialog[open]')`, 'dialog');
    if (kind === 'remaster') await click('.remaster-categories button'); await click(`[data-preset-id="${preset}"]`);
    await run(`(()=>{const select=document.querySelector('[aria-label="Output track"]');const value='${target - 1}';select.click();document.querySelector('[role=option][data-value="'+value+'"]').click();})()`);
    const started = performance.now(); await click('.remaster-submit');
    await wait(`document.querySelector('[data-track-number="${target}"].is-ready')&&!document.querySelector('dialog')`, 'output');
    timings.push({ operation: kind, source, target, milliseconds: Math.round(performance.now() - started) });
  };
  await measure('original playing'); await recordMemory('original');
  for (let target = 2; target <= 9; target++) { await processTrack(1, target, 'eq', 'warm'); await measure('background EQ to ' + target); if(target === 2 || target === 9) await recordMemory(target + ' tracks'); }
  const select = async number => {
    const started = performance.now(); await click(`[aria-label="Listen to track ${number}"]`);
    await wait(`document.querySelector('[data-track-number="${number}"] .source-selector').getAttribute('aria-pressed')==='true'`, 'source switch');
    timings.push({ operation: 'select', target: number, milliseconds: Math.round(performance.now() - started) });
    await measure('switch ' + number);
  };
  for (const number of [2, 9, 3, 8, 4, 7, 5, 6, 1]) await select(number);
  // Preview a different version while the user's selected original stays fixed.
  const selected = () => run(`document.querySelector('.source-selector[aria-pressed="true"]').textContent`);
  const rms = async () => { await delay(300); const before = await run('window.__stats()'); await delay(300); const after = await run('window.__stats()'); return Math.sqrt((after.sumSquares-before.sumSquares)/(after.frames-before.frames)); };
  const originalRms = await rms(); await click('[aria-label="EQ track 2"]');
  await click('[data-preset-id="vocal"]'); await click('.sound-preview-bar button');
  await wait(`document.querySelector('.sound-preview-bar small').textContent==='Processed · track 2'`, 'live preview');
  const vocalRms = await rms(); assert.equal(await selected(),'1','explicit preview leaves the user selection intact');
  assert.ok(20*Math.log10(vocalRms/originalRms)>1.5,'actual live EQ reaches master output'); await measure('live EQ preview on track 2');
  await click('.sound-preview-bar button'); await wait(`document.querySelector('.sound-preview-bar small').textContent==='Original · track 2'`, 'hard bypass');
  const bypassRms=await rms();assert.ok(Math.abs(20*Math.log10(bypassRms/originalRms))<.5,'bypass removes the full preview chain'); await measure('preview original bypass');
  await click('.sound-preview-bar button'); await click('[data-preset-id="bright"]');
  const brightRms=await rms();assert.ok(vocalRms>brightRms*1.05,'changing presets changes real rendered preview audio');
  await click('.sound-tabs button:nth-child(2)'); await click('.sound-mode button');
  await wait(`!document.querySelector('.sound-preview-bar button').disabled`, 'source LUFS measured'); await delay(300); await measure('live full mastering with source normalization');
  await click('[aria-label="Close eq"]'); await delay(100); const restoredRms=await rms();assert.ok(Math.abs(20*Math.log10(restoredRms/originalRms))<.2,'closing restores the original sound');assert.equal(await selected(),'1');
  // Render a four-minute full mastering chain during uninterrupted original playback.
  await click('[aria-label="EQ track 2"]');await click('.sound-tabs button:nth-child(2)');await click('.sound-mode button');await click('.sound-tabs button:first-child');await click('[data-preset-id="suno"]');
  await run(`(()=>{const s=document.querySelector('[aria-label="Output track"]');const value='2';s.click();document.querySelector('[role=option][data-value="'+value+'"]').click();})()`);
  const masteringStarted=performance.now();await click('.remaster-submit');await wait(`!document.querySelector('dialog')&&document.querySelector('[data-track-number="3"].is-ready')`,'full mastering ready');
  timings.push({operation:'mastering',source:2,target:3,milliseconds:Math.round(performance.now()-masteringStarted)});assert.equal(await selected(),'1');await measure('background full mastering + normalization + 4× TP');await recordMemory('after full mastering');
  await processTrack(3, 4, 'remaster', 'gentle'); await measure('mastering output → remaster while original plays');
  // Simultaneously run one heavy job and cold selection, the maximum admitted concurrency.
  const background = processTrack(2, 3, 'remaster', 'gentle');
  await wait(`document.querySelector('.card-perimeter-progress')`, 'background job');
  for (const number of [8, 4, 9]) await select(number);
  await background; await measure('concurrent remaster and cold selection');
  await select(3); await delay(100); await measure('remaster output audible'); await select(9);
  for (const number of [1,9,1,9,1,9,1,9,1,9]) await select(number);
  await delay(200); await measure('rapid returns during unfinished crossfades');
  await recordMemory('nine tracks after GC'); const memory = await decodedMemory();
  await measure('explicit garbage collection during playback'); assert.ok(memory.pcmBytes <= 256 * 1024 * 1024);
  assert.ok(samples.at(-1).frames > samples[0].frames + samples[0].sampleRate * 5, 'probe observed sustained real audio rendering'); assert.deepEqual(errors, []);
  await click('.transport-secondary > button'); await click('.queue-sheet .destructive-text-button'); await wait(`document.querySelector('.confirm-destructive')`, 'clear queue'); await click('.confirm-destructive'); await wait(`!document.querySelector('.version-b')`, 'audio released');
  await collect();
  const afterClear = await run(`window.__buffers.filter(ref=>ref.deref()).length`); assert.equal(afterClear,0,'clearing playback releases all decoded AudioBuffers');
  await recordMemory('after clear'); clearInterval(memoryTimer);
  const report = { origin: url, runtime: process.versions, songSeconds: 240, tracks: 9, samples, timings, memory, rendererMemory, peakRendererKiB, decodedBuffersAfterClear: afterClear, rendererErrors: errors, preview: {vocalGainDb:20*Math.log10(vocalRms/originalRms),brightGainDb:20*Math.log10(brightRms/originalRms),bypassGainDb:20*Math.log10(bypassRms/originalRms),restoredGainDb:20*Math.log10(restoredRms/originalRms)}, limitation: 'AudioWorklet observes rendered PCM; it cannot prove physical-device underruns or performance on other hardware/browsers. Renderer working set includes textures/decoder/DSP; it is not the PCM cache budget.' };
  await writeFile(path.join(output, url.startsWith('http') ? 'web.json' : 'desktop.json'), JSON.stringify(report, null, 2));
  console.log('PASS nine 4-minute tracks, continuous native audio during EQ/remaster/cold switches, bounded resident PCM');
} catch (error) { console.error(error.stack ?? String(error)); exitCode = 1; }
finally { clearTimeout(timer); window?.destroy(); await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => {}); app.exit(exitCode); }
}
void main();
