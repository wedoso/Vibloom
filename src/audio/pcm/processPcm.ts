import { PcmWavEncoder } from "./wavEncoder";
type Reply = { type: string; message?: string; bytes?: ArrayBuffer; clippedSamples?: number; channels?: Float32Array[]; peak?: number; lufs?: number; gain?: number };
/** One in-flight chunk. Never detach the engine's AudioBuffer or copy a whole
 * song to a worker; terminate on every exit, including synchronous failures. */
export class PcmWorker {
  private readonly worker = new Worker(new URL("./pcm.worker.ts", import.meta.url), { type: "module" });
  private pending: { resolve: (reply: Reply) => void; reject: (error: unknown) => void } | null = null;
  private disposed = false;
  private abort = () => this.dispose(this.signal.reason ?? new DOMException("Cancelled", "AbortError"));
  constructor(private signal: AbortSignal) {
    this.worker.onmessage = ({ data }: MessageEvent<Reply>) => {
      if (data.type === "error") { this.dispose(new Error(data.message)); return; }
      const pending = this.pending; this.pending = null; pending?.resolve(data);
    };
    this.worker.onerror = event => this.dispose(new Error(event.message || "PCM worker failed."));
    this.worker.onmessageerror = () => this.dispose(new Error("PCM worker returned unreadable data."));
    signal.addEventListener("abort", this.abort, { once: true });
    if (signal.aborted) this.abort();
  }
  request(message: unknown, transfer: Transferable[] = []) {
    this.signal.throwIfAborted();
    if (this.disposed) return Promise.reject<Reply>(new Error("PCM worker was released."));
    if (this.pending) return Promise.reject<Reply>(new Error("PCM worker is busy."));
    return new Promise<Reply>((resolve, reject) => {
      this.pending = { resolve, reject };
      try { this.worker.postMessage(message, transfer); } catch (error) { this.dispose(error); }
    });
  }
  dispose(error: unknown = new Error("PCM worker was released.")) {
    if (this.disposed) return;
    this.disposed = true; this.signal.removeEventListener("abort", this.abort);
    const pending = this.pending; this.pending = null;
    this.worker.onmessage = null; this.worker.onerror = null; this.worker.onmessageerror = null; this.worker.terminate(); pending?.reject(error);
  }
}
const chunkFrames = 65536;
export async function encodePcmWav(buffer: AudioBuffer, signal: AbortSignal, onProgress: (fraction: number) => void, bitDepth: 16 | 24, random = Math.random) {
  signal.throwIfAborted();
  // An injected random stream is used by the upstream parity oracle. Production
  // uses the worker's equivalent Math.random TPDF distribution.
  if (random !== Math.random) {
    const encoder = new PcmWavEncoder(buffer.length, buffer.numberOfChannels, buffer.sampleRate, bitDepth);
    for (let first = 0; first < buffer.length; first += chunkFrames) {
      signal.throwIfAborted(); const end = Math.min(buffer.length, first + chunkFrames);
      encoder.append(Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c).subarray(first, end)), random);
      onProgress(end / buffer.length); await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    signal.throwIfAborted(); return encoder.finish();
  }
  const worker = new PcmWorker(signal);
  try {
    await worker.request({ type: "init", length: buffer.length, channels: buffer.numberOfChannels, rate: buffer.sampleRate, bitDepth });
    for (let first = 0; first < buffer.length; first += chunkFrames) {
      signal.throwIfAborted(); const end = Math.min(buffer.length, first + chunkFrames);
      const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c).slice(first, end));
      await worker.request({ type: "append", channels }, channels.map(c => c.buffer)); onProgress(end / buffer.length);
    }
    const reply = await worker.request({ type: "finish" }); signal.throwIfAborted();
    if (!reply.bytes || reply.clippedSamples === undefined) throw new Error("PCM worker returned incomplete WAV data.");
    return { bytes: reply.bytes, clippedSamples: reply.clippedSamples };
  } finally { worker.dispose(); }
}
export async function scanPcmPeaks(buffer: AudioBuffer, signal: AbortSignal, ceiling?: number, from = 0, to = buffer.length) {
  signal.throwIfAborted(); const worker = new PcmWorker(signal); let peak = 0;
  try {
    for (let first = 0; first < buffer.length; first += chunkFrames) {
      signal.throwIfAborted(); const end = Math.min(buffer.length, first + chunkFrames);
      const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c).slice(first, end));
      const reply = await worker.request({ type: "peaks", channels, ceiling, peakFrom: Math.max(0, from - first), peakTo: Math.min(end - first, to - first) }, channels.map(c => c.buffer)); signal.throwIfAborted();
      if (reply.peak === undefined || (ceiling !== undefined && !reply.channels)) throw new Error("PCM worker returned incomplete peak data.");
      peak = Math.max(peak, reply.peak);
      if (ceiling !== undefined) reply.channels!.forEach((data, c) => buffer.copyToChannel(data as Float32Array<ArrayBuffer>, c, first));
    }
    return peak;
  } finally { worker.dispose(); }
}
export async function measurePcmLoudness(buffer: AudioBuffer, signal: AbortSignal, target?: number) {
  signal.throwIfAborted(); const worker = new PcmWorker(signal);
  try {
    await worker.request({ type: "loudness-init", channels: buffer.numberOfChannels, rate: buffer.sampleRate });
    for (let first = 0; first < buffer.length; first += chunkFrames) {
      signal.throwIfAborted(); const end = Math.min(buffer.length, first + chunkFrames);
      const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c).slice(first, end));
      await worker.request({ type: "loudness-append", channels }, channels.map(c => c.buffer));
    }
    const reply = await worker.request({ type: "loudness-finish", target }); signal.throwIfAborted();
    if (reply.lufs === undefined) throw new Error("PCM worker returned incomplete loudness data.");
    if (reply.gain !== undefined) for (let first = 0; first < buffer.length; first += chunkFrames) {
      signal.throwIfAborted(); const end = Math.min(buffer.length, first + chunkFrames);
      const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c).slice(first, end));
      const normalized = await worker.request({ type: "gain", channels, gain: reply.gain }, channels.map(c => c.buffer)); signal.throwIfAborted();
      if (!normalized.channels) throw new Error("PCM worker returned incomplete normalized audio.");
      normalized.channels.forEach((data, c) => buffer.copyToChannel(data as Float32Array<ArrayBuffer>, c, first));
    }
    return reply.lufs;
  } finally { worker.dispose(); }
}
