import { encodePcmWav } from "../pcm/processPcm";
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
  return encodePcmWav(buffer, signal, fraction => progress({ phase: "Preparing WAV", progress: .8 + .2 * fraction }), bitDepth, random);
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
