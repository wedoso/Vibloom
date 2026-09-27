type LipSyncModel = {
  getParameterIndex: (id: string) => number;
  getParameterCount: () => number;
  setParameterValueByIndex: (index: number, value: number) => void;
};

/** Apply a separated-vocal envelope sampled on the existing Web Audio clock. */
export class MusicLipSync {
  private readonly indexes: number[];
  private openness = 0;

  constructor(
    private readonly model: LipSyncModel,
    parameterIds: readonly string[],
  ) {
    // Cubism synthesizes indexes for unknown IDs. Only animate real channels.
    this.indexes = [...new Set(parameterIds.map((id) => model.getParameterIndex(id)))]
      .filter((index) => index >= 0 && index < model.getParameterCount());
  }

  /** Call from beforeModelUpdate, after authored motions, expressions and physics. */
  update(vocalLevel: number, playing: boolean, dt: number) {
    const level = playing ? vocalLevel : 0;
    const target = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) * 0.8 : 0;
    // Smooth the 20 ms vocal frames without beat timing or a second playback
    // clock. Pause and vocal silence release the mouth in ~300 ms.
    const seconds = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    const response = target > this.openness ? 0.035 : 0.075;
    this.openness += (target - this.openness) * (1 - Math.exp(-seconds / response));
    if (this.openness < 0.001) this.openness = 0;
    for (const index of this.indexes) {
      // Set, rather than add: unrelated authored singing curves must not keep
      // the mouth open in silence. MouthForm and all expression channels survive.
      this.model.setParameterValueByIndex(index, this.openness);
    }
  }
}
