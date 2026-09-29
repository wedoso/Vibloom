import { VOCAL_FRAME_RATE, type VocalPose, SILENT_VOCAL_POSE } from "./envelope";

export type VocalCurves = { open: Float32Array; form: Float32Array; vowels?: Float32Array[] };
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
    if (gap.value || gap.start === 0 || gap.end === n) continue;
    const vowel = labels[gap.start - 1];
    const stableShoulders = gap.start >= 4 && gap.end + 4 <= n && vowel <= 4
      && labels.subarray(gap.start - 4, gap.start).every(v => v === vowel)
      && labels.subarray(gap.end, gap.end + 4).every(v => v === vowel)
      && energy.subarray(gap.start - 4, gap.start).every(v => v > .008)
      && energy.subarray(gap.end, gap.end + 4).every(v => v > .008);
    // Only a continuing vowel can bridge 60–140 ms gate holes. Silence/PP
    // labels veto this hold; phrase boundaries and unvoiced consonants close.
    const continuingVowel = stableShoulders && labels.subarray(gap.start, gap.end).every(v => v === vowel);
    if (gap.end - gap.start > (continuingVowel ? 7 : 2)) continue;
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
  // A stable vowel gets a modest aperture floor through a brief near-gate
  // dip. Require voiced shoulders and matching labels; never lift real zeros.
  for (const dip of segments(Uint8Array.from(open, v => v > 0 && v < .25 ? 1 : 0))) {
    if (!dip.value || dip.end - dip.start > 7 || dip.start < 4 || dip.end + 4 > n) continue;
    const vowel = labels[dip.start];
    if (vowel > 4 || !labels.subarray(dip.start - 4, dip.end + 4).every(v => v === vowel)
      || !open.subarray(dip.start - 4, dip.start).every(v => v >= .25)
      || !open.subarray(dip.end, dip.end + 4).every(v => v >= .25)) continue;
    open.fill(.25, dip.start, dip.end);
  }
  const runs = segments(labels);
  const stableLabels = labels.slice();
  for (const run of runs) {
    const before = labels[run.start - 1], after = labels[run.end];
    if (run.end - run.start <= 2 && before <= 4 && before === after && energy.subarray(run.start, run.end).every((v) => v > 0)) {
      stableLabels.fill(before, run.start, run.end);
    }
  }
  const vowelChanges: Array<{ start: number; vowel: number }> = [];
  const stableVowels = new Uint8Array(n);
  for (const run of segments(stableLabels)) {
    // Ignore consonant form chatter and vowels shorter than 80 ms. Once a vowel
    // owns the shape, it holds for >=120 ms unless actual silence intervenes.
    if (run.value > 4 || run.end - run.start < 4) continue;
    stableVowels.fill(run.value, run.start, run.end);
    const nearby: number[] = [];
    for (let i = Math.max(0, run.start - 6); i <= Math.min(n - 1, run.start + 1); i++) if (onsets[i]) nearby.push(i);
    let start = nearby.length ? nearby.reduce((a, b) => Math.abs(a - run.start) <= Math.abs(b - run.start) ? a : b) : run.start;
    const previous = vowelChanges.at(-1);
    const separated = previous && lastSilence[start] > previous.start;
    if (previous && !separated) {
      if (previous.vowel === run.value) continue;
      start = Math.max(start, previous.start + 6);
      if (start >= run.end) continue;
    }
    vowelChanges.push({ start, vowel: run.value });
  }
  const vowels = Array.from({length: 5}, () => new Float32Array(n));
  let cursor = 0, currentVowel = 0, silence = 0;
  for (let i = 0; i < n; i++) {
    // A gate can interrupt a vowel without changing the classifier's label.
    if (energy[i] > 0 && silence >= 3) currentVowel = stableVowels[i];
    while (cursor < vowelChanges.length && vowelChanges[cursor].start <= i) currentVowel = vowelChanges[cursor++].vowel;
    silence = energy[i] > 0 ? 0 : silence + 1;
    if (silence >= 3) currentVowel = 0;
    if (open[i] > 0) { form[i] = VOWEL_FORMS[currentVowel]; vowels[currentVowel][i] = 1; }
  }
  for (const run of runs) {
    if (run.value !== 5 || run.end - run.start < 4) continue;
    // A persistent PP label alone is insufficient (the speech model can label
    // sung vowels PP). Require a coincident vocal-energy valley before closing.
    // Labels carry no calibrated confidence. Demand a deep, sustained valley
    // inside PP itself, with audible shoulders on both sides, as corroboration.
    const before = energy.subarray(Math.max(0, run.start - 4), run.start);
    const after = energy.subarray(run.end, Math.min(n, run.end + 4));
    const shoulder = Math.min(Math.max(0, ...before), Math.max(0, ...after));
    if (shoulder < .02) continue;
    let low = -1;
    const close = (end: number) => { if (low >= 0 && end - low >= 3) open.fill(0, low, end); };
    for (let i = run.start; i < run.end; i++) {
      if (energy[i] < shoulder * .12) { if (low < 0) low = i; }
      else { close(i); low = -1; }
    }
    close(run.end);
  }

  // Only sustained, visually distinct consonants contribute a restrained shape.
  // They never own jaw amplitude and cannot interrupt a stable vowel segment.
  for (const run of runs) {
    if (![9, 13].includes(run.value) || run.end - run.start < 6) continue;
    const target = run.value === 9 ? .55 : -.35; // FF contact / CH rounding.
    for (let i = run.start + 2; i < run.end - 2; i++) if (open[i] > 0) form[i] = target;
  }
  return smoothVocalCurves({ open, form, vowels });
}

/** Bake asymmetric attack/release into the saved-time domain. Forward filtering
 * starts at the acoustic onset; finite tails reach exact silence in 40 ms.
 * Shape changes use a 100 ms smoothstep, keeping both endpoint velocities zero. */
export function smoothVocalCurves(input: VocalCurves): VocalCurves {
  const open = new Float32Array(input.open.length), form = input.form.slice();
  let from = .15, target = .15, elapsed = 5;
  for (let i = 0; i < open.length; i++) {
    const desired = input.open[i];
    const previous = input.open[i - 1] ?? 0, older = input.open[i - 2] ?? 0;
    // Finite kernels taper all the way to zero without truncating an exponential
    // tail. Faster opening, softer closing; no lookahead into preceding silence.
    open[i] = desired >= previous ? .55 * desired + .3 * previous + .15 * older : .35 * desired + .4 * previous + .25 * older;
    const next = input.form[i];
    if (!Number.isFinite(next)) { form[i] = NaN; continue; }
    if (next !== target) { from = i > 0 && Number.isFinite(form[i - 1]) ? form[i - 1] : target; target = next; elapsed = 0; }
    const t = Math.min(1, ++elapsed / 5), ease = t * t * (3 - 2 * t);
    form[i] = from + (target - from) * ease;
  }
  // Preserve vowel identity as a blend, rather than reconstructing it from
  // ParamMouthForm (whose intermediate values are ambiguous).
  const vowels = input.vowels?.map(values => {
    const result = new Float32Array(values.length);
    let from = 0, target = 0, elapsed = 5;
    for (let i = 0; i < values.length; i++) {
      if (values[i] !== target) { from = result[i - 1] ?? 0; target = values[i]; elapsed = 0; }
      const t = Math.min(1, ++elapsed / 5);
      result[i] = from + (target - from) * t * t * (3 - 2 * t);
    }
    return result;
  });
  return { open, form, vowels };
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
