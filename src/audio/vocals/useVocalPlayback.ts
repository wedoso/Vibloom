import { useCallback, useEffect, useMemo, useState } from "react";
import { isCurrentVocalAnalysis, isVocalAnalysisReference, type MotionVocalAnalysis, type VocalAnalysis, type VocalAnalysisReference } from "../../domain/library";
import type { VocalAnalysisStore } from "./analysisStore";
import { buildVocalCurves, sampleVocalCurves } from "./articulation";
import { SILENT_VOCAL_POSE } from "./envelope";

export function useVocalPlaybackState(analysis: VocalAnalysis | undefined, duration: number, enabled: boolean, storage?: VocalAnalysisStore, onUnavailable?: (reference: VocalAnalysisReference) => void) {
  const reference = isVocalAnalysisReference(analysis) ? analysis : undefined;
  const cacheKey = reference?.cacheKey, frames = reference?.frames;
  const [loaded, setLoaded] = useState<{ cacheKey: string; frames: number; value?: MotionVocalAnalysis; error?: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => { setLoaded(null); setAttempt(value => value + 1); }, []);
  useEffect(() => {
    if (!enabled || !cacheKey || frames === undefined || !storage) return;
    if (loaded?.cacheKey === cacheKey && loaded.frames === frames && (loaded.value || loaded.error)) return;
    const requested: VocalAnalysisReference = { version: 4, cacheKey, frames };
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async (failures = 0) => {
      try {
        const value = await storage.get(requested);
        if (cancelled) return;
        if (value) setLoaded({ cacheKey, frames, value });
        else onUnavailable?.(requested);
      } catch (error) {
        if (cancelled) return;
        // A durable curve may be ready before a transient storage read succeeds.
        // Recover without requiring the listener to disable/re-enable singing.
        if (failures < 3) timer = setTimeout(() => void read(failures + 1), [100, 300, 900][failures]);
        else setLoaded({ cacheKey, frames, error: error instanceof Error ? error.message : "Vocal timing could not load. Retry." });
      }
    };
    void read();
    return () => { cancelled = true; if (timer !== undefined) clearTimeout(timer); };
  }, [cacheKey, frames, enabled, storage, onUnavailable, attempt, loaded]);
  const matching = loaded?.cacheKey === cacheKey && loaded?.frames === frames ? loaded : null;
  // Metadata restoration can create a new reference object for the same record.
  // Match durable identity, not JS object identity, to retain the loaded curves.
  const resident = isCurrentVocalAnalysis(analysis) ? analysis : matching?.value;
  const curves = useMemo(() => isCurrentVocalAnalysis(resident, duration) ? buildVocalCurves(Float32Array.from(resident.rms), Uint8Array.from(resident.vowels)) : null, [resident, duration]);
  const sample = useCallback((time: number, volume: number) => enabled && curves ? sampleVocalCurves(curves, time, volume) : SILENT_VOCAL_POSE, [curves, enabled]);
  return { sample, ready: !!curves, loading: enabled && !!reference && !curves && !matching?.error, error: matching?.error, retry };
}

export function useVocalPlayback(...args: Parameters<typeof useVocalPlaybackState>) { return useVocalPlaybackState(...args).sample; }
