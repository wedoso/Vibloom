import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "./load-ts.mjs";
const { createMobileVocalTrace, MOBILE_VOCAL_DIAGNOSTICS_KEY: key } = await loadTs("../src/audio/vocals/mobileDiagnostics.ts");

test("mobile diagnosis persists real backend/stage across interruptions, bounds history and distinguishes errors/cancel", () => {
  const data = new Map(), storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) };
  const read = () => JSON.parse(data.get(key));
  const interrupted = createMobileVocalTrace("auto", storage);
  interrupted.update({ phase: "Separating vocals · WebGPU", step: "inference" });
  assert.equal(read().at(-1).status, "working"); assert.equal(read().at(-1).step, "inference");
  const cpu = createMobileVocalTrace("wasm", storage);
  cpu.update({ phase: "Loading vocal model", runtime: "wasm-simd" });
  cpu.update({ phase: "Separating vocals · WASM CPU", step: "reconstruction", runtime: undefined }); cpu.update({ phase: "Analyzing mouth shapes · MotionSync" }); cpu.finish();
  assert.equal(read()[0].step, "inference", "a new job cannot erase the interrupted stage");
  assert.equal(read()[1].status, "ready"); assert.equal(read()[1].requestedBackend, "wasm");
  assert.equal(read()[1].backend, "WASM CPU", "the final MotionSync phase cannot erase the actual inference backend");
  assert.equal(read()[1].runtime, "wasm-simd", "later phases cannot erase the runtime used for inference");
  const fail = createMobileVocalTrace("webgpu", storage); fail.finish(new Error("WebGPU GPUValidationError: invalid buffer"));
  assert.equal(read().at(-1).status, "error"); assert.match(read().at(-1).error, /GPUValidationError/);
  for (let i = 0; i < 3; i++) { const cancelled = createMobileVocalTrace("auto", storage); cancelled.finish(new Error("Cancelled"), true); }
  assert.equal(read().length, 4); assert.equal(read().at(-1).status, "cancelled");
  assert.ok(read().every(record => !Object.hasOwn(record, "file") && !Object.hasOwn(record, "audio")));
});

test("mobile diagnosis cannot fail analysis when storage is broken or full", () => {
  const storage = { getItem() { throw new Error("unavailable"); }, setItem() { throw new Error("quota"); } };
  assert.doesNotThrow(() => { const trace = createMobileVocalTrace("auto", storage); trace.update({ phase: "Loading" }); trace.finish(); });
});
