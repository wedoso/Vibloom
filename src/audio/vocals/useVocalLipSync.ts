import { useCallback, useEffect, useRef, useState } from "react";
import { analyzeVocals, type VocalFrames, type VocalProgress } from "./analyzeVocals";
import { sampleVocalPose, SILENT_VOCAL_POSE } from "./envelope";
import type { VocalAnalysis } from "../../domain/library";

type AnalysisState = VocalProgress & { buffer: AudioBuffer | null; status: "idle" | "working" | "ready" | "error"; error?: string };
const idle = (buffer: AudioBuffer | null): AnalysisState => ({ buffer, status: "idle", phase: "", progress: 0 });

export function useVocalLipSync(buffer: AudioBuffer | null, saved: VocalAnalysis | undefined, save: (buffer: AudioBuffer, analysis: VocalAnalysis) => void) {
  const cache = useRef(new WeakMap<AudioBuffer, VocalFrames>());
  const [requested, setRequested] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<AnalysisState>(idle(null));
  useEffect(() => {
    if ((!requested && saved?.version !== 2) || !buffer) return;
    const controller = new AbortController();
    const cached = cache.current.get(buffer) ?? (
      saved?.version === 2 && Array.isArray(saved.visemes) && saved.visemes?.length === saved.rms?.length && saved.visemes.every((v) => Number.isInteger(v) && v >= 0 && v <= 14) && Array.isArray(saved.rms) && saved.rms.length === Math.ceil(buffer.duration * 50)
        && saved.rms.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)
        ? { rms: Float32Array.from(saved.rms), visemes: Uint8Array.from(saved.visemes) } : undefined
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
        save(buffer, { version: 2, rms: Array.from(frames.rms, (value) => Math.round(Math.min(1, value) * 10000) / 10000), visemes: Array.from(frames.visemes) });
        setState({ ...idle(buffer), status: "ready", progress: 1 });
      } catch (error) {
        if (!controller.signal.aborted) setState({ ...idle(buffer), status: "error", error: error instanceof Error ? error.message : "Vocal analysis failed." });
      }
    });
    return () => controller.abort();
  }, [buffer, requested, attempt, saved, save]);
  const sample = useCallback((time: number, volume: number) => {
    const data = buffer && cache.current.get(buffer);
    return enabled && data ? sampleVocalPose(data.rms, data.visemes, time, volume) : SILENT_VOCAL_POSE;
  }, [buffer, enabled]);
  return {
    state: (requested || saved?.version === 2) && state.buffer === buffer ? state : idle(buffer),
    enabled,
    sample,
    prepare: () => { setRequested(true); setAttempt((value) => value + 1); },
    cancel: () => { setRequested(false); setEnabled(false); },
    toggle: () => setEnabled((value) => !value),
  };
}
