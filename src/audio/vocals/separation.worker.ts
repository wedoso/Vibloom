import type * as Ort from "onnxruntime-web";
import { loadSeparationRuntime } from "./separationRuntime";
import { mobileModelSource, objectSource } from "./mobileModel";
import { vocalEnvelope } from "./envelope";
import { separateSpleeter, SpleeterWorkspace } from "./spleeterSeparation";

// Shared Spleeter worker. The job owner selects GPU first and handles initialization-only
// CPU fallback in a fresh worker. Explicit diagnostics retain their backend.
const MODEL_BASE = "https://huggingface.co/csukuangfj/sherpa-onnx-spleeter-2stems-fp16/resolve/93ba771920ade509f8cbd6825b1a90856c797e08";
let ort: typeof Ort;
let runtime = "", backend = "";
const sessions: Ort.InferenceSession[] = [];
const workspace = new SpleeterWorkspace();
type GpuDevice = {
  addEventListener: (name: string, listener: (event: { error: { message: string } }) => void) => void;
  lost: Promise<{ message: string }>;
  queue: { onSubmittedWorkDone: () => Promise<void> };
  destroy: () => void;
};
let device: GpuDevice | undefined, disposing = false;
const report = (phase: string, progress: number, step: string) => self.postMessage({ type: "progress", phase, progress, step, runtime });
self.onmessage = async ({ data }) => {
  let gpuInitialization = false;
  try {
    if (data.type === "init") {
      if (disposing) throw new Error("Vocal worker has been released");
      if (sessions.length) throw new Error("Vocal model already initialized");
      const cpu = data.backend !== "webgpu";
      backend = cpu ? "WASM CPU" : "WebGPU";
      gpuInitialization = !cpu;
      ({ ort, runtime } = await loadSeparationRuntime(cpu));
      gpuInitialization = false;
      const models: Blob[] = [];
      for (const [index, name] of ["vocals", "accompaniment"].entries()) {
        report("Loading vocal model · Spleeter FP16", index / 2, "model-loading");
        const size = index ? 19681024 : 19681017;
        const saved = data.models?.[index];
        const model = saved instanceof Blob && saved.size === size ? objectSource(saved) : await mobileModelSource(`${MODEL_BASE}/${name}.fp16.onnx`, size,
          value => report("Downloading vocal model · Spleeter FP16", (index + value) / 2, "download"));
        if (!cpu) models.push(model.blob);
        try {
          gpuInitialization = !cpu;
          sessions.push(await ort.InferenceSession.create(model.url, {
            executionProviders: [cpu ? "wasm" : "webgpu"], graphOptimizationLevel: "all",
          }));
          gpuInitialization = false;
        } finally { model.release(); }
      }
      if (!cpu) {
        gpuInitialization = true;
        device = await ort.env.webgpu.device as GpuDevice | undefined;
        if (!device) throw new Error("WebGPU did not initialize. Use the CPU test on this device.");
        device.addEventListener("uncapturederror", event => { if (!disposing) self.postMessage({ type: "error", message: `WebGPU: ${event.error.message}` }); });
        void device.lost.then(info => { if (!disposing) self.postMessage({ type: "error", message: `WebGPU device lost: ${info.message}` }); }).catch(() => undefined);
        gpuInitialization = false;
      }
      // Share disk-backed Files / immutable Blobs with the job owner. This
      // avoids re-downloading on rotation even if persistent storage is denied.
      self.postMessage({ type: "ready", backend, runtime, models: cpu ? undefined : models });
    } else if (data.type === "dispose") {
      // Waiting for tensor disposal alone did not bound WebKit process memory.
      // Finish submitted work and destroy this worker's inference-only device.
      // The Live2D renderer owns a separate context and continues rendering.
      disposing = true;
      await device?.queue.onSubmittedWorkDone();
      try { for (const session of sessions.splice(0)) await session.release(); }
      finally { device?.destroy(); }
      self.postMessage({ type: "result" });
    } else if (data.type === "separate") {
      if (sessions.length !== 2) throw new Error("Vocal model is not initialized");
      report(`Separating vocals · ${backend}`, 0, "preprocessing");
      const result = await separateSpleeter(ort, sessions, data.left, data.right,
        value => report(`Separating vocals · ${backend}`, value, "inference"), workspace);
      const frames = vocalEnvelope(result.vocals.left, result.vocals.right, data.left, data.right);
      const mono = Float32Array.from(result.vocals.left, (value, index) => (value + result.vocals.right[index]) / 2);
      self.postMessage({ type: "result", frames, mono }, [frames.buffer, mono.buffer]);
    }
  } catch (error) {
    // A failed session cannot be reused; the owning pool terminates this worker.
    if (data.type === "init" && data.backend === "webgpu") {
      disposing = true;
      try { (await ort?.env.webgpu.device as GpuDevice | undefined)?.destroy(); } catch { /* Initialization may not have created a device. */ }
    }
    self.postMessage({ type: "error", gpuInitialization, message: error instanceof Error ? error.message : String(error) });
  }
};
