export const f32 = Math.fround;
export const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
export const EPS = 1e-12;
export const yieldTask = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/** Nearest-edge median, with a sorted sliding window. */
export function medianFilter(input: Float32Array, output: Float32Array, width: number, lo: number, hi: number) {
  const half = width >> 1, work = new Float32Array(width);
  for (let j = 0; j < width; j++) work[j] = input[clamp(lo + j - half, lo, hi)];
  work.sort();
  for (let i = lo; i <= hi; i++) {
    output[i] = work[half];
    const old = input[clamp(i - half, lo, hi)], next = input[clamp(i + half + 1, lo, hi)];
    let at = 0; while (at < width - 1 && work[at] !== old) at++;
    for (let j = at; j < width - 1; j++) work[j] = work[j + 1];
    at = width - 1;
    while (at > 0 && work[at - 1] > next) { work[at] = work[at - 1]; at--; }
    work[at] = next;
  }
}
export function smooth(input: Float32Array, output: Float32Array, width: number, lo: number, hi: number) {
  const half = width >> 1;
  let sum = 0;
  for (let j = -half; j <= half; j++) sum += input[clamp(lo + j, lo, hi)];
  for (let i = lo; i <= hi; i++) {
    output[i] = sum / width;
    sum += input[clamp(i + half + 1, lo, hi)] - input[clamp(i - half, lo, hi)];
  }
}

const MULT = 47026247687942121848144207491837523525n;
const MASK = (1n << 128n) - 1n, MASK64 = (1n << 64n) - 1n;
/** NumPy default_rng(0): PCG64 XSL-RR, including its initial SeedSequence state.
 * Advance creates one stream per frequency row without allocating an F×T map. */
export class Pcg64 {
  private state = 35399562948360463058890781895381311971n;
  private readonly increment = 87136372517582989555478159403783844777n;
  advance(delta: number) {
    let n = BigInt(delta), mult = MULT, plus = this.increment, am = 1n, ap = 0n;
    while (n > 0n) {
      if (n & 1n) { am = am * mult & MASK; ap = (ap * mult + plus) & MASK; }
      plus = ((mult + 1n) * plus) & MASK; mult = mult * mult & MASK; n >>= 1n;
    }
    this.state = (am * this.state + ap) & MASK;
  }
  uniform() {
    this.state = (this.state * MULT + this.increment) & MASK;
    const x = ((this.state >> 64n) ^ this.state) & MASK64, r = this.state >> 122n;
    const bits = ((x >> r) | (x << ((-r) & 63n))) & MASK64;
    return Number(bits >> 11n) / 9007199254740992;
  }
}
