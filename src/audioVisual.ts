export type AudioVisualFeatures = {
  energy: number;
  bass: number;
  mid: number;
  treble: number;
  transient: number;
  isPlaying: boolean;
  isComparing: boolean;
  source: number;
  elapsed: number;
};

export const EMPTY_AUDIO_VISUAL: AudioVisualFeatures = {
  energy: 0,
  bass: 0,
  mid: 0,
  treble: 0,
  transient: 0,
  isPlaying: false,
  isComparing: false,
  source: 0,
  elapsed: 0,
};

export function sampleAnalyser(
  analyser: AnalyserNode,
  frequencyData: Uint8Array<ArrayBuffer>,
  timeData: Uint8Array<ArrayBuffer>,
  previous: AudioVisualFeatures,
  elapsed: number,
  source: number,
): AudioVisualFeatures {
  analyser.getByteFrequencyData(frequencyData);
  analyser.getByteTimeDomainData(timeData);

  const binHz = analyser.context.sampleRate / analyser.fftSize;
  const band = (low: number, high: number) => {
    const start = Math.max(0, Math.floor(low / binHz));
    const end = Math.min(frequencyData.length, Math.ceil(high / binHz));
    let sum = 0;
    for (let index = start; index < end; index += 1) {
      const value = frequencyData[index] / 255;
      sum += value * value;
    }
    return end > start ? Math.sqrt(sum / (end - start)) : 0;
  };

  let squareSum = 0;
  for (const byte of timeData) {
    const value = (byte - 128) / 128;
    squareSum += value * value;
  }
  const rms = Math.sqrt(squareSum / timeData.length);
  const energy = Math.min(1, rms * 3.6);
  const bass = Math.min(1, band(35, 190) * 1.7);
  const mid = Math.min(1, band(190, 2400) * 1.55);
  const treble = Math.min(1, band(2400, 10000) * 2);
  // Percussive onsets are carried by both broadband amplitude and low-frequency
  // flux. This keeps kick/snare timing legible without retriggering on a held note.
  const energyRise = Math.max(0, energy - previous.energy);
  const bassRise = Math.max(0, bass - previous.bass);
  const rawTransient = Math.min(1, energyRise * 5.6 + bassRise * 3.4);

  return {
    energy: previous.energy * 0.32 + energy * 0.68,
    bass: previous.bass * 0.38 + bass * 0.62,
    mid: previous.mid * 0.4 + mid * 0.6,
    treble: previous.treble * 0.46 + treble * 0.54,
    transient: Math.max(rawTransient, previous.transient * 0.7),
    isPlaying: true,
    isComparing: previous.isComparing,
    source,
    elapsed,
  };
}
