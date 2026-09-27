import * as ort from "onnxruntime-web/webgpu";
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";
import wasmModuleUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url";
import { DemucsProcessor } from "demucs-web";
import { vocalEnvelope } from "./envelope";

// Pin weights independently of changes to the upstream repository's main branch.
const MODEL_URL = "https://huggingface.co/timcsy/demucs-web-onnx/resolve/92e33df61cfc9eb820272aaa62d2ef6dcf4d950d/htdemucs_embedded.onnx";
const scope = self as unknown as {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};
let processor: DemucsProcessor | null = null;
let chunkSamples = 0;

async function loadWeights() {
  let cache: Cache | null = null;
  try { cache = await caches.open("vibloom-demucs-v1"); } catch { /* Private storage can be unavailable. */ }
  const cached = await cache?.match(MODEL_URL);
  if (cached) return cached.arrayBuffer();
  const response = await fetch(MODEL_URL, { credentials: "omit" });
  if (!response.ok || !response.body) throw new Error("Could not download the vocal model. Check your connection and retry.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0, lastProgress = -1;
  const total = Number(response.headers.get("content-length")) || 180534758;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.length;
    chunks.push(value);
    const progress = Math.min(1, length / total);
    if (progress - lastProgress >= 0.01) {
      lastProgress = progress;
      scope.postMessage({ type: "progress", phase: "Downloading vocal model", progress });
    }
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { await cache?.put(MODEL_URL, new Response(bytes)); } catch { /* Analysis still works without a persistent cache. */ }
  return bytes.buffer;
}

scope.onmessage = async ({ data }) => {
  try {
    if (data.type === "init") {
      scope.postMessage({ type: "progress", phase: "Loading vocal model", progress: 0 });
      // A single WASM thread also works on static GitHub Pages without COOP/COEP.
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: wasmModuleUrl };
      const weights = await loadWeights();
      scope.postMessage({ type: "progress", phase: "Starting vocal analysis", progress: 0 });
      processor = new DemucsProcessor({
        ort,
        sessionOptions: { executionProviders: ["webgpu", "wasm"], graphOptimizationLevel: "basic" },
        onProgress: ({ currentSegment }) => scope.postMessage({
          type: "progress", phase: "Separating vocals",
          progress: currentSegment / Math.ceil(chunkSamples / Math.floor(343980 * 0.75)),
        }),
      });
      await processor.loadModel(weights);
      scope.postMessage({ type: "ready" });
    } else if (data.type === "separate" && processor) {
      chunkSamples = data.left.length;
      const result = await processor.separate(data.left, data.right);
      const frames = vocalEnvelope(result.vocals.left, result.vocals.right, data.left, data.right);
      scope.postMessage({ type: "result", frames }, [frames.buffer]);
    }
  } catch (error) {
    scope.postMessage({ type: "error", message: error instanceof Error ? error.message : "Vocal analysis failed." });
  }
};
