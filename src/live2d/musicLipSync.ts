import type { VocalPose } from "../audio/vocals/envelope";
type LipSyncModel = {
  getParameterIndex: (id: string) => number;
  getParameterCount: () => number;
  getParameterMinimumValue?: (index: number) => number;
  getParameterMaximumValue?: (index: number) => number;
  getParameterDefaultValue?: (index: number) => number;
  getParameterValueByIndex?: (index: number) => number;
  getDrawableCount?: () => number;
  getDrawableVertices?: (index: number) => Float32Array;
  update?: () => void;
  setParameterValueByIndex: (index: number, value: number) => void;
};

type MouthChannel = { index: number; min: number; max: number; neutral: number; weights: readonly number[]; value: number; jaw: boolean };
// Normalized offsets from the rig default, ordered AA/E/I/O/U. This profile
// is enabled only for real, deforming channels, never merely declared IDs.
const HONG_XI_CHANNELS = [
  { id: "Mouthfunnel", weights: [0, 0, 0, .7, .9], jaw: false },
  { id: "MouthPuckerWiden", weights: [0, .35, .7, -.55, -.85], jaw: false },
  { id: "Jawopen", weights: [1, 1, 1, 1, 1], jaw: true },
];

/** Verify a parameter changes geometry. Some exported rigs contain unbound
 * ARKit IDs. Probe once at load, restoring every parameter before rendering. */
function deforms(model: LipSyncModel, index: number, min: number, max: number) {
  if (!model.update || !model.getDrawableCount || !model.getDrawableVertices || !model.getParameterValueByIndex) return false;
  const saved = Array.from({length: model.getParameterCount()}, (_, i) => model.getParameterValueByIndex!(i));
  const mouth = model.getParameterIndex("ParamMouthOpenY");
  try {
    if (mouth >= 0 && mouth < saved.length) model.setParameterValueByIndex(mouth, .7);
    model.setParameterValueByIndex(index, min); model.update();
    const before = Array.from({length: model.getDrawableCount()}, (_, i) => model.getDrawableVertices!(i).slice());
    model.setParameterValueByIndex(index, max); model.update();
    return before.some((vertices, i) => {
      const after = model.getDrawableVertices!(i);
      return vertices.some((v, j) => Math.abs(v - after[j]) > 1e-6);
    });
  } finally {
    saved.forEach((v, i) => model.setParameterValueByIndex(i, v)); model.update();
  }
}

/** Apply a separated-vocal envelope sampled on the existing Web Audio clock. */
export class MusicLipSync {
  private readonly indexes: number[];
  private readonly channels: MouthChannel[] = [];
  private openness = 0;
  private form = 0;
  private readonly formIndex: number;

  constructor(
    private readonly model: LipSyncModel,
    parameterIds: readonly string[],
    profile?: string,
  ) {
    if (profile === "hong-xi" && model.getParameterMinimumValue && model.getParameterMaximumValue && model.getParameterDefaultValue) {
      for (const channel of HONG_XI_CHANNELS) {
        const index = model.getParameterIndex(channel.id);
        if (index < 0 || index >= model.getParameterCount()) continue;
        const min = model.getParameterMinimumValue(index), max = model.getParameterMaximumValue(index), neutral = model.getParameterDefaultValue(index);
        if (![min, max, neutral].every(Number.isFinite) || min >= max || !deforms(model, index, min, max)) continue;
        this.channels.push({...channel, index, min, max, neutral, value: neutral});
      }
    }
    // Cubism synthesizes indexes for unknown IDs. Only animate real channels.
    this.formIndex = model.getParameterIndex("ParamMouthForm");
    this.indexes = [...new Set(parameterIds.map((id) => model.getParameterIndex(id)))]
      .filter((index) => index >= 0 && index < model.getParameterCount());
  }

  /** Call from beforeModelUpdate, after authored motions, expressions and physics. */
  update(vocalLevel: number | VocalPose, playing: boolean, dt: number) {
    const level = playing ? typeof vocalLevel === "number" ? vocalLevel : vocalLevel.open : 0;
    const target = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0;
    // Follow the stabilized acoustic envelope without adding another amplitude scale.
    const seconds = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    const response = target > this.openness ? 0.012 : 0.018;
    this.openness += (target - this.openness) * (1 - Math.exp(-seconds / response));
    if (this.openness < 0.001) this.openness = 0;
    if (playing && typeof vocalLevel !== "number" && vocalLevel.form !== null && this.formIndex >= 0 && this.formIndex < this.model.getParameterCount()) {
      this.form += (vocalLevel.form - this.form) * (1 - Math.exp(-seconds / .025));
      this.model.setParameterValueByIndex(this.formIndex, this.form);
    }
    const vowels = playing && typeof vocalLevel !== "number" ? vocalLevel.vowels : undefined;
    const validVowels = vowels?.length === 5 && vowels.every(v => Number.isFinite(v) && v >= 0 && v <= 1);
    for (const channel of this.channels) {
      const blend = validVowels ? Math.max(-1, Math.min(1, channel.weights.reduce((sum, weight, i) => sum + weight * vowels![i], 0))) : 0;
      const amount = channel.jaw ? (validVowels ? this.openness : 0) : blend * Math.min(1, this.openness / .25);
      const desired = channel.neutral + amount * (amount >= 0 ? channel.max - channel.neutral : channel.neutral - channel.min);
      channel.value = channel.jaw ? desired : channel.value + (desired - channel.value) * (1 - Math.exp(-seconds / .025));
      if (this.openness === 0) channel.value = channel.neutral;
      this.model.setParameterValueByIndex(channel.index, Math.max(channel.min, Math.min(channel.max, channel.value)));
    }
    const richJaw = validVowels && this.channels.some(channel => channel.jaw);
    for (const index of this.indexes) {
      // Set, rather than add: unrelated authored singing curves must not keep
      // the mouth open in silence. Other expression channels keep their owners.
      this.model.setParameterValueByIndex(index, richJaw && index === this.model.getParameterIndex("ParamMouthOpenY") ? 0 : this.openness);
    }
  }
}
