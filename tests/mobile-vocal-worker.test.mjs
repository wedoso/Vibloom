import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

test("shared Spleeter worker distinguishes GPU initialization failures from downloads and inference", async () => {
  const original = { self: globalThis.self, fixture: globalThis.__mobileWorkerFixture };
  const messages = [];
  let failure = "", destroyed = 0;
  const device = { destroy() { destroyed++; }, addEventListener() {}, lost: new Promise(() => {}) };
  globalThis.self = { postMessage(message) { messages.push(message); } };
  globalThis.__mobileWorkerFixture = {
    async loadSeparationRuntime() {
      if (failure === "runtime") throw new Error(failure);
      return { runtime: "fixture", ort: {
        env: { webgpu: { device } },
        InferenceSession: { async create() { if (failure === "session") throw new Error(failure); return {}; } },
      } };
    },
    async mobileModelSource() { if (failure === "download") throw new Error(failure); return { url: "fixture", blob: new Blob(), release() {} }; },
    async separateSpleeter() { throw new Error("inference"); },
  };
  const source = ts.transpileModule(await readFile(new URL("../src/audio/vocals/separation.worker.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText.replace(/^import .*;$/gm, "");
  const mocks = "const { loadSeparationRuntime, mobileModelSource, separateSpleeter } = globalThis.__mobileWorkerFixture; const objectSource = mobileModelSource; class SpleeterWorkspace {} const vocalEnvelope = () => {};";
  const module = variant => `data:text/javascript;base64,${Buffer.from(mocks + source + `\n// ${variant}`).toString("base64")}`;
  try {
    for (const mode of ["runtime", "session", "download"]) {
      failure = mode; messages.length = 0;
      await import(module(mode));
      await globalThis.self.onmessage({ data: { type: "init", backend: "webgpu" } });
      const error = messages.at(-1);
      assert.equal(error.type, "error"); assert.equal(error.message, mode);
      assert.equal(error.gpuInitialization, mode !== "download");
    }
    assert.equal(destroyed, 2, "partial GPU devices are destroyed on failed initialization");
    failure = ""; messages.length = 0;
    await import(module("inference"));
    await globalThis.self.onmessage({ data: { type: "init", backend: "webgpu" } });
    assert.equal(messages.at(-1).backend, "WebGPU");
    await globalThis.self.onmessage({ data: { type: "separate", left: new Float32Array(1), right: new Float32Array(1) } });
    assert.equal(messages.at(-1).message, "inference");
    assert.equal(messages.at(-1).gpuInitialization, false);
    failure = "session"; messages.length = 0;
    await import(module("cpu"));
    await globalThis.self.onmessage({ data: { type: "init", backend: "wasm" } });
    assert.equal(messages.at(-1).gpuInitialization, false, "CPU initialization errors cannot request GPU fallback");
  } finally {
    for (const [key, value] of Object.entries(original)) {
      const name = key === "fixture" ? "__mobileWorkerFixture" : key;
      if (value === undefined) delete globalThis[name]; else globalThis[name] = value;
    }
  }
});
