export const REMASTER_ENGINE_VERSION = "web-deshimmer-3";

export type RepairSettings = {
  bypass: boolean;
  startHz: number; endHz: number; edgeHz: number;
  thresholdDb: number; slope: number; noiseResynth: number;
  denoise: number; noiseStartHz: number; noiseWindowMs: number; noiseFloorDb: number; noiseSmoothBins: number; noisePsdMs: number;
  deres: number; resonanceThresholdDb: number; resonanceMaxDb: number;
  resonanceWindowMs: number; resonanceMedianBins: number; stationaryFloor: boolean; resonanceSmoothBins: number; resonancePersistenceDb: number;
  enhance: boolean; tonalRepair: number;
  targetLufs: number | null; ceilingDb: number;
};
export type RepairPreset = { id: string; name: string; description: string; settings: Readonly<RepairSettings> };

const base: RepairSettings = {
  bypass: false, startHz: 5100, endHz: 7200, edgeHz: 200,
  thresholdDb: 8, slope: .6, noiseResynth: 0,
  denoise: 0, noiseStartHz: 120, noiseWindowMs: 400, noiseFloorDb: -18, noiseSmoothBins: 3, noisePsdMs: 50,
  deres: 0, resonanceThresholdDb: 6, resonanceMaxDb: 8,
  resonanceWindowMs: 600, resonanceMedianBins: 31, stationaryFloor: false, resonanceSmoothBins: 5, resonancePersistenceDb: 2.5,
  enhance: true, tonalRepair: .5,
  targetLufs: null, ceilingDb: -1,
};
const preset = (id: string, name: string, description: string, changes: Partial<RepairSettings>): RepairPreset =>
  Object.freeze({ id, name, description, settings: Object.freeze({ ...base, ...changes }) });

// Recipes adapted from TheApeMachine/deshimmer, fea2cca81da613ec8a3aca4962a359e060eab9d9.
// Each recipe starts from the upstream UI defaults rather than inheriting the
// previously selected preset. The offline engine includes the default stages.
export const REPAIR_PRESETS: readonly RepairPreset[] = Object.freeze([
  preset("bypass", "Bypass", "An unchanged copy for checking the comparison path.", { bypass: true }),
  preset("default", "Default shimmer", "Conservative suppression of narrow artifacts around 5.1–7.2 kHz.", {}),
  preset("gentle", "Gentle shimmer", "Lighter cleanup for material that already sounds good.", { thresholdDb: 10, slope: .45 }),
  preset("aggressive", "Aggressive shimmer", "Stronger high-frequency cleanup; compare cymbals and vocal detail.", { thresholdDb: 6.5, slope: .85 }),
  preset("decrystallize", "Shimmer + de-crystallize", "Blend seeded phase texture into noise-like high frequencies.", { noiseResynth: .25 }),
  preset("light-denoise", "Shimmer + light denoise", "Reduce the steady noise bed while protecting attacks.", { denoise: .25 }),
  preset("strong-denoise", "Shimmer + stronger denoise", "Deeper noise reduction with a smoother frequency mask.", { denoise: .55, noiseSmoothBins: 5 }),
  preset("gentle-resonance", "De-resonator · gentle", "Reduce persistent narrow ringing with a 6 dB stage cap.", { deres: .35, resonanceThresholdDb: 7, resonanceMaxDb: 6, resonanceWindowMs: 800 }),
  preset("strong-resonance", "De-resonator · stronger", "Stronger resonance cleanup, capped at 10 dB per stage.", { deres: .7, resonanceMaxDb: 10, resonanceWindowMs: 700, resonanceSmoothBins: 7 }),
  preset("full-safe", "Full stack · conservative", "Combine shimmer cleanup, light denoise and gentle resonance reduction.", { thresholdDb: 8.5, slope: .55, noiseResynth: .1, denoise: .25, noiseSmoothBins: 5, noiseWindowMs: 450, noisePsdMs: 60, deres: .35, resonanceThresholdDb: 7, resonanceMaxDb: 7, resonanceWindowMs: 900, resonancePersistenceDb: 2.8, resonanceSmoothBins: 7 }),
  preset("full-strong", "Full stack · aggressive", "A stronger combined treatment for heavily affected material.", { thresholdDb: 7, slope: .85, noiseResynth: .2, denoise: .6, noiseFloorDb: -20, noiseSmoothBins: 7, noiseWindowMs: 350, noisePsdMs: 40, deres: .75, resonanceMaxDb: 12, resonanceWindowMs: 650, resonancePersistenceDb: 2.2, resonanceSmoothBins: 9 }),
  preset("delivery", "Delivery · −14 LUFS", "Default cleanup, then loudness adjustment with linked peak protection.", { targetLufs: -14 }),
  preset("delivery-loud", "Delivery · −10 LUFS", "A louder delivery target; limiting can reduce the achieved loudness.", { targetLufs: -10 }),
  preset("presence", "Band · 2–6 kHz", "Target metallic artifacts in the presence range.", { startHz: 2000, endHz: 6000 }),
  preset("upper", "Band · 5.8–7.8 kHz", "Shift shimmer detection toward the upper high-frequency band.", { startHz: 5800, endHz: 7800 }),
  preset("whine", "Suno/Udio · 3.5 kHz whine", "Focus on persistent whistles around 3–4.2 kHz.", { startHz: 3000, endHz: 4200, thresholdDb: 6, slope: .9, deres: .8, resonanceThresholdDb: 4, resonanceMaxDb: 12, resonanceMedianBins: 61, resonanceWindowMs: 1000, stationaryFloor: false }),
  preset("crickets", "Suno/Udio · whine + metallic crickets", "Whistle cleanup plus high-band denoise and phase texture softening.", { startHz: 3000, endHz: 4200, thresholdDb: 6, slope: .9, deres: .8, resonanceThresholdDb: 4, resonanceMaxDb: 12, resonanceMedianBins: 61, resonanceWindowMs: 1000, stationaryFloor: true, denoise: .8, noiseStartHz: 3000, noiseFloorDb: -24, noiseSmoothBins: 5, noiseWindowMs: 1000, noiseResynth: .35 }),
]);

export function getRepairPreset(id: string) {
  const found = REPAIR_PRESETS.find(item => item.id === id);
  if (!found) throw new Error("Unknown remaster preset.");
  return found;
}

// Limit output allocation rather than compressed input size. Worker owns one
// 24-bit WAV, while playback retains A and eventually one decoded B.
export const MAX_REMASTER_PCM_BYTES = 128 * 1024 * 1024;
export function validateRepairInput(rate: number, length: number, channels: number) {
  if (![1, 2].includes(channels) || !Number.isInteger(length) || length <= 0
    || !Number.isInteger(rate) || rate < 8000 || rate > 96000
    || length > rate * 60 * 12 || length * channels * 4 > MAX_REMASTER_PCM_BYTES) {
    throw new Error("Remaster supports mono/stereo at 8–96 kHz, up to 12 minutes and 128 MiB of decoded PCM.");
  }
}
