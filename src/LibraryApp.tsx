import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  AudioLines,
  ChevronDown,
  Database,
  FastForward,
  FileAudio,
  FileText,
  FolderOpen,
  HardDrive,
  Headphones,
  Library,
  ListMusic,
  Maximize2,
  Minimize2,
  Menu,
  MoreHorizontal,
  Music2,
  Pause,
  Play,
  Plus,
  Repeat,
  Repeat1,
  Rewind,
  Search,
  ShieldCheck,
  Shuffle,
  SkipBack,
  SkipForward,
  Trash2,
  Upload,
  Volume2,
  X,
} from "lucide-react";
import {
  ChangeEvent,
  CSSProperties,
  DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import Live2DStage from "./Live2DStage";
import { EMPTY_AUDIO_VISUAL, sampleAnalyser } from "./audioVisual";
import {
  cacheTrackFile,
  clearCachedTracks,
  comparisonCacheKey,
  createShuffleBag,
  deleteLibraryDatabase,
  EMPTY_SESSION,
  getCachedTrackFile,
  LibrarySession,
  LibraryTrack,
  loadLibrarySnapshot,
  makeTrackFingerprint,
  normalizeFileName,
  readStorageState,
  removeCachedTrack,
  RepeatMode,
  requestPersistentStorage,
  saveLibrarySnapshot,
  withoutExtension,
} from "./libraryStore";
import { decodeLrc, LyricLine, parseLrc } from "./lrc";
import "./library.css";

const SUPPORTED_AUDIO = /\.(mp3|wav|wave|m4a|aac|ogg|oga|flac|opus|webm|aiff|aif)$/iu;
const MAX_FILE_BYTES = 300 * 1024 * 1024;
const SOURCE_LEAD_SECONDS = 0.025;
const SOURCE_SWITCH_SECONDS = 0.018;

type ImportSummary = {
  accepted: number;
  lyrics: number;
  duplicates: number;
  ignored: number;
  errors: string[];
};

type StorageState = {
  usage: number;
  quota: number;
  persistent: boolean;
};

type FileWithPath = File & { webkitRelativePath?: string };
type DroppedFileEntry = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (success: (file: File) => void, error?: (reason: DOMException) => void) => void;
  createReader?: () => { readEntries: (success: (entries: DroppedFileEntry[]) => void, error?: (reason: DOMException) => void) => void };
};
type Workspace = "player" | "library";
type LoadStage = "idle" | "reading" | "decoding" | "caching";
type CompareSlot = {
  file: File | null;
  trackId: string;
  name: string;
  size: number;
  duration: number;
  status: "empty" | "loading" | "ready" | "error" | "reconnect";
  loadStage: LoadStage;
  loadProgress: number;
  error: string;
  persistence: "indexed" | "cached";
};
type SceneTransitionDirection = "enter" | "workspace-player" | "workspace-library" | "focus-enter" | "focus-exit";

const EMPTY_COMPARE_SLOT: CompareSlot = {
  file: null,
  trackId: "",
  name: "",
  size: 0,
  duration: 0,
  status: "empty",
  loadStage: "idle",
  loadProgress: 0,
  error: "",
  persistence: "indexed",
};

const droppedRelativePaths = new WeakMap<File, string>();

let sceneCoverTimer: number | null = null;
let sceneCleanupTimer: number | null = null;
let sceneTransitionFrame: number | null = null;
let sceneRevealFrame: number | null = null;

function withSceneTransition(update: () => void, direction: SceneTransitionDirection): Promise<void> {
  const commit = () => flushSync(update);
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    commit();
    return Promise.resolve();
  }
  const root = document.documentElement;
  if (sceneCoverTimer !== null) window.clearTimeout(sceneCoverTimer);
  if (sceneCleanupTimer !== null) window.clearTimeout(sceneCleanupTimer);
  if (sceneTransitionFrame !== null) window.cancelAnimationFrame(sceneTransitionFrame);
  if (sceneRevealFrame !== null) window.cancelAnimationFrame(sceneRevealFrame);
  root.classList.remove("is-scene-transitioning", "is-scene-covering", "is-scene-curtain-open", "is-scene-revealing");
  root.dataset.sceneTransition = direction;
  void root.offsetWidth;
  root.classList.add("is-scene-transitioning", "is-scene-covering");
  sceneTransitionFrame = window.requestAnimationFrame(() => {
    root.classList.add("is-scene-curtain-open");
    sceneTransitionFrame = null;
  });
  const cleanup = () => {
    root.classList.remove("is-scene-transitioning", "is-scene-covering", "is-scene-curtain-open", "is-scene-revealing");
    delete root.dataset.sceneTransition;
    sceneCoverTimer = null;
    sceneCleanupTimer = null;
    sceneRevealFrame = null;
  };
  return new Promise((resolve) => {
    sceneCoverTimer = window.setTimeout(() => {
      commit();
      const revealAfterSettledFrames = (frames: number) => {
        sceneRevealFrame = window.requestAnimationFrame(() => {
          if (frames > 1) {
            revealAfterSettledFrames(frames - 1);
            return;
          }
          root.classList.remove("is-scene-covering");
          root.classList.add("is-scene-revealing");
          sceneRevealFrame = null;
          resolve();
        });
      };
      revealAfterSettledFrames(4);
    }, 390);
    sceneCleanupTimer = window.setTimeout(cleanup, 1040);
  });
}

function formatTime(seconds: number, precise = false) {
  if (!Number.isFinite(seconds) || seconds < 0) return precise ? "00:00.000" : "00:00";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const wholeSeconds = Math.floor(seconds % 60);
  const base = `${hours ? `${String(hours).padStart(2, "0")}:` : ""}${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}`;
  return precise ? `${base}.${String(Math.floor((seconds % 1) * 1000)).padStart(3, "0")}` : base;
}

function makeWaveformPeaks(buffer: AudioBuffer, count = 144) {
  const peaks = new Array(count).fill(0.08);
  const channels = Math.min(buffer.numberOfChannels, 2);
  const block = Math.max(1, Math.floor(buffer.length / count));
  for (let index = 0; index < count; index += 1) {
    let max = 0;
    const start = index * block;
    const end = Math.min(buffer.length, start + block);
    const stride = Math.max(1, Math.floor((end - start) / 160));
    for (let channel = 0; channel < channels; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let sample = start; sample < end; sample += stride) max = Math.max(max, Math.abs(data[sample]));
    }
    peaks[index] = Math.max(0.08, Math.min(1, Math.sqrt(max)));
  }
  return peaks;
}

function readAudioFile(file: File, onProgress: (progress: number) => void) {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 52));
    };
    reader.onload = () => reader.result instanceof ArrayBuffer
      ? resolve(reader.result)
      : reject(new Error("The audio file could not be read."));
    reader.onerror = () => reject(reader.error ?? new Error("The audio file could not be read."));
    reader.onabort = () => reject(new DOMException("File reading was cancelled.", "AbortError"));
    reader.readAsArrayBuffer(file);
  });
}

