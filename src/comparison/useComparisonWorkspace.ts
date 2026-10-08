import { useCallback, useEffect, useRef, useState } from "react";
import { comparisonsOf, comparisonCacheKey, withComparisons, withoutExtension, type LibraryTrack, type TrackComparison } from "../domain/library";
import type { LibraryPlatform } from "../platform/libraryPlatform";
import { makeWaveformPeaks, readAudioFile } from "../audio/audioFiles";
import { SynchronizedAudioEngine } from "../audio/SynchronizedAudioEngine";
import { renderRemasterNow, type RemasterProgress } from "../audio/remaster/renderRemaster";
import { getRepairPreset, REMASTER_ENGINE_VERSION } from "../audio/remaster/presets";
import { renderEqNow } from "../audio/eq/renderEq";
import { renderMasteringNow } from "../audio/mastering/renderMastering";
import { MASTERING_ENGINE_VERSION, MASTERING_UPSTREAM, snapshotSettings, type MasteringSettings } from "../audio/mastering/settings";
import { EQ_ENGINE_VERSION, getEqPreset } from "../audio/eq/presets";

export type CompareView = TrackComparison & { id: string; slot: number; status: "ready" | "loading" | "error" | "reconnect"; loadProgress: number; error: string };
export type TransformKind = "eq" | "remaster";
export type TransformJob = RemasterProgress & { kind: TransformKind; source: number; target: number; presetId: string };
type Job = { controller: AbortController; source: number; target: number };
type Options = {
  rootId: string; readRoot: () => LibraryTrack | null; readTracks: () => LibraryTrack[];
  patchTracks: (update: (tracks: LibraryTrack[]) => LibraryTrack[]) => void;
  engine: SynchronizedAudioEngine; platform: LibraryPlatform; cacheEnabled: () => boolean;
  onMessage: (message: string) => void; onSelect: (index: number) => void;
  forgetVocals: (track: LibraryTrack, source: number) => void;
};
import { runAudioJob } from "../audio/processingQueue";
const aborted = () => new DOMException("Source changed or cancelled", "AbortError");
export function useComparisonWorkspace({ rootId, readRoot, readTracks, patchTracks, engine, platform, cacheEnabled, onMessage, onSelect, forgetVocals }: Options) {
  const [slots, setSlots] = useState<Record<number, CompareView>>({});
  const [jobs, setJobs] = useState<Record<number, TransformJob>>({});
  const [clearing, setClearing] = useState(false);
  const clearingRef = useRef(false);
  const epoch = useRef(0), selection = useRef(0);
  const controllers = useRef(new Map<number, Job>());
  const files = useRef(new Map<string, File>());
  const pending = useRef(new Map<string, Promise<AudioBuffer>>());
  const selectionTail = useRef<Promise<void>>(Promise.resolve());
  const urls = useRef(new Map<string, number>());
  const cancel = useCallback((source: number) => {
    controllers.current.get(source)?.controller.abort(); controllers.current.delete(source);
    setJobs(current => { const next = { ...current }; delete next[source]; return next; });
  }, []);
  const cancelAll = useCallback(() => { for (const job of controllers.current.values()) job.controller.abort(); controllers.current.clear(); setJobs({}); }, []);
  const reset = useCallback(() => {
    epoch.current++; selection.current++; cancelAll(); pending.current.clear();
    for (let i = 1; i < 9; i++) engine.setBuffer(i, null);
    setSlots({});
  }, [cancelAll, engine]);
  useEffect(() => {
    reset();
    const root = readRoot(); if (!root) return;
    const versions = comparisonsOf(root), next: Record<number, CompareView> = {};
    for (const item of versions) {
      const ready = item.persistence === "cached" && item.availability === "available" || files.current.has(comparisonCacheKey(root.id, item));
      next[item.slot!] = { ...item, id: item.id!, slot: item.slot!, status: ready ? "ready" : "reconnect", loadProgress: 0, error: ready ? "" : "Choose this version's file to reconnect it." };
      engine.setDuration(item.slot!, item.duration);
    }
    setSlots(next);
  }, [rootId, readRoot, reset, engine]);
  useEffect(() => () => {
    for (const job of controllers.current.values()) job.controller.abort();
    controllers.current.clear(); files.current.clear(); pending.current.clear();
    for (const [url, timer] of urls.current) { clearTimeout(timer); URL.revokeObjectURL(url); } urls.current.clear();
  }, []);
  const record = useCallback((index: number) => { const root = readRoot(); return root ? comparisonsOf(root).find(item => item.slot === index) : undefined; }, [readRoot]);
  const sourceIdentity = useCallback((index: number) => index === 0 ? readRoot()?.fingerprint : record(index)?.id, [readRoot, record]);
  const resolveFile = useCallback(async (root: LibraryTrack, item: TrackComparison) => files.current.get(comparisonCacheKey(root.id, item)) ?? (item.persistence === "cached" ? await platform.audioFiles.get(comparisonCacheKey(root.id, item)) : null), [platform]);
  const ensureBuffer = useCallback(async (index: number, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    const warm = engine.getBuffer(index); if (warm) return warm;
    if (index === 0) throw new Error("Load the original track first.");
    const root = readRoot(), item = record(index), generation = epoch.current;
    if (!root || !item) throw new Error("This version is no longer available.");
    const key = `${root.id}:${item.id}`;
    const existing = pending.current.get(key); if (existing) { const result = await existing; signal?.throwIfAborted(); return result; }
    const valid = () => generation === epoch.current && readRoot()?.id === root.id && record(index)?.id === item.id;
    const task = (async () => {
      const file = await resolveFile(root, item); if (!valid()) throw aborted();
      if (!file) throw new Error("Reconnect this version before listening or processing.");
      setSlots(current => ({ ...current, [index]: { ...current[index], status: "loading", loadProgress: 0, error: "" } }));
      try {
        const bytes = await readAudioFile(file, progress => { if (valid()) setSlots(current => ({ ...current, [index]: { ...current[index], loadProgress: progress * .6 } })); });
        if (!valid()) throw aborted(); signal?.throwIfAborted();
        const context = await engine.ensureGraph(false), buffer = await context.decodeAudioData(bytes);
        if (!valid()) throw aborted(); signal?.throwIfAborted();
        engine.setBuffer(index, buffer); engine.trimDecodedBuffers([index]);
        const peaks = makeWaveformPeaks(buffer);
        setSlots(current => ({ ...current, [index]: { ...current[index], status: "ready", loadProgress: 100, duration: buffer.duration, peaks } }));
        patchTracks(current => current.map(track => track.id === root.id ? withComparisons(track, comparisonsOf(track).map(version => version.id === item.id ? { ...version, duration: buffer.duration, peaks } : version)) : track));
        return buffer;
      } catch (error) {
        if (valid()) setSlots(current => ({ ...current, [index]: { ...current[index], status: error instanceof Error && error.name === "AbortError" ? "ready" : "error", error: error instanceof Error ? error.message : "Could not decode this version." } }));
        throw error;
      }
    })();
    pending.current.set(key, task);
    try { return await task; } finally { if (pending.current.get(key) === task) pending.current.delete(key); }
  }, [engine, readRoot, record, resolveFile, patchTracks]);
  const select = useCallback(async (index: number) => {
    if (index > 0 && clearingRef.current) return;
    const replacing = () => [...controllers.current.values()].some(job => job.target === index);
    if (replacing()) { onMessage(`Track ${index + 1} is being updated. Select it once the new version is ready.`); return; }
    const request = ++selection.current;
    const switchWhenReady = async () => {
      if (request !== selection.current) return;
      try {
        await ensureBuffer(index);
        if (request !== selection.current) return;
        if (replacing()) return;
        if (engine.selectSource(index, .018)) { onSelect(index); engine.trimDecodedBuffers(); }
      } catch (error) { if (request === selection.current && error instanceof Error && error.name !== "AbortError") onMessage(error.message); }
    };
    // Keep warm switches immediate. Cold requests share one decode lane; queued
    // selections superseded by another key press never read or decode their file.
    if (engine.getBuffer(index)) return switchWhenReady();
    const task = selectionTail.current.then(switchWhenReady);
    selectionTail.current = task.catch(() => undefined);
    return task;
  }, [ensureBuffer, engine, onSelect, onMessage]);
  const cancelTouching = useCallback((index: number) => { for (const [source, job] of controllers.current) if (job.source === index || job.target === index) cancel(source); }, [cancel]);
  const commitFile = useCallback(async (source: number | null, target: number, file: File, changes: Partial<TrackComparison>, controller: AbortController, generation: number, inputId?: string) => {
    const root = readRoot(); if (!root || target < 1 || target > 8) throw aborted();
    const valid = () => { controller.signal.throwIfAborted(); if (epoch.current !== generation || readRoot()?.id !== root.id || source !== null && sourceIdentity(source) !== inputId) throw aborted(); };
    valid();
    const previous = record(target), id = crypto.randomUUID(), key = `${root.id}--version-${target + 1}-${id}`;
    let cached = false, attempted = false, committed = false, notice = "";
    try {
      const context = await engine.ensureGraph(false), buffer = await context.decodeAudioData(await file.arrayBuffer()); valid();
      if (cacheEnabled()) {
        try {
          const storage = await platform.storage.readState(); valid();
          if (storage.quota > 0 && file.size > Math.max(0, storage.quota - storage.usage) * .9) throw new Error("Not enough device storage.");
          attempted = true; await platform.audioFiles.put(key, file); valid(); cached = true;
        } catch (error) { valid(); notice = error instanceof Error ? ` ${error.message} Download this version to keep it.` : " Download this version to keep it."; }
      }
      valid();
      const next: TrackComparison = { ...changes, id, slot: target, cacheKey: key, name: file.name, size: file.size, lastModified: file.lastModified, duration: buffer.duration, peaks: makeWaveformPeaks(buffer), availability: cached ? "available" : "session", persistence: cached ? "cached" : "indexed" };
      if (engine.selectedSource === target) throw new Error(`Track ${target + 1} is selected. Switch tracks before replacing it.`);
      forgetVocals(root, target);
      engine.setBuffer(target, buffer); engine.trimDecodedBuffers();
      if (!cached) files.current.set(key, file);
      patchTracks(current => current.map(track => track.id === root.id ? withComparisons(track, [...comparisonsOf(track).filter(item => item.slot !== target), next].sort((a, b) => a.slot! - b.slot!)) : track));
      setSlots(current => ({ ...current, [target]: { ...next, id, slot: target, status: "ready", loadProgress: 100, error: "" } }));
      committed = true;
      if (previous) { files.current.delete(comparisonCacheKey(root.id, previous)); if (previous.persistence === "cached") await platform.audioFiles.remove(comparisonCacheKey(root.id, previous)).catch(() => undefined); }
      return notice;
    } finally { if (attempted && (!cached || !committed)) await platform.audioFiles.remove(key).catch(() => undefined); }
  }, [readRoot, sourceIdentity, record, engine, cacheEnabled, platform, forgetVocals, patchTracks]);
  const nextTarget = useCallback((source = 0) => {
    const occupied = new Set(comparisonsOf(readRoot() ?? { comparison: null } as LibraryTrack).map(item => item.slot));
    for (const job of controllers.current.values()) occupied.add(job.target);
    for (let target = 1; target < 9; target++) if (!occupied.has(target) && target !== source) return target;
    return null;
  }, [readRoot]);
  const importFile = useCallback(async (file: File, target: number) => {
    if (clearingRef.current) return;
    if (!readRoot()) { onMessage("Choose a library track first."); return; }
    if (engine.selectedSource === target) { onMessage(`Track ${target + 1} is selected. Switch tracks before replacing it.`); return; }
    cancelTouching(target); const controller = new AbortController(), generation = epoch.current;
    const source = -target; controllers.current.set(source, { controller, source: target, target });
    setJobs(current => ({ ...current, [source]: { kind: "eq", source: target, target, presetId: "import", phase: "Reading audio", progress: .1 } }));
    try {
      const notice = await runAudioJob(controller.signal, () => commitFile(null, target, file, {}, controller, generation));
      onMessage(`Track ${target + 1} ready.${notice}`);
    } catch (error) { if (error instanceof Error && error.name !== "AbortError") onMessage(error.message); }
    finally { if (controllers.current.get(source)?.controller === controller) { controllers.current.delete(source); setJobs(current => { const next = { ...current }; delete next[source]; return next; }); } }
  }, [readRoot, cancelTouching, commitFile, onMessage, engine]);
  const process = useCallback(async (source: number, target: number, kind: TransformKind, presetId: string, settings?: MasteringSettings) => {
    const sound = settings ? snapshotSettings(settings) : undefined;
    if (clearingRef.current) throw new Error("Comparison cleanup is still finishing.");
    if (source === target || target < 1 || target > 8) throw new Error("Choose another output track from 2 to 9.");
    if (engine.selectedSource === target) throw new Error(`Track ${target + 1} is selected. Choose another output or switch tracks before replacing it.`);
    if ([...controllers.current.values()].some(job => job.source === source || job.target === source || job.source === target || job.target === target)) throw new Error("That track is already processing. Choose another output or wait.");
    const root = readRoot(), inputId = sourceIdentity(source), generation = epoch.current;
    if (!root || !inputId) throw new Error("Load this track before processing.");
    const parent = source === 0 ? { name: root.name, id: root.id, number: 1 } : { name: record(source)!.name, id: inputId, number: source + 1 };
    const controller = new AbortController(); controllers.current.set(source, { controller, source, target });
    const progress = (value: RemasterProgress) => { if (!controller.signal.aborted) setJobs(current => ({ ...current, [source]: { ...value, kind, source, target, presetId } })); };
    progress({ phase: "Queued for audio processing", progress: 0 });
    try {
      return await runAudioJob(controller.signal, async () => {
      const loader = async () => { if (generation !== epoch.current || sourceIdentity(source) !== inputId) throw aborted(); return ensureBuffer(source, controller.signal); };
      const createdAt = Date.now(); let blob: Blob, details: Partial<TrackComparison>;
      if (kind === "remaster") {
        const result = await renderRemasterNow(loader, presetId, controller.signal, progress); blob = result.blob;
        details = { remaster: { engineVersion: REMASTER_ENGINE_VERSION, presetId, createdAt, metrics: result.metrics } };
      } else if (sound) {
        const result = await renderMasteringNow(loader, sound, controller.signal, progress); blob = result.blob;
        details = { mastering: { engineVersion: MASTERING_ENGINE_VERSION, upstream: MASTERING_UPSTREAM, settings: sound, inputIdentity: inputId, createdAt, clippedSamples: result.clippedSamples }, ...(sound.mode === "eq" ? { eq: { engineVersion: EQ_ENGINE_VERSION, presetId, createdAt, clippedSamples: result.clippedSamples } } : {}) };
      } else {
        const result = await renderEqNow(loader, presetId, controller.signal, progress); blob = result.blob;
        details = { eq: { engineVersion: EQ_ENGINE_VERSION, presetId, createdAt, clippedSamples: result.clippedSamples } };
      }
      controller.signal.throwIfAborted(); progress({ phase: "Preparing comparison track", progress: .98 });
      const name = `${withoutExtension(parent.name)}.${sound?.mode === "mastering" ? "mastering" : kind === "remaster" ? "audio-repair" : kind}-${presetId}.wav`;
      const notice = await commitFile(source, target, new File([blob], name, { type: "audio/wav", lastModified: createdAt }), { ...details, source: parent }, controller, generation, inputId);
      const presetName = kind === "remaster" ? getRepairPreset(presetId).name : (presetId === "custom" ? "Custom EQ" : getEqPreset(presetId).name);
      onMessage(`${presetName} ready in track ${target + 1}.${notice}`);
      return true;
      });
    } finally {
      if (controllers.current.get(source)?.controller === controller) { controllers.current.delete(source); setJobs(current => { const next = { ...current }; delete next[source]; return next; }); }
      engine.trimDecodedBuffers();
    }
  }, [readRoot, sourceIdentity, record, ensureBuffer, commitFile, onMessage, engine]);
  const remove = useCallback(async (index: number) => {
    cancelTouching(index); const root = readRoot(), item = record(index); if (!root || !item) return;
    forgetVocals(root, index);
    if (engine.selectedSource === index) { await select(0); if (engine.isPlaying) await new Promise(resolve => setTimeout(resolve, 50)); }
    if (readRoot()?.id !== root.id || record(index)?.id !== item.id) return;
    engine.setBuffer(index, null);
    files.current.delete(comparisonCacheKey(root.id, item));
    patchTracks(current => current.map(track => track.id === root.id ? withComparisons(track, comparisonsOf(track).filter(version => version.id !== item.id)) : track));
    setSlots(current => { const next = { ...current }; delete next[index]; return next; });
    if (item.persistence === "cached") await platform.audioFiles.remove(comparisonCacheKey(root.id, item)).catch(() => undefined);
    onMessage(`Track ${index + 1} removed. Other versions remain available.`);
  }, [cancelTouching, readRoot, record, forgetVocals, engine, select, patchTracks, platform, onMessage]);
  const download = useCallback(async (index: number) => {
    if (clearingRef.current) return;
    const generation = epoch.current;
    const root = readRoot(), item = record(index); if (!root || !item) return;
    const file = await resolveFile(root, item); if (!file) { onMessage("Reconnect this version before downloading."); return; }
    if (generation !== epoch.current || record(index)?.id !== item.id) return;
    const url = URL.createObjectURL(file), anchor = document.createElement("a"); anchor.href = url; anchor.download = item.name;
    try { anchor.click(); } catch (error) { URL.revokeObjectURL(url); throw error; }
    urls.current.set(url, window.setTimeout(() => { URL.revokeObjectURL(url); urls.current.delete(url); }, 30_000));
  }, [readRoot, record, resolveFile, onMessage]);
  const clearAll = useCallback(async () => {
    if (clearingRef.current) return;
    const root = readRoot(); if (!root) return;
    const versions = comparisonsOf(root);
    clearingRef.current = true; setClearing(true);
    epoch.current++; selection.current++; cancelAll(); pending.current.clear();
    for (const version of versions) forgetVocals(root, version.slot!);
    try {
      await select(0);
      if (engine.isPlaying) await new Promise(resolve => setTimeout(resolve, 50));
      if (readRoot()?.id === root.id) {
        for (let index = 1; index < 9; index++) engine.setBuffer(index, null);
        setSlots({}); engine.trimDecodedBuffers();
      }
      for (const version of versions) files.current.delete(comparisonCacheKey(root.id, version));
      for (const [url, timer] of urls.current) { clearTimeout(timer); URL.revokeObjectURL(url); }
      urls.current.clear();
      patchTracks(current => current.map(track => track.id === root.id ? withComparisons(track, []) : track));
      const removals = await Promise.allSettled(versions.filter(version => version.persistence === "cached").map(version => platform.audioFiles.remove(comparisonCacheKey(root.id, version))));
      onMessage(removals.some(result => result.status === "rejected") ? "Comparisons cleared. Some device files could not be removed; retry in Storage." : "Comparisons cleared · original playback continues.");
    } finally { clearingRef.current = false; setClearing(false); }
  }, [readRoot, cancelAll, forgetVocals, select, engine, patchTracks, platform, onMessage]);
  const hasSessionFile = useCallback((track: LibraryTrack, item: TrackComparison) => files.current.has(comparisonCacheKey(track.id, item)), []);
  const preserveCachedFiles = useCallback(async (onlyTrackId?: string) => {
    const root = readRoot(); if (!root || onlyTrackId && root.id !== onlyTrackId) return;
    for (const item of comparisonsOf(root)) {
      if (item.persistence !== "cached") continue;
      const file = await resolveFile(root, item);
      if (!file) continue;
      // OPFS File snapshots become unreadable when their backing entry is
      // removed. Materialize a session Blob before clearing the disk cache.
      const bytes = await file.arrayBuffer();
      if (readRoot()?.id === root.id && record(item.slot!)?.id === item.id) files.current.set(comparisonCacheKey(root.id, item), new File([bytes], item.name, { type: file.type, lastModified: item.lastModified }));
    }
  }, [readRoot, record, resolveFile]);
  const updateCacheStatus = useCallback((_cached: false, onlyTrackId?: string) => {
    patchTracks(current => current.map(track => onlyTrackId && track.id !== onlyTrackId ? track : withComparisons(track, comparisonsOf(track).map(item => ({ ...item, persistence: "indexed", availability: hasSessionFile(track, item) ? "session" : "reconnect" })))));
    if (!onlyTrackId || readRoot()?.id === onlyTrackId) setSlots(current => Object.fromEntries(Object.entries(current).map(([key, value]) => [key, { ...value, persistence: "indexed", status: readRoot() && hasSessionFile(readRoot()!, value) || engine.getBuffer(value.slot) ? "ready" : "reconnect" }])));
  }, [patchTracks, hasSessionFile, readRoot, engine]);
  const cacheFiles = useCallback(async (onlyTrackId?: string) => {
    let count = 0;
    for (const root of readTracks()) if (!onlyTrackId || root.id === onlyTrackId) for (const item of comparisonsOf(root)) {
      const key = comparisonCacheKey(root.id, item), file = files.current.get(key); if (!file) continue;
      try { await platform.audioFiles.put(key, file); } catch (error) { await platform.audioFiles.remove(key).catch(() => undefined); throw error; }
      if (!readTracks().some(track => track.id === root.id && comparisonsOf(track).some(version => version.id === item.id))) { await platform.audioFiles.remove(key).catch(() => undefined); continue; }
      patchTracks(current => current.map(track => track.id === root.id ? withComparisons(track, comparisonsOf(track).map(version => version.id === item.id ? { ...version, persistence: "cached", availability: "available" } : version)) : track));
      files.current.delete(key); count++;
      if (readRoot()?.id === root.id) setSlots(current => ({ ...current, [item.slot!]: { ...current[item.slot!], persistence: "cached" } }));
    }
    return count;
  }, [readTracks, platform, patchTracks, readRoot]);
  const clearFiles = useCallback(() => { reset(); files.current.clear(); }, [reset]);
  return { slots, jobs, clearing, clearAll, reset, clearFiles, record, nextTarget, ensureBuffer, select, importFile, process, cancel, cancelAll, remove, download, hasSessionFile, preserveCachedFiles, updateCacheStatus, cacheFiles };
}
