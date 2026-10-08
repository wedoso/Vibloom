import { app, BrowserWindow, net, protocol, session } from "electron";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const profile = await mkdtemp(path.join(tmpdir(), "vibloom-lip-sync-"));
const output = path.join(root, "outputs/lip-sync-smoke");
app.setPath("userData", profile);
app.on("window-all-closed", () => {});
protocol.registerSchemesAsPrivileged([{ scheme: "vibloom", privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true,
} }]);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let window;
let exitCode = 0;
async function smoke() {
  const timer = setTimeout(() => { console.error("Lip sync smoke timed out"); app.exit(1); }, 600000);
  try {
    await app.whenReady();
    await mkdir(output, { recursive: true });
    protocol.handle("vibloom", (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/__test__/voice.wav") return net.fetch(pathToFileURL(path.join(root, "tests/fixtures/vocal-speech.wav")).href);
      if (url.pathname === "/__test__/model.onnx" && process.env.VIBLOOM_TEST_VOCAL_MODEL) return net.fetch(pathToFileURL(path.resolve(process.env.VIBLOOM_TEST_VOCAL_MODEL)).href);
      const file = path.resolve(root, "dist", `.${url.pathname}`);
      if (!file.startsWith(`${path.join(root, "dist")}${path.sep}`)) return new Response("Not found", { status: 404 });
      return net.fetch(pathToFileURL(file).href);
    });
    if (process.env.VIBLOOM_TEST_VOCAL_MODEL) {
      session.defaultSession.webRequest.onBeforeRequest({ urls: ["https://huggingface.co/*"] }, (_request, callback) => callback({ redirectURL: "vibloom://app/__test__/model.onnx" }));
    }
    window = new BrowserWindow({ width: 1280, height: 900, show: process.env.CI === "true",
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    window.webContents.setAudioMuted(true);
    const errors = [];
    window.webContents.on("console-message", (event) => {
      if (event.level === "error" || event.level === 3) errors.push(event.message);
    });
    const run = (code) => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Renderer did not respond within 30 seconds")), 30000);
      window.webContents.executeJavaScript(code, true).then(
        (value) => { clearTimeout(timeout); resolve(value); },
        (error) => { clearTimeout(timeout); reject(error); },
      );
    });
    const waitFor = async (code, label, analysis = label.endsWith("analyzed")) => {
      const attempts = analysis ? 5000 : 150;
      console.log(`WAIT ${label}`);
      for (let i = 0; i < attempts; i++) {
        if (await run(code)) return;
        if (analysis && i % 100 === 0) console.log(await run(`document.querySelector('.library-list-panel') ? [...document.querySelectorAll('.track-vocal-job')].map(el => el.textContent).join(" | ") : [...document.querySelectorAll('[data-vocal-track]')].map(x=>x.dataset.tooltip).join(' | ')`));
        await delay(100);
      }
      throw new Error(`Timed out: ${label}`);
    };
    const click = (selector) => run(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const range = (label, value) => run(`(() => {
      const input = document.querySelector('[aria-label="${label}"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${value});
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    const ready = (id) => waitFor(`document.querySelector('.live2d-stage[data-companion="${id}"][data-status="ready"]') && document.querySelector('canvas.live2d-canvas')?.style.visibility !== 'hidden'`, `${id} ready`);
    const select = async (id) => {
      await run(`(() => { const select = document.querySelector('[aria-label="Music companion"]');const value='${id}';select.click();document.querySelector('[role=option][data-value="'+value+'"]').click(); })()`);
      await ready(id);
    };
    const capture = async (name) => writeFile(path.join(output, `${name}.png`), (await window.webContents.capturePage()).toPNG());
    const closed = async (label) => {
      await delay(600);
      await run("window.__mouthProbe.samples = []");
      await delay(350);
      const samples = await run("window.__mouthProbe.samples");
      assert.ok(samples.length >= 3, `${label}: renderer is updating`);
      assert.ok(samples.every((v) => v < 0.015), `${label}: mouth closes, max=${Math.max(...samples)}`);
    };
    const open = (label) => waitFor("window.__mouthProbe?.current > 0.25", label);
    await window.loadURL("vibloom://app/index.html");
    if (app.commandLine.getSwitchValue("disable-features").split(",").includes("WebGPUService")) {
      assert.equal(await run(`(async () => Boolean(await navigator.gpu?.requestAdapter()))()`), false, "WASM test has no WebGPU adapter");
      console.log("PASS WebGPU adapter disabled; exercising WASM fallback");
    }
    await ready("hong-xi");
    await run(`(async () => {
      const context = new AudioContext({sampleRate: 44100});
      const voice = await context.decodeAudioData(await (await fetch('./__test__/voice.wav')).arrayBuffer());
      await context.close();
      // Probe the actual values sent to Cubism Core, after every controller.
      const create = Live2DCubismCore.Model.fromMoc;
      Live2DCubismCore.Model.fromMoc = function(...args) {
        const model = create.apply(this, args), update = model.update;
        const mouth = model.parameters.ids.indexOf('ParamMouthOpenY');
        const form = model.parameters.ids.indexOf('ParamMouthForm');
        const probe = window.__mouthProbe = { current: 0, samples: [], forms: [], index: mouth };
        model.update = function(...args) {
          probe.current = model.parameters.values[mouth];
          probe.samples.push(probe.current);
          probe.forms.push(model.parameters.values[form]);
          if (probe.forms.length > 300) probe.forms.shift();
          if (probe.samples.length > 300) probe.samples.shift();
          return update.apply(this, args);
        };
        return model;
      };
      const decode = BaseAudioContext.prototype.decodeAudioData;
      window.__decodeCount = 0;
      BaseAudioContext.prototype.decodeAudioData = function(...args) { window.__decodeCount++; return decode.apply(this, args); };
      const Worker = window.Worker;
      window.__workerStarts = 0;
      window.Worker = class extends Worker { constructor(...args) { super(...args); window.__workerStarts++; } };
      const start = AudioBufferSourceNode.prototype.start;
      window.__sourceStarts = 0;
      AudioBufferSourceNode.prototype.start = function(...args) { if (this.context instanceof AudioContext) window.__sourceStarts++; return start.apply(this, args); };
      window.__wav = (name, silent) => {
        const rate = 44100, samples = rate * (silent ? 3 : 12), bytes = new ArrayBuffer(44 + samples * 2), view = new DataView(bytes);
        const text = (offset, value) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
        text(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
        view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
        view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
        text(36, 'data'); view.setUint32(40, samples * 2, true);
        for (let i = 0; i < samples; i++) {
          const t = i / rate;
          const drums = Math.sin(t * 70 * Math.PI * 2) * Math.exp(-(t % 0.5) * 30) * 0.35;
          const music = 0.07 * Math.sin(t * 220 * Math.PI * 2) + 0.05 * Math.sin(t * 330 * Math.PI * 2);
          const vocal = !silent && i >= rate * 4 && i < rate * 4 + voice.length ? voice.getChannelData(0)[i - rate * 4] : 0;
          view.setInt16(44 + i * 2, silent ? 0 : (drums + music + vocal) * 24000, true);
        }
        return new File([bytes], name, { type: 'audio/wav', lastModified: 1 });
      };
    })()`);
    await select("hiyori");
    await closed("welcome");
    await select("hong-xi");
    await run(`(() => {
      const transfer = new DataTransfer(); transfer.items.add(window.__wav('Voice A.wav', false));
      const input = document.querySelector('input[type="file"][multiple]'); input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await waitFor(`document.querySelector('#import-title')?.textContent === 'Import complete'`, "import");
    await click('[aria-label="Close import summary"]');
    await waitFor(`document.querySelector('.transport-play') && !document.querySelector('.transport-play').disabled`, "transport");
    if (!await run(`Boolean(document.querySelector('[aria-label="Pause"]'))`)) await click('.transport-play');
    await range("Playback position", 4.2);
    await closed("unprepared vocals never fall back to the audible mix");
    await click('[data-vocal-track="1"]');
    await waitFor(`document.querySelector('[data-vocal-track="1"]')?.dataset.vocalStatus === 'working'`, "analysis starts");
    await click('[data-vocal-track="1"]');
    await closed("cancelled analysis");
    await range("Playback position", 0);
    await click('[aria-label="Repeat off"]');
    await click('[aria-label="Repeat all"]');
    await run("window.__uiTicks = 0; window.__heartbeat = setInterval(() => window.__uiTicks++, 50)");
    await click('button[title="Library"]');
    await waitFor(`document.querySelector(".library-vocal-toolbar button")`, "library mode entry");
    assert.equal(await run(`document.querySelectorAll('.vocal-track-select input').length`), 0);
    await click('.library-vocal-toolbar button');
    await click('[aria-label="Select Voice A for vocal preparation"]');
    await waitFor(`!document.documentElement.classList.contains("is-scene-transitioning")`, "library transition complete");
    await capture("library-selection");
    const workersBeforeSubmission = await run("window.__workerStarts");
    await click('.library-vocal-toolbar button');
    await waitFor(`document.querySelector('.track-vocal-job progress')`, "Library progress");
    // Progress is published while the file is still being read/decoded. That
    // does not mean runAnalysis has constructed its worker yet (especially CPU CI).
    await waitFor(`window.__workerStarts > ${workersBeforeSubmission}`, "Library analysis worker starts after decoding");
    const sharedWorkers = await run("window.__workerStarts");
    assert.equal(sharedWorkers, workersBeforeSubmission + 2, "one separation and one MotionSync worker start for the submitted source");
    await click('[aria-label="Actions for Voice A"]');
    await run(`[...document.querySelectorAll('.track-popover button')].find(b=>b.textContent==='Prepare vocal lip sync').click()`);
    assert.equal(await run("window.__workerStarts"), sharedWorkers, "duplicate menu submission is deduplicated");
    await click('button[title="Player"]');
    await waitFor(`document.querySelector('[data-vocal-track="1"]')`, 'Player card mounted');
    await waitFor(`document.querySelector('.version-a .card-perimeter-progress')`, "progress bar");
    const workersBeforeLoop = await run("window.__workerStarts");
    const decodesBeforeLoop = await run("window.__decodeCount");
    await range("Playback position", 11.5);
    await waitFor(`Number(document.querySelector('[aria-label="Playback position"]').value) < 2 && Boolean(document.querySelector('[aria-label="Pause"]'))`, "repeat during preparation");
    const positionBefore = await run(`Number(document.querySelector('[aria-label="Playback position"]').value)`);
    await delay(1600);
    await capture("background-preparation");
    assert.ok(await run(`Boolean(document.querySelector('[aria-label="Pause"]'))`), "playback continues during inference");
    assert.ok(await run(`Number(document.querySelector('[aria-label="Playback position"]').value)`) > positionBefore + 1, "playback clock advances during inference");
    await waitFor(`document.querySelector('[data-vocal-track="1"]')?.getAttribute('aria-label') === 'Disable singing track 1'  || document.querySelector('[data-vocal-status="error"]')`, "A analyzed");
    assert.equal(await run(`document.querySelector('[data-vocal-status="error"]')?.textContent ?? ''`), "");
    assert.ok(await run(`Boolean(document.querySelector('[aria-label="Pause"]'))`), "playback continues during analysis");
    assert.ok(await run("window.__uiTicks") > 10, "renderer remains responsive");
    await run("clearInterval(window.__heartbeat)");
    assert.equal(await run("window.__workerStarts"), workersBeforeLoop, "repeat does not restart vocal separation");
    assert.equal(await run("window.__workerStarts"), sharedWorkers, "no duplicate worker starts before analysis completes");
    assert.equal(await run("window.__decodeCount"), decodesBeforeLoop, "repeat reuses decoded audio");
    assert.equal(await run(`document.querySelector('[data-vocal-track="1"]').getAttribute("aria-pressed")`), "true", "newly prepared vocals automatically enable");
    await click('[aria-label="Pause"]');
    await click('[aria-label="Repeat one"]');
    console.log("PASS background Demucs analysis, uninterrupted repeat, visible phases, automatic singing, cancellation and retry");
    await run(`(() => {
      const transfer = new DataTransfer(); transfer.items.add(window.__wav('Silent B.wav', true));
      const input = document.querySelector('input[type="file"]:not([multiple]):not([accept^=".lrc"])');
      input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await waitFor(`document.querySelector('.source-switch-comparison:not(:disabled)')`, "B ready");
    await click('.source-switch-comparison:not(:disabled)');
    await click('[data-vocal-track="2"]');
    await waitFor(`document.querySelector('[data-vocal-track="2"]')?.getAttribute('aria-label') === 'Disable singing track 2' || document.querySelector('[data-vocal-status="error"]')`, "B analyzed");
    assert.equal(await run(`document.querySelector('[data-vocal-status="error"]')?.textContent ?? ''`), "");
    assert.equal(await run(`document.querySelector('[data-vocal-track="2"]').getAttribute("aria-pressed")`), "true");
    for (const id of ["hong-xi", "hiyori"]) {
      const starts = await run("window.__sourceStarts");
      await select(id);
      assert.equal(await run("window.__sourceStarts"), starts, "model switching never starts extra audio");
      assert.ok(await run("window.__mouthProbe.index >= 0"), "real mouth parameter exists");
      await click('.source-switch-original');
      await range("Playback position", 4.2);
      await click('.transport-play');
      await open(`${id} vocal A opens`);
      await run("window.__mouthProbe.samples = []; window.__mouthProbe.forms = []");
      await delay(1700);
      const articulation = await run("({open: window.__mouthProbe.samples, form: window.__mouthProbe.forms})");
      assert.ok(Math.max(...articulation.open) - Math.min(...articulation.open) > .15, `${id}: syllabic mouth movement`);
      assert.ok(Math.max(...articulation.form) - Math.min(...articulation.form) > .15, `${id}: MotionSync weights change actual Cubism mouth shape`);
      await capture(`${id}-singing`);
      const beforeToggle = await run("window.__sourceStarts");
      await click('[data-vocal-track="1"]');
      await closed(`${id} singing switched off`);
      assert.equal(await run(`document.querySelector('[data-vocal-track="1"]').getAttribute('aria-label')`), "Enable singing track 1");
      assert.equal(await run("window.__sourceStarts"), beforeToggle, "singing toggle does not restart playback");
      await click('[data-vocal-track="1"]');
      await range("Playback position", 4.2);
      await open(`${id} cached singing restored`);
      await range("Volume", 0);
      await closed(`${id} volume zero`);
      await range("Volume", 0.9);
      await range("Playback position", 4.2);
      await open(`${id} vocals restored`);
      await click('[aria-label="Pause"]');
      await closed(`${id} paused`);
      await capture(`${id}-paused`);
      await range("Playback position", 0);
      await click('.transport-play');
      await closed(`${id} A instrumental intro despite ongoing drums`);
      await click('.source-switch-comparison:not(:disabled)');
      await range("Playback position", 0);
      await closed(`${id} silent B`);
      await range("Playback position", 4.2);
      await closed(`${id} shorter B ended while A vocals play`);
      await click('.source-switch-original');
      await range("Playback position", 4.2);
      await open(`${id} back to actual vocals`);
      await range("Playback position", 9);
      await closed(`${id} instrumental outro`);
      await click('[aria-label="Pause"]');
      console.log(`PASS ${id}: actual vocals, instrumental intro/outro rejection, silent B, numbered switching, ended source, volume, seek, pause/resume`);
    }
    // Process a different song from Library without replacing current playback.
    await run(`(() => {
      const transfer = new DataTransfer(); transfer.items.add(window.__wav('Library vocal preparation.wav', true)); transfer.items.add(window.__wav('Queued cancellation.wav', true));
      const input = document.querySelector('input[type="file"][multiple]'); input.files = transfer.files; input.dispatchEvent(new Event('change', {bubbles:true}));
    })()`);
    await waitFor(`document.querySelector('#import-title')?.textContent === 'Import complete'`, "library test tracks imported");
    await click('[aria-label="Close import summary"]');
    await click('button[title="Library"]');
    await waitFor(`document.querySelector(".library-vocal-toolbar button")`, "library mode entry");
    assert.equal(await run(`document.querySelectorAll('.vocal-track-select input').length`), 0, "normal library has no selection checkboxes");
    await click(".library-vocal-toolbar button");
    await waitFor(`document.querySelector('[aria-label="Select Library vocal preparation for vocal preparation"]')`, "library selection");
    await click('[aria-label="Select Library vocal preparation for vocal preparation"]');
    await click('[aria-label="Select Queued cancellation for vocal preparation"]');
    await click('.library-vocal-toolbar button');
    assert.equal(await run(`document.querySelectorAll('.vocal-track-select input').length`), 0, "batch submission leaves selection mode");
    await waitFor(`document.querySelector('[aria-label="Cancel vocal preparation for Queued cancellation"]')`, "second song queued");
    await click('[aria-label="Cancel vocal preparation for Queued cancellation"]');
    const startsBeforeLibrary = await run("window.__sourceStarts");
    await waitFor(`[...document.querySelectorAll('.track-row')].find(row => row.textContent.includes('Library vocal preparation'))?.textContent.includes('Vocals ready')`, "library vocal preparation finished", true);
    assert.equal(await run("window.__sourceStarts"), startsBeforeLibrary, "library preparation does not replace playback sources");
    assert.ok(await run(`document.querySelector('.library-list-panel') !== null`), "processing stays in Library");
    await capture("library-vocal-preparation");
    await run(`[...document.querySelectorAll('.queue-list > div:not(.is-active) [aria-label="Remove from queue"]')].forEach(button => button.click())`);
    console.log("PASS Library selection, background queue, queued cancellation and saved results");
    await click('button[title="Player"]');
    await waitFor(`document.querySelector('[data-vocal-track="1"]')`, 'Player card mounted');
    await waitFor(`document.querySelector('.comparison-deck')`, "return to player");
    await range("Playback position", 11.5);
    await click('.transport-play');
    await waitFor(`Boolean(document.querySelector('[aria-label="Play"]'))`, "track ends");
    await closed("end of track");
    await delay(500);
    await window.loadURL("vibloom://app/index.html");
    await ready("hiyori");
    await waitFor(`document.querySelector('[data-vocal-track="1"]') && !document.querySelector('[data-vocal-track="1"]').disabled`, "restored audio ready");
    await run(`window.Worker = class { constructor() { throw new Error('Saved timing should not run inference again'); } }; void 0;`);
    await waitFor(`document.querySelector('[data-vocal-track="1"]')?.getAttribute('aria-label') === 'Enable singing track 1' || document.querySelector('[data-vocal-status="error"]')`, "saved A timing");
    assert.equal(await run(`document.querySelector('[data-vocal-status="error"]')?.textContent ?? ''`), "");
    await click('[data-vocal-track="1"]');
    await click('.source-switch-comparison:not(:disabled)');
    await waitFor(`document.querySelector('[data-vocal-track="2"]')?.getAttribute('aria-label') === 'Enable singing track 2' || document.querySelector('[data-vocal-status="error"]')`, "saved B timing");
    assert.equal(await run(`document.querySelector('[data-vocal-status="error"]')?.textContent ?? ''`), "");
    console.log("PASS saved A/B analysis is reused after app reload without another worker");
    // Prove old discrete caches cannot silently select the removed classifier.
    await click('.source-switch-original');
    await delay(500);
    const beforeMigration = await run(`new Promise((resolve, reject) => {
      const open = indexedDB.open('vibloom-library', 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result, tx = db.transaction('state', 'readwrite'), store = tx.objectStore('state');
        const request = store.get('library'); let original;
        request.onsuccess = () => {
          const snapshot = request.result, track = snapshot.tracks.find(t => t.id === snapshot.session.currentTrackId);
          if (track.vocalAnalysis?.version !== 4 || track.comparison?.vocalAnalysis?.version !== 4) { tx.abort(); return; }
          original = { id: track.id, name: track.name, lyrics: track.lyrics, comparison: track.comparison };
          track.vocalAnalysis = { version: 3, rms: track.vocalAnalysis.rms, visemes: track.vocalAnalysis.rms.map(() => 2) };
          store.put(snapshot, 'library');
        };
        tx.oncomplete = () => { db.close(); resolve(original); };
        tx.onabort = () => { db.close(); reject(new Error('Missing version 4 persisted caches')); };
      };
    })`);
    await window.loadURL('vibloom://app/index.html');
    await ready('hiyori');
    await waitFor(`document.querySelector('[data-vocal-track="1"]')?.getAttribute('aria-label') === 'Prepare vocals track 1' && !document.querySelector('[data-vocal-track="1"]').disabled`, 'legacy cache needs preparation');
    await click('button[title="Library"]');
    await waitFor(`document.querySelector('.track-row.is-active .track-vocal-job')?.textContent === 'Reprepare lip sync'`, 'Library marks legacy cache');
    await click('button[title="Player"]');
    await waitFor(`document.querySelector('[data-vocal-track="1"]')`, 'Player card mounted');
    await click('[data-vocal-track="1"]');
    await waitFor(`document.querySelector('[data-vocal-track="1"]')?.getAttribute('aria-label') === 'Disable singing track 1' || document.querySelector('[data-vocal-status="error"]')`, 'legacy source analyzed');
    assert.equal(await run(`document.querySelector('[data-vocal-status="error"]')?.textContent ?? ''`), '');
    await delay(500);
    const afterMigration = await run(`new Promise((resolve, reject) => {
      const open = indexedDB.open('vibloom-library', 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result, tx = db.transaction('state', 'readonly');
        const request = tx.objectStore('state').get('library');
        request.onsuccess = () => resolve(request.result.tracks.find(t => t.id === request.result.session.currentTrackId));
        tx.oncomplete = () => db.close();
      };
    })`);
    assert.equal(afterMigration.vocalAnalysis.version, 4);
    assert.equal(afterMigration.vocalAnalysis.vowels.length, afterMigration.vocalAnalysis.rms.length * 5);
    assert.equal(afterMigration.id, beforeMigration.id);
    assert.equal(afterMigration.name, beforeMigration.name);
    assert.deepEqual(afterMigration.lyrics, beforeMigration.lyrics);
    assert.deepEqual(afterMigration.comparison, beforeMigration.comparison, 'B cache is not replaced when re-preparing A');
    console.log('PASS legacy cache re-preparation, version 4 persistence and retained track/lyrics/B cache');
    assert.deepEqual(errors, [], "no renderer errors");
    console.log(`PASS track end; screenshots: ${output}`);
  } catch (error) {
    console.error(error);
    if (window && !window.isDestroyed()) {
      console.error(await window.webContents.executeJavaScript(`({cards:[...document.querySelectorAll('.source-selector')].map(x=>[x.textContent,x.getAttribute('aria-pressed')]),vocals:[...document.querySelectorAll('[data-vocal-track]')].map(x=>[x.dataset.vocalTrack,x.getAttribute('aria-label'),x.dataset.tooltip]),position:document.querySelector('[aria-label="Playback position"]')?.value,pose:window.__mouthProbe?.current})`));
      console.error(await window.webContents.executeJavaScript(`new Promise(resolve=>{const req=indexedDB.open('vibloom-library');req.onsuccess=()=>{const db=req.result,r=db.transaction('state').objectStore('state').get('library');r.onsuccess=()=>{const t=r.result?.tracks.find(x=>x.id===r.result.session.currentTrackId);resolve({original:t?.vocalAnalysis?.rms.slice(0,10),versions:t?.comparisons.map(x=>({slot:x.slot,name:x.name,duration:x.duration,rms:x.vocalAnalysis?.rms.slice(0,20),max:x.vocalAnalysis&&Math.max(...x.vocalAnalysis.rms)}))});db.close();};};})`));
    }
    exitCode = 1;
  } finally {
    clearTimeout(timer);
    window?.destroy();
    await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
    app.exit(exitCode);
  }
}
void smoke();
