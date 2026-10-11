import { VocalGpuInitializationError, VocalWorkerPool } from "./workerSession";
import { registerAudioJobResource, runAudioJob } from "../processingQueue";
import { VOCAL_FRAME_RATE, VOCAL_SAMPLE_RATE } from "./envelope";
import { createMobileVocalTrace } from "./mobileDiagnostics";

export type VocalFrames = { rms: Float32Array; vowels: Uint8Array };
export type VocalProgress = { phase: string; progress: number; step?: string; runtime?: string; chunk?: number; chunks?: number };

// Both interfaces use the same backend policy; the query override also lets
// diagnostics compare GPU/CPU without ever mixing their inference heaps.
export function vocalBackendPreference(search = typeof location === "undefined" ? "" : location.search): "auto" | "wasm" | "webgpu" {
  const requested = new URLSearchParams(search).get("vocalBackend");
  return requested === "wasm" || requested === "webgpu" ? requested : "auto";
}
export const mobileVocalBackendPreference = vocalBackendPreference;

// One Spleeter/MotionSync implementation across desktop web, Electron and mobile.
// Delay Core until separated PCM exists and release inference heaps after each job.
const workerPool = new VocalWorkerPool(() => ({
  separator: new Worker(new URL("./separation.worker.ts", import.meta.url), { type: "module" }),
  motion: () => new Worker(new URL(`${import.meta.env.BASE_URL}live2d/motionsync/motionsync.worker.js`, document.baseURI)),
}), 0);
export const releaseIdleVocalWorkers = () => workerPool.releaseIdle();
export const releaseIdleMobileVocalWorkers = releaseIdleVocalWorkers;
const vocalResource = registerAudioJobResource(releaseIdleVocalWorkers);

