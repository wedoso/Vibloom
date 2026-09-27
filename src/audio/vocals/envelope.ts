export const VOCAL_FRAME_RATE = 50;
export const VOCAL_SAMPLE_RATE = 44100;

/** Compact timing data, never a second audio playback source. */
export function vocalEnvelope(left: Float32Array, right: Float32Array, mixLeft: Float32Array, mixRight: Float32Array) {
  const hop = VOCAL_SAMPLE_RATE / VOCAL_FRAME_RATE;
  const frames = new Float32Array(Math.ceil(left.length / hop));
  for (let frame = 0; frame < frames.length; frame++) {
    const start = frame * hop, end = Math.min(start + hop, left.length);
    let vocalPower = 0, mixPower = 0;
    for (let i = start; i < end; i++) {
      vocalPower += left[i] ** 2 + right[i] ** 2;
      mixPower += mixLeft[i] ** 2 + mixRight[i] ** 2;
    }
    const rms = Math.sqrt(vocalPower / (2 * (end - start)));
    // Reject low-level separator leakage; this gate operates on the separated
    // vocal stem, never on rhythm, frequency bands, or the mix alone.
    frames[frame] = rms >= 0.006 && vocalPower >= mixPower * 0.01 ? rms : 0;
  }
  return frames;
}

export function sampleVocalEnvelope(frames: Float32Array | null, time: number, volume: number) {
  if (!frames || !Number.isFinite(time) || time < 0 || volume <= 0) return 0;
  const position = time * VOCAL_FRAME_RATE, index = Math.floor(position);
  if (index >= frames.length) return 0;
  const rms = (frames[index] + ((frames[index + 1] ?? 0) - frames[index]) * (position - index)) * volume;
  return rms > 0 ? Math.max(0, Math.min(1, (20 * Math.log10(rms) + 45) / 35)) : 0;
}
