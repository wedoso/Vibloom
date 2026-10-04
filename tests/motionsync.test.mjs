import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const core = await readFile(new URL("../public/live2d/motionsync/live2dcubismmotionsynccore.min.js", import.meta.url), "utf8");
const adapter = await readFile(new URL("../public/live2d/motionsync/motionsync.worker.js", import.meta.url), "utf8");
const wave = await readFile(new URL("fixtures/vocal-speech.wav", import.meta.url));
let offset = 12, dataStart = 0, dataSize = 0;
while (offset + 8 < wave.length) {
  const size = wave.readUInt32LE(offset + 4);
  if (wave.toString("ascii", offset, offset + 4) === "data") { dataStart = offset + 8; dataSize = size; break; }
  offset += 8 + size + (size % 2);
}
assert.ok(dataStart > 0);
const speech = Float32Array.from({ length: dataSize / 2 }, (_, i) => wave.readInt16LE(dataStart + i * 2) / 32768);

test("official Core produces compact causal weights equivalent to the selected lab, then resets on the next context", () => {
  const reports = [], events = [];
  const sandbox = vm.createContext({ console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, atob, self: { postMessage: report => reports.push(report) } });
  sandbox.importScripts = () => vm.runInContext(core, sandbox);
  vm.runInContext(adapter, sandbox);
  const api = sandbox.Live2DCubismMotionSyncCore;
  assert.equal(api.CubismMotionSyncEngine.csmMotionSyncGetEngineName(), "Live2DCubismMotionSyncEngine_CRI");
  const getCount = api.ToPointer.GetProcessedSampleCountFromAnalysisResult;
  const getValues = api.ToPointer.GetValuesFromAnalysisResult;
  let consumed = 0;
  api.ToPointer.GetProcessedSampleCountFromAnalysisResult = ptr => { const count = getCount(ptr); consumed += count; return count; };
  api.ToPointer.GetValuesFromAnalysisResult = (...args) => { const values = getValues(...args); events.push({ consumed, values }); return values; };
  sandbox.self.onmessage({ data: { mono: speech } });
  const report = reports[0];
  assert.equal(report.type, "result", report.message);
  assert.equal(report.vowels.length, Math.ceil(speech.length / 882) * 5);
  assert.ok(report.vowels.some(value => value > 100), "real voiced output");
  assert.ok(report.vowels.some((value, i) => value > 0 && i % 5 !== 0), "multiple recognized shapes");
  assert.deepEqual(Array.from(report.vowels.slice(0, 5)), [0, 0, 0, 0, 0], "no lookahead into frame zero");
  let cursor = 0, current = [0, 0, 0, 0, 0];
  for (let frame = 0; frame < report.vowels.length / 5; frame++) {
    while (cursor < events.length && events[cursor].consumed <= frame * 882) current = Array.from(events[cursor++].values.slice(0, 5), value => Math.max(0, Math.min(1, value)));
    const sum = current.reduce((a, b) => a + b, 0);
    const expected = current.map(value => sum > 1e-6 ? Math.round(value / sum * 255) : 0);
    assert.deepEqual(Array.from(report.vowels.slice(frame * 5, frame * 5 + 5)), expected);
  }
  for (const length of [44100, 1, 0]) {
    sandbox.self.onmessage({ data: { mono: new Float32Array(length) } });
    const result = reports.at(-1);
    assert.equal(result.type, "result", result.message);
    assert.equal(result.vowels.length, Math.ceil(length / 882) * 5);
    assert.ok(result.vowels.every(value => value === 0), "no previous-clip vowel state");
  }
});