async function runAnalysis(source: AudioBuffer | (() => Promise<AudioBuffer>), signal: AbortSignal, onProgress: (progress: VocalProgress) => void) {
  signal.throwIfAborted();
  const pool = workerPool;
  let session = pool.acquire();
  let buffer: AudioBuffer;
  let models: Blob[] | undefined;
  const preference = vocalBackendPreference();
  let backend = preference === "auto" ? "webgpu" : preference;
  let chunkStart = 0, completed = false, processing = false;
  const chunkSeconds = 12, contextSeconds = 2;
  // Work progress, not an elapsed-time estimate. A window only counts as
  // complete after MotionSync; reserve its final share for mouth analysis.
  const separationShare = .9;
  const report = (update: VocalProgress) => onProgress(processing
    ? { ...update, chunk: Math.floor(chunkStart / chunkSeconds) + 1, chunks: Math.ceil(buffer.duration / chunkSeconds) }
    : update);
  const abort = () => pool.discard(session, new DOMException("Cancelled", "AbortError"));
  signal.addEventListener("abort", abort);
  const request = (worker: Worker, message: unknown, transfer: Transferable[] = []) => {
    signal.throwIfAborted();
    return session.request(worker, message, transfer, data => report({
      phase: data.phase,
      step: data.step,
      runtime: data.runtime,
      progress: data.phase.startsWith("Separating vocals")
        ? Math.min(0.99, (chunkStart + Math.max(0, Math.min(1, data.progress)) * separationShare * Math.min(chunkSeconds, buffer.duration - chunkStart)) / buffer.duration)
        : processing ? chunkStart / buffer.duration : data.progress,
    }));
  };
  const initialize = async () => {
    if (!session.initialized) {
      let ready;
      try {
        ready = await request(session.separator, { type: "init", backend, models });
      } catch (error) {
        signal.throwIfAborted();
        if (preference !== "auto" || backend !== "webgpu" || !(error instanceof VocalGpuInitializationError)) throw error;
        // Use a fresh worker: CPU SIMD and GPU Asyncify runtimes must never
        // share an inference heap. Keep CPU for the rest of this job.
        pool.discard(session);
        backend = "wasm";
        report({ phase: "WebGPU unavailable · switching to WASM CPU", step: "cpu-fallback", progress: buffer ? chunkStart / buffer.duration : 0 });
        signal.throwIfAborted();
        session = pool.acquire();
        ready = await request(session.separator, { type: "init", backend, models });
      }
      models = ready.models;
      session.backend = ready.backend ?? "";
      session.initialized = true;
    }
  };
  try {
    await initialize();
    buffer = typeof source === "function" ? await source() : source;
    signal.throwIfAborted();
    const frames = new Float32Array(Math.ceil(buffer.duration * VOCAL_FRAME_RATE));
    const vowels = new Uint8Array(frames.length * 5);
    // Bound memory regardless of song length, with context on both sides of each
    // window. Each separator owns preprocessing and overlap-add reconstruction.
    for (let start = 0; start < buffer.duration; start += chunkSeconds) {
      chunkStart = start;
      processing = true;
      signal.throwIfAborted();
      if (session.backend === "WebGPU" && start > 0 && start % 24 === 0) {
        // Bound the lifetime of WebKit native GPU resources too, rather than
        // only JS tensors/WASM allocations. Cached weights stay on disk.
        report({ phase: "Refreshing GPU resources", step: "gpu-release", progress: start / buffer.duration });
        await request(session.separator, { type: "dispose" });
        pool.discard(session);
        signal.throwIfAborted();
        session = pool.acquire();
        await initialize();
      }
      report({ phase: `Separating vocals · ${session.backend}`, progress: start / buffer.duration });
      const from = Math.max(0, start - contextSeconds);
      const to = Math.min(buffer.duration, start + chunkSeconds + contextSeconds);
      let left: Float32Array, right: Float32Array;
      if (buffer.sampleRate === VOCAL_SAMPLE_RATE) {
        // No native rendering context is needed for already-resampled PCM.
        const begin = Math.round(from * VOCAL_SAMPLE_RATE), end = Math.round(to * VOCAL_SAMPLE_RATE);
        left = buffer.getChannelData(0).slice(begin, end);
        right = buffer.getChannelData(Math.min(1, buffer.numberOfChannels - 1)).slice(begin, end);
      } else {
        const offline = new OfflineAudioContext(2, Math.round((to - from) * VOCAL_SAMPLE_RATE), VOCAL_SAMPLE_RATE);
        const source = offline.createBufferSource();
        source.buffer = buffer;
        source.connect(offline.destination);
        source.start(0, from, to - from);
        const resampled = await offline.startRendering();
        source.disconnect(); source.buffer = null;
        left = resampled.getChannelData(0).slice(); right = resampled.getChannelData(1).slice();
      }
      signal.throwIfAborted();
      const result = await request(session.separator, { type: "separate", left, right }, [left.buffer, right.buffer]);
      if (!result.frames || !result.mono) throw new Error("The vocal model returned no timing data.");
      report({ phase: "Analyzing mouth shapes · MotionSync", progress: Math.min(.99, (start + separationShare * Math.min(chunkSeconds, buffer.duration - start)) / buffer.duration) });
      const shape = await request(session.motion, { mono: result.mono }, [result.mono.buffer]);
      signal.throwIfAborted();
      if (!shape.vowels || shape.vowels.length !== result.frames.length * 5) throw new Error("MotionSync returned incomplete mouth shapes.");
      const skip = Math.round((start - from) * VOCAL_FRAME_RATE);
      const offset = Math.round(start * VOCAL_FRAME_RATE);
      const count = Math.min(chunkSeconds * VOCAL_FRAME_RATE, frames.length - offset);
      vowels.set(shape.vowels.subarray(skip * 5, (skip + count) * 5), offset * 5);
      frames.set(result.frames.subarray(skip, skip + count), offset);
      report({ phase: "Mouth shapes analyzed · MotionSync", progress: Math.min(.99, (start + Math.min(chunkSeconds, buffer.duration - start)) / buffer.duration) });
    }
    if (session.backend === "WebGPU") await request(session.separator, { type: "dispose" });
    completed = true;
    return { rms: frames, vowels };
  } finally {
    signal.removeEventListener("abort", abort);
    pool.release(session, completed && !signal.aborted);
  }
}

// One model/PCM job at a time across all views; playback stays independent.
// Initialize before deferred decoding so model-loading allocations never overlap
// the full decoded song. Mobile wraps this same entry only to persist diagnostics.
export function analyzeVocals(source: AudioBuffer | (() => Promise<AudioBuffer>), signal: AbortSignal, onProgress: (progress: VocalProgress) => void): Promise<VocalFrames> {
  onProgress({ phase: "Queued for vocal analysis", progress: 0 });
  return runAudioJob(signal, () => runAnalysis(source, signal, onProgress), vocalResource);
}

export function analyzeMobileVocals(source: AudioBuffer | (() => Promise<AudioBuffer>), signal: AbortSignal, onProgress: (progress: VocalProgress) => void): Promise<VocalFrames> {
  const trace = createMobileVocalTrace(vocalBackendPreference());
  return analyzeVocals(source, signal, progress => { trace.update(progress); onProgress(progress); })
    .then(result => { trace.finish(); return result; }, error => { trace.finish(error, signal.aborted); throw error; });
}
