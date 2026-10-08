/** Browser-native port of the fixed upstream default TonalRepair. Keeps its
 * evidence gates: resolved Hann lobes, continuous channels, peer-supported
 * harmonic families and ambiguity protection. No tuning grid is introduced. */
import { initializeReferenceFft } from "./referenceFft";
import { clamp, yieldTask } from "./numerics";
const N = 4096, HOP = 1024, MIN = 4;
const TONAL_BUDGET_ERROR = "Tonal analysis exceeded its memory budget. Use a shorter excerpt.";
export function checkTonalAllocation(rows: number, columns: number, budget: number) {
  if (rows * columns > budget) throw new Error(TONAL_BUDGET_ERROR);
}
import { NativePeaks } from "./nativePeaks";
type Coefficient = number[]; // interleaved real/imag per channel, Float64 analysis
interface Track { first: number; freq: number[]; coef: Coefficient[] }
interface Family { members: number[]; first: number; observed: number[][]; expected: number[][]; tolerance: number[]; stable: number[]; stableCount: number; power: number }
const cents = (a: number, b: number) => 1200 * Math.log2(a / b);
const wrap = (x: number) => Math.atan2(Math.sin(x), Math.cos(x));
function quantile(input: number[], q: number) {
  const a = input.slice().sort((x, y) => x - y), at = (a.length - 1) * q, i = Math.floor(at);
  return a.length ? a[i] + (a[Math.min(i + 1, a.length - 1)] - a[i]) * (at - i) : 0;
}
const median = (input: number[]) => quantile(input, .5);
/** Rectangular minimum-cost one-to-one assignment (shortest augmenting paths).
 * Tracks are never greedily assigned; crossings retain upstream cost semantics. */
