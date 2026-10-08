import { referenceKernel, releaseSpectralMemory } from "./referenceFft";
type Kernel = ReturnType<typeof referenceKernel> & {
  peaks_create(rate: number, channels: number, length: number): number;
  peaks_buffer(context: number, kind: number): number;
  peaks_analyze(context: number, center: number): number;
  peaks_destroy(context: number): void;
};
/** Keep spectra, prominence scans and Hann fitting native. Only sparse accepted
 * peaks cross back to the reference trajectory/family logic. */
export class NativePeaks {
  private k: Kernel | null = referenceKernel() as Kernel;
  private context: number;
  private readonly channels: number;
  constructor(input: Float32Array[], rate: number) {
    this.channels = input.length;
    this.context = this.k!.peaks_create(rate, input.length, input[0].length);
    try {
      const set = (kind: number, data: Float64Array) => new Float64Array(this.k!.memory.buffer, this.k!.peaks_buffer(this.context, kind), data.length).set(data);
      set(0, Float64Array.from({ length: 4096 }, (_, i) => .5 - .5 * Math.cos(2 * Math.PI * i / 4096)));
      // Previously these invariant rotations were recalculated for every frame.
      set(1, Float64Array.from({ length: 8193 }, (_, i) => Math.cos(2 * Math.PI * i * 2048 / 16384)));
      set(2, Float64Array.from({ length: 8193 }, (_, i) => Math.sin(2 * Math.PI * i * 2048 / 16384)));
      input.forEach((x, c) => new Float32Array(this.k!.memory.buffer, this.k!.peaks_buffer(this.context, 100 + c), x.length).set(x));
    } catch (error) { this.dispose(); throw error; }
  }
  peaks(center: number) {
    const count = this.k!.peaks_analyze(this.context, center), data = new Float64Array(this.k!.memory.buffer, this.k!.peaks_buffer(this.context, 3), count * 5);
    return Array.from({ length: count }, (_, i) => ({ hz: data[i * 5], coef: Array.from(data.subarray(i * 5 + 1, i * 5 + 1 + this.channels * 2)) }));
  }
  dispose() {
    if (this.context) { this.k!.peaks_destroy(this.context); this.context = 0; }
    this.k = null; releaseSpectralMemory();
  }
}
