import { app, BrowserWindow, net, protocol } from 'electron';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const profile = await mkdtemp(path.join(tmpdir(), 'vibloom-companion-memory-'));
const output = path.join(root, 'outputs/companion-memory');
app.setPath('userData', profile);
app.on('window-all-closed', () => {});
protocol.registerSchemesAsPrivileged([{ scheme: 'vibloom', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let window, exitCode = 0;
const timer = setTimeout(() => app.exit(1), 120000);
async function main() {
try {
  await app.whenReady();
  await mkdir(output, { recursive: true });
  protocol.handle('vibloom', request => {
    const file = path.resolve(root, 'dist', `.${new URL(request.url).pathname}`);
    return file.startsWith(path.join(root, 'dist') + path.sep) ? net.fetch(pathToFileURL(file).href) : new Response('Not found', { status: 404 });
  });
  window = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  const run = code => window.webContents.executeJavaScript(code, true);
  const wait = async code => {
    for (let i = 0; i < 300; i++) { if (await run(code)) return; await delay(100); }
    throw new Error(`Timed out: ${code}`);
  };
  await window.loadURL('vibloom://app/index.html');
  await wait(`document.querySelector('.live2d-stage[data-status="ready"]')`);
  // Import the same built modules the UI uses; observe production texture
  // ownership with WeakRefs rather than retaining the resources in this probe.
  const modules = (await readdir(path.join(root, 'dist/assets'))).filter(name => /^lib-.*\.js$/.test(name));
  await run(`(async () => {
    const modules = await Promise.all(${JSON.stringify(modules)}.map(name => import('/assets/' + name)));
    const Texture = modules.flatMap(m => Object.values(m)).find(value => typeof value?.fromURL === 'function' && typeof value?.fromBuffer === 'function');
    if (!Texture) throw new Error('Built Pixi Texture export not found');
    const original = Texture.fromURL, seen = new WeakSet();
    window.__textures = [];
    Texture.fromURL = async function(...args) {
      const texture = await original.apply(this, args);
      if (!seen.has(texture)) { seen.add(texture); window.__textures.push({ ref: new WeakRef(texture), url: String(args[0]), bytes: texture.width * texture.height * 4 }); }
      return texture;
    };
  })()`);
  window.webContents.debugger.attach('1.3');
  const samples = [];
  for (let cycle = 0; cycle < 12; cycle++) {
    const id = cycle % 2 ? 'hong-xi' : 'hiyori';
    await run(`(() => { document.querySelector('[aria-label="Music companion"]').click(); document.querySelector('[role=option][data-value="${id}"]').click(); })()`);
    await wait(`document.querySelector('.live2d-stage[data-companion="${id}"][data-status="ready"]') && !document.querySelector('.is-switching-companion')`);
    await delay(150);
    for (let i = 0; i < 3; i++) { await window.webContents.debugger.sendCommand('HeapProfiler.collectGarbage'); await delay(30); }
    const resources = await run(`(() => {
      const retained = window.__textures.filter(item => { const texture = item.ref.deref(); return texture && !texture.destroyed; });
      return { uniqueTexturesLoaded: window.__textures.length, retainedTextures: retained.length, decodedRgbaBytesEstimate: retained.reduce((n,item) => n + item.bytes, 0), retainedUrls: retained.map(item => item.url), canvases: document.querySelectorAll('canvas.live2d-canvas').length };
    })()`);
    assert.equal(resources.canvases, 1);
    const heap = await window.webContents.debugger.sendCommand('Runtime.getHeapUsage');
    samples.push({ cycle, companion: id, resources, heap });
    console.log(JSON.stringify(samples.at(-1)));
  }
  // Detect growth after both bundled companions are warm. Retained textures
  // may be an intentional global cache; this test does not equate it with GPU RSS.
  const warm = samples[3].resources;
  for (const sample of samples.slice(4)) assert.equal(sample.resources.retainedTextures, warm.retainedTextures, 'repeated switching must not accumulate live textures');
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ samples, limitation: 'RGBA sizes are decoded image estimates, not measured GPU memory; texture cache retention is reported separately from cumulative growth.' }, null, 2));
  console.log('PASS repeated companion switching has bounded textures and one canvas');
} catch (error) { console.error(error); exitCode = 1; }
finally { clearTimeout(timer); window?.destroy(); await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => {}); app.exit(exitCode); }
}
void main();
