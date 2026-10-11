declare module "demucs-web" {
  export function fft(real: Float32Array, imag: Float32Array, input: Float32Array, size: number): void;
  export function ifft(realOut: Float32Array, imagOut: Float32Array, real: Float32Array, imag: Float32Array, size: number): void;
  export function getHannWindow(size: number): Float32Array;
}
