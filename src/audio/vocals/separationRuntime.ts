import cpuWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import cpuModuleUrl from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";
import gpuWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";
import gpuModuleUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url";

// Selecting the WASM provider in the WebGPU bundle still uses Asyncify. Load
// the CPU-only bundle for the mobile CPU test so it exercises plain WASM.
export async function loadSeparationRuntime(cpuOnly: boolean) {
  const ort = cpuOnly ? await import("onnxruntime-web/wasm") : await import("onnxruntime-web/webgpu");
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = cpuOnly ? { wasm: cpuWasmUrl, mjs: cpuModuleUrl } : { wasm: gpuWasmUrl, mjs: gpuModuleUrl };
  if (!cpuOnly) ort.env.webgpu.powerPreference = "high-performance";
  return { ort, runtime: cpuOnly ? "wasm-simd" : "webgpu-asyncify" };
}
