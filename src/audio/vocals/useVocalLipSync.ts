import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { buildVocalCurves, sampleVocalCurves } from "./articulation";
import { SILENT_VOCAL_POSE } from "./envelope";
import { isCurrentVocalAnalysis, type VocalAnalysis } from "../../domain/library";
import { VocalJobStore } from "./jobStore";

export function useVocalLipSync(store: VocalJobStore, key: string, duration: number | null, readBuffer: () => AudioBuffer | null, saved: VocalAnalysis | undefined, save: (buffer: AudioBuffer, analysis: VocalAnalysis) => void) {
  const jobs = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [enabled, setEnabled] = useState(false);
  const job = jobs[key];
  const analysis = job?.analysis ?? saved;
  const curves = useMemo(() => {
    if (duration === null || !isCurrentVocalAnalysis(analysis, duration)) return null;
    return buildVocalCurves(Float32Array.from(analysis.rms), Uint8Array.from(analysis.vowels));
  }, [analysis, duration]);
  useEffect(() => {
    // Preserve singing intent across A/B switches while sharing any task that
    // Library already submitted for this source.
    // Read the live engine at invocation time. Old React callbacks retain only
    // metadata and this getter, never a previous track's PCM buffer.
    if (enabled && duration !== null && key && !curves && !job) {
      const audio = readBuffer();
      if (audio) store.prepare(key, audio, (result) => save(audio, result));
    }
  }, [enabled, duration, readBuffer, key, curves, job, store, save]);
  const sample = useCallback((time: number, volume: number) => enabled && curves ? sampleVocalCurves(curves, time, volume) : SILENT_VOCAL_POSE, [curves, enabled]);
  return {
    state: job ?? { status: curves ? "ready" : "idle", phase: "", progress: curves ? 1 : 0, error: undefined },
    enabled, sample,
    prepare: () => {
      if (duration !== null && key) {
        const audio = readBuffer();
        if (audio) store.prepare(key, audio, (analysis) => save(audio, analysis));
      }
    },
    cancel: () => { store.cancel(key); setEnabled(false); },
    toggle: () => setEnabled(value => !value),
  };
}
