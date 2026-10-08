/// <reference lib="webworker" />
import { OfflineRepair } from "./dsp";
import { getRepairPreset, validateRepairInput } from "./presets";
import { WavRender } from "./wav";

const worker = self as unknown as DedicatedWorkerGlobalScope;
let repair: OfflineRepair | null = null, render: WavRender | null = null;
let presetId = "", received = 0, startedAt = 0, busy = false;
let rate = 0, length = 0, channelCount = 0;
worker.onmessage = async ({ data }) => {
  try {
    if (busy) throw new Error("Remaster worker received overlapping requests.");
    busy = true;
    if (data.type === "init") {
      validateRepairInput(data.rate, data.length, data.channels);
      const preset = getRepairPreset(data.presetId);
      presetId = preset.id; startedAt = performance.now(); received = 0;
      repair = new OfflineRepair(data.rate, data.channels, data.length, preset.settings);
      rate = data.rate; length = data.length; channelCount = data.channels;
      render = null;
      worker.postMessage({ type: "ready" });
    } else if (data.type === "chunk" && repair) {
      const channels = data.channels as Float32Array[];
      if (channels.length !== channelCount || channels.some(x => !(x instanceof Float32Array) || x.length !== channels[0].length || x.some(v => !Number.isFinite(v)))) throw new Error("Invalid audio chunk.");
      received += channels[0].length;
      if (received > length || data.final && received !== length) throw new Error("Invalid input length.");
      repair.append(channels);
      if (data.final) {
        const prepared = await repair.finish((phase, progress) => worker.postMessage({ type: "progress", phase, progress: .15 + progress * .65 }));
        // Delay the full WAV/PCM allocation until native repair has released its
        // large working heap; discard the planar copy before delivery mastering.
        render = new WavRender(rate, length, channelCount);
        render.append(prepared); prepared.length = 0;
        repair = null;
        const preset = getRepairPreset(presetId);
        const result = await render.finish(preset.settings.targetLufs, preset.settings.ceilingDb, progress => worker.postMessage({ type: "progress", phase: "Preparing WAV", progress: .8 + progress * .2 }));
        worker.postMessage({ type: "result", buffer: result.buffer, byteLength: result.byteLength, metrics: { ...result.metrics, elapsedMs: performance.now() - startedAt } }, [result.buffer]);
        repair = null; render = null;
      } else worker.postMessage({ type: "next", progress: .15 * received / length });
    } else throw new Error("Invalid remaster worker request.");
  } catch (error) {
    repair = null; render = null;
    worker.postMessage({ type: "error", message: error instanceof Error ? error.message : "Audio processing failed." });
  } finally { busy = false; }
};
