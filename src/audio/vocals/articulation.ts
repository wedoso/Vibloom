import { VOCAL_FRAME_RATE, type VocalPose, SILENT_VOCAL_POSE } from "./envelope";

export type VocalCurves = { open: Float32Array; form: Float32Array };
type Segment = { start: number; end: number; value: number };
const VOWEL_FORMS = [.15, .5, 1, -.8, -1];
const segments = (values: ArrayLike<number>): Segment[] => {
  const result: Segment[] = [];
  for (let start = 0; start < values.length;) {
    let end = start + 1;
    while (end < values.length && values[end] === values[start]) end++;
    result.push({ start, end, value: values[start] }); start = end;
  }
  return result;
};
const median = (a: number, b: number, c: number) => a + b + c - Math.min(a, b, c) - Math.max(a, b, c);

/** Offline temporal stabilization, independent of renderer frame rate.
 * The acoustic envelope owns jaw timing. Classifier labels only select stable
 * vowel shapes or support an energy-confirmed bilabial closure.
 */
export function buildVocalCurves(rms: Float32Array, visemes: Uint8Array, version: 2 | 3 = 3): VocalCurves {
  const n = rms.length, energy = rms.slice(), labels = new Uint8Array(n).fill(14);
  // v2 persisted a fixed 40 ms advance. Undo it before onset alignment so old
  // analyses benefit immediately without downloading or separating audio again.
  for (let i = 0; i < n; i++) labels[i] = visemes[Math.max(0, i - (version === 2 ? 2 : 0))] ?? 14;
  for (let i = 1; i < n - 1; i++) energy[i] = median(rms[i - 1], rms[i], rms[i + 1]);
  // Bridge <=40 ms gate dropouts inside voice; preserve meaningful silence.
  const voiced = Uint8Array.from(energy, (v) => v > 0 ? 1 : 0);
  for (const gap of segments(voiced)) {
    if (gap.value || gap.end - gap.start > 2 || gap.start === 0 || gap.end === n) continue;
    const a = energy[gap.start - 1], b = energy[gap.end];
    for (let i = gap.start; i < gap.end; i++) energy[i] = a + (b - a) * (i - gap.start + 1) / (gap.end - gap.start + 1);
  }
  // Slow, robust gain reference: interpolate two-second 90th percentiles,
  // instead of multiplying each consonant by a small fixed viseme aperture.
  const block = VOCAL_FRAME_RATE * 2, references: number[] = [];
  for (let start = 0; start < n; start += block) {
    const values = Array.from(energy.subarray(start, start + block)).filter((v) => v > 0).sort((a, b) => a - b);
    references.push(Math.max(.03, values[Math.floor((values.length - 1) * .9)] ?? .03));
  }
  const open = new Float32Array(n), form = new Float32Array(n).fill(NaN);
  const onsets = new Uint8Array(n), lastSilence = new Int32Array(n).fill(-1);
  let lastOnset = -Infinity, quietFrames = 0;
  for (let i = 0; i < n; i++) {
    const p = Math.max(0, i / block - .5), a = Math.floor(p), f = p - a;
    const reference = references[a] + ((references[a + 1] ?? references[a]) - references[a]) * f;
    const level = energy[i] > 0 ? .95 * Math.pow(Math.min(1, energy[i] / reference), .65) : 0;
    open[i] = level > 0 && i > 0 && Math.abs(level - open[i - 1]) < .035 ? open[i - 1] : level;
    const previous = Math.min(energy[Math.max(0, i - 1)], energy[Math.max(0, i - 2)]);
    const rise = energy[i] - previous;
    if (energy[i] > .008 && rise > Math.max(.008, reference * .22) && i - lastOnset >= 5) { onsets[i] = 1; lastOnset = i; }
    quietFrames = energy[i] > 0 ? 0 : quietFrames + 1;
    lastSilence[i] = quietFrames >= 3 ? i : (lastSilence[i - 1] ?? -1);
  }
  const runs = segments(labels);
  const stableLabels = labels.slice();
  for (const run of runs) {
    const before = labels[run.start - 1], after = labels[run.end];
    if (run.end - run.start <= 2 && before <= 4 && before === after && energy.subarray(run.start, run.end).every((v) => v > 0)) {
      stableLabels.fill(before, run.start, run.end);
    }
  }
  const vowelChanges: Array<{ start: number; form: number }> = [];
  const stableVowels = new Float32Array(n).fill(.15);
  for (const run of segments(stableLabels)) {
    // Ignore consonant form chatter and vowels shorter than 80 ms. Once a vowel
    // owns the shape, it holds for >=120 ms unless actual silence intervenes.
    if (run.value > 4 || run.end - run.start < 4) continue;
    stableVowels.fill(VOWEL_FORMS[run.value], run.start, run.end);
    const nearby: number[] = [];
    for (let i = Math.max(0, run.start - 6); i <= Math.min(n - 1, run.start + 1); i++) if (onsets[i]) nearby.push(i);
    let start = nearby.length ? nearby.reduce((a, b) => Math.abs(a - run.start) <= Math.abs(b - run.start) ? a : b) : run.start;
    const previous = vowelChanges.at(-1);
    const separated = previous && lastSilence[start] > previous.start;
    if (previous && !separated) {
      if (previous.form === VOWEL_FORMS[run.value]) continue;
      start = Math.max(start, previous.start + 6);
      if (start >= run.end) continue;
    }
    vowelChanges.push({ start, form: VOWEL_FORMS[run.value] });
  }
  let cursor = 0, currentForm = .15, silence = 0;
  for (let i = 0; i < n; i++) {
    // A gate can interrupt a vowel without changing the classifier's label.
    if (energy[i] > 0 && silence >= 3) currentForm = stableVowels[i];
    while (cursor < vowelChanges.length && vowelChanges[cursor].start <= i) currentForm = vowelChanges[cursor++].form;
    silence = energy[i] > 0 ? 0 : silence + 1;
    if (silence >= 3) currentForm = .15;
    if (open[i] > 0) form[i] = currentForm;
  }
  for (const run of runs) {
    if (run.value !== 5 || run.end - run.start < 4) continue;
    // A persistent PP label alone is insufficient (the speech model can label
    // sung vowels PP). Require a coincident vocal-energy valley before closing.
    let shoulder = .02;
    for (let i = Math.max(0, run.start - 5); i < Math.min(n, run.end + 5); i++) shoulder = Math.max(shoulder, energy[i]);
    let low = -1;
    for (let i = Math.max(0, run.start - 5); i < run.end; i++) {
      if (energy[i] > 0 && energy[i] < shoulder * .55) { if (low < 0) low = i; }
      else {
        if (low >= 0 && i - low >= 3) open.fill(0, low, i);
        low = -1;
      }
    }
    if (low >= 0 && run.end - low >= 3) open.fill(0, low, run.end);
  }
  return { open, form };
}

export function sampleVocalCurves(curves: VocalCurves, time: number, volume: number): VocalPose {
  if (!Number.isFinite(time) || time < 0 || !Number.isFinite(volume) || volume <= 0) return SILENT_VOCAL_POSE;
  const position = time * VOCAL_FRAME_RATE, index = Math.floor(position), fraction = position - index;
  if (index >= curves.open.length) return SILENT_VOCAL_POSE;
  const open = curves.open[index] + ((curves.open[index + 1] ?? 0) - curves.open[index]) * fraction;
  const a = curves.form[index], b = curves.form[index + 1];
  return { open: open * Math.min(1, volume / .3), form: Number.isFinite(a) ? Number.isFinite(b) ? a + (b - a) * fraction : a : null };
}