function PrecisionWaveform({ peaks, progress, label, source }: { peaks: number[]; progress: number; label: string; source: 0 | 1 }) {
  const bars = peaks.length ? peaks : new Array(144).fill(0.12);
  return (
    <div className={`precision-waveform waveform-source-${source === 0 ? "a" : "b"} ${peaks.length ? "is-ready" : "is-loading"}`} role="img" aria-label={`${label} waveform`}>
      <div className="waveform-bars">{bars.map((peak, index) => <i key={`${label}-${index}`} style={{ height: `${Math.max(8, peak * 100)}%` }} />)}</div>
      <span className="waveform-played" style={{ width: `${Math.max(0, Math.min(100, progress * 100))}%` }} />
      <b style={{ left: `${Math.max(0, Math.min(100, progress * 100))}%` }} />
    </div>
  );
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** unit).toFixed(unit > 1 ? 1 : 0)} ${units[unit]}`;
}

function relativePathOf(file: FileWithPath) {
  return file.webkitRelativePath || droppedRelativePaths.get(file) || file.name;
}

function fileFromEntry(entry: DroppedFileEntry) {
  return new Promise<File>((resolve, reject) => {
    if (!entry.file) {
      reject(new DOMException("The dropped file could not be read.", "NotReadableError"));
      return;
    }
    entry.file(resolve, reject);
  });
}

function entriesFromDirectory(entry: DroppedFileEntry) {
  return new Promise<DroppedFileEntry[]>((resolve, reject) => {
    const reader = entry.createReader?.();
    if (!reader) {
      resolve([]);
      return;
    }
    const entries: DroppedFileEntry[] = [];
    const readBatch = () => reader.readEntries((batch) => {
      if (!batch.length) {
        resolve(entries);
        return;
      }
      entries.push(...batch);
      readBatch();
    }, reject);
    readBatch();
  });
}

async function filesFromDroppedEntry(entry: DroppedFileEntry, parentPath = ""): Promise<File[]> {
  const entryPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
  if (entry.isFile) {
    const file = await fileFromEntry(entry);
    droppedRelativePaths.set(file, entryPath);
    return [file];
  }
  if (!entry.isDirectory) return [];
  const children = await entriesFromDirectory(entry);
  const nested = await Promise.all(children.map((child) => filesFromDroppedEntry(child, entryPath)));
  return nested.flat();
}

async function filesFromDrop(dataTransfer: DataTransfer) {
  const entryItems: DroppedFileEntry[] = [];
  for (const item of Array.from(dataTransfer.items)) {
    const entry = (item as unknown as { webkitGetAsEntry?: () => DroppedFileEntry | null }).webkitGetAsEntry?.();
    if (entry) entryItems.push(entry);
  }
  if (!entryItems.length) return Array.from(dataTransfer.files);
  const nested = await Promise.all(entryItems.map((entry) => filesFromDroppedEntry(entry)));
  return nested.flat();
}

function dirname(value: string) {
  const separator = value.lastIndexOf("/");
  return separator >= 0 ? value.slice(0, separator) : "";
}

function lyricMatchKey(value: string) {
  const normalized = normalizeFileName(value);
  return `${dirname(normalized)}/${withoutExtension(normalized.split("/").at(-1) ?? normalized)}`;
}

function sourceLabelFor(relativePath: string) {
  const parts = relativePath.split("/").filter(Boolean);
  return parts.length > 1 ? parts[0] : "Imported files";
}

function trackDisplayName(name: string) {
  return withoutExtension(name).replace(/^\d{1,3}[\s._-]+/u, "").trim() || withoutExtension(name);
}

function repeatLabel(mode: RepeatMode) {
  if (mode === "one") return "Repeat one";
  if (mode === "all") return "Repeat all";
  return "Repeat off";
}

function LyricsPanel({ lines, currentTime, fileName, activeSource, onAttachLyrics, onRemoveLyrics, variant = "console" }: { lines: LyricLine[]; currentTime: number; fileName: string; activeSource: 0 | 1; onAttachLyrics: () => void; onRemoveLyrics: () => void; variant?: "console" | "focus" }) {
  const lineRefs = useRef<Array<HTMLParagraphElement | null>>([]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const activeIndex = useMemo(() => {
    let result = -1;
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index].time <= currentTime + 0.03) result = index;
      else break;
    }
    return result;
  }, [currentTime, lines]);
  const activeLine = activeIndex >= 0 ? lines[activeIndex] : null;
  const nextTime = activeIndex >= 0 ? lines[activeIndex + 1]?.time : lines[0]?.time;
  const lineProgress = activeLine && nextTime && nextTime > activeLine.time
    ? Math.min(100, Math.max(0, ((currentTime - activeLine.time) / (nextTime - activeLine.time)) * 100))
    : activeLine ? 100 : 0;

  useEffect(() => {
    if (activeIndex < 0) return;
    const viewport = viewportRef.current;
    const line = lineRefs.current[activeIndex];
    if (!viewport || !line) return;
    const viewportBounds = viewport.getBoundingClientRect();
    const lineBounds = line.getBoundingClientRect();
    viewport.scrollTo({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      top: viewport.scrollTop + lineBounds.top - viewportBounds.top - viewport.clientHeight / 2 + lineBounds.height / 2,
    });
  }, [activeIndex]);

  if (!lines.length) {
    return (
      <div className={`library-lyrics-empty lyrics-variant-${variant}`}>
        <FileText size={18} />
        <span>No matched lyrics for this track</span>
        <button type="button" onClick={onAttachLyrics}>Attach .lrc</button>
      </div>
    );
  }

  return (
    <div className={`library-lyrics lyrics-variant-${variant} lyrics-source-${activeSource === 0 ? "a" : "b"}`} aria-label={`Lyrics from ${fileName}`}>
      <span className="library-lyrics-label"><FileText size={12} /> Synced lyrics <button type="button" onClick={onAttachLyrics}>Replace .lrc</button><button type="button" onClick={onRemoveLyrics}>Remove</button></span>
      <div className="library-lyrics-viewport" ref={viewportRef}>
        <div className="library-lyrics-list">
          {lines.map((line, index) => (
            <p
              className={index === activeIndex ? "is-current" : index < activeIndex ? "is-past" : ""}
              key={`${line.time}-${index}`}
              ref={(node) => { lineRefs.current[index] = node; }}
              aria-current={index === activeIndex ? "true" : undefined}
              style={index === activeIndex ? { "--lyric-progress": `${lineProgress}%` } as CSSProperties : undefined}
            >
              {line.text.split("\n").map((part, partIndex) => <span key={partIndex}>{part}</span>)}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function LibraryApp() {
  const [tracks, setTracks] = useState<LibraryTrack[]>([]);
  const tracksRef = useRef<LibraryTrack[]>([]);
  const [session, setSession] = useState<LibrarySession>({ ...EMPTY_SESSION });
  const sessionRef = useRef<LibrarySession>({ ...EMPTY_SESSION });
  const [restored, setRestored] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [message, setMessage] = useState("Your library stays in this browser.");
  const [search, setSearch] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [queueOpen, setQueueOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [storageOpen, setStorageOpen] = useState(false);
  const [storageState, setStorageState] = useState<StorageState>({ usage: 0, quota: 0, persistent: false });
  const [cacheProgress, setCacheProgress] = useState(0);
  const [menuTrackId, setMenuTrackId] = useState("");
  const [focusMode, setFocusMode] = useState(false);
  const [workspace, setWorkspace] = useState<Workspace>("player");
  const [compareSlot, setCompareSlot] = useState<CompareSlot>({ ...EMPTY_COMPARE_SLOT });
  const [primaryLoad, setPrimaryLoad] = useState<{ stage: LoadStage; progress: number }>({ stage: "idle", progress: 0 });
  const [activeSource, setActiveSource] = useState<0 | 1>(0);
  const [primaryPeaks, setPrimaryPeaks] = useState<number[]>([]);
  const [comparePeaks, setComparePeaks] = useState<number[]>([]);
  const [confirmAction, setConfirmAction] = useState<"cache" | "queue" | "reset" | null>(null);
  const [dragging, setDragging] = useState(false);

  const filesInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const compareInputRef = useRef<HTMLInputElement>(null);
  const lyricsInputRef = useRef<HTMLInputElement>(null);
  const lyricsTargetTrackIdRef = useRef("");
  const focusModeRef = useRef(false);
  const workspaceRef = useRef<Workspace>("player");
  const runtimeFilesRef = useRef(new Map<string, File>());
  const reconnectModeRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const compareAnalyserRef = useRef<AnalyserNode | null>(null);
  const primaryGainRef = useRef<GainNode | null>(null);
  const compareGainRef = useRef<GainNode | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const primaryBufferRef = useRef<AudioBuffer | null>(null);
  const compareBufferRef = useRef<AudioBuffer | null>(null);
  const sourcesRef = useRef<[AudioBufferSourceNode | null, AudioBufferSourceNode | null]>([null, null]);
  const frequencyDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const timeDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const compareFrequencyDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const compareTimeDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const loadedTrackIdRef = useRef("");
  const primaryLoadVersionRef = useRef(0);
  const compareLoadVersionRef = useRef(0);
  const playingRef = useRef(false);
  const playbackOffsetRef = useRef(0);
  const playbackStartedAtRef = useRef(0);
  const shuffleBagRef = useRef<string[]>([]);
  const shuffleCycleStartedRef = useRef(false);
  const animationFrameRef = useRef<number | null>(null);
  const lastCheckpointRef = useRef(0);
  const startTrackRef = useRef<(trackId: string, play?: boolean, resumeAt?: number) => Promise<boolean>>(async () => false);
  const endedRef = useRef<() => void>(() => undefined);
  const shortcutTogglePlayRef = useRef<() => Promise<void>>(async () => undefined);
  const shortcutSwitchSourceRef = useRef<(source: 0 | 1) => void>(() => undefined);
  const audioVisualRef = useRef({ ...EMPTY_AUDIO_VISUAL });

  const currentTrack = tracks.find((track) => track.id === session.currentTrackId) ?? null;
  const filteredTracks = useMemo(() => {
    const query = normalizeFileName(search);
    if (!query) return tracks;
    return tracks.filter((track) => normalizeFileName(`${track.name} ${track.relativePath} ${track.sourceLabel}`).includes(query));
  }, [search, tracks]);
  const unavailableCount = tracks.filter((track) => track.availability === "reconnect" || track.availability === "missing").length;
  const comparisonReady = compareSlot.status === "ready";
  const timelineDuration = Math.max(duration, currentTrack?.duration ?? 0, compareSlot.duration, 0);
  const activeDuration = activeSource === 0 ? (duration || currentTrack?.duration || 0) : compareSlot.duration;
  const activeSourceEnded = comparisonReady && activeDuration > 0 && currentTime >= activeDuration - 0.005 && currentTime < timelineDuration - 0.005;
  const durationDelta = comparisonReady ? Math.abs((duration || currentTrack?.duration || 0) - compareSlot.duration) : 0;

  const patchTracks = useCallback((update: (current: LibraryTrack[]) => LibraryTrack[]) => {
    setTracks((current) => {
      const next = update(current);
      tracksRef.current = next;
      return next;
    });
  }, []);

  const patchSession = useCallback((patch: Partial<LibrarySession> | ((current: LibrarySession) => LibrarySession)) => {
    setSession((current) => {
      const next = typeof patch === "function" ? patch(current) : { ...current, ...patch };
      sessionRef.current = next;
      return next;
    });
  }, []);

  const changeWorkspace = useCallback((nextWorkspace: Workspace) => {
    if (workspaceRef.current === nextWorkspace) {
      setLibraryOpen(false);
      return;
    }
    void withSceneTransition(() => {
      workspaceRef.current = nextWorkspace;
      setWorkspace(nextWorkspace);
      setLibraryOpen(false);
    }, nextWorkspace === "player" ? "workspace-player" : "workspace-library");
  }, []);

  const setFocusWithTransition = useCallback((nextFocusMode: boolean) => {
    if (focusModeRef.current === nextFocusMode) return;
    void withSceneTransition(() => {
      focusModeRef.current = nextFocusMode;
      setFocusMode(nextFocusMode);
    }, nextFocusMode ? "focus-enter" : "focus-exit");
  }, []);

  const toggleFocusMode = useCallback(() => {
    setFocusWithTransition(!focusModeRef.current);
  }, [setFocusWithTransition]);

  const refreshStorageState = useCallback(async () => {
    try {
      setStorageState(await readStorageState());
    } catch {
      setStorageState({ usage: 0, quota: 0, persistent: false });
    }
  }, []);

  useEffect(() => {
    const folderInput = folderInputRef.current as (HTMLInputElement & { webkitdirectory?: boolean }) | null;
    if (folderInput) folderInput.webkitdirectory = true;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const snapshot = await loadLibrarySnapshot();
        if (!snapshot || cancelled) return;
        const restoredTracks = await Promise.all(snapshot.tracks.map(async (storedTrack) => {
          const track: LibraryTrack = { ...storedTrack, comparison: storedTrack.comparison ?? null };
          const comparison = track.comparison;
          const restoredComparison = comparison?.persistence === "cached"
            ? await getCachedTrackFile(comparisonCacheKey(track.id)).then((file) => ({
              ...comparison,
              availability: file ? "available" as const : "reconnect" as const,
              persistence: file ? "cached" as const : "indexed" as const,
            }))
            : comparison ? { ...comparison, availability: "reconnect" as const } : null;
          if (track.persistence !== "cached") return { ...track, comparison: restoredComparison, availability: "reconnect" as const };
          const cached = await getCachedTrackFile(track.id);
          return { ...track, comparison: restoredComparison, availability: cached ? "available" as const : "reconnect" as const, persistence: cached ? "cached" as const : "indexed" as const };
        }));
        if (cancelled) return;
        tracksRef.current = restoredTracks;
        setTracks(restoredTracks);
        const nextSession = {
          ...EMPTY_SESSION,
          ...snapshot.session,
          cacheEnabled: snapshot.version >= 2 ? snapshot.session.cacheEnabled : true,
        };
        sessionRef.current = nextSession;
        setSession(nextSession);
        setCurrentTime(nextSession.currentTime);
        setMessage(restoredTracks.length ? "Library restored. Press play or reconnect unavailable tracks." : "Your library stays in this browser.");
      } catch {
        setMessage("Storage is unavailable here. Session-only playback still works.");
      } finally {
        if (!cancelled) setRestored(true);
      }
      await refreshStorageState();
    })();
    return () => { cancelled = true; };
  }, [refreshStorageState]);

  useEffect(() => {
    tracksRef.current = tracks;
  }, [tracks]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    if (!restored) return;
    const timer = window.setTimeout(() => {
      const serializableTracks = tracks.map((track) => ({
        ...track,
        availability: track.persistence === "cached" ? "available" as const : "reconnect" as const,
        comparison: track.comparison ? {
          ...track.comparison,
          availability: track.comparison.persistence === "cached" ? "available" as const : "reconnect" as const,
        } : null,
      }));
      void saveLibrarySnapshot({ version: 2, tracks: serializableTracks, session }).catch(() => {
        setMessage("Could not save changes in this browser mode.");
      });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [restored, session, tracks]);

  const ensureAudioGraph = useCallback(async (resume = true) => {
    if (!audioContextRef.current) {
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      const compareAnalyser = context.createAnalyser();
      const primaryGain = context.createGain();
      const comparisonGain = context.createGain();
      const masterGain = context.createGain();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.68;
      compareAnalyser.fftSize = 1024;
      compareAnalyser.smoothingTimeConstant = 0.68;
      analyser.connect(primaryGain);
      compareAnalyser.connect(comparisonGain);
      primaryGain.connect(masterGain);
      comparisonGain.connect(masterGain);
      masterGain.connect(context.destination);
      primaryGain.gain.value = 1;
      comparisonGain.gain.value = 0;
      masterGain.gain.value = sessionRef.current.volume;
      audioContextRef.current = context;
      analyserRef.current = analyser;
      compareAnalyserRef.current = compareAnalyser;
      primaryGainRef.current = primaryGain;
      compareGainRef.current = comparisonGain;
      masterGainRef.current = masterGain;
      frequencyDataRef.current = new Uint8Array(analyser.frequencyBinCount);
      timeDataRef.current = new Uint8Array(analyser.fftSize);
      compareFrequencyDataRef.current = new Uint8Array(compareAnalyser.frequencyBinCount);
      compareTimeDataRef.current = new Uint8Array(compareAnalyser.fftSize);
    }
    const context = audioContextRef.current;
    if (resume && context.state === "suspended") {
      await context.resume();
    }
    return context;
  }, []);

  const stopSourceAt = useCallback((index: 0 | 1) => {
    const source = sourcesRef.current[index];
    if (!source) return;
    source.onended = null;
    try { source.stop(); } catch { /* The shorter source may already have ended. */ }
    source.disconnect();
    sourcesRef.current[index] = null;
  }, []);

  const stopAllSources = useCallback(() => {
    stopSourceAt(0);
    stopSourceAt(1);
  }, [stopSourceAt]);

  const getTimelineTime = useCallback(() => {
    const context = audioContextRef.current;
    if (playingRef.current && context) {
      return playbackOffsetRef.current + Math.max(0, context.currentTime - playbackStartedAtRef.current);
    }
    return playbackOffsetRef.current;
  }, []);

  const createSourceAt = useCallback((index: 0 | 1, when: number, offset: number) => {
    const context = audioContextRef.current;
    const buffer = index === 0 ? primaryBufferRef.current : compareBufferRef.current;
    const analyser = index === 0 ? analyserRef.current : compareAnalyserRef.current;
    if (!context || !buffer || !analyser || offset >= buffer.duration - 0.005) return false;
    stopSourceAt(index);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(analyser);
    source.start(when, Math.max(0, offset));
    sourcesRef.current[index] = source;
    return true;
  }, [stopSourceAt]);

  const startPlayback = useCallback(async (time: number) => {
    const context = await ensureAudioGraph();
    stopAllSources();
    const when = context.currentTime + SOURCE_LEAD_SECONDS;
    const started = ([0, 1] as const).map((index) => createSourceAt(index, when, time));
    if (!started.some(Boolean)) return false;
    playbackOffsetRef.current = time;
    playbackStartedAtRef.current = when;
    playingRef.current = true;
    setCurrentTime(time);
    setIsPlaying(true);
    return true;
  }, [createSourceAt, ensureAudioGraph, stopAllSources]);

  const pausePlayback = useCallback(() => {
    const pausedAt = getTimelineTime();
    playingRef.current = false;
    playbackOffsetRef.current = pausedAt;
    stopAllSources();
    setCurrentTime(pausedAt);
    setIsPlaying(false);
    audioVisualRef.current = { ...audioVisualRef.current, isPlaying: false, transient: 0 };
    lastCheckpointRef.current = pausedAt;
    patchSession({ currentTime: pausedAt });
  }, [getTimelineTime, patchSession, stopAllSources]);

  const seekTo = useCallback(async (rawTime: number) => {
    const maxDuration = Math.max(primaryBufferRef.current?.duration ?? 0, compareBufferRef.current?.duration ?? 0);
    const nextTime = Math.max(0, Math.min(rawTime, maxDuration));
    playbackOffsetRef.current = nextTime;
    setCurrentTime(nextTime);
    patchSession({ currentTime: nextTime });
    if (playingRef.current) await startPlayback(nextTime);
  }, [patchSession, startPlayback]);

  const resolveTrackFile = useCallback(async (track: LibraryTrack) => {
    const runtime = runtimeFilesRef.current.get(track.id);
    if (runtime) return runtime;
    if (track.persistence === "cached") return getCachedTrackFile(track.id);
    return null;
  }, []);

  const decodeComparisonFile = useCallback(async (file: File, trackId: string, persistence: "indexed" | "cached", announce = true, displayName = file.name) => {
    const version = ++compareLoadVersionRef.current;
    setCompareSlot({
      file,
      trackId,
      name: displayName,
      size: file.size,
      duration: 0,
      status: "loading",
      loadStage: "reading",
      loadProgress: 0,
      error: "",
      persistence,
    });
    try {
      const arrayBuffer = await readAudioFile(file, (progress) => {
        if (version === compareLoadVersionRef.current) setCompareSlot((slot) => ({ ...slot, loadProgress: progress }));
      });
      if (version !== compareLoadVersionRef.current) return null;
      setCompareSlot((slot) => ({ ...slot, loadStage: "decoding", loadProgress: 58 }));
      const context = await ensureAudioGraph(false);
      const buffer = await context.decodeAudioData(arrayBuffer);
      if (version !== compareLoadVersionRef.current) return null;
      compareBufferRef.current = buffer;
      setCompareSlot({
        file,
        trackId,
        name: displayName,
        size: file.size,
        duration: buffer.duration,
        status: "ready",
        loadStage: "idle",
        loadProgress: 100,
        error: "",
        persistence,
      });
      setComparePeaks(makeWaveformPeaks(buffer));
      if (playingRef.current) {
        const when = context.currentTime + SOURCE_LEAD_SECONDS;
        const offset = getTimelineTime() + SOURCE_LEAD_SECONDS;
        createSourceAt(1, when, offset);
      }
      if (announce) setMessage("Version B is synchronized and ready.");
      return buffer;
    } catch {
      if (version !== compareLoadVersionRef.current) return null;
      compareBufferRef.current = null;
      setCompareSlot((slot) => ({ ...slot, status: "error", loadStage: "idle", loadProgress: 0, error: "Version B could not be decoded in this browser." }));
      setMessage("Version B could not be decoded in this browser.");
      return null;
    }
  }, [createSourceAt, ensureAudioGraph, getTimelineTime]);

  const startTrack = useCallback(async (trackId: string, play = true, resumeAt = 0) => {
    const track = tracksRef.current.find((candidate) => candidate.id === trackId);
    if (!track) return false;
    const file = await resolveTrackFile(track);
    if (!file) {
      patchTracks((current) => current.map((candidate) => candidate.id === trackId ? { ...candidate, availability: "missing" } : candidate));
      setMessage(`Reconnect ${track.sourceLabel} to play ${trackDisplayName(track.name)}.`);
      return false;
    }
    const loadVersion = ++primaryLoadVersionRef.current;
    if (loadedTrackIdRef.current && loadedTrackIdRef.current !== trackId) {
      compareLoadVersionRef.current += 1;
      compareBufferRef.current = null;
      stopSourceAt(1);
      setCompareSlot({ ...EMPTY_COMPARE_SLOT });
      setComparePeaks([]);
      setActiveSource(0);
      if (primaryGainRef.current) primaryGainRef.current.gain.value = 1;
      if (compareGainRef.current) compareGainRef.current.gain.value = 0;
    }
    playingRef.current = false;
    stopAllSources();
    setIsPlaying(false);
    setMessage(`Preparing · ${trackDisplayName(track.name)}`);
    setPrimaryLoad({ stage: "reading", progress: 0 });
    let buffer: AudioBuffer;
    try {
      const context = await ensureAudioGraph(false);
      const arrayBuffer = await readAudioFile(file, (progress) => {
        if (loadVersion === primaryLoadVersionRef.current) setPrimaryLoad({ stage: "reading", progress });
      });
      if (loadVersion !== primaryLoadVersionRef.current) return false;
      setPrimaryLoad({ stage: "decoding", progress: 58 });
      buffer = await context.decodeAudioData(arrayBuffer);
    } catch {
      setPrimaryLoad({ stage: "idle", progress: 0 });
      setMessage("This track could not be decoded in the current browser.");
      return false;
    }
    if (loadVersion !== primaryLoadVersionRef.current) return false;
    primaryBufferRef.current = buffer;
    loadedTrackIdRef.current = trackId;
    const safeTime = Math.min(Math.max(0, resumeAt), Math.max(0, buffer.duration - 0.05));
    playbackOffsetRef.current = safeTime;
    const previous = sessionRef.current.currentTrackId;
    patchSession((current) => ({
      ...current,
      currentTrackId: trackId,
      currentTime: safeTime,
      history: previous && previous !== trackId ? [...current.history, previous].slice(-100) : current.history,
    }));
    patchTracks((current) => current.map((candidate) => candidate.id === trackId ? {
      ...candidate,
      availability: candidate.persistence === "cached" ? "available" : "session",
      duration: buffer.duration,
    } : candidate));
    setCurrentTime(safeTime);
    lastCheckpointRef.current = safeTime;
    setDuration(buffer.duration);
    setPrimaryPeaks(makeWaveformPeaks(buffer));
    setPrimaryLoad({ stage: "idle", progress: 100 });
    setMessage(`${play ? "Playing" : "Ready"} · ${trackDisplayName(track.name)}`);
    if (play) await startPlayback(safeTime);
    if (track.comparison) {
      const comparisonFile = track.comparison.persistence === "cached"
        ? await getCachedTrackFile(comparisonCacheKey(track.id))
        : null;
      if (comparisonFile) {
        await decodeComparisonFile(comparisonFile, track.id, "cached", false, track.comparison.name);
      } else {
        setCompareSlot({
          ...EMPTY_COMPARE_SLOT,
          trackId: track.id,
          name: track.comparison.name,
          size: track.comparison.size,
          duration: track.comparison.duration,
          status: "reconnect",
          error: "Reconnect or replace Version B to compare again.",
          persistence: "indexed",
        });
      }
    }
    return true;
  }, [decodeComparisonFile, ensureAudioGraph, patchSession, patchTracks, resolveTrackFile, startPlayback, stopAllSources, stopSourceAt]);

  useEffect(() => {
    startTrackRef.current = startTrack;
  }, [startTrack]);

  const nextTrack = useCallback(async (natural = false) => {
    const current = sessionRef.current;
    if (!current.queue.length) return;
    if (natural && current.repeat === "one" && current.currentTrackId) {
      await startTrackRef.current(current.currentTrackId, true, 0);
      return;
    }
    let candidates: string[] = [];
    if (current.shuffle) {
      if (!shuffleBagRef.current.length) {
        if (shuffleCycleStartedRef.current && current.repeat !== "all") {
          if (playingRef.current) pausePlayback();
          setMessage("Queue complete.");
          return;
        }
        shuffleBagRef.current = createShuffleBag(current.queue, current.currentTrackId);
        shuffleCycleStartedRef.current = true;
      }
      candidates = [...shuffleBagRef.current];
    } else {
      const index = current.queue.indexOf(current.currentTrackId);
      candidates = index < 0 ? [...current.queue] : current.queue.slice(index + 1);
      if (current.repeat === "all") candidates.push(...current.queue.slice(0, Math.max(0, index + 1)));
    }
    for (const nextId of candidates) {
      if (current.shuffle) shuffleBagRef.current = shuffleBagRef.current.filter((id) => id !== nextId);
      if (await startTrackRef.current(nextId, true, 0)) return;
    }
    if (playingRef.current) pausePlayback();
    setMessage("Queue complete. Reconnect any unavailable tracks to include them.");
  }, [pausePlayback]);

  useEffect(() => {
    endedRef.current = () => { void nextTrack(true); };
  }, [nextTrack]);

  const previousTrack = useCallback(async () => {
    const current = sessionRef.current;
    if (currentTime > 4 && current.currentTrackId) {
      await startTrack(current.currentTrackId, true, 0);
      return;
    }
    const previous = current.history.at(-1);
    if (!previous) return;
    patchSession({ history: current.history.slice(0, -1) });
    await startTrack(previous, true, 0);
  }, [currentTime, patchSession, startTrack]);

  useEffect(() => {
    if (!isPlaying) {
      audioVisualRef.current = { ...audioVisualRef.current, isPlaying: false, transient: 0 };
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
      return;
    }
    const tick = () => {
      const reference = getTimelineTime();
      const maxDuration = Math.max(primaryBufferRef.current?.duration ?? 0, compareBufferRef.current?.duration ?? 0);
      const nextTime = Math.min(reference, maxDuration);
      setCurrentTime(nextTime);
      sessionRef.current = { ...sessionRef.current, currentTime: nextTime };
      if (Math.abs(nextTime - lastCheckpointRef.current) >= 5) {
        lastCheckpointRef.current = nextTime;
        setSession(sessionRef.current);
      }
      const useComparison = activeSource === 1 && compareSlot.status === "ready";
      const analyser = useComparison ? compareAnalyserRef.current : analyserRef.current;
      const frequency = useComparison ? compareFrequencyDataRef.current : frequencyDataRef.current;
      const time = useComparison ? compareTimeDataRef.current : timeDataRef.current;
      if (analyser && frequency && time) {
        audioVisualRef.current = sampleAnalyser(analyser, frequency, time, audioVisualRef.current, reference, activeSource);
      }
      if (maxDuration > 0 && reference >= maxDuration - 0.025) {
        playingRef.current = false;
        playbackOffsetRef.current = maxDuration;
        stopAllSources();
        setCurrentTime(maxDuration);
        setIsPlaying(false);
        endedRef.current();
        return;
      }
      animationFrameRef.current = requestAnimationFrame(tick);
    };
    animationFrameRef.current = requestAnimationFrame(tick);
    return () => {
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [activeSource, compareSlot.status, getTimelineTime, isPlaying, stopAllSources]);

  useEffect(() => () => {
    stopAllSources();
    const context = audioContextRef.current;
    if (context && context.state !== "closed") void context.close();
  }, [stopAllSources]);

  const handleImport = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList) as FileWithPath[];
    if (!files.length) return;
    const enteringFromWelcome = tracksRef.current.length === 0;
    setImporting(true);
    setImportSummary(null);
    setImportOpen(false);
    const summary: ImportSummary = { accepted: 0, lyrics: 0, duplicates: 0, ignored: 0, errors: [] };
    const audioFiles = files.filter((file) => file.type.startsWith("audio/") || SUPPORTED_AUDIO.test(file.name));
    const lyricFiles = files.filter((file) => /\.lrc$/iu.test(file.name));
    summary.ignored = files.length - audioFiles.length - lyricFiles.length;
    const lyricMap = new Map<string, FileWithPath>();
    for (const file of lyricFiles) lyricMap.set(lyricMatchKey(relativePathOf(file)), file);
    const existingByFingerprint = new Map(tracksRef.current.map((track) => [track.fingerprint, track]));
    const imported: LibraryTrack[] = [];
    let cacheThisImport = sessionRef.current.cacheEnabled;
    if (cacheThisImport && audioFiles.length) {
      await requestPersistentStorage().catch(() => false);
      try {
        const estimate = await navigator.storage?.estimate?.();
        const availableBytes = Math.max(0, (estimate?.quota ?? 0) - (estimate?.usage ?? 0));
        const requestedBytes = audioFiles.reduce((sum, file) => sum + file.size, 0);
        if (availableBytes > 0 && requestedBytes > availableBytes * 0.9) {
          cacheThisImport = false;
          summary.errors.push("Not enough browser storage to keep every imported track. They remain available for this session.");
        }
      } catch {
        // Storage estimates are best-effort; the individual cache write remains authoritative.
      }
    }

    const sortedAudioFiles = audioFiles.sort((a, b) => relativePathOf(a).localeCompare(relativePathOf(b), undefined, { numeric: true, sensitivity: "base" }));
    for (const [fileIndex, file] of sortedAudioFiles.entries()) {
      if (file.size > MAX_FILE_BYTES) {
        summary.errors.push(`${file.name} is larger than 300 MB`);
        continue;
      }
      const path = relativePathOf(file);
      const fingerprint = makeTrackFingerprint(file, path);
      const existing = existingByFingerprint.get(fingerprint);
      if (existing) {
        runtimeFilesRef.current.set(existing.id, file);
        let reconnected = { ...existing, comparison: existing.comparison ?? null, availability: existing.persistence === "cached" ? "available" as const : "session" as const };
        if (cacheThisImport && existing.persistence !== "cached") {
          try {
            await cacheTrackFile(existing.id, file);
            reconnected = { ...reconnected, persistence: "cached", availability: "available" };
          } catch {
            summary.errors.push(`${file.name} could not be kept for future visits.`);
          }
        }
        imported.push(reconnected);
        summary.duplicates += 1;
        setCacheProgress(Math.round(((fileIndex + 1) / sortedAudioFiles.length) * 100));
        continue;
      }
      let lyrics: LyricLine[] = [];
      let lyricsFileName = "";
      const lyricFile = lyricMap.get(lyricMatchKey(path))
        ?? [...lyricMap.entries()].find(([key]) => key.endsWith(`/${withoutExtension(normalizeFileName(file.name))}`))?.[1];
      if (lyricFile) {
        try {
          lyrics = parseLrc(decodeLrc(await lyricFile.arrayBuffer())).lines;
          lyricsFileName = lyricFile.name;
          if (lyrics.length) summary.lyrics += 1;
        } catch {
          summary.errors.push(`${lyricFile.name} could not be parsed`);
        }
      }
      const track: LibraryTrack = {
        id: fingerprint,
        fingerprint,
        name: file.name,
        relativePath: path,
        sourceLabel: sourceLabelFor(path),
        size: file.size,
        lastModified: file.lastModified,
        duration: 0,
        availability: "session",
        persistence: "indexed",
        lyricsFileName,
        lyrics,
        comparison: null,
      };
      runtimeFilesRef.current.set(track.id, file);
      if (cacheThisImport) {
        try {
          await cacheTrackFile(track.id, file);
          track.persistence = "cached";
          track.availability = "available";
        } catch {
          summary.errors.push(`${file.name} could not be kept for future visits.`);
        }
      }
      imported.push(track);
      existingByFingerprint.set(fingerprint, track);
      summary.accepted += 1;
      setCacheProgress(Math.round(((fileIndex + 1) / sortedAudioFiles.length) * 100));
    }

    const reconnecting = reconnectModeRef.current;
    const importedIds = imported.map((track) => track.id);
    const commitImport = () => {
      patchTracks((current) => {
        const byId = new Map(current.map((track) => [track.id, track]));
        if (reconnecting) {
          for (const [id, track] of byId) {
            if ((track.availability === "reconnect" || track.availability === "missing") && !imported.some((candidate) => candidate.id === id)) {
              byId.set(id, { ...track, availability: "missing" });
            }
          }
        }
        for (const track of imported) byId.set(track.id, track);
        return [...byId.values()].sort((a, b) => a.relativePath.localeCompare(b.relativePath, undefined, { numeric: true, sensitivity: "base" }));
      });
      if (importedIds.length) {
        patchSession((current) => ({
          ...current,
          queue: reconnecting ? current.queue.length ? current.queue : importedIds : [...new Set([...current.queue, ...importedIds])],
          currentTrackId: current.currentTrackId || importedIds[0],
        }));
      }
    };
    if (enteringFromWelcome && importedIds.length) await withSceneTransition(commitImport, "enter");
    else commitImport();
    if (importedIds.length) {
      if (reconnecting) setMessage(`${importedIds.length} tracks reconnected without changing the queue.`);
      else setMessage(`${importedIds.length} tracks indexed. Choose one or press Play all.`);
    }
    reconnectModeRef.current = false;
    setCacheProgress(0);
    await refreshStorageState();
    setImportSummary(summary);
    setImporting(false);
  }, [patchSession, patchTracks, refreshStorageState]);

  function handleFilesInput(event: ChangeEvent<HTMLInputElement>) {
    void handleImport(event.target.files ?? []);
    event.target.value = "";
  }

  function openFiles(reconnect = false) {
    reconnectModeRef.current = reconnect;
    setImportOpen(false);
    filesInputRef.current?.click();
  }

  function openFolder(reconnect = false) {
    reconnectModeRef.current = reconnect;
    setImportOpen(false);
    folderInputRef.current?.click();
  }

  function openLyricsPicker(trackId: string) {
    lyricsTargetTrackIdRef.current = trackId;
    setMenuTrackId("");
    lyricsInputRef.current?.click();
  }

  async function handleLyricsInput(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const trackId = lyricsTargetTrackIdRef.current;
    event.target.value = "";
    if (!file || !trackId) return;
    try {
      const parsed = parseLrc(decodeLrc(await file.arrayBuffer()));
      if (!parsed.lines.length) throw new Error("No timestamped lyric lines");
      const target = tracksRef.current.find((track) => track.id === trackId);
      patchTracks((current) => current.map((track) => track.id === trackId ? {
        ...track,
        lyrics: parsed.lines,
        lyricsFileName: file.name,
      } : track));
      setMessage(`Lyrics attached · ${target ? trackDisplayName(target.name) : file.name}`);
    } catch {
      setMessage("That file has no valid timestamped LRC lyrics.");
    } finally {
      lyricsTargetTrackIdRef.current = "";
    }
  }

  function removeTrackLyrics(trackId: string) {
    const target = tracksRef.current.find((track) => track.id === trackId);
    patchTracks((current) => current.map((track) => track.id === trackId ? {
      ...track,
      lyrics: [],
      lyricsFileName: "",
    } : track));
    setMenuTrackId("");
    setMessage(`Lyrics removed · ${target ? trackDisplayName(target.name) : "track"}`);
  }

  async function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragging(false);
    try {
      const files = await filesFromDrop(event.dataTransfer);
      if (!files.length) {
        setMessage("This browser could not read that dropped folder. Use Choose a folder instead.");
        return;
      }
      await handleImport(files);
    } catch {
      setMessage("That folder could not be read. Check its permission or use Choose a folder.");
    }
  }

  const playAll = useCallback(async (shuffle = false) => {
    const ids = filteredTracks.filter((track) => track.availability === "available" || track.availability === "session").map((track) => track.id);
    if (!ids.length) return;
    shuffleBagRef.current = shuffle ? createShuffleBag(ids, "") : [];
    shuffleCycleStartedRef.current = shuffle;
    const first = shuffle ? shuffleBagRef.current.shift() ?? ids[0] : ids[0];
    patchSession((current) => ({ ...current, queue: ids, shuffle, history: [] }));
    await startTrack(first, true, 0);
  }, [filteredTracks, patchSession, startTrack]);

  async function togglePlay() {
    if (primaryBufferRef.current && loadedTrackIdRef.current === sessionRef.current.currentTrackId) {
      if (playingRef.current) pausePlayback();
      else {
        const maxDuration = Math.max(primaryBufferRef.current.duration, compareBufferRef.current?.duration ?? 0);
        const startAt = playbackOffsetRef.current >= maxDuration - 0.01 ? 0 : playbackOffsetRef.current;
        await startPlayback(startAt);
      }
      return;
    }
    const trackId = sessionRef.current.currentTrackId || sessionRef.current.queue[0] || tracksRef.current[0]?.id;
    if (trackId) await startTrack(trackId, true, sessionRef.current.currentTime);
  }

  function cycleRepeat() {
    const next: RepeatMode = session.repeat === "off" ? "all" : session.repeat === "all" ? "one" : "off";
    patchSession({ repeat: next });
    setMessage(repeatLabel(next));
  }

  function toggleShuffle() {
    const next = !session.shuffle;
    shuffleBagRef.current = next ? createShuffleBag(session.queue, session.currentTrackId) : [];
    shuffleCycleStartedRef.current = next;
    patchSession({ shuffle: next });
    setMessage(next ? "Shuffle enabled · no repeats this cycle" : "Playing in queue order");
  }

  function addPlayNext(trackId: string) {
    patchSession((current) => {
      const queue = current.queue.filter((id) => id !== trackId);
      const index = Math.max(0, queue.indexOf(current.currentTrackId));
      queue.splice(index + 1, 0, trackId);
      return { ...current, queue };
    });
    setMessage("Added as next track.");
    setMenuTrackId("");
  }

  function appendQueue(trackId: string) {
    patchSession((current) => ({ ...current, queue: current.queue.includes(trackId) ? current.queue : [...current.queue, trackId] }));
    setMessage("Added to queue.");
    setMenuTrackId("");
  }

  function reorderQueue(trackId: string, direction: -1 | 1) {
    patchSession((current) => {
      const queue = [...current.queue];
      const index = queue.indexOf(trackId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= queue.length) return current;
      [queue[index], queue[target]] = [queue[target], queue[index]];
      return { ...current, queue };
    });
  }

  function moveQueueTrack(draggedId: string, targetId: string) {
    if (!draggedId || draggedId === targetId) return;
    patchSession((current) => {
      const queue = current.queue.filter((id) => id !== draggedId);
      const target = queue.indexOf(targetId);
      queue.splice(Math.max(0, target), 0, draggedId);
      return { ...current, queue };
    });
  }

  async function cacheAvailableTracks() {
    const available = tracksRef.current.filter((track) => runtimeFilesRef.current.has(track.id) && track.persistence !== "cached");
    const comparisonFile = compareSlot.status === "ready" && compareSlot.file && compareSlot.persistence !== "cached" ? compareSlot.file : null;
    patchSession({ cacheEnabled: true });
    if (!available.length && !comparisonFile) {
      setMessage("Automatic caching is on. New music and Version B files will be kept on this device.");
      return;
    }
    await requestPersistentStorage().catch(() => false);
    const estimate = await navigator.storage?.estimate?.();
    const requiredBytes = available.reduce((total, track) => total + (runtimeFilesRef.current.get(track.id)?.size ?? 0), comparisonFile?.size ?? 0);
    const availableBytes = Math.max(0, (estimate?.quota ?? 0) - (estimate?.usage ?? 0));
    if (availableBytes > 0 && requiredBytes > availableBytes * 0.9) {
      setMessage("Automatic caching is on, but the currently connected files exceed available browser storage.");
      return;
    }
    let completed = 0;
    const total = available.length + (comparisonFile ? 1 : 0);
    for (const track of available) {
      const file = runtimeFilesRef.current.get(track.id);
      if (!file) continue;
      try {
        await cacheTrackFile(track.id, file);
        patchTracks((current) => current.map((candidate) => candidate.id === track.id ? { ...candidate, persistence: "cached", availability: "available" } : candidate));
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "The browser could not cache this track.");
        break;
      }
      completed += 1;
      setCacheProgress(Math.round((completed / total) * 100));
    }
    if (comparisonFile && compareSlot.trackId) {
      try {
        await cacheTrackFile(comparisonCacheKey(compareSlot.trackId), comparisonFile);
        patchTracks((current) => current.map((track) => track.id === compareSlot.trackId && track.comparison ? {
          ...track,
          comparison: { ...track.comparison, persistence: "cached", availability: "available" },
        } : track));
        setCompareSlot((slot) => ({ ...slot, persistence: "cached" }));
        completed += 1;
        setCacheProgress(100);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "The browser could not cache Version B.");
      }
    }
    setCacheProgress(0);
    await refreshStorageState();
    setMessage(`${completed} tracks kept on this device.`);
  }

  async function clearAudioCache() {
    await clearCachedTracks();
    patchTracks((current) => current.map((track) => ({
      ...track,
      persistence: "indexed",
      availability: runtimeFilesRef.current.has(track.id) ? "available" : "reconnect",
      comparison: track.comparison ? {
        ...track.comparison,
        persistence: "indexed",
        availability: compareSlot.trackId === track.id && compareSlot.file ? "session" : "reconnect",
      } : null,
    })));
    setCompareSlot((slot) => slot.status === "empty" ? slot : ({ ...slot, persistence: "indexed" }));
    patchSession({ cacheEnabled: false });
    await refreshStorageState();
    setStorageOpen(false);
    setConfirmAction(null);
    setMessage("Cached audio cleared. Playlists and lyrics were kept.");
  }

  async function toggleTrackCache(track: LibraryTrack) {
    if (track.persistence === "cached") {
      await removeCachedTrack(track.id);
      await removeCachedTrack(comparisonCacheKey(track.id)).catch(() => undefined);
      patchTracks((current) => current.map((candidate) => candidate.id === track.id ? {
        ...candidate,
        persistence: "indexed",
        availability: runtimeFilesRef.current.has(track.id) ? "available" : "reconnect",
        comparison: candidate.comparison ? { ...candidate.comparison, persistence: "indexed", availability: compareSlot.trackId === track.id && compareSlot.file ? "session" : "reconnect" } : null,
      } : candidate));
      if (compareSlot.trackId === track.id) setCompareSlot((slot) => ({ ...slot, persistence: "indexed" }));
      setMessage("Cached track and Version B copy removed; library entries remain.");
    } else {
      const file = runtimeFilesRef.current.get(track.id);
      if (!file) {
        setMessage("Reconnect this track before keeping it on the device.");
      } else {
        await cacheTrackFile(track.id, file);
        let cachedComparison = false;
        if (track.comparison && compareSlot.trackId === track.id && compareSlot.file) {
          await cacheTrackFile(comparisonCacheKey(track.id), compareSlot.file);
          cachedComparison = true;
          setCompareSlot((slot) => ({ ...slot, persistence: "cached" }));
        }
        patchTracks((current) => current.map((candidate) => candidate.id === track.id ? {
          ...candidate,
          persistence: "cached",
          availability: "available",
          comparison: candidate.comparison && cachedComparison ? { ...candidate.comparison, persistence: "cached", availability: "available" } : candidate.comparison,
        } : candidate));
        setMessage(cachedComparison ? "Track and Version B kept on this device." : "Track kept on this device.");
      }
    }
    setMenuTrackId("");
    await refreshStorageState();
  }

  function clearQueue() {
    if (playingRef.current) pausePlayback();
    patchSession({ queue: [], history: [], currentTrackId: "", currentTime: 0 });
    setCurrentTime(0);
    setDuration(0);
    setConfirmAction(null);
    setQueueOpen(false);
    setMessage("Queue cleared. Your library and cached audio remain.");
  }

  async function resetLibrary() {
    if (playingRef.current) pausePlayback();
    await clearCachedTracks();
    await deleteLibraryDatabase();
    runtimeFilesRef.current.clear();
    tracksRef.current = [];
    setTracks([]);
    sessionRef.current = { ...EMPTY_SESSION };
    setSession({ ...EMPTY_SESSION });
    setCurrentTime(0);
    setDuration(0);
    setStorageOpen(false);
    setConfirmAction(null);
    setMessage("Vibloom was reset on this device.");
    await refreshStorageState();
  }

  function openComparison(trackId?: string) {
    changeWorkspace("player");
    setMenuTrackId("");
    if (trackId && trackId !== sessionRef.current.currentTrackId) void startTrack(trackId, isPlaying, 0);
    setMessage("Comparison console ready. Add version B without interrupting version A.");
  }

  async function loadComparisonFile(file: File) {
    const track = tracksRef.current.find((candidate) => candidate.id === sessionRef.current.currentTrackId);
    if (!track) {
      setMessage("Choose a library track before adding Version B.");
      return;
    }
    if (!(file.type.startsWith("audio/") || SUPPORTED_AUDIO.test(file.name)) || file.size > MAX_FILE_BYTES) {
      setCompareSlot({ ...EMPTY_COMPARE_SLOT, trackId: track.id, name: file.name, size: file.size, status: "error", error: "Choose a supported audio file smaller than 300 MB." });
      setMessage("Choose a supported audio file smaller than 300 MB.");
      return;
    }
    stopSourceAt(1);
    const primary = primaryGainRef.current;
    const comparison = compareGainRef.current;
    const context = await ensureAudioGraph(false);
    if (primary && comparison) {
      const now = context.currentTime;
      primary.gain.cancelScheduledValues(now);
      comparison.gain.cancelScheduledValues(now);
      primary.gain.setValueAtTime(1, now);
      comparison.gain.setValueAtTime(0, now);
    }
    setActiveSource(0);
    const buffer = await decodeComparisonFile(file, track.id, "indexed", false);
    if (!buffer) return;
    let persistence: "indexed" | "cached" = "indexed";
    if (sessionRef.current.cacheEnabled) {
      setCompareSlot((slot) => ({ ...slot, loadStage: "caching", loadProgress: 84 }));
      try {
        const estimate = await navigator.storage?.estimate?.();
        const availableBytes = Math.max(0, (estimate?.quota ?? 0) - (estimate?.usage ?? 0));
        if (availableBytes > 0 && file.size > availableBytes * 0.9) throw new Error("Not enough browser storage for Version B.");
        await requestPersistentStorage().catch(() => false);
        await cacheTrackFile(comparisonCacheKey(track.id), file);
        persistence = "cached";
      } catch (error) {
        setMessage(error instanceof Error ? `${error.message} Version B remains available in this tab.` : "Version B remains available in this tab.");
      }
    }
    patchTracks((current) => current.map((candidate) => candidate.id === track.id ? {
      ...candidate,
      comparison: {
        name: file.name,
        size: file.size,
        lastModified: file.lastModified,
        duration: buffer.duration,
        availability: persistence === "cached" ? "available" : "session",
        persistence,
      },
    } : candidate));
    setCompareSlot((slot) => ({ ...slot, persistence, loadStage: "idle", loadProgress: 100 }));
    await refreshStorageState();
    setMessage(persistence === "cached" ? "Version B is synchronized and kept for your next visit." : "Version B is synchronized for this session.");
  }

  function handleComparisonDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    const file = Array.from(event.dataTransfer.files).find((candidate) => candidate.type.startsWith("audio/") || SUPPORTED_AUDIO.test(candidate.name));
    if (file) void loadComparisonFile(file);
    else setMessage("Drop one supported audio file to use as Version B.");
  }

  function switchSource(source: 0 | 1) {
    if (source === 1 && compareSlot.status !== "ready") return;
    const context = audioContextRef.current;
    const primary = primaryGainRef.current;
    const comparison = compareGainRef.current;
    if (!context || !primary || !comparison) return;
    const now = context.currentTime;
    primary.gain.cancelScheduledValues(now);
    comparison.gain.cancelScheduledValues(now);
    primary.gain.setValueAtTime(primary.gain.value, now);
    comparison.gain.setValueAtTime(comparison.gain.value, now);
    primary.gain.linearRampToValueAtTime(source === 0 ? 1 : 0, now + SOURCE_SWITCH_SECONDS);
    comparison.gain.linearRampToValueAtTime(source === 1 ? 1 : 0, now + SOURCE_SWITCH_SECONDS);
    setActiveSource(source);
    audioVisualRef.current = { ...audioVisualRef.current, source };
  }

  async function removeComparison() {
    const trackId = compareSlot.trackId || sessionRef.current.currentTrackId;
    compareLoadVersionRef.current += 1;
    compareBufferRef.current = null;
    stopSourceAt(1);
    if (primaryGainRef.current) primaryGainRef.current.gain.value = 1;
    if (compareGainRef.current) compareGainRef.current.gain.value = 0;
    setCompareSlot({ ...EMPTY_COMPARE_SLOT });
    setComparePeaks([]);
    setActiveSource(0);
    if (trackId) {
      await removeCachedTrack(comparisonCacheKey(trackId)).catch(() => undefined);
      patchTracks((current) => current.map((track) => track.id === trackId ? { ...track, comparison: null } : track));
    }
    await refreshStorageState();
    setMessage("Version B removed from this track.");
  }

  useEffect(() => {
    const context = audioContextRef.current;
    const master = masterGainRef.current;
    if (context && master) master.gain.setTargetAtTime(session.volume, context.currentTime, 0.015);
  }, [session.volume]);

  useEffect(() => {
    document.title = currentTrack
      ? `${isPlaying ? "Playing" : "Ready"} · ${trackDisplayName(currentTrack.name)} — Vibloom`
      : tracks.length ? `Library · ${tracks.length} tracks — Vibloom` : "Vibloom — Local Live2D Music Player";
  }, [currentTrack, isPlaying, tracks.length]);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), 3200);
    return () => window.clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    shortcutTogglePlayRef.current = togglePlay;
    shortcutSwitchSourceRef.current = switchSource;
  });

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      const key = event.key.toLowerCase();
      if (key === "escape") {
        if (focusModeRef.current) setFocusWithTransition(false);
        setQueueOpen(false);
        setStorageOpen(false);
        setLibraryOpen(false);
        return;
      }
      if (!tracksRef.current.length) return;
      if ((key === " " || key === "spacebar") && !event.repeat) {
        event.preventDefault();
        void shortcutTogglePlayRef.current();
      } else if ((key === "f") && !event.metaKey && !event.ctrlKey && !event.altKey && !event.repeat) {
        event.preventDefault();
        toggleFocusMode();
      } else if ((key === "1" || key === "a") && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        shortcutSwitchSourceRef.current(0);
      } else if ((key === "2" || key === "b") && compareSlot.status === "ready" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        shortcutSwitchSourceRef.current(1);
      } else if (key === "arrowleft" || key === "arrowright") {
        event.preventDefault();
        void seekTo(getTimelineTime() + (key === "arrowleft" ? -5 : 5));
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [compareSlot.status, getTimelineTime, seekTo, setFocusWithTransition, toggleFocusMode]);

  return (
    <main className={`library-app ${tracks.length ? "has-library" : "is-empty"} ${focusMode ? "is-library-focus" : ""}`}>
      <div className="scene-curtain" aria-hidden="true">
        <span className="scene-curtain-disc" />
        <span className="scene-curtain-line scene-curtain-line-one" />
        <span className="scene-curtain-line scene-curtain-line-two" />
        <span className="scene-curtain-copy scene-curtain-copy-enter"><small>Listening room</small><strong><span>The room is</span><em>listening.</em></strong><i>Your library and Hiyori are ready</i></span>
        <span className="scene-curtain-copy scene-curtain-copy-workspace-player"><small>Playback room</small><strong><span>Back to the</span><em>music.</em></strong><i>Controls and Hiyori ready</i></span>
        <span className="scene-curtain-copy scene-curtain-copy-workspace-library"><small>Your collection</small><strong><span>Open the</span><em>library.</em></strong><i>Queue, lyrics and local tracks</i></span>
        <span className="scene-curtain-copy scene-curtain-copy-focus-enter"><small>Focus mode</small><strong><span>The noise</span><em>falls away.</em></strong><i>One track · One room · One moment</i></span>
        <span className="scene-curtain-copy scene-curtain-copy-focus-exit"><small>Full room</small><strong><span>The session</span><em>returns.</em></strong><i>Controls and comparison restored</i></span>
      </div>
      <input ref={filesInputRef} type="file" accept="audio/*,.flac,.aiff,.aif,.lrc" multiple hidden onChange={handleFilesInput} />
      <input ref={folderInputRef} type="file" accept="audio/*,.flac,.aiff,.aif,.lrc" multiple hidden onChange={handleFilesInput} />
      <input ref={compareInputRef} type="file" accept="audio/*,.flac,.aiff,.aif" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void loadComparisonFile(file); event.target.value = ""; }} />
      <input ref={lyricsInputRef} type="file" accept=".lrc,text/plain" hidden onChange={(event) => void handleLyricsInput(event)} />
      {focusMode && <button className="focus-exit-control" type="button" aria-label="Exit focus mode (F or Escape)" onClick={() => setFocusWithTransition(false)}><Minimize2 size={17} /> Exit focus <kbd>F</kbd><span>or Esc</span></button>}

      <header className="library-header">
        <button className="mobile-nav-button" type="button" aria-label="Open library navigation" onClick={() => setLibraryOpen(true)}><Menu size={20} /></button>
        <a className="brand" href="#library-top" aria-label="Vibloom home">
          <span className="brand-mark"><ArrowLeftRight size={18} strokeWidth={2} /></span>
          <span className="brand-copy"><strong>Vibloom</strong><small>Local listening room</small></span>
        </a>
        {tracks.length > 0 && <div className="library-header-status"><span>{tracks.length} tracks</span><strong>{currentTrack ? trackDisplayName(currentTrack.name) : "Library ready"}</strong></div>}
        <div className="library-header-actions">
          {unavailableCount > 0 && <button className="reconnect-button" type="button" onClick={() => openFolder(true)}><FolderOpen size={15} /> Reconnect music <span>{unavailableCount}</span></button>}
          {tracks.length > 0 && <button className="header-icon-button" type="button" aria-label="Focus mode (F)" onClick={toggleFocusMode}><Maximize2 size={17} /></button>}
          <button className="header-icon-button" type="button" aria-label="Local storage" onClick={() => { setStorageOpen(true); void refreshStorageState(); }}><HardDrive size={17} /></button>
          <span className="privacy-chip"><ShieldCheck size={15} /> Local only</span>
        </div>
      </header>

      {!tracks.length ? (
        <section
          className={`library-welcome ${dragging ? "is-dragging" : ""}`}
          id="library-top"
          onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
          onDrop={handleDrop}
        >
          <div className="library-welcome-copy">
            <p className="eyebrow"><Headphones size={15} /> Your private local music library</p>
            <h1>Bring a folder.<br /><em>Let it bloom.</em></h1>
            <p>Build a queue from your own music, keep lyrics in sync, and let Hiyori stay with every track. Nothing is uploaded.</p>
            <div className="welcome-import-surface">
              <button className="welcome-import-primary" type="button" onClick={() => setImportOpen((value) => !value)}><Upload size={18} /><span><strong>Import your music</strong><small>Files, albums, lyrics, or a complete folder</small></span><ChevronDown size={16} /></button>
              {importOpen && <div className="welcome-import-menu"><button type="button" onClick={() => openFiles()}><FileAudio size={17} /><span><strong>Choose files</strong><small>One or many audio and LRC files</small></span></button><button type="button" onClick={() => openFolder()}><FolderOpen size={17} /><span><strong>Choose a folder</strong><small>Preserve album order and matching lyrics</small></span></button></div>}
              <p>Drop files here anytime · everything stays on this device</p>
            </div>
          </div>
          <div className="library-welcome-stage">
            <Live2DStage featuresRef={audioVisualRef} variant="welcome" trackLabel="Waiting for your library" activeSource={0} isComparing={false} isPlaying={false} focusMode={false} />
          </div>
        </section>
      ) : (
        <div className={`unified-shell ${workspace === "player" ? "is-player-shell" : "is-library-shell"}`} id="library-top">
          <aside className={`workspace-rail ${libraryOpen ? "is-open" : ""}`} aria-label="Primary navigation">
            <button className="sheet-close mobile-only" type="button" aria-label="Close navigation" onClick={() => setLibraryOpen(false)}><X size={20} /></button>
            <button className={workspace === "player" ? "is-active" : ""} type="button" title="Player" onClick={() => changeWorkspace("player")}><Headphones size={20} /><span>Player</span></button>
            <button className={workspace === "library" ? "is-active" : ""} type="button" title="Library" onClick={() => changeWorkspace("library")}><Library size={20} /><span>Library</span></button>
            <button type="button" title="Queue" onClick={() => { setQueueOpen(true); setLibraryOpen(false); }}><ListMusic size={20} /><span>Queue</span><i>{session.queue.length}</i></button>
            <button type="button" title="Storage" onClick={() => { setStorageOpen(true); setLibraryOpen(false); void refreshStorageState(); }}><Database size={20} /><span>Storage</span></button>
          </aside>

          <section className={`workspace-surface ${workspace === "player" ? "is-player" : "is-library"}`}>
          {workspace === "player" ? (
            <div className="player-console">
              <div className="console-heading">
                <div><p>PLAYBACK CONSOLE</p><h1>Hear every<br /><em>difference.</em></h1></div>
                <span className="engine-status"><i /> Local audio engine</span>
              </div>
              {unavailableCount > 0 && <div className="library-reconnect-banner"><FolderOpen size={17} /><span><strong>Some music needs to be reconnected.</strong><small>Your queue and order are still here.</small></span><button type="button" onClick={() => openFolder(true)}>Reconnect</button></div>}
              <div className={`comparison-deck ${comparisonReady ? "has-version-b" : "is-solo"}`}>
                <article className={`waveform-card version-a ${activeSource === 0 ? "is-active" : ""}`}>
                  <div className="waveform-card-heading"><button className="source-selector" type="button" onClick={() => switchSource(0)} aria-pressed={activeSource === 0}>A</button><div><small>LIBRARY MASTER</small><strong>{currentTrack ? trackDisplayName(currentTrack.name) : "Choose a track"}</strong></div><span>{formatTime(duration || currentTrack?.duration || 0)}</span></div>
                  <PrecisionWaveform peaks={primaryPeaks} progress={currentTime / Math.max(duration || currentTrack?.duration || 1, 1)} label="Version A" source={0} />
                  <div className="waveform-card-foot"><span>{primaryLoad.stage === "reading" ? `READING · ${primaryLoad.progress}%` : primaryLoad.stage === "decoding" ? "DECODING AUDIO" : activeSource === 0 ? "AUDIBLE" : "SYNCHRONIZED"}</span><span>{currentTrack ? `${formatBytes(currentTrack.size)} · ${currentTrack.sourceLabel}` : "Local library"}</span></div>
                </article>
                <div className="center-stage-reserve" aria-hidden="true" />
                {compareSlot.status === "empty" ? (
                  <div className="quiet-compare-entry" onDragOver={(event) => event.preventDefault()} onDrop={handleComparisonDrop}><span>Need to compare a mix?</span><button type="button" onClick={() => compareInputRef.current?.click()}><Plus size={15} /> Add version B</button><small>Choose or drop one file. A keeps playing.</small></div>
                ) : (
                  <article className={`waveform-card version-b ${activeSource === 1 ? "is-active" : ""} is-${compareSlot.status}`} onDragOver={(event) => event.preventDefault()} onDrop={handleComparisonDrop}>
                    <div className="waveform-card-heading"><button className="source-selector" type="button" disabled={!comparisonReady} onClick={() => switchSource(1)} aria-pressed={activeSource === 1}>B</button><div><small>COMPARISON · {compareSlot.status.toUpperCase()}</small><strong>{trackDisplayName(compareSlot.name)}</strong></div><span className="version-b-actions"><button type="button" onClick={() => compareInputRef.current?.click()} aria-label="Replace version B">Replace</button><button type="button" onClick={() => void removeComparison()} aria-label="Remove version B"><X size={14} /></button></span></div>
                    <PrecisionWaveform peaks={comparePeaks} progress={currentTime / Math.max(compareSlot.duration || 1, 1)} label="Version B" source={1} />
                    <div className="waveform-card-foot"><span>{compareSlot.loadStage === "reading" ? `READING · ${compareSlot.loadProgress}%` : compareSlot.loadStage === "decoding" ? "DECODING AUDIO" : compareSlot.loadStage === "caching" ? "KEEPING ON DEVICE" : compareSlot.status === "reconnect" ? "RECONNECT NEEDED" : activeSource === 1 ? "AUDIBLE" : "SYNCHRONIZED"}</span><span>{compareSlot.size ? `${formatBytes(compareSlot.size)} · ` : ""}{formatTime(compareSlot.duration)}</span></div>
                  </article>
                )}
              </div>
              {durationDelta > 0.05 && <div className="comparison-duration-alert" role="status"><strong>Different lengths</strong><span>The shared timeline follows the longer file. {duration > compareSlot.duration ? "A" : "B"} is {formatTime(durationDelta, true)} longer.</span></div>}
              {activeSourceEnded && <div className="comparison-ended-alert" role="status">Version {activeSource === 0 ? "A" : "B"} ended at {formatTime(activeDuration, true)}. Switch source to hear the remaining audio.</div>}
              <div className="console-lower"><LyricsPanel lines={currentTrack?.lyrics ?? []} currentTime={currentTime} fileName={currentTrack?.lyricsFileName ?? ""} activeSource={activeSource} onAttachLyrics={() => { if (currentTrack) openLyricsPicker(currentTrack.id); }} onRemoveLyrics={() => { if (currentTrack) removeTrackLyrics(currentTrack.id); }} /><button className="open-library-button" type="button" onClick={() => changeWorkspace("library")}><Library size={16} /> Browse {tracks.length} tracks</button></div>
            </div>
          ) : (
          <div className="library-list-panel">
            {unavailableCount > 0 && <div className="library-reconnect-banner"><FolderOpen size={17} /><span><strong>Some music needs to be reconnected.</strong><small>Your playlists and order are still here.</small></span><button type="button" onClick={() => openFolder(true)}>Reconnect folder</button></div>}
            <div className="library-list-heading">
              <div><p>LOCAL LIBRARY</p><h1>Collected <em>manuscripts.</em></h1><span>{filteredTracks.length} of {tracks.length} tracks</span></div>
              <div className="import-menu-wrap">
                <button className="library-import-button" type="button" onClick={() => setImportOpen((value) => !value)}><Plus size={17} /> Import <ChevronDown size={14} /></button>
                {importOpen && <div className="import-popover"><button type="button" onClick={() => openFiles()}><FileAudio size={16} /> Add files</button><button type="button" onClick={() => openFolder()}><FolderOpen size={16} /> Add folder</button></div>}
              </div>
            </div>
            <div className="library-list-toolbar">
              <div><button type="button" onClick={() => void playAll(false)}><Play size={16} fill="currentColor" /> Play all</button><button type="button" onClick={() => void playAll(true)}><Shuffle size={16} /> Shuffle</button></div>
              <label><Search size={15} /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search your library" /></label>
            </div>
            <div className="track-table" role="table" aria-label="Local music library">
              <div className="track-row track-table-header" role="row"><span>#</span><span>Track</span><span>Source</span><span>Status</span><span>Time</span><span /></div>
              {filteredTracks.map((track, index) => {
                const active = track.id === session.currentTrackId;
                const unavailable = track.availability === "reconnect" || track.availability === "missing";
                return (
                  <div className={`track-row ${active ? "is-active" : ""} ${unavailable ? "is-unavailable" : ""}`} role="row" key={track.id} onDoubleClick={() => void startTrack(track.id, true, 0)}>
                    <button className="track-index" type="button" aria-label={`Play ${trackDisplayName(track.name)}`} onClick={() => void startTrack(track.id, true, 0)}>{active && isPlaying ? <AudioLines size={14} /> : String(index + 1).padStart(2, "0")}</button>
                    <span className="track-title"><strong>{trackDisplayName(track.name)}</strong><small>{track.name}</small></span>
                    <span className="track-source">{track.sourceLabel}</span>
                    <span className="track-states">
                      <i className={`availability-${track.availability}`}>{track.availability === "available" ? "Available" : track.availability === "session" ? "This session" : track.availability === "missing" ? "Missing" : "Reconnect"}</i>
                      {track.persistence === "cached" && <i className="is-cached">On device</i>}
                      {track.lyrics.length > 0 && <i className="has-lyrics">Lyrics</i>}
                      {track.comparison && <i className={`has-version-b comparison-${track.comparison.availability}`} title={`${track.comparison.name} · ${track.comparison.persistence === "cached" ? "kept on device" : "reconnect next visit"}`}>Version B</i>}
                    </span>
                    <span className="track-duration">{track.duration ? formatTime(track.duration) : "—"}</span>
                    <span className="track-menu-wrap"><button type="button" aria-label={`Actions for ${trackDisplayName(track.name)}`} onClick={() => setMenuTrackId(menuTrackId === track.id ? "" : track.id)}><MoreHorizontal size={18} /></button>
                      {menuTrackId === track.id && <span className="track-popover"><button type="button" onClick={() => addPlayNext(track.id)}>Play next</button><button type="button" onClick={() => appendQueue(track.id)}>Add to queue</button><button type="button" onClick={() => openLyricsPicker(track.id)}>{track.lyrics.length ? "Replace lyrics (.lrc)" : "Attach lyrics (.lrc)"}</button>{track.lyrics.length > 0 && <button type="button" onClick={() => removeTrackLyrics(track.id)}>Remove lyrics</button>}<button type="button" onClick={() => void toggleTrackCache(track)}>{track.persistence === "cached" ? "Remove cached copy" : "Keep on this device"}</button><button type="button" onClick={() => openComparison(track.id)}>Open in player / compare</button></span>}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          )}
          </section>

          <aside className="persistent-stage-panel">
            <div className="now-listening-heading"><p>NOW LISTENING</p><h2>{currentTrack ? trackDisplayName(currentTrack.name) : "Choose a track"}</h2><span>{currentTrack?.sourceLabel ?? "Your local library"}</span></div>
            {focusMode && currentTrack?.lyrics.length ? <LyricsPanel lines={currentTrack.lyrics} currentTime={currentTime} fileName={currentTrack.lyricsFileName} activeSource={activeSource} variant="focus" onAttachLyrics={() => openLyricsPicker(currentTrack.id)} onRemoveLyrics={() => removeTrackLyrics(currentTrack.id)} /> : null}
            <div className="persistent-stage-canvas"><Live2DStage containModel layoutKey={`${workspace}:${focusMode ? "focus" : "room"}`} featuresRef={audioVisualRef} variant="player" trackLabel={currentTrack?.name ?? "Library ready"} activeSource={activeSource} isComparing={compareSlot.status === "ready"} isPlaying={isPlaying} focusMode={focusMode} /></div>
            <div className="stage-source-indicator"><button type="button" className={activeSource === 0 ? "is-active" : ""} onClick={() => switchSource(0)} aria-pressed={activeSource === 0}>A</button>{comparisonReady && <><i /><button type="button" className={activeSource === 1 ? "is-active" : ""} onClick={() => switchSource(1)} aria-pressed={activeSource === 1}>B</button></>}<small>{comparisonReady ? `Listening to ${activeSource === 0 ? "library track" : "version B"}` : "Solo playback"}</small></div>
          </aside>
        </div>
      )}

      {tracks.length > 0 && <footer className="library-transport">
        <div className="transport-track"><span className="transport-disc"><Music2 size={20} /></span><span><strong>{currentTrack ? trackDisplayName(currentTrack.name) : "Nothing selected"}</strong><small>{currentTrack ? currentTrack.persistence === "cached" ? "Kept on this device" : currentTrack.sourceLabel : `${session.queue.length} tracks in queue`}</small></span></div>
        <div className="transport-center">
          {focusMode && comparisonReady && <div className="focus-compare-waveforms" aria-label="Focus comparison waveforms"><button type="button" className={activeSource === 0 ? "is-active" : ""} onClick={() => switchSource(0)} aria-pressed={activeSource === 0}><span>A</span><PrecisionWaveform peaks={primaryPeaks} progress={currentTime / Math.max(duration || 1, 1)} label="Focus Version A" source={0} /></button><button type="button" className={activeSource === 1 ? "is-active" : ""} onClick={() => switchSource(1)} aria-pressed={activeSource === 1}><span>B</span><PrecisionWaveform peaks={comparePeaks} progress={currentTime / Math.max(compareSlot.duration || 1, 1)} label="Focus Version B" source={1} /></button></div>}
          <div className="transport-buttons"><button className={session.shuffle ? "is-active" : ""} type="button" aria-label="Shuffle" aria-pressed={session.shuffle} onClick={toggleShuffle}><Shuffle size={17} /></button><button type="button" aria-label="Back 5 seconds" onClick={() => void seekTo(currentTime - 5)}><Rewind size={18} /></button><button type="button" aria-label="Previous track" onClick={() => void previousTrack()}><SkipBack size={20} /></button><button className="transport-play" type="button" aria-label={isPlaying ? "Pause" : "Play"} onClick={() => void togglePlay()}>{isPlaying ? <Pause size={21} fill="currentColor" /> : <Play size={21} fill="currentColor" />}</button><button type="button" aria-label="Next track" onClick={() => void nextTrack(false)}><SkipForward size={20} /></button><button type="button" aria-label="Forward 5 seconds" onClick={() => void seekTo(currentTime + 5)}><FastForward size={18} /></button><button className={session.repeat !== "off" ? "is-active" : ""} type="button" aria-label={repeatLabel(session.repeat)} onClick={cycleRepeat}>{session.repeat === "one" ? <Repeat1 size={17} /> : <Repeat size={17} />}</button></div>
          <div className="transport-progress"><span>{formatTime(currentTime, comparisonReady)}</span><input aria-label="Playback position" type="range" min="0" max={Math.max(timelineDuration, 1)} step="0.001" value={Math.min(currentTime, Math.max(timelineDuration, 1))} onChange={(event) => void seekTo(Number(event.target.value))} /><span>{formatTime(timelineDuration, comparisonReady)}</span></div>
          {activeSourceEnded && <span className="transport-source-ended">Version {activeSource === 0 ? "A" : "B"} has ended · switch source</span>}
        </div>
        <div className="transport-secondary">{comparisonReady && <div className="transport-ab-switch" aria-label="Choose audible source"><button type="button" className={activeSource === 0 ? "is-active source-a" : "source-a"} onClick={() => switchSource(0)} aria-pressed={activeSource === 0}>A</button><button type="button" className={activeSource === 1 ? "is-active source-b" : "source-b"} onClick={() => switchSource(1)} aria-pressed={activeSource === 1}>B</button></div>}<label><Volume2 size={17} /><input aria-label="Volume" type="range" min="0" max="1" step="0.01" value={session.volume} onChange={(event) => patchSession({ volume: Number(event.target.value) })} /></label><button type="button" className={queueOpen ? "is-active" : ""} onClick={() => setQueueOpen(true)}><ListMusic size={18} /><span>Queue</span></button></div>
      </footer>}

      {message && <div className="library-status" role="status">{message}</div>}

      {(importing || importSummary) && <div className="modal-backdrop"><section className="import-summary" role="dialog" aria-modal="true" aria-labelledby="import-title"><button className="sheet-close" type="button" aria-label="Close import summary" onClick={() => { if (!importing) setImportSummary(null); }}><X size={20} /></button><p>LOCAL INDEX</p><h2 id="import-title">{importing ? "Reading your music…" : "Import complete"}</h2>{importing ? <div className="import-loader"><span /><small>Indexing audio and matching lyrics without decoding every track.</small></div> : importSummary && <><div className="import-stats"><div><strong>{importSummary.accepted}</strong><span>New tracks</span></div><div><strong>{importSummary.lyrics}</strong><span>Lyrics matched</span></div><div><strong>{importSummary.duplicates}</strong><span>Reconnected / duplicate</span></div><div><strong>{importSummary.ignored}</strong><span>Ignored</span></div></div>{importSummary.errors.length > 0 && <div className="import-errors">{importSummary.errors.map((error) => <span key={error}>{error}</span>)}</div>}<button className="primary-action" type="button" onClick={() => setImportSummary(null)}>Open library</button></>}</section></div>}

      <div className={`side-sheet-backdrop ${queueOpen ? "is-open" : ""}`} onClick={() => setQueueOpen(false)}><aside className="side-sheet queue-sheet" onClick={(event) => event.stopPropagation()}><button className="sheet-close" type="button" aria-label="Close queue" onClick={() => setQueueOpen(false)}><X size={20} /></button><p>UP NEXT</p><h2>Current queue</h2><span>{session.queue.length} tracks · {session.shuffle ? "shuffle" : "in order"}</span><div className="queue-list">{session.queue.map((trackId, index) => { const track = tracks.find((candidate) => candidate.id === trackId); if (!track) return null; return <div className={trackId === session.currentTrackId ? "is-active" : ""} draggable onDragStart={(event) => event.dataTransfer.setData("text/plain", trackId)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => moveQueueTrack(event.dataTransfer.getData("text/plain"), trackId)} key={trackId}><span>{String(index + 1).padStart(2, "0")}</span><button type="button" onClick={() => void startTrack(trackId, true, 0)}><strong>{trackDisplayName(track.name)}</strong><small>{track.sourceLabel}</small></button><span className="queue-move"><button type="button" aria-label="Move up" onClick={() => reorderQueue(trackId, -1)}><ArrowUp size={13} /></button><button type="button" aria-label="Move down" onClick={() => reorderQueue(trackId, 1)}><ArrowDown size={13} /></button></span><button type="button" aria-label="Remove from queue" onClick={() => patchSession((current) => ({ ...current, queue: current.queue.filter((id) => id !== trackId) }))}><X size={14} /></button></div>; })}</div><button className="destructive-text-button" type="button" onClick={() => setConfirmAction("queue")}><Trash2 size={14} /> Clear queue only</button></aside></div>

      <div className={`side-sheet-backdrop ${storageOpen ? "is-open" : ""}`} onClick={() => setStorageOpen(false)}>
        <aside className="side-sheet storage-sheet" onClick={(event) => event.stopPropagation()}>
          <div className="sheet-heading"><div><p>LOCAL STORAGE</p><h2>Keep what matters.</h2></div><button className="sheet-close" type="button" aria-label="Close storage" onClick={() => setStorageOpen(false)}><X size={20} /></button></div>
          <p className="sheet-description">{storageState.persistent ? "Browser protection is enabled." : "The browser may clear cached audio when space is low."}</p>
          <section className="storage-usage" aria-label="Storage usage"><div><strong>{formatBytes(storageState.usage)}</strong><span>used of {storageState.quota ? formatBytes(storageState.quota) : "browser-managed space"}</span></div><div className="storage-bar"><i style={{ width: `${storageState.quota ? Math.min(100, storageState.usage / storageState.quota * 100) : 0}%` }} /></div></section>
          <label className="cache-toggle"><span><strong>Automatically keep new music</strong><small>On by default. New library tracks and Version B files remain playable after reopening Vibloom.</small></span><input type="checkbox" checked={session.cacheEnabled} onChange={(event) => { if (event.target.checked) void cacheAvailableTracks(); else { patchSession({ cacheEnabled: false }); setMessage("Automatic caching paused. Existing cached audio was kept."); } }} /></label>
          {cacheProgress > 0 && <div className="cache-progress"><i><b style={{ width: `${cacheProgress}%` }} /></i><span>Caching · {cacheProgress}%</span></div>}
          <div className="storage-actions"><button type="button" onClick={() => setConfirmAction("queue")}><span><strong>Clear queue only</strong><small>Keep library and audio</small></span><X size={16} /></button><button type="button" onClick={() => setConfirmAction("cache")}><span><strong>Clear cached audio</strong><small>Keep playlists and lyrics</small></span><Trash2 size={16} /></button><button className="is-destructive" type="button" onClick={() => setConfirmAction("reset")}><span><strong>Reset Vibloom</strong><small>Remove everything from this browser</small></span><Trash2 size={16} /></button></div>
        </aside>
      </div>

      {confirmAction && <div className="modal-backdrop"><section className="confirm-dialog" role="alertdialog" aria-modal="true"><p>PLEASE CONFIRM</p><h2>{confirmAction === "cache" ? "Clear cached audio?" : confirmAction === "queue" ? "Clear the current queue?" : "Reset Vibloom on this device?"}</h2><span>{confirmAction === "cache" ? "Your playlists, lyrics and track order will remain. Uncached tracks may need to be reconnected." : confirmAction === "queue" ? "Your library, playlists and cached audio will not be changed." : "This removes the library index, playlists, settings and all cached audio from this browser."}</span><div><button type="button" onClick={() => setConfirmAction(null)}>Cancel</button><button className="confirm-destructive" type="button" onClick={() => { if (confirmAction === "cache") void clearAudioCache(); else if (confirmAction === "queue") clearQueue(); else void resetLibrary(); }}>{confirmAction === "reset" ? "Reset Vibloom" : "Continue"}</button></div></section></div>}
    </main>
  );
}
