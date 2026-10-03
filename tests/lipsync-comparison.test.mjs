import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString("base64")}`;
const envelope = moduleUrl(await readFile(new URL("../src/audio/vocals/envelope.ts", import.meta.url), "utf8"));
const articulation = moduleUrl((await readFile(new URL("../src/audio/vocals/articulation.ts", import.meta.url), "utf8")).replace('"./envelope"', JSON.stringify(envelope)));
const curvesSource = (await readFile(new URL("../src/lipsync-lab/curves.ts", import.meta.url), "utf8")).replace('"../audio/vocals/articulation"', JSON.stringify(articulation));
const { comparisonCurves, motionFrames, strongest, wavBytes } = await import(moduleUrl(curvesSource));

test("comparison preserves common jaw and explicit MotionSync channel order through silence and vowel changes", () => {
  const rms = new Float32Array(100).fill(.1); rms.fill(0, 0, 10); rms.fill(0, 90);
  const head = new Uint8Array(100).fill(2);
  const weights = motionFrames([{ time: .2, values: [0, 0, 0, 0, 1, 0] }, { time: 1, values: [0, 1, 0, 0, 0, 0] }], 100);
  assert.equal(weights[5][9], 1, "no lookahead into preceding silence");
  assert.equal(weights[4][10], 1, "U is channel 4, not channel 2");
  const result = comparisonCurves(rms, head, weights);
  assert.deepEqual(result.head.open, result.motion.open);
  assert.equal(result.head.open[5], 0);
  assert.equal(result.motion.open[95], 0);
  assert.equal(strongest(result.head.vowels.map(w => w[30])), "I");
  assert.equal(strongest(result.motion.vowels.map(w => w[30])), "U");
  assert.equal(strongest(result.motion.vowels.map(w => w[70])), "E");
  assert.throws(() => comparisonCurves(rms, head.subarray(1), weights));
});

test("WAV export interleaves the same stereo samples used by both analyzers", () => {
  const channels = [new Float32Array([-.5, .5]), new Float32Array([1, -1])];
  const bytes = wavBytes({ numberOfChannels: 2, length: 2, sampleRate: 44100, getChannelData: i => channels[i] });
  const data = new DataView(bytes);
  assert.equal(bytes.byteLength, 52);
  assert.equal(data.getUint32(24, true), 44100);
  assert.equal(data.getUint16(22, true), 2);
  assert.deepEqual([44, 46, 48, 50].map(i => data.getInt16(i, true)), [-16384, 32767, 16383, -32768]);
});

test("official MotionSync Core analyzes real speech and can recreate contexts without stale state", async () => {
  const core = await readFile(new URL("../public/live2d/motionsync/live2dcubismmotionsynccore.min.js", import.meta.url), "utf8");
  const adapter = await readFile(new URL("../public/lipsync-lab/motionsync.worker.js", import.meta.url), "utf8");
  const wave = await readFile(new URL("fixtures/vocal-speech.wav", import.meta.url));
  let offset = 12, dataStart = 0, dataSize = 0;
  while (offset + 8 < wave.length) {
    const size = wave.readUInt32LE(offset + 4);
    if (wave.toString("ascii", offset, offset + 4) === "data") { dataStart = offset + 8; dataSize = size; break; }
    offset += 8 + size + (size % 2);
  }
  assert.ok(dataStart > 0);
  const speech = Float32Array.from({ length: dataSize / 2 }, (_, i) => wave.readInt16LE(dataStart + i * 2) / 32768);
  const reports = [];
  const sandbox = vm.createContext({ console: { log() {}, warn() {}, error() {} }, performance, setTimeout, clearTimeout, atob, self: { postMessage: report => reports.push(report) } });
  sandbox.importScripts = () => vm.runInContext(core, sandbox);
  vm.runInContext(adapter, sandbox);
  const analyze = mono => sandbox.self.onmessage({ data: { mono, sampleRate: 44100, smoothing: 60, scales: [1, 1, 1, 1, 1, 1] } });
  analyze(speech);
  assert.equal(reports[0].type, "result", reports[0].message);
  assert.equal(reports[0].engine, "Live2DCubismMotionSyncEngine_CRI");
  assert.ok(reports[0].events.length > 100);
  assert.ok(reports[0].events.every(e => e.values.length === 6 && e.values.every(Number.isFinite)));
  assert.ok(reports[0].events.some(e => Math.max(...e.values.slice(0, 5)) > .2), "real voiced output, not an empty stub");
  assert.ok(reports[0].events.every((e, i, all) => i === 0 || e.time > all[i - 1].time));
  analyze(new Float32Array(44100));
  assert.equal(reports[1].type, "result", reports[1].message);
  assert.ok(reports[1].events.every(e => e.values[5] > .99 && e.values.slice(0, 5).every(v => Math.abs(v) < 1e-5)), "new silent context does not retain prior speech");
});
