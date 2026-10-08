import { runAudioJob } from "../processingQueue";
import { validateRepairInput } from "../remaster/presets";
import type { RemasterProgress } from "../remaster/renderRemaster";
import { EQ_FREQUENCIES, getEqPreset } from "./presets";

/** Same five Web Audio nodes, order, Q and initial state as upstream's EQ
 * section. Other mastering, normalization and polish stages are excluded. */
export async function applyEq(buffer: AudioBuffer, presetId: string, signal: AbortSignal, progress: (p: RemasterProgress) => void = () => {}) {
  validateRepairInput(buffer.sampleRate, buffer.length, buffer.numberOfChannels);
  const preset = getEqPreset(presetId);
  signal.throwIfAborted();
  const context = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  const source = context.createBufferSource(); source.buffer = buffer;
  const filters = EQ_FREQUENCIES.map((frequency, i) => {
    const node = context.createBiquadFilter();
    node.type = i === 0 ? "lowshelf" : i === 4 ? "highshelf" : "peaking";
    node.frequency.value = frequency;
    if (i > 0 && i < 4) node.Q.value = 1;
    node.gain.value = preset.gains[i];
    return node;
  });
  const abort = () => { try { source.stop(); } catch { /* Rendering may have completed. */ } };
  signal.addEventListener("abort", abort, { once: true });
  try {
    source.connect(filters[0]);
    filters.forEach((node, i) => node.connect(filters[i + 1] ?? context.destination));
    progress({ phase: "Rendering EQ", progress: .1 });
    source.start();
    const result = await context.startRendering();
    signal.throwIfAborted();
    progress({ phase: "EQ rendered", progress: .8 });
    return result;
  } finally {
    signal.removeEventListener("abort", abort);
    source.disconnect(); source.buffer = null;
    for (const filter of filters) filter.disconnect();
  }
}

/** Upstream 24-bit encoding: round(sample * 0x7fffff), no dither or metadata.
 * Write directly from planar PCM to avoid its extra whole-song interleave copy. */
export async function encodeEqWav(buffer: AudioBuffer, signal: AbortSignal, progress: (p: RemasterProgress) => void = () => {}, bitDepth: 16 | 24 = 24, random = Math.random) {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const width = bitDepth / 8;
  const dataSize = buffer.length * channels.length * width, bytes = new ArrayBuffer(44 + dataSize), view = new DataView(bytes);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, "RIFF"); view.setUint32(4, bytes.byteLength - 8, true); text(8, "WAVE"); text(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels.length, true);
  view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * channels.length * width, true);
  view.setUint16(32, channels.length * width, true); view.setUint16(34, bitDepth, true); text(36, "data"); view.setUint32(40, dataSize, true);
  let offset = 44, clippedSamples = 0;
  for (let first = 0; first < buffer.length; first += 65536) {
    signal.throwIfAborted();
    const end = Math.min(buffer.length, first + 65536);
    for (let i = first; i < end; i++) for (const channel of channels) {
      const sample = channel[i];
      if (!Number.isFinite(sample)) throw new Error("EQ produced a non-finite sample.");
      if (Math.abs(sample) > 1) clippedSamples++;
      const max = bitDepth === 16 ? 0x7fff : 0x7fffff, min = bitDepth === 16 ? -0x8000 : -0x800000;
      const value = Math.max(min, Math.min(max, Math.round(Math.max(-1, Math.min(1, sample)) * max + (bitDepth === 16 ? random() - random() : 0))));
      if (bitDepth === 16) { view.setInt16(offset, value, true); offset += 2; }
      else { view.setUint8(offset++, value & 255); view.setUint8(offset++, value >> 8 & 255); view.setUint8(offset++, value >> 16 & 255); }
    }
    progress({ phase: "Preparing WAV", progress: .8 + .2 * end / buffer.length });
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  return { bytes, clippedSamples };
}

export function renderEq(source: () => Promise<AudioBuffer>, presetId: string, signal: AbortSignal, progress: (p: RemasterProgress) => void) {
  getEqPreset(presetId); signal.throwIfAborted();
  progress({ phase: "Queued for EQ", progress: 0 });
  return runAudioJob(signal, () => renderEqNow(source, presetId, signal, progress));
}

/** Caller owns the shared queue through result decoding and storage commit. */
export async function renderEqNow(source: () => Promise<AudioBuffer>, presetId: string, signal: AbortSignal, progress: (p: RemasterProgress) => void) {
    getEqPreset(presetId);
    signal.throwIfAborted();
    const buffer = await source(); signal.throwIfAborted();
    const rendered = await applyEq(buffer, presetId, signal, progress);
    const result = await encodeEqWav(rendered, signal, progress);
    signal.throwIfAborted();
    return { blob: new Blob([result.bytes], { type: "audio/wav" }), clippedSamples: result.clippedSamples };
}
