import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { buildVocalCurves, sampleVocalCurves } from "./articulation";
import { SILENT_VOCAL_POSE } from "./envelope";
import type { VocalAnalysis } from "../../domain/library";
import { VocalJobStore } from "./jobStore";

export function useVocalLipSync(store: VocalJobStore, key: string, buffer: AudioBuffer | null, saved: VocalAnalysis | undefined, save: (buffer: AudioBuffer, analysis: VocalAnalysis) => void) {
  const jobs = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [enabled, setEnabled] = useState(false);
  const job = jobs[key];
  const analysis = job?.analysis ?? saved;
  const curves = useMemo(() => {
    if (!buffer || (analysis?.version !== 2 && analysis?.version !== 3)) return null;
    if (!Array.isArray(analysis.rms) || !Array.isArray(analysis.visemes) || analysis.rms.length !== Math.ceil(buffer.duration * 50) || analysis.visemes.length !== analysis.rms.length
      || !analysis.rms.every(v => Number.isFinite(v) && v >= 0 && v <= 1) || !analysis.visemes.every(v => Number.isInteger(v) && v >= 0 && v <= 14)) return null;
    return buildVocalCurves(Float32Array.from(analysis.rms), Uint8Array.from(analysis.visemes), analysis.version);
  }, [analysis, buffer]);
  useEffect(() => {
    // Preserve singing intent across A/B switches while sharing any task that
    // Library already submitted for this source.
    if (enabled && buffer && key && !curves && !job) store.prepare(key, buffer, (result) => save(buffer, result));
  }, [enabled, buffer, key, curves, job, store, save]);
  const sample = useCallback((time: number, volume: number) => enabled && curves ? sampleVocalCurves(curves, time, volume) : SILENT_VOCAL_POSE, [curves, enabled]);
  return {
    state: job ?? { status: curves ? "ready" : "idle", phase: "", progress: curves ? 1 : 0, error: undefined },
    enabled, sample,
    prepare: () => { if (buffer && key) store.prepare(key, buffer, (analysis) => save(buffer, analysis)); },
    cancel: () => { store.cancel(key); setEnabled(false); },
    toggle: () => setEnabled(value => !value),
  };
}
