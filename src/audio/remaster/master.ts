import { nativeLimiter } from "./nativeLimiter";
import { EPS, f32, yieldTask, clamp } from "./numerics";

/** The fixed Python reference uses pyloudnorm's RBJ K-weighting (not DeMan),
 * rounds each filter's output back to Float32, and includes a partial final block. */
export function referenceLoudness(pcm: Float32Array, rate: number, channels: number) {
  const length = pcm.length / channels;
  if (length < rate * .4) return null;
  const rbj = (shelf: boolean) => {
    const a = shelf ? 10 ** .1 : 1, w = 2 * Math.PI * (shelf ? 1500 : 38) / rate;
    const cos = Math.cos(w), alpha = Math.sin(w) / (2 * (shelf ? Math.SQRT1_2 : .5));
    const d = shelf ? (a + 1) - (a - 1) * cos + 2 * Math.sqrt(a) * alpha : 1 + alpha;
    return shelf ? [a * ((a + 1) + (a - 1) * cos + 2 * Math.sqrt(a) * alpha) / d,
      -2 * a * ((a - 1) + (a + 1) * cos) / d,
      a * ((a + 1) + (a - 1) * cos - 2 * Math.sqrt(a) * alpha) / d,
      2 * ((a - 1) - (a + 1) * cos) / d, ((a + 1) - (a - 1) * cos - 2 * Math.sqrt(a) * alpha) / d]
      : [(1 + cos) / 2 / d, -(1 + cos) / d, (1 + cos) / 2 / d, -2 * cos / d, (1 - alpha) / d];
  };
  const coeff = [rbj(true), rbj(false)], filtered = new Float32Array(length);
  const count = Math.round((length / rate - .4) / .1) + 1, energy = new Float64Array(count);
  for (let c = 0; c < channels; c++) {
    for (let i = 0; i < length; i++) filtered[i] = pcm[i * channels + c];
    for (const [b0, b1, b2, a1, a2] of coeff) {
      let z1 = 0, z2 = 0;
      for (let i = 0; i < length; i++) { const x = filtered[i], y = b0 * x + z1; z1 = b1 * x - a1 * y + z2; z2 = b2 * x - a2 * y; filtered[i] = y; }
    }
    for (let j = 0; j < count; j++) {
      const lo = Math.floor(.4 * (j * .25) * rate), hi = Math.min(length, Math.floor(.4 * (j * .25 + 1) * rate));
      let sum = 0; for (let i = lo; i < hi; i++) sum += f32(filtered[i] * filtered[i]);
      energy[j] += f32(sum) / (.4 * rate);
    }
  }
  const absolute = 10 ** ((-70 + .691) / 10);
  let sum = 0, n = 0;
  for (const e of energy) if (e >= absolute) { sum += e; n++; }
  if (!n) return null;
  const relative = sum / n / 10; sum = 0; n = 0;
  for (const e of energy) if (e > absolute && e > relative) { sum += e; n++; }
  return n ? -.691 + 10 * Math.log10(sum / n) : null;
}
function bessel0(x: number) {
  let term = 1, sum = 1;
  for (let j = 1; j < 40; j++) { term *= x * x / (4 * j * j); sum += term; if (term < sum * 1e-16) break; }
  return sum;
}
/** SciPy resample_poly default: 81-tap firwin(.25), Kaiser beta=5. */
export function resampleKernel() {
  const kernel = Float64Array.from({ length: 81 }, (_, i) => {
    const x = i - 40, sinc = x === 0 ? .25 : Math.sin(Math.PI * x / 4) / (Math.PI * x);
    return sinc * bessel0(5 * Math.sqrt(Math.max(0, 1 - (x / 40) ** 2))) / bessel0(5);
  });
  const sum = kernel.reduce((a, b) => a + b, 0);
  return Float32Array.from(kernel, x => x / sum);
}
export function upsampleAt(pcm: Float32Array, channels: number, frame: number, channel: number, kernel: Float32Array) {
  const count = pcm.length / channels, lo = Math.ceil((frame - 40) / 4), hi = Math.floor((frame + 40) / 4);
  let sum = 0;
  for (let i = Math.max(0, lo); i <= Math.min(count - 1, hi); i++) sum = f32(sum + f32(pcm[i * channels + channel] * f32(4 * kernel[frame + 40 - i * 4])));
  return sum;
}
export async function referenceTruePeak(pcm: Float32Array, channels: number, progress: (p: number) => void) {
  const kernel = resampleKernel(); let peak = 0;
  const count = pcm.length / channels * 4;
  for (let i = 0; i < count; i++) {
    for (let c = 0; c < channels; c++) peak = Math.max(peak, Math.abs(upsampleAt(pcm, channels, i, c, kernel)));
    if (i % 262144 === 0) { progress(i / count); await yieldTask(); }
  }
  return peak;
}
/** Butterworth order-2 sosfiltfilt, odd extension length 9, steady-state zi.
 * Double precision in both directions, a single Float32 cast at the end. */
