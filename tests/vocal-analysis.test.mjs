import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString("base64")}`;
const envelope = moduleUrl(await readFile(new URL("../src/audio/vocals/envelope.ts", import.meta.url), "utf8"));
const processingQueue = moduleUrl(await readFile(new URL("../src/audio/processingQueue.ts", import.meta.url), "utf8"));
const source = (await readFile(new URL("../src/audio/vocals/analyzeVocals.ts", import.meta.url), "utf8"))
  .replace('"../processingQueue"', JSON.stringify(processingQueue))
  .replace('"./envelope"', JSON.stringify(envelope))
  .replace('new URL("./separation.worker.ts", import.meta.url)', '"separation.worker.ts"')
  .replace('import.meta.env.BASE_URL', '"./"');
const { analyzeVocals } = await import(moduleUrl(source));

test("multi-window jobs discard context consistently, queue safely and terminate both workers on cancel", async () => {
  const original = { Worker: globalThis.Worker, document: globalThis.document, OfflineAudioContext: globalThis.OfflineAudioContext };
  const workers = [], windows = [];
  let mode = "normal", held;
  class Worker {
    constructor(url) { this.motion = String(url).includes("motionsync"); workers.push(this); }
    terminate() { this.terminated = true; }
    postMessage(data) {
      if (data.type === "init") {
        if (mode === "hold") { held = true; return; }
        queueMicrotask(() => this.onmessage({ data: { type: "ready", backend: "fixture" } })); return;
      }
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
    createBufferSource() { return { connect() {}, start: (_when, offset) => { this.offset = offset; }, buffer: null }; }
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
    assert.ok(workers.every(worker => worker.terminated));
    mode = "hold";
    const cancel = new AbortController();
    const aborted = analyzeVocals({ duration: 1 }, cancel.signal, () => {});
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(held);
    mode = "normal";
    const retry = analyzeVocals({ duration: .03 }, new AbortController().signal, () => {});
    assert.equal(workers.length, 4, "retry waits while the previous job owns workers");
    cancel.abort();
    await assert.rejects(aborted, error => error.name === "AbortError");
    const next = await retry;
    assert.equal(next.rms.length, 2);
    assert.ok(workers.every(worker => worker.terminated));
  } finally {
    for (const [key, value] of Object.entries(original)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
  }
});
