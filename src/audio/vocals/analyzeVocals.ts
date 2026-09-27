import { VOCAL_FRAME_RATE, VOCAL_SAMPLE_RATE } from "./envelope";

export type VocalFrames = { rms: Float32Array; visemes: Uint8Array };
export type VocalProgress = { phase: string; progress: number };

async function runAnalysis(buffer: AudioBuffer, signal: AbortSignal, onProgress: (progress: VocalProgress) => void) {
  const worker = new Worker(new URL("./separation.worker.ts", import.meta.url), { type: "module" });
  let rejectPending: ((reason: unknown) => void) | null = null;
  let chunkStart = 0;
  let backend = "";
  const chunkSeconds = 24, contextSeconds = 2;
  const abort = () => { worker.terminate(); rejectPending?.(new DOMException("Cancelled", "AbortError")); };
  signal.addEventListener("abort", abort);
  const request = (message: unknown, transfer: Transferable[] = []) => new Promise<VocalFrames | null>((resolve, reject) => {
    signal.throwIfAborted();
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
        resolve(data.frames ? { rms: data.frames, visemes: data.visemes } : null);
      }
    };
    worker.postMessage(message, transfer);
  });
  try {
    await request({ type: "init" });
    const frames = new Float32Array(Math.ceil(buffer.duration * VOCAL_FRAME_RATE));
    const visemes = new Uint8Array(frames.length).fill(14);
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
      signal.throwIfAborted();
      const left = resampled.getChannelData(0).slice(), right = resampled.getChannelData(1).slice();
      const result = await request({ type: "separate", left, right }, [left.buffer, right.buffer]);
      if (!result) throw new Error("The vocal model returned no timing data.");
      const skip = Math.round((start - from) * VOCAL_FRAME_RATE);
      const offset = Math.round(start * VOCAL_FRAME_RATE);
      visemes.set(result.visemes.subarray(skip, skip + Math.min(chunkSeconds * VOCAL_FRAME_RATE, frames.length - offset)), offset);
      frames.set(result.rms.subarray(skip, skip + Math.min(chunkSeconds * VOCAL_FRAME_RATE, frames.length - offset)), offset);
    }
    return { rms: frames, visemes };
  } finally {
    signal.removeEventListener("abort", abort);
    worker.terminate();
  }
}

// One model/PCM job at a time across Library and Player; rendering and playback
// continue independently. A failed/cancelled job never poisons the next job.
let queue: Promise<unknown> = Promise.resolve();
export function analyzeVocals(source: AudioBuffer | (() => Promise<AudioBuffer>), signal: AbortSignal, onProgress: (progress: VocalProgress) => void): Promise<VocalFrames> {
  onProgress({ phase: "Queued for vocal analysis", progress: 0 });
  const result = queue.then(async () => {
    signal.throwIfAborted();
    const buffer = typeof source === "function" ? await source() : source;
    signal.throwIfAborted();
    return runAnalysis(buffer, signal, onProgress);
  });
  queue = result.catch(() => undefined);
  return result;
}