async function highpass(pcm: Float32Array, rate: number, channels: number) {
  const count = pcm.length / channels, pad = 9;
  if (count <= pad) throw new Error("Delivery needs at least 10 audio samples.");
  const k = Math.tan(Math.PI * 20 / rate), den = 1 + Math.SQRT2 * k + k * k;
  const b0 = 1 / den, b1 = -2 / den, b2 = b0, a1 = 2 * (k * k - 1) / den, a2 = (1 - Math.SQRT2 * k + k * k) / den;
  const values = new Float64Array(count + 2 * pad);
  for (let c = 0; c < channels; c++) {
    let sum = 0;
    for (let i = 0; i < count; i++) sum = channels > 1 ? f32(sum + pcm[i * channels + c]) : sum + pcm[i * channels + c];
    const mean = f32(f32(sum) / count);
    for (let i = 0; i < count; i++) values[i + pad] = f32(pcm[i * channels + c] - mean);
    for (let i = 0; i < pad; i++) {
      values[i] = 2 * values[pad] - values[2 * pad - i];
      values[count + pad + i] = 2 * values[count + pad - 1] - values[count + pad - 2 - i];
    }
    for (const reverse of [false, true]) {
      let z1 = -b0 * values[reverse ? values.length - 1 : 0], z2 = b2 * values[reverse ? values.length - 1 : 0];
      for (let j = 0; j < values.length; j++) {
        const i = reverse ? values.length - 1 - j : j, x = values[i], y = b0 * x + z1;
        z1 = b1 * x - a1 * y + z2; z2 = b2 * x - a2 * y; values[i] = y;
      }
      await yieldTask();
    }
    for (let i = 0; i < count; i++) pcm[i * channels + c] = values[i + pad];
  }
}
/** Streaming 4× upsample → linked PDR limiter → downsample. The original Python
 * maximum_filter1d uses a positive origin, hence a trailing (causal) window.
 * Reproduce that behavior rather than changing it to a future lookahead. */
export async function masterPost(pcm: Float32Array, rate: number, channels: number, targetLufs: number, ceilingDb: number, progress: (p: number) => void) {
  await highpass(pcm, rate, channels);
  const loudness = referenceLoudness(pcm, rate, channels);
  let gainDb: number;
  if (loudness === null) {
    let power = 0; for (const x of pcm) power += f32(x * x);
    const rms = Math.sqrt(f32(f32(power / pcm.length) + EPS)); gainDb = -16 - 20 * Math.log10(rms + EPS);
  } else gainDb = targetLufs - loudness;
  const normalization = f32(10 ** (clamp(gainDb, -24, 12) / 20));
  for (let i = 0; i < pcm.length; i++) pcm[i] *= normalization;
  return nativeLimiter(pcm, rate, channels, ceilingDb, resampleKernel(), progress);
}
