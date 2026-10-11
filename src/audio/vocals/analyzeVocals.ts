import { VocalGpuInitializationError, VocalWorkerPool } from "./workerSession";
import { registerAudioJobResource, runAudioJob } from "../processingQueue";
import { VOCAL_FRAME_RATE, VOCAL_SAMPLE_RATE } from "./envelope";
import { createMobileVocalTrace } from "./mobileDiagnostics";

export type VocalFrames = { rms: Float32Array; vowels: Uint8Array };
export type VocalProgress = { phase: string; progress: number; step?: string; runtime?: string };

// Diagnostic override for comparing backends on the same physical phone. It
// applies only to mobile analysis and never changes desktop execution policy.
export function mobileVocalBackendPreference(search = typeof location === "undefined" ? "" : location.search): "auto" | "wasm" | "webgpu" {
  const requested = new URLSearchParams(search).get("vocalBackend");
  return requested === "wasm" || requested === "webgpu" ? requested : "auto";
}

const workerPool = new VocalWorkerPool(() => {
  const separator = new Worker(new URL("./separation.worker.ts", import.meta.url), { type: "module" });
  // Keep the official Core in a classic worker; preserve subpath/protocol URLs.
  try {
    const motion = new Worker(new URL(`${import.meta.env.BASE_URL}live2d/motionsync/motionsync.worker.js`, document.baseURI));
    return { separator, motion };
  } catch (error) { separator.terminate(); throw error; }
});
// Mobile uses lighter Spleeter masks with the same MotionSync Core. Delay Core
// until the first vocal window and release both inference heaps after each job.
const mobileWorkerPool = new VocalWorkerPool(() => ({
  separator: new Worker(new URL("./mobileSeparation.worker.ts", import.meta.url), { type: "module" }),
  motion: () => new Worker(new URL(`${import.meta.env.BASE_URL}live2d/motionsync/motionsync.worker.js`, document.baseURI)),
}), 0);

export const releaseIdleVocalWorkers = () => workerPool.releaseIdle();
const vocalResource = registerAudioJobResource(releaseIdleVocalWorkers);
export const releaseIdleMobileVocalWorkers = () => mobileWorkerPool.releaseIdle();
const mobileVocalResource = registerAudioJobResource(releaseIdleMobileVocalWorkers);

