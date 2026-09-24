export type CompanionId = "hiyori" | "hong-xi";

export const COMPANIONS = {
  "hong-xi": {
    name: "Hong Xi",
    modelPath: "live2d/hong-xi/yuql216.model3.json",
    authoredMotions: false,
    shadowY: 0.43,
  },
  hiyori: {
    name: "Hiyori",
    modelPath: "live2d/hiyori-pro/hiyori_pro_t11.model3.json",
    authoredMotions: true,
    shadowY: 0.463,
  },
} as const;

// Hong Xi has no authored motion clips. Absolute offsets from the default
// pose avoid accumulating values in Cubism's saved parameter baseline.
export function hongXiPose(phase: number, sway: number, groove: number, nod: number, bass: number, switchAccent: number) {
  return {
    ParamAngleX: Math.sin(phase * 0.8) * 2 + sway * groove * 3,
    ParamAngleY: -nod * (4.2 + bass * 1.4),
    ParamAngleZ: Math.sin(phase * 0.6) * 1.5 - sway * groove * 4,
    ParamBodyAngleX: sway * groove * 2 + switchAccent * 0.4,
    ParamBodyAngleY: -nod * 0.9,
    ParamBodyAngleZ: sway * groove * 1.4,
  };
}
