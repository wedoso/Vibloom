import { PcmWavEncoder } from "./wavEncoder";
import { StreamingIntegratedLufs, normalizationGain } from "../mastering/loudness";
let encoder: PcmWavEncoder | null = null;
let loudness: StreamingIntegratedLufs | null = null;
self.onmessage = ({ data }) => {
  try {
    if (data.type === "init") { encoder = new PcmWavEncoder(data.length, data.channels, data.rate, data.bitDepth); self.postMessage({ type: "ready" }); }
    else if (data.type === "append") { if (!encoder) throw new Error("WAV encoder is not ready."); encoder.append(data.channels); self.postMessage({ type: "ready" }); }
    else if (data.type === "finish") { if (!encoder) throw new Error("WAV encoder is not ready."); const result = encoder.finish(); encoder = null; self.postMessage({ type: "result", ...result }, [result.bytes]); }
    else if (data.type === "loudness-init") { loudness = new StreamingIntegratedLufs(data.rate, data.channels); self.postMessage({ type: "ready" }); }
    else if (data.type === "loudness-append") { if (!loudness) throw new Error("Loudness meter is not ready."); loudness.append(data.channels); self.postMessage({ type: "ready" }); }
    else if (data.type === "loudness-finish") { if (!loudness) throw new Error("Loudness meter is not ready."); const lufs = loudness.value(); loudness = null; self.postMessage({ type: "result", lufs, gain: data.target === undefined ? undefined : normalizationGain(lufs, data.target) }); }
    else if (data.type === "gain") { for (const channel of data.channels as Float32Array[]) for (let i = 0; i < channel.length; i++) channel[i] *= data.gain; self.postMessage({ type: "result", channels: data.channels }, data.channels.map((c: Float32Array) => c.buffer)); }
    else if (data.type === "peaks") {
      let peak = 0;
      for (const channel of data.channels as Float32Array[]) for (let i = 0; i < channel.length; i++) {
        const value = channel[i]; if (i >= data.peakFrom && i < data.peakTo) peak = Math.max(peak, Math.abs(value));
        if (data.ceiling !== undefined) { if (value > data.ceiling) channel[i] = data.ceiling; else if (value < -data.ceiling) channel[i] = -data.ceiling; }
      }
      // Read-only scans return a scalar; don't transfer unchanged PCM back.
      if (data.ceiling === undefined) self.postMessage({ type: "result", peak });
      else self.postMessage({ type: "result", peak, channels: data.channels }, data.channels.map((c: Float32Array) => c.buffer));
    }
  } catch (error) { encoder = null; loudness = null; self.postMessage({ type: "error", message: error instanceof Error ? error.message : "PCM processing failed." }); }
};