async function runAnalysis(source: AudioBuffer | (() => Promise<AudioBuffer>), signal: AbortSignal, onProgress: (progress: VocalProgress) => void, mobile = false) {
  signal.throwIfAborted();
  const pool = mobile ? mobileWorkerPool : workerPool;
  let session = pool.acquire();
  let buffer: AudioBuffer;
  let models: Blob[] | undefined;
  const preference = mobile ? mobileVocalBackendPreference() : undefined;
  let backend = preference === "auto" ? "webgpu" : preference;
  let chunkStart = 0, completed = false;
  const chunkSeconds = mobile ? 12 : 24, contextSeconds = 2;
  const abort = () => pool.discard(session, new DOMException("Cancelled", "AbortError"));
  signal.addEventListener("abort", abort);
  const request = (worker: Worker, message: unknown, transfer: Transferable[] = []) => {
    signal.throwIfAborted();
    return session.request(worker, message, transfer, data => onProgress({
      phase: data.phase,
      step: data.step,
      runtime: data.runtime,
      progress: data.phase.startsWith("Separating vocals")
        ? Math.min(0.99, (chunkStart + data.progress * Math.min(chunkSeconds, buffer.duration - chunkStart)) / buffer.duration)
        : mobile && buffer && chunkStart > 0 ? chunkStart / buffer.duration : data.progress,
    }));
  };
  const initialize = async () => {
    if (!session.initialized) {
      let ready;
      try {
        ready = await request(session.separator, { type: "init", mobile, backend, models });
      } catch (error) {
        signal.throwIfAborted();
        if (preference !== "auto" || backend !== "webgpu" || !(error instanceof VocalGpuInitializationError)) throw error;
        // Use a fresh worker: CPU SIMD and GPU Asyncify runtimes must never
        // share an inference heap. Keep CPU for the rest of this job.
        pool.discard(session);
        backend = "wasm";
        onProgress({ phase: "WebGPU unavailable · switching to WASM CPU", step: "cpu-fallback", progress: buffer ? chunkStart / buffer.duration : 0 });
        signal.throwIfAborted();
        session = pool.acquire();
        ready = await request(session.separator, { type: "init", mobile, backend, models });
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
      signal.throwIfAborted();
      if (mobile && session.backend === "WebGPU" && start > 0 && start % 24 === 0) {
        // Bound the lifetime of WebKit native GPU resources too, rather than
        // only JS tensors/WASM allocations. Cached weights stay on disk.
        onProgress({ phase: "Refreshing GPU resources", step: "gpu-release", progress: start / buffer.duration });
        await request(session.separator, { type: "dispose" });
        pool.discard(session);
        signal.throwIfAborted();
        session = pool.acquire();
        await initialize();
      }
      onProgress({ phase: `Separating vocals · ${session.backend}`, progress: start / buffer.duration });
      const from = Math.max(0, start - contextSeconds);
      const to = Math.min(buffer.duration, start + chunkSeconds + contextSeconds);
      let left: Float32Array, right: Float32Array;
      if (mobile && buffer.sampleRate === VOCAL_SAMPLE_RATE) {
        // No native rendering context is needed for already-resampled PCM.
        const begin = Math.round(from * VOCAL_SAMPLE_RATE), end = Math.round(to * VOCAL_SAMPLE_RATE);
        left = buffer.getChannelData(0).slice(begin, end);
        right = buffer.getChannelData(Math.min(1, buffer.numberOfChannels - 1)).slice(begin, end);
      } else {
        const offline = new OfflineAudioContext(2, (mobile ? Math.round : Math.ceil)((to - from) * VOCAL_SAMPLE_RATE), VOCAL_SAMPLE_RATE);
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
      onProgress({ phase: "Analyzing mouth shapes · MotionSync", progress: Math.min(.99, (start + Math.min(chunkSeconds, buffer.duration - start)) / buffer.duration) });
      const shape = await request(session.motion, { mono: result.mono }, [result.mono.buffer]);
      signal.throwIfAborted();
      if (!shape.vowels || shape.vowels.length !== result.frames.length * 5) throw new Error("MotionSync returned incomplete mouth shapes.");
      const skip = Math.round((start - from) * VOCAL_FRAME_RATE);
      const offset = Math.round(start * VOCAL_FRAME_RATE);
      const count = Math.min(chunkSeconds * VOCAL_FRAME_RATE, frames.length - offset);
      vowels.set(shape.vowels.subarray(skip * 5, (skip + count) * 5), offset * 5);
      frames.set(result.frames.subarray(skip, skip + count), offset);
    }
    if (mobile && session.backend === "WebGPU") await request(session.separator, { type: "dispose" });
    completed = true;
    return { rms: frames, vowels };
  } finally {
    signal.removeEventListener("abort", abort);
    pool.release(session, completed && !signal.aborted);
  }
}

export function analyzeMobileVocals(source: AudioBuffer | (() => Promise<AudioBuffer>), signal: AbortSignal, onProgress: (progress: VocalProgress) => void): Promise<VocalFrames> {
  const trace = createMobileVocalTrace(mobileVocalBackendPreference());
  onProgress({ phase: "Queued for vocal analysis", progress: 0 });
  // Decode a deferred source after model initialization, rather than holding
  // its full PCM alongside the temporary model-loading allocations.
  return runAudioJob(signal, () => runAnalysis(source, signal, progress => { trace.update(progress); onProgress(progress); }, true), mobileVocalResource)
    .then(result => { trace.finish(); return result; }, error => { trace.finish(error, signal.aborted); throw error; });
}

// One model/PCM job at a time across Library and Player; rendering and playback
// continue independently. A failed/cancelled job never poisons the next job.
export function analyzeVocals(source: AudioBuffer | (() => Promise<AudioBuffer>), signal: AbortSignal, onProgress: (progress: VocalProgress) => void): Promise<VocalFrames> {
  onProgress({ phase: "Queued for vocal analysis", progress: 0 });
  return runAudioJob(signal, async () => {
    signal.throwIfAborted();
    const buffer = typeof source === "function" ? await source() : source;
    signal.throwIfAborted();
    return runAnalysis(buffer, signal, onProgress);
  }, vocalResource);
}
