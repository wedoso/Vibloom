import kernelUrl from "./wasm/fft-kernel.wasm?url";

type Kernel = { memory: WebAssembly.Memory; init_fft(): void; buffer(): number; forward(large: number): void; inverse(large: number): void };
let kernel: Kernel | null = null, pending: Promise<void> | null = null, compiled: WebAssembly.Module | null = null;
const trap = () => { throw new Error("The remaster kernel failed. Try a shorter excerpt."); };
const imports = { wasi_snapshot_preview1: { clock_time_get: trap, fd_close: trap, fd_seek: trap, fd_write: trap, proc_exit: trap } };
function createKernel() {
  const instance = new WebAssembly.Instance(compiled!, imports), next = instance.exports as unknown as Kernel;
  next.init_fft(); return next;
}
export function initializeReferenceFft() {
  return pending ??= (async () => {
    const response = await fetch(kernelUrl);
    if (!response.ok) throw new Error("Unable to load the remaster kernel.");
    compiled = await WebAssembly.compile(await response.arrayBuffer()); kernel = createKernel();
  })();
}
/** WASM heaps cannot shrink. After a native stage releases its output, replace a
 * large released heap before the next stage. Reuse the compiled module, without
 * fetching/compiling it again. No native context may survive this call. */
export function releaseSpectralMemory() {
  if (kernel && kernel.memory.buffer.byteLength > 64 * 1024 * 1024) kernel = createKernel();
}
/** Fixed real FFT plans. The WASM workspace is shared only during a synchronous
 * transform; each Analysis owns its JS arrays, including across async yields. */
export class ReferenceFFT {
  readonly real: Float64Array;
  readonly imag: Float64Array;
  private readonly large: number;
  constructor(readonly size: number) {
    if (!kernel || ![2048, 16384].includes(size)) throw new Error("Remaster FFT is not initialized.");
    this.real = new Float64Array(size); this.imag = new Float64Array(size); this.large = size === 16384 ? 1 : 0;
  }
  transform(inverse = false) {
    const k = kernel!, data = new Float64Array(k.memory.buffer, k.buffer(), this.size), half = this.size / 2;
    if (inverse) {
      data[0] = this.real[0]; data[this.size - 1] = this.real[half];
      for (let i = 1; i < half; i++) { data[2 * i - 1] = this.real[i]; data[2 * i] = this.imag[i]; }
      k.inverse(this.large); this.real.set(data); this.imag.fill(0);
    } else {
      data.set(this.real); k.forward(this.large);
      this.real[0] = data[0]; this.imag[0] = 0; this.real[half] = data[this.size - 1]; this.imag[half] = 0;
      for (let i = 1; i < half; i++) { this.real[i] = this.real[this.size - i] = data[2 * i - 1]; this.imag[i] = data[2 * i]; this.imag[this.size - i] = -data[2 * i]; }
    }
  }
}

export function referenceKernel() {
  if (!kernel) throw new Error("Remaster kernel is not initialized.");
  return kernel;
}
