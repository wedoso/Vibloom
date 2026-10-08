export const EQ_ENGINE_VERSION = "suno-eq-1";
export const EQ_FREQUENCIES = [80, 250, 1000, 4000, 12000] as const;
export type EqPreset = { id: string; name: string; description: string; gains: readonly [number, number, number, number, number] };
// SUP3RMASS1VE/Suno-Song-Remaster, 862a0aa7a686be3bc7e420d108f4e3e4e050bb1f.
// Each choice replaces all five gains; none inherits another preset's settings.
export const EQ_PRESETS: readonly EqPreset[] = [
  { id: "flat", name: "Flat", description: "Keep the tonal balance unchanged.", gains: [0, 0, 0, 0, 0] },
  { id: "vocal", name: "Vocal Boost", description: "Bring vocals forward with more midrange presence.", gains: [-2, -1, 2, 3, 1] },
  { id: "bass", name: "Bass Boost", description: "A fuller low end with softer upper frequencies.", gains: [6, 3, 0, -1, -2] },
  { id: "bright", name: "Bright", description: "Lift presence and high-frequency detail.", gains: [-1, 0, 1, 3, 5] },
  { id: "warm", name: "Warm", description: "Add body and gently soften the top end.", gains: [3, 2, 0, -2, -3] },
  { id: "suno", name: "AI Fix", description: "The upstream recipe for a clearer balance in AI-generated songs.", gains: [1, -2, 1, -1, 2] },
];
export function getEqPreset(id: string) {
  const preset = EQ_PRESETS.find(item => item.id === id);
  if (!preset) throw new Error("Unknown EQ preset.");
  return preset;
}
