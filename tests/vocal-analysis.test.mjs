import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString("base64")}`;
const workerSession = moduleUrl(await readFile(new URL("../src/audio/vocals/workerSession.ts", import.meta.url), "utf8"));
const envelope = moduleUrl(await readFile(new URL("../src/audio/vocals/envelope.ts", import.meta.url), "utf8"));
const processingQueue = moduleUrl(await readFile(new URL("../src/audio/processingQueue.ts", import.meta.url), "utf8"));
const source = (await readFile(new URL("../src/audio/vocals/analyzeVocals.ts", import.meta.url), "utf8"))
  .replace('"./workerSession"', JSON.stringify(workerSession))
  .replace('"../processingQueue"', JSON.stringify(processingQueue))
  .replace('"./envelope"', JSON.stringify(envelope))
  .replace('new URL("./separation.worker.ts", import.meta.url)', '"separation.worker.ts"')
  .replace('import.meta.env.BASE_URL', '"./"');
const { analyzeVocals, releaseIdleVocalWorkers } = await import(moduleUrl(source));
const { runAudioJob } = await import(processingQueue);

test("multi-window jobs preserve timing, reuse one model, expire idle workers and cancel safely", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const original = { Worker: globalThis.Worker, document: globalThis.document, OfflineAudioContext: globalThis.OfflineAudioContext };
  const workers = [], windows = [];
  let mode = "normal", held;
  let initializations = 0, requests = [];
  class Worker {
    constructor(url) { this.motion = String(url).includes("motionsync"); workers.push(this); }
    terminate() { this.terminated = true; }
    postMessage(data, transfer = []) {
      requests.push({ worker: this, type: data.type ?? "motion", transfer });
      if (data.type === "init") {
        initializations++;
        if (mode === "hold") { held = true; return; }
        queueMicrotask(() => this.onmessage({ data: { type: "ready", backend: "fixture" } })); return;
      }
      if (mode === "hold") { held = true; return; }
      if (this.motion) {
        const count = Math.ceil(data.mono.length / 882), vowels = new Uint8Array(count * 5);
        for (let i = 0; i < count; i++) vowels[i * 5 + Math.round(data.mono[i * 882]) % 5] = 255;
        queueMicrotask(() => this.onmessage({ data: { type: "result", vowels } }));
      } else {
        const count = Math.ceil(data.left.length / 882);
        const frames = Float32Array.from({ length: count }, (_, i) => Math.round(data.left[i * 882]) % 100 / 100);
        queueMicrotask(() => this.onmessage({ data: { type: "result", frames, mono: data.left } }));
      }
    }
  }
  class Offline {
    constructor(_channels, length, rate) { this.length = length; this.sampleRate = rate; this.destination = {}; }
    createBufferSource() { return { connect() {}, disconnect() { this.disconnected = true; }, start: (_when, offset) => { this.offset = offset; }, buffer: null }; }
    async startRendering() {
      windows.push({ from: this.offset, length: this.length });
      const samples = Float32Array.from({ length: this.length }, (_, i) => Math.round(this.offset * 50) + Math.floor(i / 882));
      return { getChannelData: () => samples };
    }
  }
  globalThis.Worker = Worker; globalThis.OfflineAudioContext = Offline; globalThis.document = { baseURI: "https://example.test/Vibloom/index.html" };
  try {
    const controller = new AbortController();
    const result = await analyzeVocals({ duration: 50.013 }, controller.signal, () => {});
    assert.deepEqual(windows.map(window => window.from), [0, 22, 46]);
    assert.equal(result.rms.length, Math.ceil(50.013 * 50));
    assert.equal(result.vowels.length, result.rms.length * 5);
    for (let i = 0; i < result.rms.length; i++) {
      assert.ok(Math.abs(result.rms[i] - i % 100 / 100) < 1e-6, `RMS context at ${i}`);
      assert.equal(result.vowels[i * 5 + i % 5], 255, `vowel context at ${i}`);
    }
    assert.equal(workers.length, 2);
    assert.equal(initializations, 1);
    const again = await analyzeVocals({ duration: 50.013 }, new AbortController().signal, () => {});
    assert.deepEqual(again, result, "warm model cannot change aligned outputs");
    assert.equal(workers.length, 2, "successful jobs share the same pair");
    assert.equal(initializations, 1, "weights and inference session initialize once");
    assert.ok(requests.filter(r => r.type === "separate").every(r => r.transfer.length === 2));
    assert.ok(requests.filter(r => r.type === "motion").every(r => r.transfer.length === 1));
    mode = "hold";
    const cancel = new AbortController();
    const aborted = analyzeVocals({ duration: 1 }, cancel.signal, () => {});
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(held);
    t.mock.timers.tick(30_000);
    assert.ok(workers.every(worker => !worker.terminated), "idle deadline cannot expire an active lease");
    const queuedCancel = new AbortController();
    const skipped = analyzeVocals({ duration: 1 }, queuedCancel.signal, () => {});
    queuedCancel.abort();
    await assert.rejects(skipped, { name: "AbortError" });
    assert.ok(workers.every(worker => !worker.terminated), "cancelled waiting jobs cannot kill the active model");
    mode = "normal";
    const retry = analyzeVocals({ duration: .03 }, new AbortController().signal, () => {});
    assert.equal(workers.length, 2, "retry waits while the previous job owns workers");
    cancel.abort();
    await assert.rejects(aborted, error => error.name === "AbortError");
    const next = await retry;
    assert.equal(next.rms.length, 2);
    assert.equal(workers.length, 4, "cancelled inference gets fresh workers on retry");
    assert.ok(workers.slice(0, 2).every(worker => worker.terminated));
    t.mock.timers.tick(14_999);
    assert.ok(workers.slice(2).every(worker => !worker.terminated));
    t.mock.timers.tick(1);
    assert.ok(workers.every(worker => worker.terminated), "idle pair is released after 15 seconds");
    await analyzeVocals({ duration: .03 }, new AbortController().signal, () => {});
    assert.equal(workers.length, 6, "expired model is recreated lazily");
    await runAudioJob(new AbortController().signal, async () => {
      assert.ok(workers.every(worker => worker.terminated), "other processing jobs release the warm model before allocating PCM");
    });
    releaseIdleVocalWorkers();
    assert.ok(workers.every(worker => worker.terminated));
  } finally {
    releaseIdleVocalWorkers();
    t.mock.timers.reset();
    for (const [key, value] of Object.entries(original)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
  }
});

test("startup, transport and inference failures discard warm workers without poisoning retries", async () => {
  const original = { Worker: globalThis.Worker, document: globalThis.document, OfflineAudioContext: globalThis.OfflineAudioContext };
  const workers = [];
  let mode = "normal", failMotionConstruction = false;
  class Worker {
    constructor(url) {
      this.motion = String(url).includes("motionsync");
      if (this.motion && failMotionConstruction) throw new Error("blocked classic worker");
      workers.push(this);
    }
    terminate() { this.terminated = true; }
    postMessage(data) {
      const fail = mode; mode = "normal";
      queueMicrotask(() => {
        if (fail === "crash") { this.onerror({}); return; }
        if (fail === "decode") { this.onmessageerror({}); return; }
        if (fail === "model") { this.onmessage({ data: { type: "error", message: "model failed" } }); return; }
        if (data.type === "init") { this.onmessage({ data: { type: "ready", backend: "fixture" } }); return; }
        this.onmessage({ data: this.motion ? { type: "result", vowels: new Uint8Array(10) } : { type: "result", frames: new Float32Array(2), mono: new Float32Array(882) } });
      });
      if (fail === "clone") throw new Error("transfer failed");
    }
  }
  class Offline {
    constructor() { this.destination = {}; }
    createBufferSource() { return { start() {}, connect() {}, disconnect() {} }; }
    async startRendering() { return { getChannelData: () => new Float32Array(882) }; }
  }
  globalThis.Worker = Worker; globalThis.OfflineAudioContext = Offline; globalThis.document = { baseURI: "https://example.test/Vibloom/index.html" };
  try {
    failMotionConstruction = true;
    await assert.rejects(analyzeVocals({ duration: .03 }, new AbortController().signal, () => {}), /blocked classic worker/);
    assert.ok(workers.every(worker => worker.terminated), "partial construction releases its separator");
    failMotionConstruction = false;
    for (const failure of ["crash", "decode", "model", "clone"]) {
      await analyzeVocals({ duration: .03 }, new AbortController().signal, () => {});
      mode = failure;
      await assert.rejects(analyzeVocals({ duration: .03 }, new AbortController().signal, () => {}));
      assert.ok(workers.every(worker => worker.terminated), `${failure} releases the entire pair`);
      const retry = await analyzeVocals({ duration: .03 }, new AbortController().signal, () => {});
      assert.equal(retry.rms.length, 2);
      assert.equal(retry.vowels.length, 10);
    }
    releaseIdleVocalWorkers();
    assert.ok(workers.every(worker => worker.terminated));
  } finally {
    releaseIdleVocalWorkers();
    for (const [key, value] of Object.entries(original)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
  }
});
