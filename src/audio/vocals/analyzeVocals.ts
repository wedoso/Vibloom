import { VocalWorkerPool } from "./workerSession";
import { registerAudioJobResource, runAudioJob } from "../processingQueue";
import { VOCAL_FRAME_RATE, VOCAL_SAMPLE_RATE } from "./envelope";

export type VocalFrames = { rms: Float32Array; vowels: Uint8Array };
export type VocalProgress = { phase: string; progress: number };

const workerPool = new VocalWorkerPool(() => {
  const separator = new Worker(new URL("./separation.worker.ts", import.meta.url), { type: "module" });
  // Keep the official Core in a classic worker; preserve subpath/protocol URLs.
  try {
    const motion = new Worker(new URL(`${import.meta.env.BASE_URL}live2d/motionsync/motionsync.worker.js`, document.baseURI));
    return { separator, motion };
  } catch (error) { separator.terminate(); throw error; }
});

export const releaseIdleVocalWorkers = () => workerPool.releaseIdle();
const vocalResource = registerAudioJobResource(releaseIdleVocalWorkers);

async function runAnalysis(buffer: AudioBuffer, signal: AbortSignal, onProgress: (progress: VocalProgress) => void) {
  signal.throwIfAborted();
  const session = workerPool.acquire();
  const { separator, motion } = session;
  let chunkStart = 0, completed = false;
  const chunkSeconds = 24, contextSeconds = 2;
  const abort = () => workerPool.discard(session, new DOMException("Cancelled", "AbortError"));
  signal.addEventListener("abort", abort);
  const request = (worker: Worker, message: unknown, transfer: Transferable[] = []) => {
    signal.throwIfAborted();
    return session.request(worker, message, transfer, data => onProgress({
      phase: data.phase,
      progress: data.phase.startsWith("Separating vocals")
        ? Math.min(0.99, (chunkStart + data.progress * Math.min(chunkSeconds, buffer.duration - chunkStart)) / buffer.duration)
        : data.progress,
    }));
  };
  try {
    if (!session.initialized) {
      const ready = await request(separator, { type: "init" });
      session.backend = ready.backend ?? "";
      session.initialized = true;
    }
    const frames = new Float32Array(Math.ceil(buffer.duration * VOCAL_FRAME_RATE));
    const vowels = new Uint8Array(frames.length * 5);
    // Bound memory regardless of song length, with context on both sides of each
    // window. The package owns model preprocessing and overlap-add separation.
    for (let start = 0; start < buffer.duration; start += chunkSeconds) {
      chunkStart = start;
      signal.throwIfAborted();
      onProgress({ phase: `Separating vocals · ${session.backend}`, progress: start / buffer.duration });
      const from = Math.max(0, start - contextSeconds);
      const to = Math.min(buffer.duration, start + chunkSeconds + contextSeconds);
      const offline = new OfflineAudioContext(2, Math.ceil((to - from) * VOCAL_SAMPLE_RATE), VOCAL_SAMPLE_RATE);
      const source = offline.createBufferSource();
      source.buffer = buffer;
      source.connect(offline.destination);
      source.start(0, from, to - from);
      const resampled = await offline.startRendering();
      source.disconnect(); source.buffer = null;
      signal.throwIfAborted();
      const left = resampled.getChannelData(0).slice(), right = resampled.getChannelData(1).slice();
      const result = await request(separator, { type: "separate", left, right }, [left.buffer, right.buffer]);
      if (!result.frames || !result.mono) throw new Error("The vocal model returned no timing data.");
      onProgress({ phase: "Analyzing mouth shapes · MotionSync", progress: Math.min(.99, (start + Math.min(chunkSeconds, buffer.duration - start)) / buffer.duration) });
      const shape = await request(motion, { mono: result.mono }, [result.mono.buffer]);
      signal.throwIfAborted();
      if (!shape.vowels || shape.vowels.length !== result.frames.length * 5) throw new Error("MotionSync returned incomplete mouth shapes.");
      const skip = Math.round((start - from) * VOCAL_FRAME_RATE);
      const offset = Math.round(start * VOCAL_FRAME_RATE);
      const count = Math.min(chunkSeconds * VOCAL_FRAME_RATE, frames.length - offset);
      vowels.set(shape.vowels.subarray(skip * 5, (skip + count) * 5), offset * 5);
      frames.set(result.frames.subarray(skip, skip + count), offset);
    }
    completed = true;
    return { rms: frames, vowels };
  } finally {
    signal.removeEventListener("abort", abort);
    workerPool.release(session, completed && !signal.aborted);
  }
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
