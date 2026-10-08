import { referenceKernel, releaseSpectralMemory } from "./referenceFft";
import type { RepairSettings } from "./presets";
import { f32, clamp, yieldTask } from "./numerics";
const N = 2048, HOP = 512, BINS = 1025;
type Native = ReturnType<typeof referenceKernel> & {
  alignment_create(count: number): number;
  alignment_buffer(context: number, right: number): number;
  alignment_run(context: number): number;
  alignment_destroy(context: number): void;
  repair_create(rate: number, channels: number, length: number): number;
  repair_buffer(context: number, kind: number): number;
  repair_cache_budget(context: number, bytes: number): void;
  repair_init(context: number): void;
  repair_balance(context: number, start: number, end: number): void;
  repair_balance_end(context: number): void;
  repair_noise(context: number, start: number, end: number): void;
  repair_noise_end(context: number): void;
  repair_begin(context: number, pass: number): void;
  repair_frames(context: number, start: number, end: number): void;
  repair_end(context: number): void;
  repair_destroy(context: number): void;
};
/** Batch whole spectral stages inside WASM. Only PCM and static reference tables
 * cross the boundary; Float32 rounding and sequential recurrences stay native. */
export async function nativeSpectralRepair(input: Float32Array[], rate: number, settings: Readonly<RepairSettings>, delays: number[], onProgress: (phase: string, p: number) => void, cacheBudgetBytes = 256 * 1024 * 1024) {
  const k = referenceKernel() as Native, length = input[0].length, cols = Math.ceil(length / HOP) + 1;
  const context = k.repair_create(rate, input.length, length), p = settings;
  const floats = (kind: number, data: ArrayLike<number>) => new Float32Array(k.memory.buffer, k.repair_buffer(context, kind), data.length).set(data);
  const doubles = (kind: number, data: ArrayLike<number>) => new Float64Array(k.memory.buffer, k.repair_buffer(context, kind), data.length).set(data);
  const ints = (kind: number, data: ArrayLike<number>) => new Int32Array(k.memory.buffer, k.repair_buffer(context, kind), data.length).set(data);
  try {
    const minwin = Math.max(4, Math.floor(rate * p.noiseWindowMs / 1000 / HOP));
    doubles(0, [p.startHz, p.endHz, p.edgeHz, p.thresholdDb, p.slope, p.noiseResynth, p.denoise, p.noiseStartHz, p.noiseWindowMs, p.noiseFloorDb, p.noiseSmoothBins, p.noisePsdMs,
      p.deres, p.resonanceThresholdDb, p.resonanceMaxDb, p.resonanceWindowMs, p.resonanceMedianBins, Number(p.stationaryFloor), Number(p.enhance), p.tonalRepair,
      Math.exp(-HOP / (rate * p.noisePsdMs / 1000)), 10 ** (3 * minwin * HOP / rate / 10), Math.exp(-HOP / (rate * p.resonanceWindowMs / 1000)), Math.exp(-HOP / (rate * .08)), 10 ** (HOP / rate / 10),
      Math.exp(-HOP / (rate * .015)), 10 ** (p.noiseFloorDb / 20), 10 ** (-Math.max(12, Math.abs(p.noiseFloorDb)) / 10), p.resonancePersistenceDb, 10 ** (-3 / 20), 10 ** (3 / 20), 10 ** -1.8]);
    floats(1, Float32Array.from({ length: N }, (_, i) => .5 - .5 * Math.cos(2 * Math.PI * i / N)));
    const bark = Float64Array.from({ length: BINS }, (_, i) => { const hz = f32(i * rate / N); return 13 * Math.atan(.00076 * hz) + 3.5 * Math.atan((hz / 7500) ** 2); });
    doubles(2, Float64Array.from({ length: BINS }, (_, i) => {
      const hz = clamp(i * rate / N / 1000, .02, 20);
      return 10 ** ((3.64 * hz ** -.8 - 6.5 * Math.exp(-.6 * (hz - 3.3) ** 2) + .001 * hz ** 4 - 96) / 10);
    }));
    doubles(3, Float64Array.from(bark, b => Math.exp(2.5 * Math.LN10 * b)));
    doubles(4, Float64Array.from(bark, b => Math.exp(-Math.LN10 * b)));
    doubles(5, Float64Array.from({ length: BINS }, (_, i) => 10 ** (-3.5 * Math.log2(Math.max(100, i * rate / N) / 100) / 20)));
    const edge = (lo: number, hi: number, width: number) => Float32Array.from({ length: BINS }, (_, i) => {
      const hz = f32(i * rate / N), d = Math.min(hz - lo, hi - hz);
      return d >= width ? 1 : f32(.5 - .5 * Math.cos(Math.PI * clamp(d / width)));
    });
    floats(6, edge(p.startHz, p.endHz, p.edgeHz)); floats(7, edge(p.noiseStartHz, 16000, 200)); floats(8, edge(180, 12000, 150));
    const left = new Int32Array(BINS), right = new Int32Array(BINS);
    for (let i = 0; i < BINS; i++) {
      let l = i, r = i;
      while (l > 0 && bark[i] - bark[l - 1] < 3.28) l--;
      while (r < BINS - 1 && bark[r + 1] - bark[i] < 8.2) r++;
      left[i] = l; right[i] = r;
    }
    ints(9, left); ints(10, right); ints(11, delays);
    k.repair_cache_budget(context, cacheBudgetBytes); k.repair_init(context);
    const channels = input.length;
    for (let c = 0; c < channels; c++) floats(100 + c, input[c]);
    // The native context now owns the source. Release the extra JS PCM before
    // reconstruction and tonal analysis increase the working set.
    input.length = 0;
    const batch = async (fn: (context: number, start: number, end: number) => void, phase: string, base: number, span: number) => {
      for (let t = 0; t < cols; t += 512) {
        const end = Math.min(cols, t + 512); fn(context, t, end);
        onProgress(phase, base + span * end / cols); await yieldTask();
      }
    };
    if (p.enhance && channels === 2) { await batch(k.repair_balance, "Balancing stereo", 0, .06); k.repair_balance_end(context); }
    if (p.denoise > 0) { await batch(k.repair_noise, "Estimating noise", .06, .07); k.repair_noise_end(context); }
    for (let pass = 0; pass < 4; pass++) {
      k.repair_begin(context, pass);
      await batch(k.repair_frames, pass ? `Reconstructing ${pass}/3` : "Repairing spectrum", .13 + .67 * pass / 4, .67 / 4);
      k.repair_end(context);
    }
    return Array.from({ length: channels }, (_, c) => new Float32Array(new Float32Array(k.memory.buffer, k.repair_buffer(context, 200 + c), length)));
  } finally { k.repair_destroy(context); releaseSpectralMemory(); }
}

export function nativeChannelDelays(input: Float32Array[], rate: number) {
  const delays = input.map(() => 0);
  if (input.length < 2) return delays;
  const k = referenceKernel() as Native, count = Math.min(input[0].length, rate * 15), context = k.alignment_create(count);
  try {
    for (let c = 0; c < 2; c++) new Float32Array(k.memory.buffer, k.alignment_buffer(context, c), count).set(input[c].subarray(0, count));
    const lag = k.alignment_run(context);
    if (lag && Math.abs(lag) <= Math.ceil(rate * .003)) delays[lag > 0 ? 1 : 0] = Math.abs(lag);
    return delays;
  } finally { k.alignment_destroy(context); releaseSpectralMemory(); }
}
