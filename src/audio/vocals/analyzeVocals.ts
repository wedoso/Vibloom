import { VOCAL_FRAME_RATE, VOCAL_SAMPLE_RATE } from "./envelope";

export type VocalProgress = { phase: string; progress: number };

export async function analyzeVocals(buffer: AudioBuffer, signal: AbortSignal, onProgress: (progress: VocalProgress) => void) {
  const worker = new Worker(new URL("./separation.worker.ts", import.meta.url), { type: "module" });
  let rejectPending: ((reason: unknown) => void) | null = null;
  let chunkStart = 0;
  const chunkSeconds = 24, contextSeconds = 2;
  const abort = () => { worker.terminate(); rejectPending?.(new DOMException("Cancelled", "AbortError")); };
  signal.addEventListener("abort", abort);
  const request = (message: unknown, transfer: Transferable[] = []) => new Promise<Float32Array | null>((resolve, reject) => {
    signal.throwIfAborted();
    rejectPending = reject;
    worker.onerror = () => reject(new Error("The vocal analysis worker could not start. Please retry."));
    worker.onmessage = ({ data }) => {
      if (data.type === "progress") onProgress({
        phase: data.phase,
        progress: data.phase === "Separating vocals"
          ? Math.min(0.99, (chunkStart + data.progress * Math.min(chunkSeconds, buffer.duration - chunkStart)) / buffer.duration)
          : data.progress,
      });
      else if (data.type === "error") reject(new Error(data.message));
      else if (data.type === "ready" || data.type === "result") resolve(data.frames ?? null);
    };
    worker.postMessage(message, transfer);
  });
  try {
    await request({ type: "init" });
    const frames = new Float32Array(Math.ceil(buffer.duration * VOCAL_FRAME_RATE));
    // Bound memory regardless of song length, with context on both sides of each
    // window. The package owns model preprocessing and overlap-add separation.
    for (let start = 0; start < buffer.duration; start += chunkSeconds) {
      chunkStart = start;
      signal.throwIfAborted();
      onProgress({ phase: "Separating vocals", progress: start / buffer.duration });
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
      frames.set(result.subarray(skip, skip + Math.min(chunkSeconds * VOCAL_FRAME_RATE, frames.length - offset)), offset);
    }
    return frames;
  } finally {
    signal.removeEventListener("abort", abort);
    worker.terminate();
  }
}
