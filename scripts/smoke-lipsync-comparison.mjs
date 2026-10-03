import { app, BrowserWindow, net, protocol, session } from "electron";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const profile = await mkdtemp(path.join(tmpdir(), "vibloom-comparison-"));
const output = path.join(root, "outputs/lipsync-comparison");
app.setPath("userData", profile);
app.on("window-all-closed", () => {});
protocol.registerSchemesAsPrivileged([{ scheme: "vibloom", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let window;
let exitCode = 0;

async function smoke() {
const watchdog = setTimeout(() => { console.error("Comparison smoke timed out"); app.exit(1); }, 360000);
try {
  await app.whenReady(); await mkdir(output, { recursive: true });
  protocol.handle("vibloom", request => {
    const url = new URL(request.url);
    if (url.pathname === "/__fixture.wav") return net.fetch(pathToFileURL(path.resolve(process.env.VIBLOOM_LAB_VOICE ?? path.join(root, "tests/fixtures/vocal-speech.wav"))).href);
    if (url.pathname === "/__model.onnx" && process.env.VIBLOOM_TEST_VOCAL_MODEL) return net.fetch(pathToFileURL(path.resolve(process.env.VIBLOOM_TEST_VOCAL_MODEL)).href);
    const file = path.resolve(root, "dist", `.${url.pathname}`);
    if (!file.startsWith(`${path.join(root, "dist")}${path.sep}`)) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(file).href);
  });
  if (process.env.VIBLOOM_TEST_VOCAL_MODEL) session.defaultSession.webRequest.onBeforeRequest({ urls: ["https://huggingface.co/*"] }, (_request, callback) => callback({ redirectURL: "vibloom://app/__model.onnx" }));
  window = new BrowserWindow({ width: 1440, height: 1120, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  window.webContents.setAudioMuted(true);
  const errors = [];
  window.webContents.on("console-message", event => { if (event.level === "error" || event.level === 3) errors.push(event.message); });
  const run = code => window.webContents.executeJavaScript(code, true);
  const waitFor = async (code, label, seconds = 30) => {
    console.log(`CHECK ${label}`);
    const deadline = Date.now() + seconds * 1000;
    while (Date.now() < deadline) {
      if (await run(code)) return;
      await delay(100);
    }
    throw new Error(`${label}: ${await run("document.querySelector('.lab-error')?.textContent ?? document.querySelector('.lab-status')?.textContent")}`);
  };
  const click = text => run(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent === ${JSON.stringify(text)}); if (!b || b.disabled) throw new Error('Missing enabled button'); b.click(); })()`);
  const setSelect = (index, value) => run(`(() => { const e = document.querySelectorAll('.lab-controls select')[${index}]; e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('change', {bubbles:true})); })()`);
  const modelsReady = () => waitFor(`document.querySelectorAll('.lab-model-frame').length === 2 && [...document.querySelectorAll('.lab-model-frame')].every(f => f.contentDocument?.querySelector('.live2d-stage[data-status="ready"]'))`, "two isolated models ready");
  const capture = async name => writeFile(path.join(output, `${name}.png`), (await window.webContents.capturePage()).toPNG());
  await window.loadURL("vibloom://app/lipsync-lab.html"); await modelsReady();
  await setSelect(0, "false");
  await run(`(async () => {
    const bytes = await (await fetch('./__fixture.wav')).arrayBuffer();
    const transfer = new DataTransfer(); transfer.items.add(new File([bytes], 'test-voice.wav', {type:'audio/wav'}));
    const input = document.querySelector('input[type=file]'); input.files = transfer.files; input.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await waitFor(`!document.querySelector('input[type=file]').disabled && document.querySelector('.lab-status').textContent.includes('已读取')`, "voice decoded");
  await click("分析两种方案");
  await waitFor(`document.querySelector('.lab-status').textContent.includes('两种方案已就绪')`, "both analyzers finished");
  // Capture the exported report through the real download flow.
  const nextDownload = new Promise((resolve, reject) => session.defaultSession.once("will-download", (_event, item) => {
    const destination = path.join(output, "direct-report.json"); item.setSavePath(destination);
    item.once("done", (_event, state) => state === "completed" ? resolve(destination) : reject(new Error(`Download ${state}`)));
  }));
  await click("导出对比记录");
  const report = JSON.parse(await readFile(await nextDownload, "utf8"));
  assert.equal(report.input, "provided-vocals"); assert.equal(report.motionSync.engine, "Live2DCubismMotionSyncEngine_CRI");
  assert.ok(report.motionWeights.some((w, i) => i < 5 && w.some(v => v > .1)));
  assert.ok(new Set(report.headRawLabels).size > 1);
  assert.equal(report.motionWeights[0].length, report.rms.length);
  assert.equal(await run("document.querySelectorAll('audio').length"), 1);
  for (const frame of window.webContents.mainFrame.frames) {
    if (!frame.url.endsWith("lipsync-model.html")) continue;
    await frame.executeJavaScript(`(() => {
      window.__mouthSamples = [];
      const original = Live2DCubismCore.Model.prototype.update;
      Live2DCubismCore.Model.prototype.update = function(...args) {
        const ids = this.parameters.ids, values = this.parameters.values;
        const open = values[ids.indexOf('ParamMouthOpenY')], form = values[ids.indexOf('ParamMouthForm')];
        window.__mouthSamples.push({open,form}); if(window.__mouthSamples.length > 1000) window.__mouthSamples.shift();
        return original.apply(this,args);
      };
    })()`, true);
  }
  await click("播放"); await delay(Math.min(2500, report.clipDuration * 700));
  await capture("playing-hong-xi");
  const samples = await run(`[...document.querySelectorAll('.lab-model-frame')].map(f => f.contentWindow.__mouthSamples)`);
  assert.ok(samples.every(s => s.length > 10 && s.some(v => v.open > .03)), "both actual rig mouths open");
  await click("暂停"); await delay(500);
  const paused = await run(`[...document.querySelectorAll('.lab-model-frame')].map(f => f.contentWindow.__mouthSamples.at(-1)?.open)`);
  assert.ok(paused.every(v => v < .015), "both actual mouths close on pause");
  await run(`(() => { const e=document.querySelector('[aria-label="共同播放位置"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,1); e.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await delay(150); assert.ok(Math.abs(await run("document.querySelector('audio').currentTime") - 1) < .1);
  await click("记录：差不多"); assert.equal(await run("document.querySelectorAll('.lab-review li').length"), 1);
  await click("删除"); assert.equal(await run("document.querySelectorAll('.lab-review li').length"), 0);
  await setSelect(2, "hiyori");
  await waitFor(`[...document.querySelectorAll('.lab-model-frame')].every(f => f.contentDocument.querySelector('.live2d-stage[data-status="ready"]')?.dataset.companion === 'hiyori')`, "both Hiyori loaded");
  await capture("paused-hiyori");
  window.setContentSize(390, 844); await delay(400);
  assert.equal(await run("document.documentElement.scrollWidth <= window.innerWidth"), true, "mobile has no horizontal overflow");
  await capture("mobile"); window.setContentSize(1440, 1120);
  if (process.env.VIBLOOM_TEST_VOCAL_MODEL) {
    await setSelect(0, "true"); await click("分析两种方案");
    await delay(50); await click("取消分析");
    await waitFor(`document.querySelector('.lab-status').textContent.includes('已取消')`, "cancel worker job");
    await click("分析两种方案");
    await waitFor(`document.querySelector('.lab-status').textContent.includes('两种方案已就绪')`, "shared separation and both analyzers finished", 240);
    assert.equal(await run("Boolean(document.querySelector('.lab-error'))"), false);
    await capture("shared-separation");
  }
  assert.deepEqual(errors, [], "no renderer/CSP errors");
  await writeFile(path.join(output, "smoke.json"), JSON.stringify({ checks: ["official-core", "head-audio", "shared-clock", "real-mouths-open", "pause-closes", "seek", "annotations", "both-models", "responsive", ...(process.env.VIBLOOM_TEST_VOCAL_MODEL ? ["cancel-retry", "shared-separation"] : [])], errors, timings: report.timings }, null, 2));
  console.log(`PASS lip-sync comparison; artifacts: ${output}`);
} catch (error) { console.error(error); exitCode = 1; }
finally { clearTimeout(watchdog); window?.destroy(); await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); app.exit(exitCode); }
}
void smoke();
