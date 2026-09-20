import { app, BrowserWindow, net, protocol, session } from "electron";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const profile = await mkdtemp(path.join(tmpdir(), "vibloom-companions-"));
const output = path.join(root, "outputs/companion-smoke");
app.setPath("userData", profile);
protocol.registerSchemesAsPrivileged([{ scheme: "vibloom", privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true,
} }]);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let window;
let expectLoadFailure = false;
const errors = [];
async function smoke() {
  const timer = setTimeout(() => { console.error("Companion smoke test timed out"); app.exit(1); }, 150000);
  try {
    await app.whenReady();
    await mkdir(output, { recursive: true });
    protocol.handle("vibloom", (request) => {
      const file = path.resolve(root, "dist", `.${new URL(request.url).pathname}`);
      if (!file.startsWith(`${path.join(root, "dist")}${path.sep}`)) return new Response("Not found", { status: 404 });
      return net.fetch(pathToFileURL(file).href);
    });
    window = new BrowserWindow({ width: 1440, height: 1000, show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    window.webContents.setAudioMuted(true);
    window.webContents.on("console-message", (event) => {
      if ((event.level === "error" || event.level === 3) && !expectLoadFailure) errors.push(event.message);
    });
    const run = (code) => window.webContents.executeJavaScript(code, true);
    const waitFor = async (condition, label) => {
      for (let attempt = 0; attempt < 160; attempt += 1) {
        if (await run(condition)) return;
        await delay(100);
      }
      throw new Error(`Timed out: ${label}`);
    };
    const ready = (id) => waitFor(`document.querySelector('.live2d-stage[data-companion="${id}"][data-status="ready"]') && document.querySelectorAll('canvas.live2d-canvas').length === 1 && document.querySelector('canvas.live2d-canvas').style.visibility !== 'hidden'`, `${id} rendered`);
    const select = (id) => run(`document.querySelector('[aria-label="Music companion"]').value = ${JSON.stringify(id)}; document.querySelector('[aria-label="Music companion"]').dispatchEvent(new Event('change', { bubbles: true }));`);
    const click = (selector) => run(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const capture = async (name) => writeFile(path.join(output, `${name}.png`), (await window.webContents.capturePage()).toPNG());
    const position = () => run(`Number(document.querySelector('[aria-label="Playback position"]').value)`);
    const playing = () => run(`Boolean(document.querySelector('button[aria-label="Pause"]'))`);
    await window.loadURL("vibloom://app/index.html");
    await ready("hiyori");
    await run(`(() => {
      const createModel = Live2DCubismCore.Model.fromMoc;
      Live2DCubismCore.Model.fromMoc = function(...args) {
        const model = createModel.apply(this, args), update = model.update;
        const probe = window.__poseProbe = { eyeMin: 1, eyeMax: 0, gazeMin: 1, gazeMax: -1 };
        model.update = function(...args) {
          const values = model.parameters.values, ids = model.parameters.ids;
          const eye = values[ids.indexOf('ParamEyeLOpen')], gaze = values[ids.indexOf('ParamEyeBallX')];
          probe.eyeMin = Math.min(probe.eyeMin, eye); probe.eyeMax = Math.max(probe.eyeMax, eye);
          probe.gazeMin = Math.min(probe.gazeMin, gaze); probe.gazeMax = Math.max(probe.gazeMax, gaze);
          return update.apply(this, args);
        };
        return model;
      };
    })()`);
    await select("hong-xi");
    await ready("hong-xi");
    await run(`window.dispatchEvent(new PointerEvent('pointermove', { clientX: 0, clientY: 0 }));`);
    await delay(500);
    await run(`window.dispatchEvent(new PointerEvent('pointermove', { clientX: innerWidth, clientY: innerHeight }));`);
    await delay(500);
    assert.ok(await run(`window.__poseProbe.gazeMax - window.__poseProbe.gazeMin > 0.1`), "pointer tracking changes eye parameters");
    await waitFor(`window.__poseProbe.eyeMin < 0.5 && window.__poseProbe.eyeMax > 0.9`, "Hong Xi blinks");
    await capture("hong-xi-welcome");
    console.log("PASS both welcome models render");

    // Import through the actual file input, using deterministic PCM audio and LRC.
    await run(`(() => {
      window.__sourceStarts = 0;
      const originalStart = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function(...args) { window.__sourceStarts++; return originalStart.apply(this, args); };
      window.__testWav = (name, hz) => {
        const rate = 8000, samples = rate * 120, bytes = new ArrayBuffer(44 + samples * 2), view = new DataView(bytes);
        const text = (offset, value) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
        text(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
        view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
        view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
        text(36, 'data'); view.setUint32(40, samples * 2, true);
        for (let i = 0; i < samples; i++) view.setInt16(44 + i * 2, Math.sin(i / rate * hz * Math.PI * 2) * (0.15 + 0.6 * Math.exp(-(i / rate % 0.6) * 16)) * 16000, true);
        return new File([bytes], name, { type: 'audio/wav', lastModified: 1 });
      };
      const transfer = new DataTransfer();
      transfer.items.add(window.__testWav('Companion test.wav', 220));
      transfer.items.add(window.__testWav('Queue test.wav', 330));
      transfer.items.add(new File(['[00:00.00]Together with the music\\n[00:05.00]Keep the same clock\\n[00:20.00]Still listening'], 'Companion test.lrc', { type: 'text/plain' }));
      const input = document.querySelector('input[type="file"][multiple]'); input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await waitFor(`document.querySelector('#import-title')?.textContent === 'Import complete'`, "audio imported");
    await click('[aria-label="Close import summary"]');
    await ready("hong-xi");
    await waitFor(`document.querySelector('.transport-play') && !document.querySelector('.transport-play').disabled`, "transport ready");
    if (!await playing()) await click('.transport-play');
    await waitFor(`document.querySelector('button[aria-label="Pause"]') && Number(document.querySelector('[aria-label="Playback position"]').value) > 0.5`, "playback starts");
    await run(`(() => { const transfer = new DataTransfer(); transfer.items.add(window.__testWav('Mix B.wav', 440)); const input = document.querySelector('input[type="file"]:not([multiple]):not([accept^=".lrc"])'); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await waitFor(`document.querySelector('.transport-ab-switch .source-b')`, "comparison ready");
    await click('.transport-ab-switch .source-b');
    const before = await position();
    const starts = await run("window.__sourceStarts");
    for (const id of ["hiyori", "hong-xi", "hiyori", "hong-xi"]) {
      await select(id); await ready(id);
      assert.equal(await playing(), true);
      assert.equal(await run(`document.querySelector('.transport-ab-switch .source-b').getAttribute('aria-pressed')`), "true");
    }
    assert.equal(await run("window.__sourceStarts"), starts, "switching companions must not restart audio sources");
    assert.ok(await position() > before, "playhead keeps advancing");
    assert.ok(await run(`document.querySelector('.library-lyrics')?.textContent.includes('Keep the same clock')`));
    await capture("hong-xi-comparison");
    console.log("PASS A/B, lyrics and uninterrupted audio during model switching");

    await click('[title="Toggle automatic phrase-level framing"]');
    assert.equal(await run(`document.querySelector('[title="Toggle automatic phrase-level framing"]').getAttribute('aria-pressed')`), "true");
    await run(`document.querySelector('.live2d-host').dispatchEvent(new WheelEvent('wheel', { deltaY: -60, bubbles: true, cancelable: true }));`);
    assert.equal(await run(`document.querySelector('[title="Toggle automatic phrase-level framing"]').getAttribute('aria-pressed')`), "false");
    await click('[aria-label="Wide full-body framing"]');
    await delay(700);
    await capture("hong-xi-wide");
    await select("hiyori"); await ready("hiyori");
    assert.ok(await run(`document.querySelector('[aria-label="Wide full-body framing"]').classList.contains('is-active')`));
    await capture("hiyori-comparison");
    await select("hong-xi"); await ready("hong-xi");
    await click('[aria-label="Portrait upper-body framing"]');
    await click('[aria-label="Focus mode (F)"]');
    await waitFor(`document.querySelector('.is-library-focus') && !document.documentElement.classList.contains('is-scene-transitioning')`, "focus transition");
    await capture("hong-xi-focus");
    await click('[aria-label="Exit focus mode (F or Escape)"]');
    await delay(1100);
    await click('button[title="Library"]');
    await delay(1100);
    assert.equal(await run(`document.querySelectorAll('.track-table .track-index').length`), 2);
    assert.equal(await run(`document.querySelectorAll('.queue-list > div').length`), 2);
    await capture("hong-xi-library");
    await click('button[title="Player"]');
    await delay(1100);
    await click('[aria-label="Pause"]');
    const paused = await position();
    await select("hiyori"); await ready("hiyori");
    await select("hong-xi"); await ready("hong-xi");
    assert.equal(await playing(), false);
    assert.ok(Math.abs(await position() - paused) < 0.05);
    console.log("PASS cameras, focus, library, queue and paused position");

    for (let i = 0; i < 12; i++) { await select(i % 2 ? "hong-xi" : "hiyori"); await delay(35); }
    await ready("hong-xi");
    await delay(600);
    await window.loadURL("vibloom://app/index.html");
    await ready("hong-xi");
    assert.equal(await run(`document.querySelector('[aria-label="Music companion"]').value`), "hong-xi");
    assert.ok(await run(`document.querySelector('.has-library') !== null`));
    window.setSize(390, 844);
    await delay(1000);
    assert.ok(await run(`document.documentElement.scrollWidth <= window.innerWidth`), "mobile layout fits viewport");
    await capture("hong-xi-mobile");
    window.setSize(1440, 1000);
    console.log("PASS rapid switching, saved selection, restored library and mobile layout");

    // A failed model load must leave the player usable and release its canvas.
    await select("hiyori"); await ready("hiyori");
    expectLoadFailure = true;
    session.defaultSession.webRequest.onBeforeRequest({ urls: ["vibloom://app/live2d/hong-xi/*"] }, (_details, callback) => callback({ cancel: true }));
    await select("hong-xi");
    await waitFor(`document.querySelector('.model-error')`, "failed model error UI");
    assert.equal(await run(`document.querySelectorAll('canvas.live2d-canvas').length`), 0);
    await click('.transport-play');
    const failedModelPosition = await position();
    await delay(500);
    assert.ok(await position() > failedModelPosition, "audio works even when the model fails");
    session.defaultSession.webRequest.onBeforeRequest(null);
    await click('.model-error button');
    await ready("hong-xi");
    expectLoadFailure = false;
    assert.deepEqual(errors, [], "no unexpected renderer errors");
    console.log(`PASS load failure cleanup and retry; screenshots: ${output}`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    clearTimeout(timer);
    window?.destroy();
    await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
    app.exit(process.exitCode || 0);
  }

}
void smoke();
