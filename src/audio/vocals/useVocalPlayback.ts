import { useCallback, useMemo } from "react";
import { isCurrentVocalAnalysis, type VocalAnalysis } from "../../domain/library";
import { buildVocalCurves, sampleVocalCurves } from "./articulation";
import { SILENT_VOCAL_POSE } from "./envelope";

export function useVocalPlayback(analysis: VocalAnalysis | undefined, duration: number, enabled: boolean) {
  const curves = useMemo(() => isCurrentVocalAnalysis(analysis, duration) ? buildVocalCurves(Float32Array.from(analysis!.rms), Uint8Array.from(analysis!.vowels)) : null, [analysis, duration]);
  return useCallback((time: number, volume: number) => enabled && curves ? sampleVocalCurves(curves, time, volume) : SILENT_VOCAL_POSE, [curves, enabled]);
}
