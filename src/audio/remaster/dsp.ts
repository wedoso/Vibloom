import { initializeReferenceFft, releaseSpectralMemory } from "./referenceFft";
import type { RepairSettings } from "./presets";
import { yieldTask } from "./numerics";
import { nativeSpectralRepair, nativeChannelDelays } from "./nativeRepair";
import { repairTonal } from "./tonal";

export class OfflineRepair {
  private readonly input: Float32Array[];
  private written = 0;
  private finished = false;
  private nonzero = false;
  constructor(readonly rate: number, readonly channels: number, readonly length: number, private readonly settings: Readonly<RepairSettings>) {
    this.input = Array.from({ length: channels }, () => new Float32Array(length));
  }
  append(channels: Float32Array[]) {
    const count = channels[0]?.length ?? 0;
    if (this.finished || channels.length !== this.channels || channels.some(x => x.length !== count) || this.written + count > this.length) throw new Error("Invalid PCM chunk.");
    for (let c = 0; c < this.channels; c++) { this.input[c].set(channels[c], this.written); this.nonzero ||= channels[c].some(x => x !== 0); }
    this.written += count;
  }
  async finish(onProgress: (phase: string, p: number) => void = () => {}) {
    if (this.finished || this.written !== this.length) throw new Error("Incomplete repair input.");
    this.finished = true;
    const p = this.settings;
    if (p.bypass || !this.nonzero) return this.input;
    await initializeReferenceFft();
    const delays = p.enhance ? nativeChannelDelays(this.input, this.rate) : this.input.map(() => 0);
    releaseSpectralMemory();
    const repaired = await nativeSpectralRepair(this.input, this.rate, p, delays, onProgress);
    releaseSpectralMemory();
    onProgress("Repairing tonal coherence", .81); await yieldTask();
    await repairTonal(repaired, this.rate, p.tonalRepair, progress => onProgress("Repairing tonal coherence", .81 + progress * .17));
    return repaired;
  }
}
