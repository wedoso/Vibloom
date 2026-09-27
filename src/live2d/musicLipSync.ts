import type { VocalPose } from "../audio/vocals/envelope";
type LipSyncModel = {
  getParameterIndex: (id: string) => number;
  getParameterCount: () => number;
  setParameterValueByIndex: (index: number, value: number) => void;
};

/** Apply a separated-vocal envelope sampled on the existing Web Audio clock. */
export class MusicLipSync {
  private readonly indexes: number[];
  private openness = 0;
  private form = 0;
  private readonly formIndex: number;

  constructor(
    private readonly model: LipSyncModel,
    parameterIds: readonly string[],
  ) {
    // Cubism synthesizes indexes for unknown IDs. Only animate real channels.
    this.formIndex = model.getParameterIndex("ParamMouthForm");
    this.indexes = [...new Set(parameterIds.map((id) => model.getParameterIndex(id)))]
      .filter((index) => index >= 0 && index < model.getParameterCount());
  }

  /** Call from beforeModelUpdate, after authored motions, expressions and physics. */
  update(vocalLevel: number | VocalPose, playing: boolean, dt: number) {
    const level = playing ? typeof vocalLevel === "number" ? vocalLevel : vocalLevel.open : 0;
    const target = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) * 0.8 : 0;
    // Keep 20 ms consonant closures responsive while removing frame steps.
    const seconds = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    const response = target > this.openness ? 0.012 : 0.018;
    this.openness += (target - this.openness) * (1 - Math.exp(-seconds / response));
    if (this.openness < 0.001) this.openness = 0;
    if (playing && typeof vocalLevel !== "number" && vocalLevel.form !== null && this.formIndex >= 0 && this.formIndex < this.model.getParameterCount()) {
      this.form += (vocalLevel.form - this.form) * (1 - Math.exp(-seconds / .025));
      this.model.setParameterValueByIndex(this.formIndex, this.form);
    }
    for (const index of this.indexes) {
      // Set, rather than add: unrelated authored singing curves must not keep
      // the mouth open in silence. Other expression channels keep their owners.
      this.model.setParameterValueByIndex(index, this.openness);
    }
  }
}
