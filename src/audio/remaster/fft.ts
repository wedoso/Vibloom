/** Allocation-free radix-2 complex FFT. One reusable plan per processing job. */
export class FFT {
  readonly real: Float64Array;
  readonly imag: Float64Array;
  private readonly reverse: Uint32Array;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;
  constructor(readonly size: number) {
    if (size < 2 || (size & (size - 1))) throw new Error("FFT size must be a power of two.");
    this.real = new Float64Array(size); this.imag = new Float64Array(size);
    this.reverse = new Uint32Array(size); this.cos = new Float64Array(size / 2); this.sin = new Float64Array(size / 2);
    const bits = Math.log2(size);
    for (let i = 0; i < size; i++) {
      let x = i, reversed = 0;
      for (let b = 0; b < bits; b++) { reversed = (reversed << 1) | (x & 1); x >>= 1; }
      this.reverse[i] = reversed;
    }
    for (let i = 0; i < size / 2; i++) { this.cos[i] = Math.cos(2 * Math.PI * i / size); this.sin[i] = Math.sin(2 * Math.PI * i / size); }
  }
  transform(inverse = false) {
    const { real: re, imag: im, size: n } = this;
    for (let i = 0; i < n; i++) {
      const j = this.reverse[i];
      if (j > i) { const r = re[i], s = im[i]; re[i] = re[j]; im[i] = im[j]; re[j] = r; im[j] = s; }
    }
    for (let length = 2; length <= n; length *= 2) {
      const half = length / 2, stride = n / length;
      for (let start = 0; start < n; start += length) {
        for (let k = 0; k < half; k++) {
          const a = start + k, b = a + half, c = this.cos[k * stride], s = this.sin[k * stride] * (inverse ? 1 : -1);
          const r = re[b] * c - im[b] * s, t = re[b] * s + im[b] * c;
          re[b] = re[a] - r; im[b] = im[a] - t; re[a] += r; im[a] += t;
        }
      }
    }
    if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }
}
