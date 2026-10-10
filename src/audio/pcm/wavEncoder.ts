/** Preserve the upstream quantization and interleaved TPDF random sequence. */
export class PcmWavEncoder {
  readonly bytes: ArrayBuffer;
  private readonly view: DataView;
  private written = 0;
  clippedSamples = 0;
  constructor(readonly length: number, readonly channels: number, rate: number, readonly bitDepth: 16 | 24) {
    const width = bitDepth / 8, dataSize = length * channels * width;
    this.bytes = new ArrayBuffer(44 + dataSize); this.view = new DataView(this.bytes);
    const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) this.view.setUint8(offset + i, value.charCodeAt(i)); };
    text(0, "RIFF"); this.view.setUint32(4, this.bytes.byteLength - 8, true); text(8, "WAVE"); text(12, "fmt ");
    this.view.setUint32(16, 16, true); this.view.setUint16(20, 1, true); this.view.setUint16(22, channels, true);
    this.view.setUint32(24, rate, true); this.view.setUint32(28, rate * channels * width, true);
    this.view.setUint16(32, channels * width, true); this.view.setUint16(34, bitDepth, true); text(36, "data"); this.view.setUint32(40, dataSize, true);
  }
  append(channels: Float32Array[], random = Math.random) {
    const count = channels[0]?.length ?? 0;
    if (channels.length !== this.channels || channels.some(c => c.length !== count) || this.written + count > this.length) throw new Error("Incomplete WAV input.");
    let offset = 44 + this.written * this.channels * (this.bitDepth / 8);
    const max = this.bitDepth === 16 ? 0x7fff : 0x7fffff, min = this.bitDepth === 16 ? -0x8000 : -0x800000;
    for (let i = 0; i < count; i++) for (const channel of channels) {
      const sample = channel[i];
      if (!Number.isFinite(sample)) throw new Error("EQ produced a non-finite sample.");
      if (Math.abs(sample) > 1) this.clippedSamples++;
      const value = Math.max(min, Math.min(max, Math.round(Math.max(-1, Math.min(1, sample)) * max + (this.bitDepth === 16 ? random() - random() : 0))));
      if (this.bitDepth === 16) { this.view.setInt16(offset, value, true); offset += 2; }
      else { this.view.setUint8(offset++, value & 255); this.view.setUint8(offset++, value >> 8 & 255); this.view.setUint8(offset++, value >> 16 & 255); }
    }
    this.written += count;
  }
  finish() {
    if (this.written !== this.length) throw new Error("Incomplete WAV input.");
    return { bytes: this.bytes, clippedSamples: this.clippedSamples };
  }
}
