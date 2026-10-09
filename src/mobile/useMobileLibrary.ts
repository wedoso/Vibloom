import { useCallback, useEffect, useRef, useState } from "react";
import { SynchronizedAudioEngine } from "../audio/SynchronizedAudioEngine";
import { useComparisonWorkspace } from "../comparison/useComparisonWorkspace";
import { albumForTrack, comparisonCacheKey, comparisonsOf, createShuffleBag, EMPTY_SESSION, makeTrackFingerprint, matchLyricFile, migrateLibrarySnapshot, withComparisons, type LibraryAlbum, type LibrarySession, type LibraryTrack } from "../domain/library";
import { decodeLrc, parseLyricsFile } from "../lrc";
import { useMediaSession } from "../platform/useMediaSession";
import { mobilePlatform } from "./platform";
import { VocalJobStore, vocalJobKey } from "../audio/vocals/jobStore";
import { useMobileVocals } from "./useMobileVocals";
import type { LibraryPlatform, StorageState } from "../platform/libraryPlatform";

const AUDIO_EXTENSIONS = /\.(mp3|wav|wave|m4a|aac|ogg|oga|flac|opus|webm|aiff|aif)$/iu;
export const MOBILE_MAX_FILE_BYTES = 300 * 1024 * 1024;
const emptyStorage: StorageState = { usage: 0, quota: 0, persistent: false };
export type MobileImportSummary = { accepted: number; reconnected: number; lyrics: number; ignored: number; errors: string[] };

