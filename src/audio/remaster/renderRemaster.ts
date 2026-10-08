import { runAudioJob } from "../processingQueue";
import { getRepairPreset, validateRepairInput } from "./presets";
import type { RenderMetrics } from "./wav";

export type RemasterProgress = { phase: string; progress: number };
export type RemasterResult = { blob: Blob; metrics: RenderMetrics };
export function renderRemaster(buffer: AudioBuffer, presetId: string, signal: AbortSignal, onProgress: (p: RemasterProgress) => void): Promise<RemasterResult> {
  validateRepairInput(buffer.sampleRate, buffer.length, buffer.numberOfChannels);
  getRepairPreset(presetId); signal.throwIfAborted();
  onProgress({ phase: "Queued for audio processing", progress: 0 });
  return runAudioJob(signal, () => new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./remaster.worker.ts", import.meta.url), { type: "module" });
    let offset = 0, settled = false;
    const dispose = () => {
      worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null;
      worker.terminate(); signal.removeEventListener("abort", abort);
    };
    const fail = (error: unknown) => { if (settled) return; settled = true; dispose(); reject(error); };
    const abort = () => fail(new DOMException("Cancelled", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    const send = () => {
      if (signal.aborted) { abort(); return; }
      // Only copy bounded windows. Never detach the player's original PCM.
      const end = Math.min(buffer.length, offset + Math.round(buffer.sampleRate * 2));
      const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c).slice(offset, end));
      offset = end;
      worker.postMessage({ type: "chunk", channels, final: end === buffer.length }, channels.map(x => x.buffer));
    };
    worker.onerror = () => fail(new Error("The remaster worker could not run. Please retry."));
    worker.onmessageerror = () => fail(new Error("Could not receive remaster audio."));
    worker.onmessage = ({ data }) => {
      if (settled) return;
      try {
        if (data.type === "ready") { onProgress({ phase: "Cleaning audio", progress: 0 }); send(); }
        else if (data.type === "next") { onProgress({ phase: "Cleaning audio", progress: data.progress }); send(); }
        else if (data.type === "progress") onProgress(data);
        else if (data.type === "error") fail(new Error(data.message));
        else if (data.type === "result") {
          if (!(data.buffer instanceof ArrayBuffer) || !Number.isInteger(data.byteLength) || data.byteLength < 44 || data.byteLength > data.buffer.byteLength) throw new Error("Invalid remaster result.");
          const blob = new Blob([new Uint8Array(data.buffer, 0, data.byteLength)], { type: "audio/wav" });
          settled = true; dispose(); resolve({ blob, metrics: data.metrics });
        }
      } catch (error) { fail(error); }
    };
    try {
      signal.throwIfAborted();
      worker.postMessage({ type: "init", rate: buffer.sampleRate, length: buffer.length, channels: buffer.numberOfChannels, presetId });
    } catch (error) { fail(error); }
  }));
}
