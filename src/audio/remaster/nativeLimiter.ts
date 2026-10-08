import { initializeReferenceFft, referenceKernel, releaseSpectralMemory } from "./referenceFft";
import { yieldTask } from "./numerics";
type Kernel = ReturnType<typeof referenceKernel> & {
  limiter_create(channels: number, count: number, lookahead: number): number;
  limiter_buffer(context: number, kind: number): number;
  limiter_run(context: number, end: number): void;
  limiter_finish(context: number): void;
  limiter_measure(context: number, end: number): void;
  limiter_destroy(context: number): void;
};
export async function nativeLimiter(pcm: Float32Array, rate: number, channels: number, ceilingDb: number, kernel: Float32Array, progress: (p: number) => void) {
  await initializeReferenceFft(); releaseSpectralMemory();
  const k = referenceKernel() as Kernel, count = pcm.length / channels, total = count * 4, context = k.limiter_create(channels, count, Math.floor(rate * 4 * .005));
  try {
    new Float32Array(k.memory.buffer, k.limiter_buffer(context, 0), pcm.length).set(pcm);
    new Float32Array(k.memory.buffer, k.limiter_buffer(context, 1), 81).set(kernel);
    new Float64Array(k.memory.buffer, k.limiter_buffer(context, 2), 5).set([Math.exp(-1 / (rate * 4 * .015)), Math.exp(-1 / (rate * 4 * .1)), 10 ** (ceilingDb / 20), 1, 0]);
    for (let end = 0; end < total + 40;) { end = Math.min(total + 40, end + 262144); k.limiter_run(context, end); progress(.8 * end / (total + 40)); await yieldTask(); }
    k.limiter_finish(context);
    for (let end = 0; end < total;) { end = Math.min(total, end + 262144); k.limiter_measure(context, end); progress(.8 + .2 * end / total); await yieldTask(); }
    pcm.set(new Float32Array(k.memory.buffer, k.limiter_buffer(context, 0), pcm.length));
    const params = new Float64Array(k.memory.buffer, k.limiter_buffer(context, 2), 5);
    return { safetyGain: params[3], truePeak: params[4] };
  } finally { k.limiter_destroy(context); releaseSpectralMemory(); }
}
