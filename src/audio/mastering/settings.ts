import { getEqPreset } from "../eq/presets";
export const MASTERING_ENGINE_VERSION = "suno-mastering-1";
export const MASTERING_UPSTREAM = "862a0aa7a686be3bc7e420d108f4e3e4e050bb1f";
export type MasteringSettings = {
  mode: "eq" | "mastering"; presetId: string; gains: number[];
  inputGain: number; cleanLowEnd: boolean; cutMud: boolean; addAir: boolean; tameHarsh: boolean; glueCompression: boolean;
  centerBass: boolean; stereoWidth: number; normalizeLoudness: boolean; targetLufs: number;
  truePeakLimit: boolean; truePeakCeiling: number; sampleRate: 44100 | 48000; bitDepth: 16 | 24;
};
export function initialSettings(): MasteringSettings {
  return { mode: "eq", presetId: "flat", gains: [...getEqPreset("flat").gains], inputGain: 0, cleanLowEnd: false, cutMud: false, addAir: false, tameHarsh: false, glueCompression: false, centerBass: false, stereoWidth: 100, normalizeLoudness: false, targetLufs: -14, truePeakLimit: false, truePeakCeiling: -1, sampleRate: 44100, bitDepth: 24 };
}
export function upstreamDefaults(settings: MasteringSettings): MasteringSettings {
  return { ...settings, mode: "mastering", inputGain: 0, cleanLowEnd: true, cutMud: false, addAir: false, tameHarsh: false, glueCompression: false, centerBass: false, stereoWidth: 100, normalizeLoudness: true, targetLufs: -14, truePeakLimit: true, truePeakCeiling: -1, sampleRate: 44100, bitDepth: 16 };
}
export function snapshotSettings(settings: MasteringSettings): MasteringSettings {
  if (settings.presetId !== "custom") getEqPreset(settings.presetId);
  if (!["eq","mastering"].includes(settings.mode)) throw new Error("Invalid processing mode.");
  for (const key of ["cleanLowEnd","cutMud","addAir","tameHarsh","glueCompression","centerBass","normalizeLoudness","truePeakLimit"] as const) if (typeof settings[key] !== "boolean") throw new Error(`Invalid ${key}.`);
  const ranges: [keyof MasteringSettings, number, number][] = [["inputGain",-12,12],["stereoWidth",0,200],["targetLufs",-20,-6],["truePeakCeiling",-6,0]];
  for (const [key,min,max] of ranges) { const value = settings[key]; if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid ${key}.`); }
  if (!Array.isArray(settings.gains) || settings.gains.length !== 5 || settings.gains.some(g => !Number.isFinite(g) || g < -12 || g > 12)) throw new Error("EQ gains must be between −12 and +12 dB.");
  if (![44100,48000].includes(settings.sampleRate) || ![16,24].includes(settings.bitDepth)) throw new Error("Invalid output format.");
  return { ...settings, gains: [...settings.gains] };
}
