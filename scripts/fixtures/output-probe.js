/* global AudioWorkletProcessor, registerProcessor, sampleRate */
// Test-only audio render probe, served from the same origin without relaxing CSP.
class OutputProbe extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frames = 0; this.silent = 0; this.run = 0; this.longest = 0; this.invalid = 0; this.sumSquares = 0;
    this.port.onmessage = () => this.port.postMessage({ frames: this.frames, silentQuanta: this.silent, longestSilentFrames: this.longest, invalidSamples: this.invalid, sampleRate, sumSquares: this.sumSquares });
  }
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel) {
      let energy = 0;
      for (const sample of channel) { if (!Number.isFinite(sample)) this.invalid++; energy += sample * sample; }
      this.frames += channel.length; this.sumSquares += energy;
      if (energy < 1e-12) { this.silent++; this.run += channel.length; this.longest = Math.max(this.longest, this.run); }
      else this.run = 0;
    }
    return true;
  }
}
registerProcessor('output-probe', OutputProbe);
