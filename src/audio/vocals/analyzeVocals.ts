import { runAudioJob } from "../processingQueue";
import { VOCAL_FRAME_RATE, VOCAL_SAMPLE_RATE } from "./envelope";

export type VocalFrames = { rms: Float32Array; vowels: Uint8Array };
export type VocalProgress = { phase: string; progress: number };

async function runAnalysis(buffer: AudioBuffer, signal: AbortSignal, onProgress: (progress: VocalProgress) => void) {
  const separator = new Worker(new URL("./separation.worker.ts", import.meta.url), { type: "module" });
  // Resolve at the document, so relative assets work on repository subpaths and
  // desktop custom protocols as well as localhost. Core stays in a classic worker.
  let motion: Worker;
  try { motion = new Worker(new URL(`${import.meta.env.BASE_URL}live2d/motionsync/motionsync.worker.js`, document.baseURI)); }
  catch (error) { separator.terminate(); throw error; }
  const workers = [separator, motion];
  const startupErrors = new Map<Worker, Error>();
  workers.forEach(worker => { worker.onerror = () => startupErrors.set(worker, new Error("The vocal analysis worker could not start. Please retry.")); });
  let rejectPending: ((reason: unknown) => void) | null = null;
  let chunkStart = 0;
  let backend = "";
  const chunkSeconds = 24, contextSeconds = 2;
  const abort = () => { workers.forEach(worker => worker.terminate()); rejectPending?.(new DOMException("Cancelled", "AbortError")); };
  signal.addEventListener("abort", abort);
  const request = (worker: Worker, message: unknown, transfer: Transferable[] = []) => new Promise<{ frames?: Float32Array; mono?: Float32Array; vowels?: Uint8Array; backend?: string }>((resolve, reject) => {
    signal.throwIfAborted();
    if (startupErrors.has(worker)) { reject(startupErrors.get(worker)); return; }
    rejectPending = reject;
    worker.onerror = () => reject(new Error("The vocal analysis worker could not start. Please retry."));
    worker.onmessage = ({ data }) => {
      if (data.type === "progress") onProgress({
        phase: data.phase,
        progress: data.phase.startsWith("Separating vocals")
          ? Math.min(0.99, (chunkStart + data.progress * Math.min(chunkSeconds, buffer.duration - chunkStart)) / buffer.duration)
          : data.progress,
      });
      else if (data.type === "error") reject(new Error(data.message));
      else if (data.type === "ready" || data.type === "result") {
        if (data.backend) backend = data.backend;
        rejectPending = null;
        resolve(data);
      }
    };
    worker.postMessage(message, transfer);
  });
  try {
    await request(separator, { type: "init" });
    const frames = new Float32Array(Math.ceil(buffer.duration * VOCAL_FRAME_RATE));
    const vowels = new Uint8Array(frames.length * 5);
    // Bound memory regardless of song length, with context on both sides of each
    // window. The package owns model preprocessing and overlap-add separation.
    for (let start = 0; start < buffer.duration; start += chunkSeconds) {
      chunkStart = start;
      signal.throwIfAborted();
      onProgress({ phase: `Separating vocals · ${backend}`, progress: start / buffer.duration });
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
      if (!shape.vowels || shape.vowels.length !== result.frames.length * 5) throw new Error("MotionSync returned incomplete mouth shapes.");
      const skip = Math.round((start - from) * VOCAL_FRAME_RATE);
      const offset = Math.round(start * VOCAL_FRAME_RATE);
      const count = Math.min(chunkSeconds * VOCAL_FRAME_RATE, frames.length - offset);
      vowels.set(shape.vowels.subarray(skip * 5, (skip + count) * 5), offset * 5);
      frames.set(result.frames.subarray(skip, skip + count), offset);
    }
    return { rms: frames, vowels };
  } finally {
    signal.removeEventListener("abort", abort);
    workers.forEach(worker => worker.terminate());
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
  });
}
