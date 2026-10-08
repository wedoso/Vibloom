type Coefficients = readonly [number, number, number, number, number];
class Biquad {
  private x1 = 0; private x2 = 0; private y1 = 0; private y2 = 0;
  constructor(private readonly c: Coefficients) {}
  sample(x: number) {
    const [b0, b1, b2, a1, a2] = this.c;
    const y = b0 * x + b1 * this.x1 + b2 * this.x2 - a1 * this.y1 - a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

/** BS.1770 K-weighting with sample-rate-derived De Man coefficients. */
function weighting(rate: number): readonly [Coefficients, Coefficients] {
  const k = Math.tan(Math.PI * 1681.974450955533 / rate), q = .7071752369554196;
  const vh = 10 ** (3.999843853973347 / 20), vb = vh ** .499666774155, a = 1 + k / q + k * k;
  const shelf: Coefficients = [(vh + vb * k / q + k * k) / a, 2 * (k * k - vh) / a, (vh - vb * k / q + k * k) / a, 2 * (k * k - 1) / a, (1 - k / q + k * k) / a];
  const h = Math.tan(Math.PI * 38.13547087602444 / rate), hq = .5003270373238773, d = 1 + h / hq + h * h;
  return [shelf, [1, -2, 1, 2 * (h * h - 1) / d, (1 - h / hq + h * h) / d]];
}

export class IntegratedLoudness {
  private readonly filters: [Biquad, Biquad][];
  private readonly energy: Float64Array;
  private readonly hop: number;
  private sum = 0; private samples = 0;
  private readonly blocks: number[] = [];
  constructor(rate: number, channels: number) {
    const coefficients = weighting(rate);
    this.filters = Array.from({ length: channels }, () => [new Biquad(coefficients[0]), new Biquad(coefficients[1])]);
    this.energy = new Float64Array(Math.round(rate * .4)); this.hop = Math.round(rate * .1);
  }
  sample(interleaved: Float32Array, frame: number, gain = 1) {
    let energy = 0;
    for (let c = 0; c < this.filters.length; c++) {
      const [shelf, hp] = this.filters[c], y = hp.sample(shelf.sample(interleaved[frame * this.filters.length + c] * gain));
      energy += y * y;
    }
    const index = this.samples % this.energy.length;
    this.sum += energy - this.energy[index]; this.energy[index] = energy; this.samples++;
    if (this.samples >= this.energy.length && (this.samples - this.energy.length) % this.hop === 0) this.blocks.push(Math.max(0, this.sum / this.energy.length));
  }
  value(): number | null {
    const absolute = 10 ** ((-70 + .691) / 10);
    let energy = 0, count = 0;
    for (const block of this.blocks) if (block > absolute) { energy += block; count++; }
    if (!count) return null;
    const relative = Math.max(absolute, energy / count / 10);
    energy = 0; count = 0;
    for (const block of this.blocks) if (block > relative) { energy += block; count++; }
    return count ? -.691 + 10 * Math.log10(energy / count) : null;
  }
}
