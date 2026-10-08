// Exercise the first vocal request against a fresh Vite optimizer and profile.
import { app, BrowserWindow, protocol, session } from 'electron';
import { createServer } from 'vite';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../', import.meta.url));
const profile = await mkdtemp(path.join(tmpdir(), 'vibloom-vocal-startup-'));
const cacheDir = await mkdtemp(path.join(root, '.cache/vocal-startup-'));
app.setPath('userData', profile); app.on('window-all-closed', () => {});
protocol.registerSchemesAsPrivileged([{ scheme: 'vibloom', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let window, server, exitCode = 0;
const timeout = setTimeout(() => app.exit(1), 300000);
async function main() { try {
  server = await createServer({ root, cacheDir, server: { host: '127.0.0.1', port: 0, open: false } });
  await server.listen(); await app.whenReady();
  const modelPath = process.env.VIBLOOM_TEST_VOCAL_MODEL;
  if (modelPath) {
    const bytes = await readFile(path.resolve(modelPath));
    // A local throttled stream makes the download phase observable without network variability.
    protocol.handle('vibloom', () => { let offset = 0; return new Response(new ReadableStream({ async pull(controller) { await delay(25); if (offset >= bytes.length) { controller.close(); return; } const end = Math.min(bytes.length, offset + 1024 * 1024); controller.enqueue(bytes.subarray(offset, end)); offset = end; } }), { headers: { 'Content-Length': String(bytes.length) } }); });
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['https://huggingface.co/*'] }, (_request, callback) => callback({ redirectURL: 'vibloom://app/model.onnx' }));
  }
  window = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true, backgroundThrottling: false } });
  window.webContents.setAudioMuted(true);
  const errors = [], navigations = [];
  window.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  window.webContents.on('did-navigate', (_event, url) => navigations.push(url));
  const run = code => window.webContents.executeJavaScript(code, true);
  const wait = async (code, label) => { console.log('WAIT', label); for (let i = 0; i < 2500; i++) { if (await run(code)) return; await delay(100); } throw new Error('Timeout ' + label); };
  const click = selector => run(`document.querySelector(${JSON.stringify(selector)}).click()`);
  await window.loadURL(server.resolvedUrls.local[0]);
  await wait(`document.querySelector('.live2d-stage[data-status="ready"]')`, 'fresh dev app');
  await run(`(()=>{
    window.__phases=new Set();window.__phaseObserver=new MutationObserver(()=>{const status=document.querySelector('.version-a .card-vocal-status');if(status)window.__phases.add(status.textContent.split(' · ')[0]);});window.__phaseObserver.observe(document.body,{childList:true,subtree:true,characterData:true});
    const rate=44100,frames=rate*4,bytes=new ArrayBuffer(44+frames*2),v=new DataView(bytes),text=(at,s)=>[...s].forEach((c,i)=>v.setUint8(at+i,c.charCodeAt(0)));
    text(0,'RIFF');v.setUint32(4,bytes.byteLength-8,true);text(8,'WAVE');text(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);text(36,'data');v.setUint32(40,frames*2,true);for(let i=0;i<frames;i++)v.setInt16(44+i*2,Math.sin(i*2*Math.PI*997/rate)*3000,true);
    const input=document.querySelector('input[type="file"][multiple]'),transfer=new DataTransfer();transfer.items.add(new File([bytes],'Vocal startup.wav',{type:'audio/wav'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await wait(`document.querySelector('#import-title')?.textContent==='Import complete'`, 'import');
  await click('[aria-label="Close import summary"]'); await click('.transport-play');
  await wait(`document.querySelector('[aria-label="Prepare vocals track 1"]')&&!document.querySelector('[aria-label="Prepare vocals track 1"]').disabled`, 'original ready');
  await click('[aria-label="Prepare vocals track 1"]');
  await wait(`document.querySelector('.card-vocal-status')?.textContent.includes('Downloading vocal model')`, 'visible model download');
  await mkdir(path.join(root, 'outputs/vocal-startup'), { recursive: true });
  await writeFile(path.join(root, 'outputs/vocal-startup/downloading.png'), (await window.webContents.capturePage()).toPNG());
  await wait(`document.querySelector('[aria-label="Disable singing track 1"]')||document.querySelector('[data-vocal-status="error"]')`, 'vocal processing');
  assert.equal(await run(`document.querySelector('[data-vocal-status="error"]')?.dataset.tooltip??''`), '');
  assert.equal(await run(`document.querySelector('[aria-label="Disable singing track 1"]').getAttribute('aria-pressed')`), 'true');
  const phases = await run(`[...window.__phases]`);
  assert.ok(phases.includes('Downloading vocal model')); assert.ok(phases.some(phase => phase.startsWith('Loading vocal model'))); assert.ok(phases.includes('Separating vocals'));
  assert.equal(navigations.length, 1, 'first worker imports never reload the page');
  assert.deepEqual(errors, []);
  const result = { navigations, phases, automaticallyEnabled: true, rendererErrors: errors };
  await writeFile(path.join(root, 'outputs/vocal-startup/report.json'), JSON.stringify(result, null, 2) + '\n');
  console.log('PASS first vocal startup on fresh Vite', result);
} catch (error) { console.error(error); exitCode = 1; }
finally { clearTimeout(timeout); window?.destroy(); await server?.close(); await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); await rm(cacheDir, { recursive: true, force: true }); app.exit(exitCode); }

}
void main();
