import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { mobileComparisons } from "./comparison";
import { clearVocalReference, comparisonsOf, type VocalAnalysisReference, isVocalAnalysisReference, isVocalAnalysisReady, withComparisons, type LibraryTrack } from "../domain/library";
import { VocalJobStore, vocalJobKey } from "../audio/vocals/jobStore";
import { useVocalPlayback } from "../audio/vocals/useVocalPlayback";
import type { SynchronizedAudioEngine } from "../audio/SynchronizedAudioEngine";
import type { VocalAnalysisStore } from "../audio/vocals/analysisStore";

export const MOBILE_VOCAL_PREFERENCES = "vibloom-mobile-disabled-vocals";
const readDisabled = () => {
  try { const value: unknown = JSON.parse(localStorage.getItem(MOBILE_VOCAL_PREFERENCES) ?? "[]"); return new Set<string>(Array.isArray(value) ? value.filter(item => typeof item === "string") : []); }
  catch { return new Set<string>(); }
};
export function useMobileVocals({ store, engine, current, tracks, readTracks, patchTracks, readBuffer, storage, onMessage }: {
  store: VocalJobStore; engine: SynchronizedAudioEngine; current: LibraryTrack | null; tracks: LibraryTrack[];
  readTracks: () => LibraryTrack[]; patchTracks: (update: (tracks: LibraryTrack[]) => LibraryTrack[]) => void;
  readBuffer: (track: LibraryTrack, source: number, signal?: AbortSignal) => Promise<AudioBuffer>;
  storage?: VocalAnalysisStore;
  onMessage?: (message: string) => void;
}) {
  const jobs = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [disabled, setDisabled] = useState(readDisabled);
  useEffect(() => { try { localStorage.setItem(MOBILE_VOCAL_PREFERENCES, JSON.stringify([...disabled])); } catch { /* Keep session controls usable without storage. */ } }, [disabled]);
  useEffect(() => () => store.dispose(), [store]);
  const states = useMemo(() => {
    const result = new Map<string, { key: string; ready: boolean; working: boolean; enabled: boolean; analysis: import("../domain/library").VocalAnalysis | undefined; job: import("../audio/vocals/jobStore").VocalJob | undefined }>();
    for (const track of tracks) for (const source of [0, ...mobileComparisons(track).map(version => version.slot!)]) {
      const key = vocalJobKey(track, source), job = jobs[key];
      const item = source === 0 ? track : comparisonsOf(track).find(version => version.slot === source);
      const analysis = job?.analysis ?? item?.vocalAnalysis;
      const ready = isVocalAnalysisReady(analysis, item?.duration || undefined);
      result.set(key, { key, ready, working: job?.status === "queued" || job?.status === "working", enabled: ready && !disabled.has(key), analysis, job });
    }
    return result;
  }, [tracks, jobs, disabled]);
  const state = useCallback((track: LibraryTrack, source = 0) => {
    const key = vocalJobKey(track, source);
    return states.get(key) ?? { key, ready: false, working: false, enabled: false, analysis: undefined, job: undefined };
  }, [states]);
  const prepare = (track: LibraryTrack, source = 0, rerun = false) => {
    if (source !== 0 && !mobileComparisons(track).some(item => item.slot === source)) return;
    const status = state(track, source);
    if (status.working) { store.cancel(status.key); return; }
    if (status.ready && !rerun) { setDisabled(old => { const next = new Set(old); if (next.has(status.key)) next.delete(status.key); else next.add(status.key); return next; }); return; }
    // Captured identity prevents a replaced comparison, removed song or late worker
    // response from attaching mouth data to another source.
    const valid = () => readTracks().find(item => item.id === track.id && vocalJobKey(item, source) === status.key);
    store.forget(status.key);
    store.prepare(status.key, async signal => {
      if (!valid()) throw new DOMException("Audio changed", "AbortError");
      const buffer = await readBuffer(track, source, signal);
      if (!valid()) throw new DOMException("Audio changed", "AbortError");
      return buffer;
    }, analysis => {
      if (!valid()) return;
      patchTracks(items => items.map(item => item.id !== track.id || vocalJobKey(item, source) !== status.key ? item : source === 0 ? { ...item, vocalAnalysis: analysis } : withComparisons(item, comparisonsOf(item).map(version => version.slot === source ? { ...version, vocalAnalysis: analysis } : version))));
      // A diagnostic re-run replaces the old curve only after success. Keep it
      // usable during analysis/errors and remove its durable record afterwards.
      if (rerun && isVocalAnalysisReference(status.analysis) && (!isVocalAnalysisReference(analysis) || status.analysis.cacheKey !== analysis.cacheKey)) void storage?.remove(status.analysis.cacheKey).catch(() => undefined);
      setDisabled(old => { const next = new Set(old); next.delete(status.key); return next; });
    });
  };
  const forgetTrack = useCallback((track: LibraryTrack) => {
    const keys = [0, ...comparisonsOf(track).map(version => version.slot!)].map(source => vocalJobKey(track, source));
    keys.forEach(store.forget);
    for (const analysis of [track.vocalAnalysis, ...comparisonsOf(track).map(item => item.vocalAnalysis)]) {
      if (isVocalAnalysisReference(analysis)) void storage?.remove(analysis.cacheKey).catch(() => undefined);
    }
    setDisabled(old => new Set([...old].filter(key => !keys.includes(key))));
  }, [store, storage]);
  const cancelAll = useCallback(() => { for (const [key, job] of Object.entries(store.getSnapshot())) if (job.status === "queued" || job.status === "working") store.cancel(key); }, [store]);
  const reset = useCallback(() => { store.reset(); setDisabled(new Set()); }, [store]);
  const audible = engine.audibleSource;
  const selected = current ? state(current, audible) : null;
  const item = current && (audible === 0 ? current : comparisonsOf(current).find(version => version.slot === audible));
  const missingVocalReference = useCallback((reference: VocalAnalysisReference) => {
    if (clearVocalReference(readTracks(), reference.cacheKey) === readTracks()) return;
    store.forgetReference(reference.cacheKey);
    patchTracks(current => clearVocalReference(current, reference.cacheKey));
    onMessage?.("Vocal timing is unavailable. Prepare vocals again.");
  }, [readTracks, store, patchTracks, onMessage]);
  const sample = useVocalPlayback(selected?.analysis, item?.duration ?? 0, selected?.enabled ?? false, storage, missingVocalReference);
  // A source may change inside the engine before React publishes its new selection.
  // Reject mismatched frames so old vocals never animate the newly audible source.
  const sampleVocals = useCallback((time: number, volume: number) => engine.audibleSource === audible ? sample(time, volume) : { open: 0, form: null }, [engine, audible, sample]);
  const activeJobs = useMemo(() => tracks.flatMap(track => [0, ...mobileComparisons(track).map(version => version.slot!)].flatMap(source => { const status = state(track, source); return status.working || status.job?.status === "error" ? [{ track, source, ...status }] : []; })), [tracks, state]);
  return { state, prepare, sampleVocals, activeJobs, forgetTrack, cancelAll, reset };
}