export function useMobileLibrary(platform: LibraryPlatform = mobilePlatform) {
  const [engine] = useState(() => new SynchronizedAudioEngine());
  const [vocalJobs] = useState(() => new VocalJobStore());
  const forgetVocals = useCallback((track: LibraryTrack, source: number) => vocalJobs.forget(vocalJobKey(track, source)), [vocalJobs]);
  const [tracks, setTracks] = useState<LibraryTrack[]>([]);
  const [albums, setAlbums] = useState<LibraryAlbum[]>([]);
  const [session, setSession] = useState<LibrarySession>({ ...EMPTY_SESSION, queue: [], history: [] });
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState("");
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState("");
  const [summary, setSummary] = useState<MobileImportSummary | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [source, setSource] = useState(0);
  const [storage, setStorage] = useState(emptyStorage);
  const tracksRef = useRef(tracks), sessionRef = useRef(session), files = useRef(new Map<string, File>());
  const loaded = useRef(""), epoch = useRef(0), importLock = useRef(false), shuffleBag = useRef<string[]>([]);
  const shuffleCycleStarted = useRef(false);
  const mounted = useRef(true), saveTail = useRef(Promise.resolve());
  const patchTracks = useCallback((update: (current: LibraryTrack[]) => LibraryTrack[]) => {
    const next = update(tracksRef.current); tracksRef.current = next; setTracks(next);
  }, []);
  const patchSession = useCallback((patch: Partial<LibrarySession>) => {
    if (patch.queue || patch.shuffle !== undefined) { shuffleBag.current = []; shuffleCycleStarted.current = false; }
    const next = { ...sessionRef.current, ...patch }; sessionRef.current = next; setSession(next);
  }, []);
  const readRoot = useCallback(() => tracksRef.current.find(track => track.id === sessionRef.current.currentTrackId) ?? null, []);
  const readTracks = useCallback(() => tracksRef.current, []);
  const cacheEnabled = useCallback(() => sessionRef.current.cacheEnabled, []);
  const comparisons = useComparisonWorkspace({ rootId: session.currentTrackId, readRoot, readTracks, patchTracks, engine, platform, cacheEnabled, onMessage: setMessage, onSelect: setSource, forgetVocals });
  const { reset: resetComparisons, clearFiles: clearComparisonFiles, ensureBuffer: ensureComparisonBuffer } = comparisons;
  const current = tracks.find(track => track.id === session.currentTrackId) ?? null;
  const duration = Math.max(current?.duration ?? 0, ...comparisonsOf(current ?? { comparison: null } as LibraryTrack).map(item => item.duration));

  const readVocalBuffer = useCallback(async (track: LibraryTrack, vocalSource: number) => {
    if (vocalSource > 0) {
      if (readRoot()?.id !== track.id) throw new Error("Open this song in Player to prepare its comparison tracks.");
      return ensureComparisonBuffer(vocalSource);
    }
    const warm = loaded.current === track.id ? engine.getBuffer(0) : null;
    if (warm) return warm;
    const file = files.current.get(track.id) ?? await platform.audioFiles.get(track.id);
    if (!file) throw new Error("Reconnect this song's original file, then retry lip sync.");
    // Decode background library preparation independently: never load/pause the player.
    const buffer = await new OfflineAudioContext(2, 1, 44100).decodeAudioData(await file.arrayBuffer());
    patchTracks(items => items.map(item => item.id === track.id && item.fingerprint === track.fingerprint ? { ...item, duration: buffer.duration } : item));
    return buffer;
  }, [readRoot, ensureComparisonBuffer, engine, platform, patchTracks]);
  const vocals = useMobileVocals({ store: vocalJobs, engine, current, tracks, readTracks, patchTracks, readBuffer: readVocalBuffer });
  const { forgetTrack: forgetVocalTrack, reset: resetVocals, cancelAll: cancelVocalJobs } = vocals;

  const refreshStorage = useCallback(async () => {
    try { const state = await platform.storage.readState(); if (mounted.current) setStorage(state); }
    catch { if (mounted.current) setStorage(emptyStorage); }
  }, [platform]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const saved = await platform.repository.load();
        if (!saved || cancelled) return;
        const snapshot = migrateLibrarySnapshot(saved);
        const restored = await Promise.all(snapshot.tracks.map(async track => {
          const cached = track.persistence === "cached" && await platform.audioFiles.get(track.id);
          const versions = await Promise.all(comparisonsOf(track).map(async version => ({ ...version, availability: version.persistence === "cached" && await platform.audioFiles.get(comparisonCacheKey(track.id, version)) ? "available" as const : "reconnect" as const })));
          return withComparisons({ ...track, availability: cached ? "available" as const : "reconnect" as const }, versions);
        }));
        if (cancelled) return;
        patchTracks(() => restored); setAlbums(snapshot.albums); patchSession(snapshot.session); setTime(snapshot.session.currentTime);
      } catch { if (!cancelled) setMessage("Storage is unavailable. You can still import and listen this session."); }
      finally { if (!cancelled) { setReady(true); await refreshStorage(); } }
    })();
    return () => { cancelled = true; };
  }, [platform, patchTracks, patchSession, refreshStorage]);
  useEffect(() => {
    if (!ready) return;
    const snapshot = { version: 3 as const, tracks, albums, session };
    const timer = window.setTimeout(() => {
      saveTail.current = saveTail.current.then(() => platform.repository.save(snapshot)).catch(() => {
        if (mounted.current) setMessage("This browser could not save your mobile library. Keep the source files to reconnect.");
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [ready, tracks, albums, session, platform]);
  useEffect(() => () => { mounted.current = false; epoch.current++; void engine.close(); }, [engine]);

  const pause = useCallback(() => {
    epoch.current++; const position = engine.pause();
    setPlaying(false); setTime(position); patchSession({ currentTime: position }); setBusy("");
  }, [engine, patchSession]);
  const load = useCallback(async (trackId: string, autoplay = true, resumeAt = 0) => {
    const track = tracksRef.current.find(item => item.id === trackId); if (!track || !ready) return false;
    const request = ++epoch.current;
    // Unlock Web Audio in the original tap before cloud/disk reads or decoding.
    const graph = engine.ensureGraph(autoplay, sessionRef.current.volume).then(async context => {
      if (autoplay && context.state !== "running" && context.state !== "closed") await context.resume();
      return { context };
    }).catch(error => ({ error }));
    setBusy("Preparing audio…");
    try {
      const resolved = await graph; if (!("context" in resolved)) throw resolved.error;
      if (request !== epoch.current) return false;
      let buffer = loaded.current === trackId ? engine.getBuffer(0) : null;
      if (!buffer) {
        const file = files.current.get(trackId) ?? await platform.audioFiles.get(trackId);
        if (request !== epoch.current) return false;
        if (!file) {
          patchTracks(items => items.map(item => item.id === trackId ? { ...item, availability: "missing" } : item));
          throw new Error("Reconnect this song: import its original file again.");
        }
        buffer = await resolved.context.decodeAudioData(await file.arrayBuffer());
        if (request !== epoch.current) return false;
        engine.pause(); setPlaying(false);
        if (loaded.current !== trackId) {
          if (sessionRef.current.currentTrackId !== trackId) resetComparisons();
          engine.clearBuffers(); engine.selectSourceImmediately(0); setSource(0);
          for (const version of comparisonsOf(track)) engine.setDuration(version.slot!, version.duration);
        }
        engine.setBuffer(0, buffer); loaded.current = trackId;
        patchTracks(items => items.map(item => item.id === trackId ? { ...item, duration: buffer!.duration, availability: item.persistence === "cached" ? "available" : "session" } : item));
      }
      const offset = Math.min(Math.max(0, resumeAt), Math.max(0, engine.getMaxDuration() - .05));
      const previous = sessionRef.current.currentTrackId;
      patchSession({ currentTrackId: trackId, currentTime: offset, history: previous && previous !== trackId ? [...sessionRef.current.history, previous].slice(-100) : sessionRef.current.history });
      engine.setOffset(offset); setTime(offset);
      if (autoplay) { const started = await engine.play(offset, .025, sessionRef.current.volume); if (request === epoch.current) setPlaying(started); }
      return true;
    } catch (error) {
      if (request === epoch.current) setMessage(error instanceof Error ? error.message : "This browser could not decode the song.");
      return false;
    } finally { if (request === epoch.current && mounted.current) setBusy(""); }
  }, [ready, engine, platform, patchTracks, patchSession, resetComparisons]);
  const play = useCallback(async () => {
    const state = sessionRef.current;
    const id = state.currentTrackId || state.queue[0] || tracksRef.current[0]?.id;
    if (!id) return;
    const offset = engine.getMaxDuration() > 0 && engine.getTimelineTime() >= engine.getMaxDuration() - .03 ? 0 : state.currentTime;
    await load(id, true, offset);
  }, [engine, load]);
  const seek = useCallback(async (value: number) => {
    if (!Number.isFinite(value) || !current) return;
    const position = Math.min(Math.max(0, value), duration);
    if (loaded.current !== current.id) { await load(current.id, false, position); return; }
    const resume = engine.isPlaying;
    engine.pause(); engine.setOffset(position); setTime(position); patchSession({ currentTime: position });
    setPlaying(resume && await engine.play(position, .025, sessionRef.current.volume));
  }, [current, duration, engine, load, patchSession]);
  const next = useCallback(async (natural = false) => {
    const state = sessionRef.current;
    if (natural && state.repeat === "one") { await load(state.currentTrackId, true, 0); return; }
    let candidates: string[];
    if (state.shuffle) {
      if (!shuffleBag.current.length) {
        if (shuffleCycleStarted.current && state.repeat !== "all") { setPlaying(false); setMessage("Queue complete."); return; }
        shuffleBag.current = createShuffleBag(state.queue, state.currentTrackId);
        if (!shuffleBag.current.length && state.repeat === "all" && state.queue.includes(state.currentTrackId)) shuffleBag.current = [state.currentTrackId];
        shuffleCycleStarted.current = true;
      }
      candidates = [...shuffleBag.current];
    } else {
      const index = state.queue.indexOf(state.currentTrackId);
      candidates = state.queue.slice(index + 1);
      if (state.repeat === "all") candidates.push(...state.queue.slice(0, index + 1));
    }
    for (const id of candidates) { shuffleBag.current = shuffleBag.current.filter(item => item !== id); if (await load(id, true, 0)) return; }
    setPlaying(false); setMessage("Queue complete. Reconnect unavailable songs to include them.");
  }, [load]);
  const previous = useCallback(async () => {
    const state = sessionRef.current;
    const id = engine.getTimelineTime() > 3 ? state.currentTrackId : state.history.at(-1) ?? state.queue[0];
    if (id) await load(id, true, 0);
  }, [engine, load]);
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      const position = Math.min(engine.getTimelineTime(), engine.getMaxDuration()); setTime(position);
      if (position - sessionRef.current.currentTime >= 5) patchSession({ currentTime: position });
      if (engine.getMaxDuration() > 0 && position >= engine.getMaxDuration() - .025) { engine.markEnded(); setPlaying(false); patchSession({ currentTime: position }); void next(true); }
    }, 100);
    return () => window.clearInterval(timer);
  }, [playing, engine, patchSession, next]);
  useMediaSession({ enabled: !!current, title: current?.name ?? "Vibloom", album: albumForTrack(albums, current?.id ?? "", session.playbackAlbumId)?.name ?? "Mobile library", isPlaying: playing, duration, position: time }, {
    play, pause, next, previous, seek, getTime: () => engine.getTimelineTime(), onError: () => setMessage("Playback needs another tap. Press Play to resume."),
  });

  const importFiles = useCallback(async (selected: File[], albumId = "") => {
    if (!selected.length || !ready || importLock.current) return;
    importLock.current = true; setImporting(true); setSummary(null);
    const result: MobileImportSummary = { accepted: 0, reconnected: 0, lyrics: 0, ignored: 0, errors: [] };
    try {
      const audio = selected.filter(file => AUDIO_EXTENSIONS.test(file.name) || file.type.startsWith("audio/"));
      const lyrics = selected.filter(file => /\.(lrc|txt)$/iu.test(file.name)).map(file => ({ name: file.name, relativePath: file.webkitRelativePath || file.name, file }));
      result.ignored = selected.length - audio.length - lyrics.length;
      const updated = new Map(tracksRef.current.map(track => [track.id, track]));
      const peers = new Map([...updated].map(([id, track]) => [id, { name: track.name, relativePath: track.relativePath }]));
      for (const file of audio) peers.set(makeTrackFingerprint(file), { name: file.name, relativePath: file.webkitRelativePath || file.name });
      const importedIds: string[] = [];
      for (const file of audio) {
        if (file.size > MOBILE_MAX_FILE_BYTES) { result.errors.push(`${file.name}: larger than 300 MB.`); continue; }
        const id = makeTrackFingerprint(file), existing = updated.get(id);
        let track: LibraryTrack = existing ?? { id, fingerprint: id, name: file.name, relativePath: file.webkitRelativePath || file.name, sourceLabel: file.webkitRelativePath.split("/").slice(0, -1).join("/") || "Imported files", size: file.size, lastModified: file.lastModified, duration: 0, availability: "session", persistence: "indexed", lyricsFileName: "", lyrics: [], comparison: null };
        files.current.set(id, file); track = { ...track, availability: track.persistence === "cached" ? "available" : "session" };
        if (sessionRef.current.cacheEnabled) {
          try { await platform.audioFiles.put(id, file); track = { ...track, persistence: "cached", availability: "available" }; }
          catch { result.errors.push(`${file.name}: available this session; could not save the audio cache.`); }
        }
        updated.set(id, track); importedIds.push(id); if (existing) result.reconnected++; else result.accepted++;
      }
      for (const [id, track] of updated) {
        const match = matchLyricFile(track, lyrics, [...peers.values()]); if (!match) continue;
        try {
          if (match.file.size > 5 * 1024 * 1024) throw new Error("Lyrics exceed 5 MB.");
          updated.set(id, { ...track, ...parseLyricsFile(decodeLrc(await match.file.arrayBuffer()), match.name), lyricsFileName: match.name }); result.lyrics++;
        } catch (error) { result.errors.push(`${match.name}: ${error instanceof Error ? error.message : "could not parse lyrics"}`); }
      }
      patchTracks(() => [...updated.values()]);
      if (albumId) setAlbums(items => items.map(album => album.id === albumId ? { ...album, trackIds: [...new Set([...album.trackIds, ...importedIds])] } : album));
      patchSession({ queue: [...new Set([...sessionRef.current.queue, ...importedIds])], currentTrackId: sessionRef.current.currentTrackId || importedIds[0] || "" });
      setSummary(result); await refreshStorage();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not import these files."); }
    finally { importLock.current = false; setImporting(false); }
  }, [ready, platform, patchTracks, patchSession, refreshStorage]);
  const attachLyrics = useCallback(async (trackId: string, file: File) => {
    try {
      if (!/\.(lrc|txt)$/iu.test(file.name) || file.size > 5 * 1024 * 1024) throw new Error("Choose an LRC or TXT file smaller than 5 MB.");
      const parsed = parseLyricsFile(decodeLrc(await file.arrayBuffer()), file.name);
      patchTracks(items => items.map(track => track.id === trackId ? { ...track, ...parsed, lyricsFileName: file.name } : track));
      setMessage("Lyrics attached.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not read lyrics."); }
  }, [patchTracks]);
  const playAll = useCallback(async (ids: string[], albumId = "") => {
    if (!ids.length) return;
    patchSession({ queue: ids, playbackAlbumId: albumId });
    await load(sessionRef.current.shuffle ? ids[Math.floor(Math.random() * ids.length)] : ids[0], true, 0);
  }, [patchSession, load]);
  const removeTrack = useCallback(async (id: string) => {
    const track = tracksRef.current.find(item => item.id === id); if (!track) return;
    if (sessionRef.current.currentTrackId === id) { pause(); resetComparisons(); engine.clearBuffers(); loaded.current = ""; setSource(0); }
    forgetVocalTrack(track);
    patchTracks(items => items.filter(item => item.id !== id));
    setAlbums(items => items.map(album => ({ ...album, trackIds: album.trackIds.filter(trackId => trackId !== id) })));
    patchSession({ queue: sessionRef.current.queue.filter(trackId => trackId !== id), currentTrackId: sessionRef.current.currentTrackId === id ? "" : sessionRef.current.currentTrackId, currentTime: sessionRef.current.currentTrackId === id ? 0 : sessionRef.current.currentTime });
    files.current.delete(id);
    await Promise.allSettled([id, ...comparisonsOf(track).map(version => comparisonCacheKey(id, version))].map(key => platform.audioFiles.remove(key)));
    await refreshStorage();
  }, [pause, resetComparisons, engine, patchTracks, patchSession, platform, refreshStorage, forgetVocalTrack]);
  const clearLibrary = useCallback(async () => {
    resetVocals();
    pause(); clearComparisonFiles(); engine.clearBuffers(); loaded.current = ""; files.current.clear();
    patchTracks(() => []); setAlbums([]); patchSession({ ...EMPTY_SESSION, queue: [], history: [] }); setTime(0); setSource(0);
    // Serialize reset behind any pending save. Only the mobile namespace is touched.
    saveTail.current = saveTail.current.then(() => platform.repository.reset());
    try { await saveTail.current; await platform.audioFiles.clear(); setMessage("Mobile library cleared. Desktop library is unchanged."); }
    catch { setMessage("Some mobile files could not be removed. Try clearing again."); saveTail.current = Promise.resolve(); }
    await refreshStorage();
  }, [pause, clearComparisonFiles, engine, patchTracks, patchSession, platform, refreshStorage, resetVocals]);
  const clearAudioCache = useCallback(async () => {
    cancelVocalJobs();
    setBusy("Clearing cached audio…");
    try {
      const track = readRoot();
      if (track?.persistence === "cached" && !files.current.has(track.id)) {
        const cached = await platform.audioFiles.get(track.id);
        if (cached) files.current.set(track.id, new File([await cached.arrayBuffer()], track.name, { type: cached.type, lastModified: track.lastModified }));
      }
      await comparisons.preserveCachedFiles();
      await platform.audioFiles.clear();
      patchTracks(items => items.map(track => ({ ...track, persistence: "indexed", availability: files.current.has(track.id) ? "session" : "reconnect" })));
      comparisons.updateCacheStatus(false);
      patchSession({ cacheEnabled: false });
      setMessage("Cached audio cleared. Albums, queue and lyrics were kept.");
    } catch { setMessage("Could not clear all cached audio. Try again."); }
    finally { setBusy(""); await refreshStorage(); }
  }, [comparisons, platform, patchTracks, patchSession, refreshStorage, readRoot, cancelVocalJobs]);
  const setVolume = useCallback((volume: number) => { engine.setVolume(volume); patchSession({ volume }); }, [engine, patchSession]);
  return { vocals, platform, engine, tracks, albums, setAlbums, session, patchSession, patchTracks, ready, busy, importing, message, setMessage, summary, setSummary, playing, time, source, storage, refreshStorage, current, duration, comparisons, load, play, pause, seek, next, previous, importFiles, attachLyrics, playAll, removeTrack, clearLibrary, clearAudioCache, setVolume };
}
export type MobileLibrary = ReturnType<typeof useMobileLibrary>;
