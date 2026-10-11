import { VOCAL_FRAME_RATE, type VocalPose, SILENT_VOCAL_POSE } from "./envelope";

export type VocalCurves = { open: Float32Array; form: Float32Array; vowels?: Float32Array[] };
const VOWEL_FORMS = [.15, .5, 1, -.8, -1];
const median = (a: number, b: number, c: number) => a + b + c - Math.min(a, b, c) - Math.max(a, b, c);

/** MotionSync weights keep their continuous A/E/I/O/U identity. Vocal energy
 * owns jaw timing; shape recognition never invents openings during silence.
 * Preserve the lab's native smoothing without adding a delayed visual chase.
 */
export function buildVocalCurves(rms: Float32Array, weights: Uint8Array): VocalCurves {
  const n = rms.length;
  if (weights.length !== n * 5) throw new Error("Incomplete MotionSync vowel timeline.");
  const energy = rms.slice();
  for (let i = 1; i < n - 1; i++) energy[i] = median(rms[i - 1], rms[i], rms[i + 1]);
  // Bridge <=40 ms internal gate dropouts, retaining longer actual silence.
  for (let start = 0; start < n;) {
    if (energy[start] > 0) { start++; continue; }
    let end = start + 1;
    while (end < n && energy[end] === 0) end++;
    if (start > 0 && end < n && end - start <= 2) {
      const a = energy[start - 1], b = energy[end];
      for (let i = start; i < end; i++) energy[i] = a + (b - a) * (i - start + 1) / (end - start + 1);
    }
    start = end;
  }
  const block = VOCAL_FRAME_RATE * 2, references: number[] = [];
  for (let start = 0; start < n; start += block) {
    const values = Array.from(energy.subarray(start, start + block)).filter(v => v > 0).sort((a, b) => a - b);
    references.push(Math.max(.03, values[Math.floor((values.length - 1) * .9)] ?? .03));
  }
  const open = new Float32Array(n), form = new Float32Array(n).fill(NaN);
  const vowels = Array.from({ length: 5 }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) {
    const p = Math.max(0, i / block - .5), a = Math.floor(p), f = p - a;
    const reference = references[a] + ((references[a + 1] ?? references[a]) - references[a]) * f;
    const level = energy[i] > 0 ? .95 * Math.pow(Math.min(1, energy[i] / reference), .65) : 0;
    open[i] = level > 0 && i > 0 && Math.abs(level - open[i - 1]) < .035 ? open[i - 1] : level;
    const total = weights.subarray(i * 5, i * 5 + 5).reduce((sum, value) => sum + value, 0);
    if (open[i] === 0 || total === 0) continue;
    form[i] = 0;
    for (let j = 0; j < 5; j++) {
      vowels[j][i] = weights[i * 5 + j] / total;
      form[i] += vowels[j][i] * VOWEL_FORMS[j];
    }
  }
  return smoothVocalCurves({ open, form, vowels });
}

/** Jaw attack/release retains finite 40 ms tails. Shapes use a centered kernel
 * on the already-analyzed timeline, so changing weights cannot repeatedly
 * restart a causal transition and accumulate lag. Silence stays unvoiced. */
export function smoothVocalCurves(input: VocalCurves): VocalCurves {
  const open = new Float32Array(input.open.length), form = input.form.slice();
  for (let i = 0; i < open.length; i++) {
    const desired = input.open[i];
    const previous = input.open[i - 1] ?? 0, older = input.open[i - 2] ?? 0;
    // Finite kernels taper all the way to zero without truncating an exponential
    // tail. Faster opening, softer closing; no lookahead into preceding silence.
    open[i] = desired >= previous ? .55 * desired + .3 * previous + .15 * older : .35 * desired + .4 * previous + .25 * older;
  }
  const centered = (values: Float32Array) => Float32Array.from(values, (value, index) => {
    if (!Number.isFinite(value) || input.open[index] === 0) return value;
    let sum = 0, total = 0;
    for (let offset = -2; offset <= 2; offset++) {
      const at = index + offset, neighbor = values[at];
      if (at < 0 || at >= values.length || input.open[at] === 0 || !Number.isFinite(neighbor)) continue;
      const weight = 3 - Math.abs(offset);
      sum += neighbor * weight; total += weight;
    }
    return total > 0 ? sum / total : value;
  });
  // Preserve vowel identity as a blend, rather than reconstructing it from
  // ParamMouthForm (whose intermediate values are ambiguous).
  const vowels = input.vowels?.map(centered);
  return { open, form: centered(form), vowels };
}

export function sampleVocalCurves(curves: VocalCurves, time: number, volume: number): VocalPose {
  if (!Number.isFinite(time) || time < 0 || !Number.isFinite(volume) || volume <= 0) return SILENT_VOCAL_POSE;
  const position = time * VOCAL_FRAME_RATE, index = Math.floor(position), fraction = position - index;
  if (index >= curves.open.length) return SILENT_VOCAL_POSE;
  const open = interpolateCurve(curves.open, index, fraction);
  const a = curves.form[index], b = curves.form[index + 1];
  return { vowels: curves.vowels?.map(values => interpolateCurve(values, index, fraction)), open: open * Math.min(1, volume / .3), form: Number.isFinite(a) ? Number.isFinite(b) ? interpolateCurve(curves.form, index, fraction) : a : null };
}

/** Monotone cubic interpolation joins frame slopes without overshooting peaks
 * or creating extra openings between silent samples. */
function interpolateCurve(values: Float32Array, index: number, t: number) {
  const a = values[index], b = Number.isFinite(values[index + 1]) ? values[index + 1] : a;
  const before = Number.isFinite(values[index - 1]) ? values[index - 1] : a;
  const after = Number.isFinite(values[index + 2]) ? values[index + 2] : b;
  const slope = (x: number, y: number) => x * y > 0 ? 2 * x * y / (x + y) : 0;
  const m0 = slope(a - before, b - a), m1 = slope(b - a, after - b);
  return (2 * t ** 3 - 3 * t ** 2 + 1) * a + (t ** 3 - 2 * t ** 2 + t) * m0
    + (-2 * t ** 3 + 3 * t ** 2) * b + (t ** 3 - t ** 2) * m1;
}
