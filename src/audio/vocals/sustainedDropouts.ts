import type { VocalCurves } from "./articulation";

type Analysis = { rms: Float32Array; vowels: Uint8Array };
export type Repair = { start: number; end: number };
const FRAME_RATE = 50;
const CONTEXT_FRAMES = 6;
const median = (a: number, b: number, c: number) => a + b + c - Math.min(a, b, c) - Math.max(a, b, c);
const dominant = (values: number[]) => values.indexOf(Math.max(...values));

// Adding voiced samples changes the population used by loudness normalization.
// Keep that change within each hole and the existing 40ms shape/closure kernel,
// rather than altering neighboring phrases or shifting the playback timeline.
export function localizeRepairs(original: VocalCurves, patched: VocalCurves, repairs: Repair[]): VocalCurves {
  const result = { open: original.open.slice(), form: original.form.slice(), vowels: original.vowels?.map(values => values.slice()) };
  for (const repair of repairs) {
    const start = Math.max(0, Math.round(repair.start * FRAME_RATE) - 2);
    const end = Math.min(original.open.length, Math.round(repair.end * FRAME_RATE) + 2);
    result.open.set(patched.open.subarray(start, end), start);
    result.form.set(patched.form.subarray(start, end), start);
    result.vowels?.forEach((values, channel) => values.set(patched.vowels![channel].subarray(start, end), start));
  }
  return result;
}

/** Repair short energy holes only inside stable voiced regions. Matching
 * surrounding vowels cannot rule out every consonant closure, so require
 * continuous context and strong, consistent vowel evidence on both sides. */
export function bridgeSustainedDropouts(analysis: Analysis) {
  let rms = analysis.rms, vowels = analysis.vowels;
  const repairs: Repair[] = [];
  const energy = rms.slice();
  for (let i = 1; i < rms.length - 1; i++) energy[i] = median(rms[i - 1], rms[i], rms[i + 1]);
  const shape = (start: number, end: number) => {
    const result = [0, 0, 0, 0, 0];
    let count = 0;
    for (let frame = start; frame < end; frame++) {
      const weights = analysis.vowels.subarray(frame * 5, frame * 5 + 5);
      const sum = weights.reduce((a, b) => a + b, 0);
      if (!sum) continue;
      weights.forEach((weight, channel) => result[channel] += weight / sum);
      count++;
    }
    return count >= 3 ? result.map(value => value / count) : null;
  };
  for (let start = 0; start < energy.length;) {
    if (energy[start] > 0) { start++; continue; }
    let end = start + 1;
    while (end < energy.length && energy[end] === 0) end++;
    // Production already bridges <=40ms. Only repair 60–100ms internal holes.
    if (end - start >= 3 && end - start <= 5 && start >= CONTEXT_FRAMES && end + CONTEXT_FRAMES <= energy.length) {
      const before = energy.subarray(start - CONTEXT_FRAMES, start);
      const after = energy.subarray(end, end + CONTEXT_FRAMES);
      const a = energy[start - 1], b = energy[end];
      const steady = before.every(value => value > 0) && after.every(value => value > 0)
        && Math.min(a, b) >= .012 && Math.min(a, b) / Math.max(a, b) >= .33;
      const left = steady ? shape(start - CONTEXT_FRAMES, start) : null;
      const right = steady ? shape(end, end + CONTEXT_FRAMES) : null;
      if (left && right) {
        const variation = left.reduce((sum, value, channel) => sum + Math.abs(value - right[channel]), 0) / 2;
        if (dominant(left) === dominant(right) && Math.max(...left) >= .6 && Math.max(...right) >= .6 && variation <= .2) {
          // Most songs need no repair; allocate replacement arrays only on a hit.
          if (!repairs.length) { rms = analysis.rms.slice(); vowels = analysis.vowels.slice(); }
          for (let frame = start; frame < end; frame++) {
            const fraction = (frame - start + 1) / (end - start + 1);
            rms[frame] = analysis.rms[frame] > 0 ? analysis.rms[frame] : a + (b - a) * fraction;
            for (let channel = 0; channel < 5; channel++) {
              vowels[frame * 5 + channel] = Math.round(255 * (left[channel] + (right[channel] - left[channel]) * fraction));
            }
          }
          repairs.push({ start: start / FRAME_RATE, end: end / FRAME_RATE });
        }
      }
    }
    start = end;
  }
  return { rms, vowels, repairs };
}
