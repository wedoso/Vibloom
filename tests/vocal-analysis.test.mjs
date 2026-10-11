import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString("base64")}`;
const workerSession = moduleUrl(await readFile(new URL("../src/audio/vocals/workerSession.ts", import.meta.url), "utf8"));
const envelope = moduleUrl(await readFile(new URL("../src/audio/vocals/envelope.ts", import.meta.url), "utf8"));
const processingQueue = moduleUrl(await readFile(new URL("../src/audio/processingQueue.ts", import.meta.url), "utf8"));
const diagnostics = moduleUrl(await readFile(new URL("../src/audio/vocals/mobileDiagnostics.ts", import.meta.url), "utf8"));
const source = (await readFile(new URL("../src/audio/vocals/analyzeVocals.ts", import.meta.url), "utf8"))
  .replace('"./workerSession"', JSON.stringify(workerSession))
  .replace('"../processingQueue"', JSON.stringify(processingQueue))
  .replace('"./envelope"', JSON.stringify(envelope))
  .replace('"./mobileDiagnostics"', JSON.stringify(diagnostics))
  .replaceAll('new URL("./separation.worker.ts", import.meta.url)', '"separation.worker.ts"')
  .replaceAll('import.meta.env.BASE_URL', '"./"');
const { analyzeVocals, analyzeMobileVocals, releaseIdleVocalWorkers, mobileVocalBackendPreference } = await import(moduleUrl(source));
const { runAudioJob } = await import(processingQueue);

test("shared 12-second jobs preserve timing, release heaps and cancel queued work safely", async (t) => {
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
        queueMicrotask(() => this.onmessage({ data: { type: "progress", phase: "Separating vocals · fixture", progress: 1 } }));
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
    const updates = [];
    const result = await analyzeVocals({ duration: 50.013 }, controller.signal, update => updates.push(update));
    const processing = updates.filter(update => update.chunk !== undefined);
    assert.deepEqual([...new Set(processing.map(update => update.chunk))], [1, 2, 3, 4, 5]);
    assert.ok(processing.every(update => update.chunks === 5));
    for (let i = 1; i < processing.length; i++) assert.ok(processing[i].progress >= processing[i - 1].progress, "processing progress cannot go backwards between substeps or windows");
    const separation = processing.find(update => update.phase.startsWith("Separating") && update.progress > 0);
    const mouth = processing.find(update => update.phase.startsWith("Analyzing mouth"));
    const analyzed = processing.find(update => update.phase.startsWith("Mouth shapes analyzed"));
    assert.equal(separation.progress, mouth.progress, "separation leaves a share of the part for mouth analysis");
    assert.ok(analyzed.progress > mouth.progress, "only completed mouth analysis advances to the next part");
    assert.ok(processing.every(update => update.progress < 1), "100% is reserved for the saved result");
    assert.deepEqual(windows.map(window => window.from), [0, 10, 22, 34, 46]);
    assert.equal(result.rms.length, Math.ceil(50.013 * 50));
    assert.equal(result.vowels.length, result.rms.length * 5);
    for (let i = 0; i < result.rms.length; i++) {
      assert.ok(Math.abs(result.rms[i] - i % 100 / 100) < 1e-6, `RMS context at ${i}`);
      assert.equal(result.vowels[i * 5 + i % 5], 255, `vowel context at ${i}`);
    }
    assert.equal(workers.length, 2);
    assert.equal(initializations, 1);
    const again = await analyzeVocals({ duration: 50.013 }, new AbortController().signal, () => {});
    assert.deepEqual(again, result, "fresh sessions cannot change aligned outputs");
    assert.equal(workers.length, 4, "jobs release their heaps and initialize fresh workers");
    assert.equal(initializations, 2, "one initialization per completed job");
    assert.ok(requests.filter(r => r.type === "separate").every(r => r.transfer.length === 2));
    assert.ok(requests.filter(r => r.type === "motion").every(r => r.transfer.length === 1));
    mode = "hold";
    const cancel = new AbortController();
    const aborted = analyzeVocals({ duration: 1 }, cancel.signal, () => {});
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(held);
    t.mock.timers.tick(30_000);
    assert.ok(!workers.at(-1).terminated, "idle deadline cannot expire an active lease");
    const queuedCancel = new AbortController();
    const skipped = analyzeVocals({ duration: 1 }, queuedCancel.signal, () => {});
    queuedCancel.abort();
    await assert.rejects(skipped, { name: "AbortError" });
    assert.ok(!workers.at(-1).terminated, "cancelled waiting jobs cannot kill the active model");
    mode = "normal";
    const retry = analyzeVocals({ duration: .03 }, new AbortController().signal, () => {});
    assert.equal(workers.length, 5, "retry waits while the previous job owns workers");
    cancel.abort();
    await assert.rejects(aborted, error => error.name === "AbortError");
    const next = await retry;
    assert.equal(next.rms.length, 2);
    assert.equal(workers.length, 7, "cancelled inference gets fresh workers on retry");
    assert.ok(workers.every(worker => worker.terminated), "completed jobs release both heaps immediately");
    await analyzeVocals({ duration: .03 }, new AbortController().signal, () => {});
    assert.equal(workers.length, 9, "next job recreates its workers lazily");
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

test("mobile initializes before deferred decode, starts Core after separation and releases both heaps immediately", async () => {
  const original = { Worker: globalThis.Worker, document: globalThis.document, OfflineAudioContext: globalThis.OfflineAudioContext };
  const workers = [], events = [];
  const progress = [];
  let fail = "", holdInit;
  class Worker {
    constructor(url) { this.motion = String(url).includes("motionsync"); if (this.motion && fail === "construction") throw new Error("Core blocked"); workers.push(this); events.push(this.motion ? "Core created" : "separator created"); }
    terminate() { this.terminated = true; }
    postMessage(data) {
      const reply = () => {
        if (data.type === "init") {
          assert.equal(this.motion, false);
          this.onmessage({ data: { type: "progress", phase: "Loading vocal model", progress: 0, runtime: "wasm-simd" } });
          events.push("model ready"); this.onmessage({ data: { type: "ready", backend: "fixture" } });
        } else if (fail === "inference") this.onmessage({ data: { type: "error", message: "inference failed" } });
        else {
          events.push(this.motion ? "mouth shapes" : "separation done");
          this.onmessage({ data: this.motion ? { type: "result", vowels: new Uint8Array(10) } : { type: "result", frames: new Float32Array(2), mono: new Float32Array(882) } });
        }
      };
      if (fail === "cancel" && data.type === "init") holdInit = true; else queueMicrotask(reply);
    }
  }
  class Offline {
    constructor() { this.destination = {}; }
    createBufferSource() { return { start() {}, connect() {}, disconnect() {} }; }
    async startRendering() { return { getChannelData: () => new Float32Array(882) }; }
  }
  globalThis.Worker = Worker; globalThis.OfflineAudioContext = Offline; globalThis.document = { baseURI: "https://example.test/Vibloom/" };
  const source = async () => { events.push("decode"); return { duration: .03 }; };
  try {
    await analyzeMobileVocals(source, new AbortController().signal, update => progress.push(update));
    assert.equal(progress.find(update => update.runtime)?.runtime, "wasm-simd", "runtime metadata survives worker transport");
    assert.deepEqual(events, ["separator created", "model ready", "decode", "separation done", "Core created", "mouth shapes"]);
    assert.ok(workers.every(worker => worker.terminated), "no warm mobile runtime survives a completed job");
    for (const failure of ["inference", "construction"]) {
      fail = failure;
      await assert.rejects(analyzeMobileVocals(source, new AbortController().signal, () => {}));
      assert.ok(workers.every(worker => worker.terminated), "failed startup must not retain the separator");
    }
    fail = "cancel"; holdInit = false;
    const cancel = new AbortController();
    const job = analyzeMobileVocals(source, cancel.signal, () => {});
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(holdInit);
    cancel.abort(); await assert.rejects(job, { name: "AbortError" });
    assert.ok(workers.every(worker => worker.terminated));
    fail = "";
    const retry = await analyzeMobileVocals(source, new AbortController().signal, () => {});
    assert.equal(retry.rms.length, 2);
    assert.ok(workers.every(worker => worker.terminated));
  } finally {
    for (const [key, value] of Object.entries(original)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
  }
});

test("mobile backend diagnosis accepts only explicit CPU/GPU overrides", () => {
  assert.equal(mobileVocalBackendPreference("?vocalBackend=wasm"), "wasm");
  assert.equal(mobileVocalBackendPreference("?vocalBackend=webgpu"), "webgpu");
  assert.equal(mobileVocalBackendPreference("?ui=mobile"), "auto");
  assert.equal(mobileVocalBackendPreference("?vocalBackend=other"), "auto");
});

test("mobile prefers GPU and falls back only from automatic GPU initialization in a fresh worker", async () => {
  const original = { Worker: globalThis.Worker, document: globalThis.document, location: globalThis.location };
  const workers = [], initializations = [], progress = [];
  let failure = "", controller;
  class Worker {
    constructor(url) { this.motion = String(url).includes("motionsync"); workers.push(this); }
    terminate() { this.terminated = true; }
    postMessage(data) {
      queueMicrotask(() => {
        if (data.type === "init") {
          initializations.push({ backend: data.backend, worker: this });
          if (data.backend === "webgpu" && failure) {
            if (failure === "abort") controller.abort();
            this.onmessage({ data: { type: "error", message: failure, gpuInitialization: failure !== "download" } });
          } else this.onmessage({ data: { type: "ready", backend: data.backend === "webgpu" ? "WebGPU" : "WASM CPU" } });
        } else if (data.type === "separate" && failure === "inference") {
          this.onmessage({ data: { type: "error", message: "inference" } });
        } else this.onmessage({ data: data.type === "dispose" ? { type: "result" } : this.motion
          ? { type: "result", vowels: new Uint8Array(5) }
          : { type: "result", frames: new Float32Array(1), mono: new Float32Array(882) } });
      });
    }
  }
  globalThis.Worker = Worker; globalThis.document = { baseURI: "https://example.test/" }; globalThis.location = { search: "" };
  const source = { duration: .02, sampleRate: 44100, numberOfChannels: 1, getChannelData: () => new Float32Array(882) };
  const run = () => { controller = new AbortController(); return analyzeMobileVocals(source, controller.signal, update => progress.push(update)); };
  try {
    await run();
    assert.deepEqual(initializations.map(item => item.backend), ["webgpu"]);
    failure = "gpu unavailable"; initializations.length = 0;
    await run();
    assert.deepEqual(initializations.map(item => item.backend), ["webgpu", "wasm"]);
    assert.notEqual(initializations[0].worker, initializations[1].worker);
    assert.ok(initializations[0].worker.terminated, "failed Asyncify runtime cannot share the CPU worker");
    assert.ok(progress.some(update => update.step === "cpu-fallback"));
    globalThis.location.search = "?vocalBackend=webgpu"; initializations.length = 0;
    await assert.rejects(run(), /gpu unavailable/);
    assert.deepEqual(initializations.map(item => item.backend), ["webgpu"], "forced GPU diagnostics never silently switch CPU");
    globalThis.location.search = "?vocalBackend=wasm"; initializations.length = 0;
    await run();
    assert.deepEqual(initializations.map(item => item.backend), ["wasm"]);
    globalThis.location.search = "";
    for (const mode of ["download", "inference", "abort"]) {
      failure = mode; initializations.length = 0;
      // Inference failure happens after a successful GPU initialization.
      if (mode === "inference") failure = "";
      const job = analyzeMobileVocals(async () => { if (mode === "inference") failure = mode; return source; }, (controller = new AbortController()).signal, () => {});
      await assert.rejects(job, mode === "abort" ? { name: "AbortError" } : new RegExp(mode));
      assert.deepEqual(initializations.map(item => item.backend), ["webgpu"], `${mode} cannot trigger automatic retries`);
    }
    assert.ok(workers.every(worker => worker.terminated));
  } finally {
    for (const [key, value] of Object.entries(original)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
  }
});

test("mobile slices mono PCM into bounded windows without extra contexts and preserves every timing frame", async () => {
  const original = { Worker: globalThis.Worker, document: globalThis.document, OfflineAudioContext: globalThis.OfflineAudioContext };
  const workers = [], windows = [];
  let backend = "fixture", disposal = "normal", heldDispose = false;
  class Worker {
    constructor(url) { this.url = String(url); this.motion = this.url.includes("motionsync"); workers.push(this); }
    terminate() { this.terminated = true; }
    postMessage(data) {
      let reply;
      if (data.type === "init") reply = { type: "ready", backend };
      else if (data.type === "dispose") {
        this.disposals = (this.disposals ?? 0) + 1;
        if (disposal === "hold") { heldDispose = true; return; }
        reply = disposal === "fail" ? { type: "error", message: "GPU release failed" } : { type: "result" };
      }
      else if (this.motion) {
        const count = Math.ceil(data.mono.length / 882), vowels = new Uint8Array(count * 5);
        for (let i = 0; i < count; i++) vowels[i * 5 + data.mono[i * 882] % 5] = 255;
        reply = { type: "result", vowels };
      } else {
        windows.push({ first: data.left[0], seconds: data.left.length / 44100 });
        assert.deepEqual(data.right, data.left, "mono duplicated without retaining another full song");
        assert.notEqual(data.left.buffer, data.right.buffer, "each transferred channel owns its buffer");
        reply = { type: "result", mono: data.left, frames: Float32Array.from({ length: Math.ceil(data.left.length / 882) }, (_, i) => data.left[i * 882] % 100 / 100) };
      }
      queueMicrotask(() => this.onmessage({ data: reply }));
    }
  }
  globalThis.Worker = Worker; globalThis.document = { baseURI: "https://example.test/app/" };
  globalThis.OfflineAudioContext = class { constructor() { throw new Error("Unnecessary native PCM copy"); } };
  try {
    const pcm = Float32Array.from({ length: Math.ceil(50.013 * 44100) }, (_, i) => Math.floor(i / 882));
    const result = await analyzeMobileVocals({ duration: pcm.length / 44100, sampleRate: 44100, numberOfChannels: 1, getChannelData: () => pcm }, new AbortController().signal, () => {});
    assert.equal(workers[0].url, "separation.worker.ts", "both interfaces initialize the same Spleeter worker");
    assert.deepEqual(windows.map(window => window.first), [0, 500, 1100, 1700, 2300]);
    assert.ok(windows.every(window => window.seconds <= 16));
    for (let i = 0; i < result.rms.length; i++) {
      assert.ok(Math.abs(result.rms[i] - i % 100 / 100) < 1e-6, `RMS frame ${i}`);
      assert.equal(result.vowels[i * 5 + i % 5], 255, `vowel frame ${i}`);
    }
    assert.ok(workers.every(worker => worker.terminated));
    const desktop = await analyzeVocals({ duration: pcm.length / 44100, sampleRate: 44100, numberOfChannels: 1, getChannelData: () => pcm }, new AbortController().signal, () => {});
    assert.deepEqual(desktop, result, "desktop and mobile use identical windows and timing frames");
    backend = "WebGPU"; windows.length = 0;
    const gpuStart = workers.length;
    const input = { duration: pcm.length / 44100, sampleRate: 44100, numberOfChannels: 1, getChannelData: () => pcm };
    const gpu = await analyzeMobileVocals(input, new AbortController().signal, () => {});
    assert.deepEqual(gpu, result, "GPU worker rotation preserves context trimming and every curve frame");
    assert.deepEqual(workers.slice(gpuStart).filter(worker => !worker.motion).map(worker => worker.disposals), [1, 1, 1], "release each device before rotation or completion");
    assert.equal(workers.length - gpuStart, 6, "three bounded GPU lifetimes with fresh mouth workers");
    assert.ok(workers.every(worker => worker.terminated));
    disposal = "hold";
    const cancel = new AbortController(), pending = analyzeMobileVocals(input, cancel.signal, () => {});
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(heldDispose);
    cancel.abort(); await assert.rejects(pending, { name: "AbortError" });
    assert.ok(workers.every(worker => worker.terminated), "cancel during GPU release kills the active worker pair");
    disposal = "fail";
    await assert.rejects(analyzeMobileVocals(input, new AbortController().signal, () => {}), /GPU release failed/);
    assert.ok(workers.every(worker => worker.terminated));
    disposal = "normal";
    assert.deepEqual(await analyzeMobileVocals(input, new AbortController().signal, () => {}), result, "a failed release cannot poison retry");
  } finally {
    for (const [key, value] of Object.entries(original)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
  }
});
