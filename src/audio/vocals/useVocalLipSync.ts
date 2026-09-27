import { useCallback, useEffect, useRef, useState } from "react";
import { analyzeVocals, type VocalProgress } from "./analyzeVocals";
import { sampleVocalEnvelope } from "./envelope";
import type { VocalAnalysis } from "../../domain/library";

type AnalysisState = VocalProgress & { buffer: AudioBuffer | null; status: "idle" | "working" | "ready" | "error"; error?: string };
const idle = (buffer: AudioBuffer | null): AnalysisState => ({ buffer, status: "idle", phase: "", progress: 0 });

export function useVocalLipSync(buffer: AudioBuffer | null, saved: VocalAnalysis | undefined, save: (buffer: AudioBuffer, analysis: VocalAnalysis) => void) {
  const cache = useRef(new WeakMap<AudioBuffer, Float32Array>());
  const [enabled, setEnabled] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<AnalysisState>(idle(null));
  useEffect(() => {
    if (!enabled || !buffer) return;
    const controller = new AbortController();
    const cached = cache.current.get(buffer) ?? (
      saved?.version === 1 && Array.isArray(saved.rms) && saved.rms.length === Math.ceil(buffer.duration * 50)
        && saved.rms.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)
        ? Float32Array.from(saved.rms) : undefined
    );
    // Defer state updates to the analysis task and discard results after source
    // replacement. Persist compact timing data with each source's library record.
    void Promise.resolve().then(async () => {
      if (controller.signal.aborted) return;
      if (cached) {
        cache.current.set(buffer, cached);
        setState({ ...idle(buffer), status: "ready", progress: 1 });
        return;
      }
      setState({ ...idle(buffer), status: "working", phase: "Loading vocal model" });
      try {
        const frames = await analyzeVocals(buffer, controller.signal, (progress) => {
          if (!controller.signal.aborted) setState({ buffer, status: "working", ...progress });
        });
        if (controller.signal.aborted) return;
        cache.current.set(buffer, frames);
        save(buffer, { version: 1, rms: Array.from(frames, (value) => Math.round(Math.min(1, value) * 10000) / 10000) });
        setState({ ...idle(buffer), status: "ready", progress: 1 });
      } catch (error) {
        if (!controller.signal.aborted) setState({ ...idle(buffer), status: "error", error: error instanceof Error ? error.message : "Vocal analysis failed." });
      }
    });
    return () => controller.abort();
  }, [buffer, enabled, attempt, saved, save]);
  const sample = useCallback((time: number, volume: number) => (
    enabled && buffer ? sampleVocalEnvelope(cache.current.get(buffer) ?? null, time, volume) : 0
  ), [buffer, enabled]);
  return {
    state: enabled && state.buffer === buffer ? state : idle(buffer),
    enabled,
    sample,
    enable: () => { setEnabled(true); setAttempt((value) => value + 1); },
    disable: () => setEnabled(false),
  };
}
