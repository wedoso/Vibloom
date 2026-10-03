import { buildVocalCurves, smoothVocalCurves, type VocalCurves } from "../audio/vocals/articulation";

export const VOWELS = ["A", "E", "I", "O", "U"] as const;
export const HEAD_LABELS = ["A", "E", "I", "O", "U", "PP", "SS", "TH", "DD", "FF", "KK", "NN", "RR", "CH", "静音"];
export type MotionEvent = { time: number; values: number[] };

/** Zero-order sample at the output timestamp, with no invented lookahead. */
export function motionFrames(events: MotionEvent[], length: number) {
  const weights = Array.from({ length: 6 }, () => new Float32Array(length));
  let cursor = 0;
  let current = [0, 0, 0, 0, 0, 1];
  for (let i = 0; i < length; i++) {
    while (cursor < events.length && events[cursor].time <= i / 50) current = events[cursor++].values;
    current.forEach((v, channel) => { weights[channel][i] = Math.max(0, Math.min(1, v)); });
  }
  return weights;
}

/** Compare shape recognition on identical jaw timing and identical rig mapping.
 * HeadAudio keeps its existing label stabilization; CRI keeps native smoothing.
 * Both then use the app's same 100 ms visual transition filter.
 */
export function comparisonCurves(rms: Float32Array, labels: Uint8Array, weights: Float32Array[]) {
  if (labels.length !== rms.length || weights.length !== 6 || weights.some(w => w.length !== rms.length)) throw new Error("嘴形时间线长度不一致。");
  const jaw = buildVocalCurves(rms, new Uint8Array(rms.length).fill(14)).open;
  const head = buildVocalCurves(rms, labels);
  const form = new Float32Array(rms.length).fill(NaN);
  const vowels = weights.slice(0, 5).map(w => w.slice());
  const forms = [.15, .5, 1, -.8, -1];
  for (let i = 0; i < rms.length; i++) {
    const total = vowels.reduce((sum, w) => sum + w[i], 0);
    if (jaw[i] === 0 || total < 1e-6) { vowels.forEach(w => { w[i] = 0; }); continue; }
    vowels.forEach(w => { w[i] /= total; });
    form[i] = vowels.reduce((sum, w, j) => sum + w[i] * forms[j], 0);
  }
  const motion = smoothVocalCurves({ open: jaw, form, vowels });
  // Avoid filtering the shared jaw twice. Mouth opening must be exactly equal.
  const headCurves: VocalCurves = { ...head, open: jaw };
  const motionCurves: VocalCurves = { ...motion, open: jaw };
  return { head: headCurves, motion: motionCurves };
}

export function strongest(values: ArrayLike<number>, silence = "静音") {
  const a = Array.from(values);
  const index = a.reduce((best, value, i) => value > a[best] ? i : best, 0);
  return !a.length || a[index] < 1e-6 || index === 5 ? silence : VOWELS[index];
}

export function wavBytes(buffer: AudioBuffer) {
  const channels = buffer.numberOfChannels;
  const bytes = new ArrayBuffer(44 + buffer.length * channels * 2);
  const view = new DataView(bytes);
  const text = (offset: number, value: string) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, "RIFF"); view.setUint32(4, bytes.byteLength - 8, true); text(8, "WAVE");
  text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, channels, true); view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true); view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, bytes.byteLength - 44, true);
  const data = Array.from({ length: channels }, (_, i) => buffer.getChannelData(i));
  for (let i = 0; i < buffer.length; i++) for (let c = 0; c < channels; c++) {
    const sample = Math.max(-1, Math.min(1, data[c][i]));
    view.setInt16(44 + (i * channels + c) * 2, sample * (sample < 0 ? 32768 : 32767), true);
  }
  return bytes;
}