export function assignment(cost: number[][]): [number, number][] {
  if (!cost.length || !cost[0].length) return [];
  const transposed = cost.length > cost[0].length;
  const a = transposed ? cost[0].map((_, c) => cost.map(row => row[c])) : cost;
  const n = a.length, m = a[0].length, u = new Float64Array(n + 1), v = new Float64Array(m + 1);
  const p = new Int32Array(m + 1), way = new Int32Array(m + 1);
  for (let i = 1; i <= n; i++) {
    p[0] = i; let j0 = 0;
    const min = new Float64Array(m + 1).fill(Infinity), used = new Uint8Array(m + 1);
    do {
      used[j0] = 1; const i0 = p[j0]; let delta = Infinity, j1 = 0;
      for (let j = 1; j <= m; j++) if (!used[j]) {
        const cur = a[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < min[j]) { min[j] = cur; way[j] = j0; }
        if (min[j] < delta) { delta = min[j]; j1 = j; }
      }
      for (let j = 0; j <= m; j++) { if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else min[j] -= delta; }
      j0 = j1;
    } while (p[j0]);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const result: [number, number][] = [];
  for (let j = 1; j <= m; j++) if (p[j]) result.push(transposed ? [j - 1, p[j] - 1] : [p[j] - 1, j - 1]);
  return result.sort((a, b) => a[0] - b[0]);
}
class Tracker {
  private readonly native: NativePeaks;
  constructor(private input: Float32Array[], private rate: number) {
    this.native = new NativePeaks(input, rate);
  }
  async tracks(onProgress: (p: number) => void) {
    const tracks: Track[] = []; let active: number[] = [], entries = 0;
    const count = Math.max(0, Math.floor((this.input[0].length - N) / HOP) + 1);
    try {
    for (let frame = 0; frame < count; frame++) {
      const peaks = this.native.peaks(N / 2 + frame * HOP), assigned = new Map<number, number>();
      checkTonalAllocation(active.length, peaks.length, 1_000_000);
      const cost = active.map(index => peaks.map(peak => Math.abs(cents(peak.hz, tracks[index].freq.at(-1)!))));
      for (const [row, col] of assignment(cost.map(row => row.map(x => Math.min(100, x))))) if (cost[row][col] < 100) assigned.set(col, active[row]);
      active = peaks.map((peak, col) => {
        let index = assigned.get(col);
        if (index === undefined) { index = tracks.length; tracks.push({ first: frame, freq: [], coef: [] }); }
        tracks[index].freq.push(peak.hz); tracks[index].coef.push(peak.coef); return index;
      });
      entries += peaks.length;
      // JS tracking arrays have higher overhead than packed PCM. Fail explicitly
      // instead of silently skipping tonal repair on unusually dense material.
      if (entries > 500_000) throw new Error(TONAL_BUDGET_ERROR);
      if (frame % 64 === 0) { onProgress(frame / Math.max(1, count) * .8); await yieldTask(); }
    }
    } finally { this.native.dispose(); }
    const retained: Track[] = [];
    for (const track of tracks) {
      if (track.freq.length < MIN) continue;
      for (let c = 0; c < this.input.length; c++) {
        for (let start = 0; start < track.freq.length;) {
          if (!Math.hypot(track.coef[start][c * 2], track.coef[start][c * 2 + 1])) { start++; continue; }
          let end = start + 1; while (end < track.freq.length && Math.hypot(track.coef[end][c * 2], track.coef[end][c * 2 + 1])) end++;
          if (end - start < MIN) for (let i = start; i < end; i++) { track.coef[i][c * 2] = 0; track.coef[i][c * 2 + 1] = 0; }
          start = end;
        }
      }
      for (let start = 0; start < track.freq.length;) {
        if (!track.coef[start].some(x => x !== 0)) { start++; continue; }
        let end = start + 1; while (end < track.freq.length && track.coef[end].some(x => x !== 0)) end++;
        if (end - start >= MIN) retained.push({ first: track.first + start, freq: track.freq.slice(start, end), coef: track.coef.slice(start, end) });
        start = end;
      }
    }
    return retained.sort((a, b) => a.first - b.first);
  }
}
function uncertainty(track: Track, rate: number) {
  const powers = track.coef[0].map(() => 0);
  for (const coef of track.coef) for (let c = 0; c < coef.length / 2; c++) powers[c] += coef[2 * c] ** 2 + coef[2 * c + 1] ** 2;
  let channel = 0; for (let c = 1; c < track.coef[0].length / 2; c++) if (powers[c] > powers[channel]) channel = c;
  const errors: number[] = [];
  for (let i = 1; i < track.freq.length; i++) {
    const a = track.coef[i], b = track.coef[i - 1], c = channel * 2, f = (track.freq[i] + track.freq[i - 1]) / 2;
    const advance = Math.atan2(a[c + 1] * b[c] - a[c] * b[c + 1], a[c] * b[c] + a[c + 1] * b[c + 1]);
    const hz = Math.abs(wrap(advance - 2 * Math.PI * f * HOP / rate)) * rate / (2 * Math.PI * HOP);
    errors.push(1200 * Math.log2(1 + hz / f));
  }
  return Math.max(2, quantile(errors, .95));
}
function fitFamilies(tracks: Track[], rate: number) {
  const neighbors = tracks.map(() => new Set<number>()), centers = tracks.map(t => median(t.freq));
  const last = (t: Track) => t.first + t.freq.length - 1;
  const tolerances = tracks.map(t => uncertainty(t, rate));
  let neighborEdges = 0;
  for (let a = 0; a < tracks.length; a++) for (let b = a + 1; b < tracks.length; b++) {
    const x = tracks[a], y = tracks[b]; if (y.first > last(x)) break;
    const first = Math.max(x.first, y.first), stop = Math.min(last(x), last(y)); if (stop - first + 1 < MIN) continue;
    const ratios = Array.from({ length: stop - first + 1 }, (_, i) => cents(x.freq[first + i - x.first], y.freq[first + i - y.first]));
    const mid = median(ratios);
    if (quantile(ratios.map(r => Math.abs(r - mid)), .95) <= 2) { if ((neighborEdges += 2) > 1_000_000) throw new Error(TONAL_BUDGET_ERROR); neighbors[a].add(b); neighbors[b].add(a); }
  }
  const seen = new Set<string>(), candidates: Family[] = [];
  let candidateCells = 0;
  for (let anchor = 0; anchor < tracks.length; anchor++) {
    const eligible = tracks.map((_, i) => i).filter(i => Math.min(last(tracks[i]), last(tracks[anchor])) - Math.max(tracks[i].first, tracks[anchor].first) + 1 >= MIN);
    for (let divisor = 1; divisor <= Math.floor(centers[anchor] / 40); divisor++) {
      const fundamental = centers[anchor] / divisor;
      const selected = eligible.filter(i => { const order = Math.round(centers[i] / fundamental); return order > 0 && Math.abs(cents(centers[i], order * fundamental)) <= 50; });
      const orders = selected.map(i => Math.round(centers[i] / fundamental));
      const members = selected.filter((_, i) => orders.filter(x => x === orders[i]).length === 1), key = members.join(",");
      if (members.length < MIN || seen.has(key)) continue; seen.add(key);
      const first = Math.max(...members.map(i => tracks[i].first)), stop = Math.min(...members.map(i => last(tracks[i]))), count = stop - first + 1;
      if (count < MIN) continue;
      checkTonalAllocation(members.length, count, 2_000_000 - candidateCells);
      const observed = members.map(i => tracks[i].freq.slice(first - tracks[i].first, stop - tracks[i].first + 1));
      const logs = observed.map(row => row.map(Math.log2)), tolerance = members.map(i => tolerances[i]);
      let offsets = logs.map(median), motion: number[] = [];
      for (let iter = 0; iter < 8; iter++) {
        motion = Array.from({ length: count }, (_, t) => median(logs.map((row, r) => row[t] - offsets[r])));
        offsets = logs.map(row => median(row.map((x, t) => x - motion[t])));
      }
      const stable = observed.map((row, r) => quantile(row.map((hz, t) => Math.abs(cents(hz, 2 ** (offsets[r] + motion[t])))), .95) <= tolerance[r] ? r : -1).filter(i => i >= 0);
      if (stable.length / members.length < .75 || members.some((i, r) => !stable.includes(r) && neighbors[i].size >= MIN - 1)) continue;
      motion = Array.from({ length: count }, (_, t) => median(stable.map(r => logs[r][t] - offsets[r])));
      const expected = offsets.map(o => motion.map(x => 2 ** (o + x)));
      let power = 0; for (const i of members) for (const coef of tracks[i].coef.slice(first - tracks[i].first, stop - tracks[i].first + 1)) for (const x of coef) power += x * x;
      const finalStable = observed.map((row, r) => quantile(row.map((hz, t) => Math.abs(cents(hz, expected[r][t]))), .95) <= tolerance[r] ? r : -1).filter(i => i >= 0);
      candidateCells += members.length * count;
      candidates.push({ members, first, observed, expected, tolerance, stable: finalStable, stableCount: stable.length, power });
    }
  }
  const ambiguous = new Set<number>(), support = new Map<number, { peers: Set<number>; first: number; last: number }[]>();
  for (const family of candidates) {
    const core = new Set(family.stable.map(r => family.members[r]));
    for (const member of family.members) {
      const peers = new Set([...core].filter(x => x !== member)); if (peers.size < MIN - 1) continue;
      const previous = support.get(member) ?? [], stop = family.first + family.observed[0].length - 1;
      if (previous.some(p => ![...peers].some(x => p.peers.has(x)) && Math.min(stop, p.last) - Math.max(family.first, p.first) + 1 >= MIN)) ambiguous.add(member);
      previous.push({ peers, first: family.first, last: stop }); support.set(member, previous);
    }
  }
  // Upstream sorting uses the stable count before the core refit.
  candidates.sort((a, b) => b.stableCount - a.stableCount || b.power - a.power);
  const assigned = new Set<number>(), families = candidates.filter(f => {
    if (f.members.some(i => assigned.has(i))) return false; for (const i of f.members) assigned.add(i); return true;
  });
  return { families, ambiguous };
}
function hermite(a: number, b: number, da: number, db: number, t: number, dt: number) {
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * a + (t3 - 2 * t2 + t) * dt * da + (-2 * t3 + 3 * t2) * b + (t3 - t2) * dt * db;
}
export async function repairTonal(input: Float32Array[], rate: number, amount: number, onProgress: (p: number) => void) {
  if (!amount || input[0].length < N + (MIN - 1) * HOP) return;
  await initializeReferenceFft();
  const tracks = await new Tracker(input, rate).tracks(onProgress), { families, ambiguous } = fitFamilies(tracks, rate);
  // Accumulate sinusoidal replacements in Float64, then cast once as Python does.
  const output = families.length ? input.map(x => Float64Array.from(x)) : [];
  for (let fi = 0; fi < families.length; fi++) {
    const family = families[fi], count = family.observed[0].length, dt = HOP / rate;
    for (let row = 0; row < family.members.length; row++) {
      const member = family.members[row]; if (ambiguous.has(member)) continue;
      const frequency = family.observed[row], correction = frequency.map((f, t) => {
        const error = cents(f, family.expected[row][t]);
        return amount * clamp(Math.sign(error) * Math.max(Math.abs(error) - family.tolerance[row], 0), -25, 25);
      });
      if (!correction.some(x => x !== 0)) continue;
      const df = frequency.map((f, t) => f * Math.expm1(-correction[t] * Math.LN2 / 1200)), delta = [0];
      for (let t = 1; t < count; t++) delta.push(delta[t - 1] + Math.PI * (df[t] + df[t - 1]) * dt);
      const track = tracks[member], coefficients = track.coef.slice(family.first - track.first, family.first - track.first + count);
      for (let c = 0; c < input.length; c++) {
        for (let start = 0; start < count;) {
          if (!Math.hypot(coefficients[start][c * 2], coefficients[start][c * 2 + 1])) { start++; continue; }
          let stop = start + 1; while (stop < count && Math.hypot(coefficients[stop][c * 2], coefficients[stop][c * 2 + 1])) stop++;
          if (stop - start >= MIN) {
            const angle = (t: number) => Math.atan2(coefficients[t][c * 2 + 1], coefficients[t][c * 2]);
            const phase = [angle(start)];
            for (let t = start + 1; t < stop; t++) {
              const advance = Math.PI * (frequency[t] + frequency[t - 1]) * dt;
              phase.push(phase.at(-1)! + advance + wrap(angle(t) - angle(t - 1) - advance));
            }
            const firstSample = (family.first + start) * HOP + N / 2, lastSample = (family.first + stop - 1) * HOP + N / 2;
            for (let sample = firstSample; sample <= lastSample; sample++) {
              const pos = (sample - firstSample) / HOP, at = Math.min(stop - start - 2, Math.floor(pos)), w = pos - at, t = start + at;
              const phi = hermite(phase[at], phase[at + 1], 2 * Math.PI * frequency[t], 2 * Math.PI * frequency[t + 1], w, dt);
              const d = hermite(delta[t], delta[t + 1], 2 * Math.PI * df[t], 2 * Math.PI * df[t + 1], w, dt);
              const amp = (1 - w) * Math.hypot(coefficients[t][c * 2], coefficients[t][c * 2 + 1]) + w * Math.hypot(coefficients[t + 1][c * 2], coefficients[t + 1][c * 2 + 1]);
              const fade = Math.sin(Math.min(Math.min(sample - firstSample, lastSample - sample) / (N / 2), 1) * Math.PI / 2) ** 2;
              output[c][sample] += fade * amp * (Math.cos(phi + d) - Math.cos(phi));
            }
          }
          start = stop;
        }
      }
    }
    onProgress(.8 + .2 * (fi + 1) / families.length); await yieldTask();
  }
  for (let c = 0; c < output.length; c++) input[c].set(output[c]);
}
