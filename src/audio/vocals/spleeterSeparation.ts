import type * as Ort from 'onnxruntime-web';
import { fft, ifft, getHannWindow } from 'demucs-web';
// Spleeter 2-stem magnitude estimates. Process one bounded stereo window;
// normalized masks retain the original phase and centered sample timing.
const FFT = 4096, HOP = 1024, BINS = 1024, FRAMES = 512, CONTEXT = 64, STEP = FRAMES - 2 * CONTEXT;
export class SpleeterWorkspace {
    capacity = 0;
    specReal = new Float32Array(0);
    specImag = new Float32Array(0);
    masks = new Float32Array(0);
    weights = new Float32Array(0);
    left = new Float32Array(0);
    right = new Float32Array(0);
    values = new Float32Array(2 * FRAMES * BINS);
    input = new Float32Array(FFT);
    real = new Float32Array(FFT);
    imag = new Float32Array(FFT);
    time = new Float32Array(FFT);
    unused = new Float32Array(FFT);
    resize(samples: number) {
        if (samples > this.capacity) {
            this.capacity = samples;
            const length = 2 * Math.ceil(samples / HOP) * BINS;
            this.specReal = new Float32Array(length);
            this.specImag = new Float32Array(length);
            this.masks = new Float32Array(length);
            this.weights = new Float32Array(samples);
            this.left = new Float32Array(samples);
            this.right = new Float32Array(samples);
        }
        this.weights.fill(0);
        this.left.fill(0);
        this.right.fill(0);
    }
}
export async function separateSpleeter(ort: typeof Ort, sessions: Ort.InferenceSession[], left: Float32Array, right: Float32Array, progress: (value: number) => void = () => { }, workspace = new SpleeterWorkspace()) {
    if (!left.length || left.length !== right.length || left.length > 16 * 44100 || sessions.length !== 2)
        throw new Error('Expected a stereo vocal window of at most 16 seconds');
    const n = left.length, frames = Math.ceil(n / HOP), window = getHannWindow(FFT);
    workspace.resize(n);
    const { specReal, specImag, masks, input, real, imag, values, weights, time, unused } = workspace;
    for (let c = 0; c < 2; c++) {
        const source = c ? right : left;
        for (let f = 0; f < frames; f++) {
            for (let i = 0; i < FFT; i++)
                input[i] = (source[f * HOP + i - FFT / 2] ?? 0) * window[i];
            fft(real, imag, input, FFT);
            const offset = (c * frames + f) * BINS;
            specReal.set(real.subarray(0, BINS), offset);
            specImag.set(imag.subarray(0, BINS), offset);
        }
    }
    progress(0);
    for (let begin = 0; begin < frames; begin += STEP) {
        values.fill(0);
        for (let c = 0; c < 2; c++)
            for (let f = 0; f < FRAMES; f++) {
                const frame = begin + f - CONTEXT;
                if (frame < 0 || frame >= frames)
                    continue;
                for (let b = 0; b < BINS; b++) {
                    const s = (c * frames + frame) * BINS + b;
                    values[(c * FRAMES + f) * BINS + b] = Math.hypot(specReal[s], specImag[s]);
                }
            }
        const x = new ort.Tensor('float32', values, [2, 1, FRAMES, BINS]);
        let v: Ort.InferenceSession.ReturnType | undefined, a: Ort.InferenceSession.ReturnType | undefined;
        try {
            v = await sessions[0].run({ x });
            a = await sessions[1].run({ x });
            const voice = v[sessions[0].outputNames[0]].data as Float32Array, music = a[sessions[1].outputNames[0]].data as Float32Array;
            if (voice.length !== values.length || music.length !== values.length)
                throw new Error('Unexpected Spleeter mask size');
            for (let c = 0; c < 2; c++)
                for (let f = 0; f < Math.min(STEP, frames - begin); f++)
                    for (let b = 0; b < BINS; b++) {
                        const i = (c * FRAMES + f + CONTEXT) * BINS + b, p = voice[i] ** 2, q = music[i] ** 2;
                        const mask = (p + 5e-11) / (p + q + 1e-10);
                        if (!Number.isFinite(mask))
                            throw new Error('Nonfinite vocal mask');
                        masks[(c * frames + begin + f) * BINS + b] = mask;
                    }
        }
        finally {
            x.dispose();
            if (v)
                for (const t of Object.values(v))
                    t.dispose();
            if (a)
                for (const t of Object.values(a))
                    t.dispose();
        }
        progress(Math.min(1, (begin + STEP) / frames));
    }
    const vocals = { left: workspace.left.subarray(0, n), right: workspace.right.subarray(0, n) };
    for (let f = 0; f < frames; f++) {
        for (let i = 0; i < FFT; i++) {
            const at = f * HOP + i - FFT / 2;
            if (at >= 0 && at < n)
                weights[at] += window[i] ** 2;
        }
        for (let c = 0; c < 2; c++) {
            real.fill(0);
            imag.fill(0);
            const offset = (c * frames + f) * BINS;
            for (let b = 0; b < BINS; b++) {
                real[b] = specReal[offset + b] * masks[offset + b];
                imag[b] = specImag[offset + b] * masks[offset + b];
                if (b) {
                    real[FFT - b] = real[b];
                    imag[FFT - b] = -imag[b];
                }
            }
            ifft(time, unused, real, imag, FFT);
            const output = c ? vocals.right : vocals.left;
            for (let i = 0; i < FFT; i++) {
                const at = f * HOP + i - FFT / 2;
                if (at >= 0 && at < n)
                    output[at] += time[i] * window[i];
            }
        }
    }
    for (let i = 0; i < n; i++)
        if (weights[i] > 0) {
            vocals.left[i] /= weights[i];
            vocals.right[i] /= weights[i];
        }
    return { vocals };
}
