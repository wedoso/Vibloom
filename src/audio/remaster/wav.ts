import { IntegratedLoudness } from "./loudness";
import { masterPost } from "./master";

export type RenderMetrics = { repairedLufs: number | null; outputLufs: number | null; samplePeakDb: number | null; truePeakDb: number | null; safetyGainDb: number; elapsedMs: number };
const yieldToMessages = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const db = (value: number) => value > 0 ? 20 * Math.log10(value) : null;

/** One output allocation. Float PCM is packed forward to PCM24 in the same
 * buffer after processing; worker returns the valid byte length separately. */
export class WavRender {
  readonly buffer: ArrayBuffer;
  readonly pcm: Float32Array;
  private written = 0;
  private readonly inputMeter: IntegratedLoudness;
  constructor(readonly rate: number, readonly length: number, readonly channels: number) {
    this.buffer = new ArrayBuffer(44 + length * channels * 4);
    this.pcm = new Float32Array(this.buffer, 44);
    this.inputMeter = new IntegratedLoudness(rate, channels);
  }
  append(data: Float32Array[]) {
    const count = data[0].length;
    if (this.written + count > this.length || data.length !== this.channels || data.some(x => x.length !== count)) throw new Error("Incomplete remaster output.");
    for (let i = 0; i < count; i++) {
      for (let c = 0; c < this.channels; c++) {
        const sample = data[c][i];
        if (!Number.isFinite(sample)) throw new Error("Non-finite audio sample.");
        this.pcm[(this.written + i) * this.channels + c] = sample;
      }
      this.inputMeter.sample(this.pcm, this.written + i);
    }
    this.written += count;
  }
  async finish(targetLufs: number | null, ceilingDb: number, onProgress: (p: number) => void) {
    if (this.written !== this.length) throw new Error("Remaster output length does not match Track A.");
    const repairedLufs = this.inputMeter.value();
    let truePeak: number | null = null, gain = 1;
    if (targetLufs !== null) {
      const result = await masterPost(this.pcm, this.rate, this.channels, targetLufs, ceilingDb, p => onProgress(p * .75));
      truePeak = result.truePeak; gain = result.safetyGain;
    }
    const meter = new IntegratedLoudness(this.rate, this.channels), view = new DataView(this.buffer);
    let peak = 0, offset = 44;
    for (let i = 0; i < this.length; i++) {
      meter.sample(this.pcm, i);
      for (let c = 0; c < this.channels; c++) {
        const sample = this.pcm[i * this.channels + c];
        peak = Math.max(peak, Math.abs(sample));
        const value = Math.max(-8388608, Math.min(8388607, Math.floor(sample * 8388608)));
        view.setUint8(offset++, value & 255); view.setUint8(offset++, value >> 8 & 255); view.setUint8(offset++, value >> 16 & 255);
      }
      if (i % 65536 === 0) { onProgress(.75 + i / this.length * .25); await yieldToMessages(); }
    }
    const string = (at: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i)); };
    string(0, "RIFF"); view.setUint32(4, offset + ((offset - 44) % 2) - 8, true); string(8, "WAVE"); string(12, "fmt ");
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, this.channels, true);
    view.setUint32(24, this.rate, true); view.setUint32(28, this.rate * this.channels * 3, true);
    view.setUint16(32, this.channels * 3, true); view.setUint16(34, 24, true); string(36, "data"); view.setUint32(40, offset - 44, true);
    if ((offset - 44) % 2) view.setUint8(offset++, 0);
    return { buffer: this.buffer, byteLength: offset, metrics: { repairedLufs, outputLufs: meter.value(), samplePeakDb: db(peak), truePeakDb: truePeak === null ? null : db(truePeak), safetyGainDb: 20 * Math.log10(gain) } };
  }
}
