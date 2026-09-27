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
    const run = (code) => window.webContents.executeJavaScript(code, true);
    const waitFor = async (code, label) => {
      const attempts = label.endsWith("analyzed") ? 5000 : 150;
      for (let i = 0; i < attempts; i++) { if (await run(code)) return; await delay(100); }
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
      await run(`(() => { const select = document.querySelector('[aria-label="Music companion"]'); select.value = '${id}'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
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
        const probe = window.__mouthProbe = { current: 0, samples: [], index: mouth };
        model.update = function(...args) {
          probe.current = model.parameters.values[mouth];
          probe.samples.push(probe.current);
          if (probe.samples.length > 300) probe.samples.shift();
          return update.apply(this, args);
        };
        return model;
      };
      const start = AudioBufferSourceNode.prototype.start;
      window.__sourceStarts = 0;
      AudioBufferSourceNode.prototype.start = function(...args) { window.__sourceStarts++; return start.apply(this, args); };
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
          view.setInt16(44 + i * 2, (drums + music + vocal) * 24000, true);
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
    await click('.vocal-lip-sync button');
    await waitFor(`document.querySelector('.vocal-lip-sync button')?.textContent === 'Cancel'`, "analysis starts");
    await click('.vocal-lip-sync button');
    await closed("cancelled analysis");
    await range("Playback position", 0);
    await click('[aria-label="Repeat off"]');
    await click('[aria-label="Repeat all"]');
    const positionBefore = await run(`Number(document.querySelector('[aria-label="Playback position"]').value)`);
    await run("window.__uiTicks = 0; window.__heartbeat = setInterval(() => window.__uiTicks++, 50)");
    await click('.vocal-lip-sync button');
    await waitFor(`document.querySelector('.vocal-lip-sync progress')`, "progress bar");
    await delay(1600);
    await capture("background-preparation");
    assert.ok(await run(`Boolean(document.querySelector('[aria-label="Pause"]'))`), "playback continues during inference");
    assert.ok(await run(`Number(document.querySelector('[aria-label="Playback position"]').value)`) > positionBefore + 1, "playback clock advances during inference");
    await waitFor(`document.querySelector('.vocal-lip-sync button')?.textContent === 'Start singing'  || document.querySelector('.vocal-lip-sync [role="alert"]')`, "A analyzed");
    assert.equal(await run(`document.querySelector('.vocal-lip-sync [role="alert"]')?.textContent ?? ''`), "");
    assert.ok(await run(`Boolean(document.querySelector('[aria-label="Pause"]'))`), "playback continues during analysis");
    assert.ok(await run("window.__uiTicks") > 10, "renderer remains responsive");
    await run("clearInterval(window.__heartbeat)");
    await closed("ready vocals wait for the user's singing toggle");
    await click('.vocal-lip-sync button');
    await click('[aria-label="Pause"]');
    await click('[aria-label="Repeat one"]');
    console.log("PASS background Demucs analysis, playback, progress, explicit singing, cancellation and retry");
    await run(`(() => {
      const transfer = new DataTransfer(); transfer.items.add(window.__wav('Instrumental B.wav', true));
      const input = document.querySelector('input[type="file"]:not([multiple]):not([accept^=".lrc"])');
      input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await waitFor(`document.querySelector('.transport-ab-switch .source-b')`, "B ready");
    await click('.transport-ab-switch .source-b');
    await waitFor(`document.querySelector('.vocal-lip-sync button')?.textContent === 'Vocal lip sync · On' || document.querySelector('.vocal-lip-sync [role="alert"]')`, "B analyzed");
    assert.equal(await run(`document.querySelector('.vocal-lip-sync [role="alert"]')?.textContent ?? ''`), "");
    for (const id of ["hong-xi", "hiyori"]) {
      const starts = await run("window.__sourceStarts");
      await select(id);
      assert.equal(await run("window.__sourceStarts"), starts, "model switching never starts extra audio");
      assert.ok(await run("window.__mouthProbe.index >= 0"), "real mouth parameter exists");
      await click('.transport-ab-switch .source-a');
      await range("Playback position", 4.2);
      await click('.transport-play');
      await open(`${id} vocal A opens`);
      await capture(`${id}-singing`);
      const beforeToggle = await run("window.__sourceStarts");
      await click('.vocal-lip-sync button');
      await closed(`${id} singing switched off`);
      assert.equal(await run(`document.querySelector('.vocal-lip-sync button').textContent`), "Start singing");
      assert.equal(await run("window.__sourceStarts"), beforeToggle, "singing toggle does not restart playback");
      await click('.vocal-lip-sync button');
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
      await click('.transport-ab-switch .source-b');
      await range("Playback position", 0);
      await closed(`${id} instrumental B`);
      await range("Playback position", 4.2);
      await closed(`${id} shorter B ended while A vocals play`);
      await click('.transport-ab-switch .source-a');
      await range("Playback position", 4.2);
      await open(`${id} back to actual vocals`);
      await range("Playback position", 9);
      await closed(`${id} instrumental outro`);
      await click('[aria-label="Pause"]');
      console.log(`PASS ${id}: actual vocals, instrumental rejection, A/B, ended source, volume, seek, pause/resume`);
    }
    await range("Playback position", 11.5);
    await click('.transport-play');
    await waitFor(`Boolean(document.querySelector('[aria-label="Play"]'))`, "track ends");
    await closed("end of track");
    await delay(500);
    await window.loadURL("vibloom://app/index.html");
    await ready("hiyori");
    await waitFor(`document.querySelector('.vocal-lip-sync button') && !document.querySelector('.vocal-lip-sync button').disabled`, "restored audio ready");
    await run(`window.Worker = class { constructor() { throw new Error('Saved timing should not run inference again'); } }; void 0;`);
    await click('.vocal-lip-sync button');
    await waitFor(`document.querySelector('.vocal-lip-sync button')?.textContent === 'Start singing' || document.querySelector('.vocal-lip-sync [role="alert"]')`, "saved A timing");
    assert.equal(await run(`document.querySelector('.vocal-lip-sync [role="alert"]')?.textContent ?? ''`), "");
    await click('.vocal-lip-sync button');
    await click('.transport-ab-switch .source-b');
    await waitFor(`document.querySelector('.vocal-lip-sync button')?.textContent === 'Vocal lip sync · On' || document.querySelector('.vocal-lip-sync [role="alert"]')`, "saved B timing");
    assert.equal(await run(`document.querySelector('.vocal-lip-sync [role="alert"]')?.textContent ?? ''`), "");
    console.log("PASS saved A/B analysis is reused after app reload without another worker");
    assert.deepEqual(errors, [], "no renderer errors");
    console.log(`PASS track end; screenshots: ${output}`);
  } catch (error) {
    console.error(error);
    exitCode = 1;
  } finally {
    clearTimeout(timer);
    window?.destroy();
    await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
    app.exit(exitCode);
  }
}
void smoke();
