import StyledSelect from "./StyledSelect";
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  AudioLines,
  ChevronDown,
  ChevronLeft,
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
  WandSparkles,
  SlidersHorizontal,
  MicVocal,
  GripVertical,
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
  useSyncExternalStore,
} from "react";
import { flushSync } from "react-dom";
import Live2DStage from "./Live2DStage";
import { COMPANIONS, type CompanionId } from "./live2d/models";
import BrandMark from "./BrandMark";
import UpdateControl from "./UpdateControl";
import ProcessingDialog from "./ProcessingDialog";
import { initialSettings, type MasteringSettings } from "./audio/mastering/settings";
import { useSoundPreview } from "./audio/mastering/useSoundPreview";
import CardProgress from "./comparison/CardProgress";
import ComparisonCardBody from "./comparison/ComparisonCardBody";
import ToolButton from "./comparison/ToolButton";
import TrackSelector from "./comparison/TrackSelector";
import { useComparisonWorkspace, type TransformKind } from "./comparison/useComparisonWorkspace";
import { EQ_PRESETS } from "./audio/eq/presets";
import ComparisonActions from "./ComparisonActions";
import { makeWaveformPeaks, readAudioFile } from "./audio/audioFiles";

import { REPAIR_PRESETS } from "./audio/remaster/presets";
import { SynchronizedAudioEngine } from "./audio/SynchronizedAudioEngine";
import { SILENT_VOCAL_POSE, type VocalPose } from "./audio/vocals/envelope";
import { useLibraryVocals } from "./audio/vocals/useLibraryVocals";
import { VocalJobStore, vocalJobKey } from "./audio/vocals/jobStore";
import { useVocalPlayback } from "./audio/vocals/useVocalPlayback";
import { EMPTY_AUDIO_VISUAL, sampleAnalyser } from "./audioVisual";
import { APP_VERSION } from "./appVersion";
import {
  addAlbumTracks,
  albumForTrack,
  reorderAlbumTrack,
  comparisonCacheKey,
  comparisonsOf,
  withComparisons,
  isCurrentVocalAnalysis,
  createShuffleBag,
  EMPTY_SESSION,
  LibrarySession,
  LibraryTrack,
  makeTrackFingerprint,
  migrateLibrarySnapshot,
  matchLyricFile,
  normalizeFileName,
  RepeatMode,
  withoutExtension,
  TRACK_DRAG_TYPE,
  type LibraryAlbum,
  type VocalAnalysis,
} from "./domain/library";
import { decodeLrc, LyricLine, parseLrc, parseLyricsFile, serializeLrc, type LyricTimingLine } from "./lrc";
import LyricsTimingEditor from "./LyricsTimingEditor";
import AlbumCollections from "./AlbumCollections";
import FileDropRegion from "./FileDropRegion";
import { browserLibraryPlatform } from "./platform/browserLibraryPlatform";
import type { LibraryPlatform, StorageState } from "./platform/libraryPlatform";
import { useMediaSession } from "./platform/useMediaSession";
import "./library.css";
import "./hong-xi-theme.css";

const SUPPORTED_AUDIO = /\.(mp3|wav|wave|m4a|aac|ogg|oga|flac|opus|webm|aiff|aif)$/iu;
const MAX_FILE_BYTES = 300 * 1024 * 1024;
const SOURCE_LEAD_SECONDS = 0.025;

type ImportSummary = {
  accepted: number;
  lyrics: number;
  duplicates: number;
  ignored: number;
  errors: string[];
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
type SceneTransitionDirection = "enter" | "workspace-player" | "workspace-library" | "focus-enter" | "focus-exit";

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

function PrecisionWaveform({
  peaks,
  currentTime,
  duration,
  label,
  source,
  onSeek,
  onScrubStart,
  onScrub,
  onScrubEnd,
}: {
  peaks: number[];
  currentTime: number;
  duration: number;
  label: string;
  source: number;
  onSeek: (time: number) => void;
  onScrubStart: () => void;
  onScrub: (time: number) => void;
  onScrubEnd: (time: number) => void;
}) {
  const scrubbingRef = useRef(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubTime, setScrubTime] = useState(0);
  const bars = useMemo(() => (peaks.length ? peaks : new Array(144).fill(0.12)).map((peak, index) => <i key={`${label}-${index}`} style={{ height: `${Math.max(8, peak * 100)}%` }} />), [peaks, label]);
  const safeDuration = Math.max(0, duration);
  const displayTime = Math.max(0, Math.min(safeDuration, isScrubbing ? scrubTime : currentTime));
  const progress = safeDuration > 0 ? displayTime / safeDuration : 0;

  const finishScrub = (time: number) => {
    if (!scrubbingRef.current) return;
    scrubbingRef.current = false;
    setIsScrubbing(false);
    setScrubTime(time);
    onScrubEnd(time);
  };

  const pointerTime = (element: HTMLInputElement, clientX: number) => {
    const bounds = element.getBoundingClientRect();
    const progress = bounds.width > 0 ? (clientX - bounds.left) / bounds.width : 0;
    return Math.max(0, Math.min(safeDuration, progress * safeDuration));
  };

  return (
    <div className={`precision-waveform waveform-source-${source === 0 ? "a" : "b"} ${peaks.length ? "is-ready" : "is-loading"} ${isScrubbing ? "is-scrubbing" : ""}`}>
      <div className="waveform-bars">{bars}</div>
      <span className="waveform-played" style={{ width: `${Math.max(0, Math.min(100, progress * 100))}%` }} />
      <b style={{ left: `${Math.max(0, Math.min(100, progress * 100))}%` }} />
      {isScrubbing && <output className="waveform-time-bubble" style={{ left: `${Math.max(0, Math.min(100, progress * 100))}%` }}>{formatTime(displayTime, true)}</output>}
      <input
        className="waveform-seek"
        type="range"
        min="0"
        max={Math.max(safeDuration, 0.001)}
        step="0.001"
        value={displayTime}
        disabled={safeDuration <= 0}
        aria-label={`Seek ${label} waveform`}
        aria-valuetext={formatTime(displayTime, true)}
        onPointerDown={(event) => {
          if (safeDuration <= 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          const time = pointerTime(event.currentTarget, event.clientX);
          scrubbingRef.current = true;
          setIsScrubbing(true);
          setScrubTime(time);
          onScrubStart();
          onScrub(time);
        }}
        onPointerMove={(event) => {
          if (!scrubbingRef.current) return;
          const time = pointerTime(event.currentTarget, event.clientX);
          setScrubTime(time);
          onScrub(time);
        }}
        onChange={(event) => {
          const time = Number(event.currentTarget.value);
          setScrubTime(time);
          if (scrubbingRef.current) onScrub(time);
          else onSeek(time);
        }}
        onPointerUp={(event) => finishScrub(pointerTime(event.currentTarget, event.clientX))}
        onPointerCancel={(event) => finishScrub(pointerTime(event.currentTarget, event.clientX))}
      />
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
  // Capture entries and fallback Files before the first await: browsers clear
  // the drag data store as soon as the drop handler returns.
  const entryItems: Array<DroppedFileEntry | File> = [];
  for (const item of Array.from(dataTransfer.items)) {
    if (item.kind !== "file") continue;
    const entry = (item as unknown as { webkitGetAsEntry?: () => DroppedFileEntry | null }).webkitGetAsEntry?.();
    if (entry) entryItems.push(entry);
    else { const file = item.getAsFile(); if (file) entryItems.push(file); }
  }
  if (!entryItems.length) return Array.from(dataTransfer.files);
  const nested = await Promise.all(entryItems.map((entry) => entry instanceof File ? [entry] : filesFromDroppedEntry(entry)));
  return nested.flat();
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

function LyricsPanel({ lines, currentTime, fileName, activeSource, onAttachLyrics, onRemoveLyrics, timing, onTiming, variant = "console" }: { lines: LyricLine[]; currentTime: number; fileName: string; activeSource: number; onAttachLyrics: () => void; onRemoveLyrics: () => void; timing?: LyricTimingLine[]; onTiming: () => void; variant?: "console" | "focus" }) {
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

  if (!lines.length && timing !== undefined) {
    return <div className={`library-lyrics-empty lyrics-plain lyrics-variant-${variant}`}>
      <FileText size={18} /><span>TXT lyrics · {timing.length} lines</span>
      <button type="button" onClick={onTiming}>Timestamp lyrics</button>
      <button type="button" onClick={onAttachLyrics}>Replace</button>
      <button type="button" onClick={onRemoveLyrics}>Remove</button>
    </div>;
  }

  if (!lines.length) {
    return (
      <div className={`library-lyrics-empty lyrics-variant-${variant}`}>
        <FileText size={18} />
        <span>No matched lyrics for this track</span>
        <button type="button" onClick={onAttachLyrics}>Attach .lrc / .txt</button>
      </div>
    );
  }

  return (
    <div className={`library-lyrics lyrics-variant-${variant} lyrics-source-${activeSource === 0 ? "a" : "b"}`} key={`${variant}:${fileName}`} aria-label={`Lyrics from ${fileName}`}>
      <span className="library-lyrics-label"><FileText size={12} /> Synced lyrics <button type="button" onClick={onAttachLyrics}>Replace</button><button type="button" onClick={onRemoveLyrics}>Remove</button><button type="button" onClick={onTiming}>Edit timing</button></span>
      <div className="library-lyrics-viewport" ref={viewportRef}>
        <div className="library-lyrics-list">
          {lines.map((line, index) => (
            <p
              className={index === activeIndex ? "is-current" : index < activeIndex ? "is-past" : ""}
              key={`${line.time}-${index}`}
              ref={(node) => { lineRefs.current[index] = node; }}
              aria-current={index === activeIndex ? "true" : undefined}
              style={{
                "--lyric-index": Math.min(index, 9),
                ...(index === activeIndex ? { "--lyric-progress": `${lineProgress}%` } : {}),
              } as CSSProperties}
            >
              {line.text.split("\n").map((part, partIndex) => <span key={partIndex}>{part}</span>)}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}

function usePlaybackTitle(name: string, playing: boolean, count: number) {
  useEffect(() => {
    document.title = name ? `${playing ? "Playing" : "Ready"} · ${trackDisplayName(name)} — Vibloom` : count ? `Library · ${count} tracks — Vibloom` : "Vibloom — Local Live2D Music Player";
  }, [name, playing, count]);
}

export default function LibraryApp({ platform = browserLibraryPlatform }: { platform?: LibraryPlatform }) {
  const [tracks, setTracks] = useState<LibraryTrack[]>([]);
  const [albums, setAlbums] = useState<LibraryAlbum[]>([]);
  const [activeAlbumId, setActiveAlbumId] = useState("");
  const [browsingAlbums, setBrowsingAlbums] = useState(false);
  const activeAlbum = albums.find((album) => album.id === activeAlbumId);
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
  const [primaryLoad, setPrimaryLoad] = useState<{ stage: LoadStage; progress: number }>({ stage: "idle", progress: 0 });
  const [activeSource, setActiveSource] = useState(0);
  const [lastComparison, setLastComparison] = useState<{ rootId: string; slot: number } | null>(null);
  const [primaryPeaks, setPrimaryPeaks] = useState<number[]>([]);
  const [confirmAction, setConfirmAction] = useState<"cache" | "queue" | "reset" | null>(null);
  const [timingTrackId, setTimingTrackId] = useState("");
  const [dragging, setDragging] = useState(false);
  const [albumDrag, setAlbumDrag] = useState("");
  const [albumDrop, setAlbumDrop] = useState<{ id: string; edge: "before" | "after" } | null>(null);
  const albumDragRef = useRef<{ albumId: string; trackId: string } | null>(null);
  const [repairDrafts, setRepairDrafts] = useState<Record<string, string>>({});
  const [soundDrafts, setSoundDrafts] = useState<Record<string, MasteringSettings>>({});
  const [emptySound] = useState(initialSettings);
  const [processingDialog, setProcessingDialog] = useState<{ source: number; kind: TransformKind; identity: string } | null>(null);
  const [processingTarget, setProcessingTarget] = useState(1);
  const [processingError, setProcessingError] = useState("");
  const compareTargetRef = useRef(1);
  const filesInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const compareInputRef = useRef<HTMLInputElement>(null);
  const lyricsInputRef = useRef<HTMLInputElement>(null);
  const lyricsTargetTrackIdRef = useRef("");
  const importAlbumIdRef = useRef("");
  const importBusyRef = useRef(false);
  const readingDropRef = useRef(false);
  const focusModeRef = useRef(false);
  const workspaceRef = useRef<Workspace>("player");
  const runtimeFilesRef = useRef(new Map<string, File>());
  const reconnectModeRef = useRef(false);
  const [audioEngine] = useState(() => new SynchronizedAudioEngine());
  const frequencyDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const timeDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const loadedTrackIdRef = useRef("");
  const preloadingTrackIdRef = useRef("");
  const primaryLoadVersionRef = useRef(0);
  const playingRef = useRef(false);
  const playbackIntentVersionRef = useRef(0);
  const waveformScrubbingRef = useRef(false);
  const waveformScrubWasPlayingRef = useRef(false);
  const shuffleBagRef = useRef<string[]>([]);
  const shuffleCycleStartedRef = useRef(false);
  const animationFrameRef = useRef<number | null>(null);
  const lastCheckpointRef = useRef(0);
  const startTrackRef = useRef<(trackId: string, play?: boolean, resumeAt?: number) => Promise<boolean>>(async () => false);
  const endedRef = useRef<() => void>(() => undefined);
  const shortcutTogglePlayRef = useRef<() => Promise<void>>(async () => undefined);
  const shortcutSwitchSourceRef = useRef<(source: number) => void>(() => undefined);
  const audioVisualRef = useRef({ ...EMPTY_AUDIO_VISUAL });
  const vocalLevelRef = useRef<VocalPose>(SILENT_VOCAL_POSE);

  const currentTrack = tracks.find((track) => track.id === session.currentTrackId) ?? null;
  const timingTrack = tracks.find((track) => track.id === timingTrackId) ?? null;
  const filteredTracks = useMemo(() => {
    const query = normalizeFileName(search);
    const album = albums.find((candidate) => candidate.id === activeAlbumId);
    const byId = new Map(tracks.map((track) => [track.id, track]));
    const collected = album ? album.trackIds.flatMap((id) => { const track = byId.get(id); return track ? [track] : []; }) : tracks;
    if (!query) return collected;
    return collected.filter((track) => normalizeFileName(`${track.name} ${track.relativePath} ${track.sourceLabel}`).includes(query));
  }, [search, tracks, albums, activeAlbumId]);
  const unavailableCount = tracks.filter((track) => track.availability === "reconnect" || track.availability === "missing").length;
  const patchTracks = useCallback((update: (current: LibraryTrack[]) => LibraryTrack[]) => {
    setTracks((current) => {
      const next = update(current);
      tracksRef.current = next;
      return next;
    });
  }, []);

  const [vocalJobs] = useState(() => new VocalJobStore());
  useEffect(() => () => vocalJobs.dispose(), [vocalJobs]);
  const jobsSnapshot = useSyncExternalStore(vocalJobs.subscribe, vocalJobs.getSnapshot);
  const [singingKeys, setSingingKeys] = useState<Set<string>>(() => new Set());
  const readRoot = useCallback(() => tracksRef.current.find(track => track.id === sessionRef.current.currentTrackId) ?? null, []);
  const readTracks = useCallback(() => tracksRef.current, []);
  const cacheEnabled = useCallback(() => sessionRef.current.cacheEnabled, []);
  const forgetVocals = useCallback((track: LibraryTrack, source: number) => {
    const key = vocalJobKey(track, source); vocalJobs.forget(key);
    setSingingKeys(current => { const next = new Set(current); next.delete(key); return next; });
  }, [vocalJobs]);
  const selectAudible = useCallback((source: number) => {
    setActiveSource(source);
    if (source > 0) setLastComparison({ rootId: readRoot()?.id ?? "", slot: source });
  }, [readRoot]);
  const comparisons = useComparisonWorkspace({ rootId: currentTrack?.id ?? "", readRoot, readTracks, patchTracks, engine: audioEngine, platform, cacheEnabled, onMessage: setMessage, onSelect: selectAudible, forgetVocals });
  const remasterPreset = processingDialog ? repairDrafts[processingDialog.identity] ?? "default" : "default";
  const soundSettings = processingDialog ? soundDrafts[processingDialog.identity] ?? emptySound : emptySound;
  const soundPreview = useSoundPreview(audioEngine, comparisons.ensureBuffer, processingDialog?.identity ?? "", soundSettings, setProcessingError);
  useEffect(() => {
    const identities = new Set(tracks.flatMap(track => [`${track.id}:${track.fingerprint}`, ...comparisonsOf(track).map(item => `${track.id}:${item.id}`)]));
    const timer = window.setTimeout(() => {
      setSoundDrafts(current => Object.keys(current).some(key => !identities.has(key)) ? Object.fromEntries(Object.entries(current).filter(([key]) => identities.has(key))) : current);
      setRepairDrafts(current => Object.keys(current).some(key => !identities.has(key)) ? Object.fromEntries(Object.entries(current).filter(([key]) => identities.has(key))) : current);
    }, 0);
    return () => clearTimeout(timer);
  }, [tracks]);
  const recordComparison = comparisons.record;
  useEffect(() => {
    if (!processingDialog) return;
    const identity = `${currentTrack?.id}:${processingDialog.source === 0 ? currentTrack?.fingerprint : recordComparison(processingDialog.source)?.id}`;
    if (identity === processingDialog.identity) return;
    audioEngine.endPreview();
    const timer = window.setTimeout(() => setProcessingDialog(null), 0);
    return () => clearTimeout(timer);
  }, [audioEngine, currentTrack, processingDialog, recordComparison]);

  const comparisonSlots = Object.values(comparisons.slots).sort((a, b) => a.slot - b.slot);
  const comparisonReady = comparisonSlots.some(slot => slot.status === "ready");
  useEffect(() => {
    audioVisualRef.current = { ...audioVisualRef.current, source: activeSource, isComparing: comparisonReady };
  }, [activeSource, comparisonReady]);
  const comparisonVisible = comparisonSlots.length > 0;
  const expandedComparison = activeSource > 0 ? activeSource : lastComparison && lastComparison.rootId === currentTrack?.id && comparisons.slots[lastComparison.slot] ? lastComparison.slot : comparisonSlots[0]?.slot;
  const comparisonExpanded = comparisonVisible;
  useEffect(() => {
    const reset = () => { albumDragRef.current = null; setAlbumDrag(""); setAlbumDrop(null); };
    const outside = (event: globalThis.DragEvent) => { if (!(event.target instanceof Element) || !event.target.closest(".track-row[data-track-id]")) setAlbumDrop(null); };
    window.addEventListener("dragend", reset);
    window.addEventListener("drop", reset);
    window.addEventListener("blur", reset);
    window.addEventListener("dragover", outside);
    return () => { window.removeEventListener("dragend", reset); window.removeEventListener("drop", reset); window.removeEventListener("blur", reset); window.removeEventListener("dragover", outside); };
  }, []);
  const primaryDuration = duration || currentTrack?.duration || 0;
  const timelineDuration = Math.max(primaryDuration, ...comparisonSlots.map(slot => slot.duration), 0);
  const playbackAlbum = albumForTrack(albums, currentTrack?.id ?? "", session.playbackAlbumId);
  const audibleSource = soundPreview.preview && processingDialog ? processingDialog.source : activeSource;
  const activeDuration = audibleSource === 0 ? primaryDuration : comparisons.slots[audibleSource]?.duration ?? 0;
  const activeSourceEnded = activeDuration > 0 && currentTime >= activeDuration - .005 && currentTime < timelineDuration - .005;
  const activeKey = currentTrack ? vocalJobKey(currentTrack, audibleSource) : "";
  const activeAnalysis = jobsSnapshot[activeKey]?.analysis ?? (audibleSource === 0 ? currentTrack?.vocalAnalysis : comparisonsOf(currentTrack ?? { comparison: null } as LibraryTrack).find(item => item.slot === audibleSource)?.vocalAnalysis);
  const sampleVocals = useVocalPlayback(activeAnalysis, activeDuration, singingKeys.has(activeKey));
  const { cancelAll: cancelTransforms, reset: resetComparisons } = comparisons;

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
      setStorageState(await platform.storage.readState());
    } catch {
      setStorageState({ usage: 0, quota: 0, persistent: false });
    }
  }, [platform]);

  useEffect(() => {
    const folderInput = folderInputRef.current as (HTMLInputElement & { webkitdirectory?: boolean }) | null;
    if (folderInput) folderInput.webkitdirectory = true;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const storedSnapshot = await platform.repository.load();
        if (!storedSnapshot || cancelled) return;
        const snapshot = migrateLibrarySnapshot(storedSnapshot);
        const restoredTracks = await Promise.all(snapshot.tracks.map(async (storedTrack) => {
          const track: LibraryTrack = { ...storedTrack, comparison: storedTrack.comparison ?? null };
          const versions = await Promise.all(comparisonsOf(track).map(async item => {
            const file = item.persistence === "cached" ? await platform.audioFiles.get(comparisonCacheKey(track.id, item)) : null;
            return { ...item, availability: file ? "available" as const : "reconnect" as const, persistence: file ? "cached" as const : "indexed" as const };
          }));
          const cached = track.persistence === "cached" ? await platform.audioFiles.get(track.id) : null;
          return withComparisons({ ...track, availability: cached ? "available" as const : "reconnect" as const, persistence: cached ? "cached" as const : "indexed" as const }, versions);
        }));
        if (cancelled) return;
        tracksRef.current = restoredTracks;
        setTracks(restoredTracks);
        setAlbums(snapshot.albums);
        const nextSession = {
          ...EMPTY_SESSION,
          ...snapshot.session,
          cacheEnabled: snapshot.session.cacheEnabled,
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
  }, [platform, refreshStorageState]);

  useEffect(() => {
    tracksRef.current = tracks;
  }, [tracks]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    if (!restored) return;
    const timer = window.setTimeout(() => {
      const serializableTracks = tracks.map(track => withComparisons({ ...track, availability: track.persistence === "cached" ? "available" as const : "reconnect" as const }, comparisonsOf(track).map(item => ({ ...item, availability: item.persistence === "cached" ? "available" as const : "reconnect" as const }))));
      void platform.repository.save({ version: 3, tracks: serializableTracks, albums, session }).catch(() => {
        setMessage("Could not save changes in this mode.");
      });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [platform, restored, session, tracks, albums]);

  const ensureAudioGraph = useCallback(async (resume = true) => {
    const context = await audioEngine.ensureGraph(resume, sessionRef.current.volume);
    if (!frequencyDataRef.current) {
      const analyser = audioEngine.getAnalyser(0);
      if (!analyser) throw new Error("Audio graph could not be created.");
      frequencyDataRef.current = new Uint8Array(analyser.frequencyBinCount);
      timeDataRef.current = new Uint8Array(analyser.fftSize);
    }
    return context;
  }, [audioEngine]);

  const getTimelineTime = useCallback(() => {
    return audioEngine.getTimelineTime();
  }, [audioEngine]);

  const startPlayback = useCallback(async (time: number) => {
    const started = await audioEngine.play(time, SOURCE_LEAD_SECONDS, sessionRef.current.volume);
    if (!started) return false;
    playingRef.current = true;
    setCurrentTime(time);
    setIsPlaying(true);
    return true;
  }, [audioEngine]);

  const pausePlayback = useCallback(() => {
    playbackIntentVersionRef.current += 1;
    const pausedAt = audioEngine.pause();
    playingRef.current = false;
    setCurrentTime(pausedAt);
    setIsPlaying(false);
    audioVisualRef.current = { ...audioVisualRef.current, isPlaying: false, transient: 0 };
    lastCheckpointRef.current = pausedAt;
    patchSession({ currentTime: pausedAt });
  }, [audioEngine, patchSession]);

  const seekTo = useCallback(async (rawTime: number) => {
    const maxDuration = audioEngine.getMaxDuration();
    const nextTime = Math.max(0, Math.min(rawTime, maxDuration));
    audioEngine.setOffset(nextTime);
    setCurrentTime(nextTime);
    patchSession({ currentTime: nextTime });
    if (playingRef.current) await startPlayback(nextTime);
  }, [audioEngine, patchSession, startPlayback]);

  const previewWaveformSeek = useCallback((rawTime: number) => {
    const maxDuration = audioEngine.getMaxDuration();
    const nextTime = Math.max(0, Math.min(rawTime, maxDuration));
    audioEngine.setOffset(nextTime);
    setCurrentTime(nextTime);
    return nextTime;
  }, [audioEngine]);

  const beginWaveformScrub = useCallback(() => {
    if (waveformScrubbingRef.current) return;
    waveformScrubbingRef.current = true;
    waveformScrubWasPlayingRef.current = playingRef.current;
    if (playingRef.current) pausePlayback();
  }, [pausePlayback]);

  const finishWaveformScrub = useCallback(async (rawTime: number) => {
    const nextTime = previewWaveformSeek(rawTime);
    const shouldResume = waveformScrubWasPlayingRef.current;
    waveformScrubbingRef.current = false;
    waveformScrubWasPlayingRef.current = false;
    lastCheckpointRef.current = nextTime;
    patchSession({ currentTime: nextTime });
    if (shouldResume) await startPlayback(nextTime);
  }, [patchSession, previewWaveformSeek, startPlayback]);

  const resolveTrackFile = useCallback(async (track: LibraryTrack) => {
    const runtime = runtimeFilesRef.current.get(track.id);
    if (runtime) return runtime;
    if (track.persistence === "cached") return platform.audioFiles.get(track.id);
    return null;
  }, [platform]);

  const [vocalSelectionMode, setVocalSelectionMode] = useState(false);
  const [selectedVocalTracks, setSelectedVocalTracks] = useState<string[]>([]);
  const saveLibraryVocals = useCallback((source: LibraryTrack, analysis: VocalAnalysis) => {
    patchTracks((current) => current.map((track) => track.id === source.id && track.fingerprint === source.fingerprint ? { ...track, vocalAnalysis: analysis } : track));
    setSingingKeys(current => new Set(current).add(vocalJobKey(source)));
  }, [patchTracks]);
  const libraryVocals = useLibraryVocals(vocalJobs, resolveTrackFile, saveLibraryVocals);

  const startTrack = useCallback(async (trackId: string, play = true, resumeAt = 0) => {
    cancelTransforms();
    const playbackIntentVersion = playbackIntentVersionRef.current;
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
      setProcessingDialog(null); setProcessingError("");
      resetComparisons();
      setActiveSource(0);
      audioEngine.selectSourceImmediately(0);
    }
    playingRef.current = false;
    audioEngine.stop();
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
    audioEngine.setBuffer(0, buffer);
    loadedTrackIdRef.current = trackId;
    const safeTime = Math.min(Math.max(0, resumeAt), Math.max(0, buffer.duration - 0.05));
    audioEngine.setOffset(safeTime);
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
    if (play && playbackIntentVersion === playbackIntentVersionRef.current) await startPlayback(safeTime);
    return true;
  }, [audioEngine, cancelTransforms, resetComparisons, ensureAudioGraph, patchSession, patchTracks, resolveTrackFile, startPlayback]);

  useEffect(() => {
    startTrackRef.current = startTrack;
  }, [startTrack]);

  useEffect(() => {
    const trackId = session.currentTrackId;
    if (!restored || !trackId || playingRef.current) return;
    if (loadedTrackIdRef.current === trackId || preloadingTrackIdRef.current === trackId) return;
    const track = tracks.find((candidate) => candidate.id === trackId);
    if (!track || (track.availability !== "available" && track.availability !== "session")) return;
    preloadingTrackIdRef.current = trackId;
    void startTrack(trackId, false, session.currentTime).finally(() => {
      if (preloadingTrackIdRef.current === trackId) preloadingTrackIdRef.current = "";
    });
  }, [restored, session.currentTime, session.currentTrackId, startTrack, tracks]);

  const nextTrack = useCallback(async (natural = false) => {
    const current = sessionRef.current;
    if (!current.queue.length) return;
    // Replaying the loaded track must retain its buffers and in-flight vocal
    // analysis, including a one-item queue repeating in "all" mode.
    const playFromStart = (trackId: string) => loadedTrackIdRef.current === trackId && audioEngine.getBuffer(0)
      ? startPlayback(0)
      : startTrackRef.current(trackId, true, 0);
    if (natural && current.repeat === "one" && current.currentTrackId) {
      await playFromStart(current.currentTrackId);
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
      if (await playFromStart(nextId)) return;
    }
    if (playingRef.current) pausePlayback();
    setMessage("Queue complete. Reconnect any unavailable tracks to include them.");
  }, [audioEngine, pausePlayback, startPlayback, setMessage]);

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
    let lastUiTime = -Infinity;
    const tick = (now: number) => {
      if (!playingRef.current) return;
      const reference = getTimelineTime();
      vocalLevelRef.current = audioEngine.getContext()?.state === "running" ? sampleVocals(reference, sessionRef.current.volume) : SILENT_VOCAL_POSE;
      const maxDuration = audioEngine.getMaxDuration();
      const nextTime = Math.min(reference, maxDuration);
      // The timing editor owns its visual playhead; background UI needs only 10 Hz.
      if (!timingTrackId || now - lastUiTime >= 100) {
        setCurrentTime(nextTime);
        lastUiTime = now;
      }
      sessionRef.current = { ...sessionRef.current, currentTime: nextTime };
      if (Math.abs(nextTime - lastCheckpointRef.current) >= 5) {
        lastCheckpointRef.current = nextTime;
        setSession(sessionRef.current);
      }
      const analyser = audioEngine.getAnalyser(audioEngine.audibleSource);
      const frequency = frequencyDataRef.current;
      const time = timeDataRef.current;
      if (analyser && frequency && time) {
        audioVisualRef.current = sampleAnalyser(analyser, frequency, time, audioVisualRef.current, reference, audioEngine.audibleSource);
      }
      if (maxDuration > 0 && reference >= maxDuration - 0.025) {
        playingRef.current = false;
        audioEngine.markEnded(maxDuration);
        setCurrentTime(maxDuration);
        setIsPlaying(false);
        if (!timingTrackId) endedRef.current();
        // A buffered repeat may resume within the same React batch. Keep a
        // frame scheduled; the effect cleanup cancels it if playback stays off.
        animationFrameRef.current = requestAnimationFrame(tick);
        return;
      }
      animationFrameRef.current = requestAnimationFrame(tick);
    };
    animationFrameRef.current = requestAnimationFrame(tick);
    return () => {
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [activeSource, audioEngine, getTimelineTime, isPlaying, timingTrackId, sampleVocals]);

  useEffect(() => () => {
    void audioEngine.close();
  }, [audioEngine]);

  const handleImport = useCallback(async (fileList: FileList | File[], albumId = "") => {
    const files = Array.from(fileList) as FileWithPath[];
    if (!files.length || importBusyRef.current || !restored) return;
    importBusyRef.current = true;
    try {
      const enteringFromWelcome = tracksRef.current.length === 0;
      setImporting(true);
      setImportSummary(null);
      setImportOpen(false);
      const summary: ImportSummary = { accepted: 0, lyrics: 0, duplicates: 0, ignored: 0, errors: [] };
      const audioFiles = files.filter((file) => file.type.startsWith("audio/") || SUPPORTED_AUDIO.test(file.name));
      const lyricFiles = files.filter((file) => /\.(lrc|txt)$/iu.test(file.name));
      summary.ignored = files.length - audioFiles.length - lyricFiles.length;
      const candidates = lyricFiles.map((file) => ({ name: file.name, relativePath: relativePathOf(file), file }));
      const matchedLyrics = new Set<File>();
      const existingByFingerprint = new Map(tracksRef.current.map((track) => [track.fingerprint, track]));
      const peers = new Map(tracksRef.current.map((track) => [track.fingerprint, { name: track.name, relativePath: track.relativePath }]));
      for (const file of audioFiles) peers.set(makeTrackFingerprint(file), { name: file.name, relativePath: relativePathOf(file) });
      const matchingPeers = [...peers.values()];
      const attachImportedLyrics = async (track: LibraryTrack, path = track.relativePath) => {
        const candidate = matchLyricFile({ name: track.name, relativePath: path }, candidates, matchingPeers);
        if (!candidate) return track;
        matchedLyrics.add(candidate.file);
        if (candidate.file.size > 5 * 1024 * 1024) { summary.errors.push(`${candidate.name} is larger than 5 MB`); return track; }
        try {
          const parsed = parseLyricsFile(decodeLrc(await candidate.file.arrayBuffer()), candidate.name);
          summary.lyrics += 1;
          return { ...track, ...parsed, lyricMetadata: parsed.lyricMetadata, lyricsFileName: candidate.name };
        } catch {
          summary.errors.push(`${candidate.name} could not be parsed`);
          return track;
        }
      };
      const imported: LibraryTrack[] = [];
      let cacheThisImport = sessionRef.current.cacheEnabled;
      if (cacheThisImport && audioFiles.length) {
        await platform.storage.requestPersistence().catch(() => false);
        try {
          const storage = await platform.storage.readState();
          const availableBytes = Math.max(0, storage.quota - storage.usage);
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
              await platform.audioFiles.put(existing.id, file);
              reconnected = { ...reconnected, persistence: "cached", availability: "available" };
            } catch {
              summary.errors.push(`${file.name} could not be kept for future visits.`);
            }
          }
          imported.push(await attachImportedLyrics(reconnected, path));
          summary.duplicates += 1;
          setCacheProgress(Math.round(((fileIndex + 1) / sortedAudioFiles.length) * 100));
          continue;
        }
        const track: LibraryTrack = await attachImportedLyrics({
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
          lyricsFileName: "",
          lyrics: [],
          comparison: null,
        });
        runtimeFilesRef.current.set(track.id, file);
        if (cacheThisImport) {
          try {
            await platform.audioFiles.put(track.id, file);
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

      // A later drop of just TXT/LRC files can attach to already indexed songs.
      const lyricUpdates: LibraryTrack[] = [];
      for (const track of tracksRef.current) {
        if (imported.some((candidate) => candidate.id === track.id)) continue;
        const updated = await attachImportedLyrics(track);
        if (updated !== track) lyricUpdates.push(updated);
      }
      for (const file of lyricFiles) {
        if (!matchedLyrics.has(file)) {
          summary.ignored += 1;
          summary.errors.push(`${file.name}: no unique matching song. Use Attach lyrics on the intended song.`);
        }
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
          for (const track of lyricUpdates) {
            const current = byId.get(track.id);
            if (current) byId.set(track.id, { ...current, lyrics: track.lyrics, lyricTiming: track.lyricTiming, lyricMetadata: track.lyricMetadata, lyricsFileName: track.lyricsFileName });
          }
          return [...byId.values()].sort((a, b) => a.relativePath.localeCompare(b.relativePath, undefined, { numeric: true, sensitivity: "base" }));
        });
        if (importedIds.length) {
          if (albumId && !reconnecting) setAlbums((current) => current.map((album) => album.id === albumId ? addAlbumTracks(album, importedIds) : album));
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
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not import these files. Please try again.");
    } finally {
      importBusyRef.current = false;
      reconnectModeRef.current = false;
      setImporting(false);
    }
  }, [patchSession, patchTracks, platform, refreshStorageState, restored, setImportSummary, setMessage]);

  function handleFilesInput(event: ChangeEvent<HTMLInputElement>) {
    void handleImport(event.target.files ?? [], importAlbumIdRef.current);
    event.target.value = "";
  }

  function openFiles(reconnect = false) {
    importAlbumIdRef.current = reconnect ? "" : activeAlbumId;
    reconnectModeRef.current = reconnect;
    setImportOpen(false);
    filesInputRef.current?.click();
  }

  function openFolder(reconnect = false) {
    importAlbumIdRef.current = reconnect ? "" : activeAlbumId;
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
      const parsed = parseLyricsFile(decodeLrc(await file.arrayBuffer()), file.name);
      const target = tracksRef.current.find((track) => track.id === trackId);
      patchTracks((current) => current.map((track) => track.id === trackId ? {
        ...track,
        lyrics: parsed.lyrics,
        lyricTiming: parsed.lyricTiming,
        lyricMetadata: parsed.lyricMetadata,
        lyricsFileName: file.name,
      } : track));
      setMessage(`Lyrics attached · ${target ? trackDisplayName(target.name) : file.name}`);
    } catch {
      setMessage("Choose a non-empty TXT file or a valid timestamped LRC file.");
    } finally {
      lyricsTargetTrackIdRef.current = "";
    }
  }

  async function openTimingEditor(trackId: string) {
    setMenuTrackId("");
    if (loadedTrackIdRef.current !== trackId) {
      if (!await startTrack(trackId, false, 0)) return;
    }
    patchTracks((current) => current.map((track) => track.id === trackId && !track.lyricTiming
      ? { ...track, lyricTiming: track.lyrics.map((line) => ({ ...line })) } : track));
    setTimingTrackId(trackId);
  }

  const saveTimedLyrics = useCallback((download: boolean, format: "lrc" | "txt" = "lrc") => {
    if (!timingTrack?.lyricTiming) return;
    try {
      const source = format === "txt" ? timingTrack.lyricTiming.map((line) => line.text).join("\n") + "\n" : serializeLrc(timingTrack.lyricTiming, timingTrack.lyricMetadata);
      const fileName = `${withoutExtension(timingTrack.lyricsFileName || timingTrack.name)}.${format}`;
      if (format === "lrc") {
        const lyrics = parseLrc(source).lines;
        patchTracks((current) => current.map((track) => track.id === timingTrack.id ? { ...track, lyrics, lyricsFileName: fileName } : track));
      }
      if (download) {
        const url = URL.createObjectURL(new Blob([source], { type: "text/plain;charset=utf-8" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setMessage(format === "txt" ? "TXT lyrics download started." : download ? "Synced lyrics saved · LRC download started." : "Synced lyrics saved.");
      if (!download) setTimingTrackId("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not export lyrics.");
    }
  }, [timingTrack, patchTracks, setMessage]);

  function removeTrackLyrics(trackId: string) {
    const target = tracksRef.current.find((track) => track.id === trackId);
    patchTracks((current) => current.map((track) => track.id === trackId ? {
      ...track,
      lyrics: [],
      lyricTiming: undefined,
      lyricMetadata: undefined,
      lyricsFileName: "",
    } : track));
    setMenuTrackId("");
    setMessage(`Lyrics removed · ${target ? trackDisplayName(target.name) : "track"}`);
  }

  async function handleDrop(event: DragEvent<HTMLElement>, albumId = activeAlbumId) {
    event.preventDefault();
    event.stopPropagation();
    setDragging(false);
    if (importBusyRef.current || readingDropRef.current || !restored) return;
    readingDropRef.current = true;
    reconnectModeRef.current = false;
    try {
      setImporting(true);
      const files = await filesFromDrop(event.dataTransfer);
      if (!files.length) {
        setMessage("This browser could not read that dropped folder. Use Choose a folder instead.");
        return;
      }
      await handleImport(files, albumId);
    } catch {
      setMessage("That folder could not be read. Check its permission or use Choose a folder.");
    } finally {
      readingDropRef.current = false;
      setImporting(false);
    }
  }

  function addTrackToAlbum(albumId: string, trackId: string) {
    if (!tracksRef.current.some((track) => track.id === trackId)) return;
    setAlbums((current) => current.map((album) => album.id === albumId ? addAlbumTracks(album, [trackId]) : album));
    setDragging(false);
    setMenuTrackId("");
    setMessage("Song added to album.");
  }

  function previewAlbumDrop(event: DragEvent<HTMLElement>, targetId: string) {
    const drag = albumDragRef.current;
    if (!activeAlbum || drag?.albumId !== activeAlbum.id || !event.dataTransfer.types.includes(TRACK_DRAG_TYPE)) return;
    event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "move";
    if (drag.trackId === targetId) { setAlbumDrop(null); return; }
    const bounds = event.currentTarget.getBoundingClientRect();
    const edge = event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
    setAlbumDrop(current => current?.id === targetId && current.edge === edge ? current : { id: targetId, edge });
  }

  function dropAlbumTrack(event: DragEvent<HTMLElement>, targetId: string) {
    const drag = albumDragRef.current;
    if (!activeAlbum || drag?.albumId !== activeAlbum.id || !event.dataTransfer.types.includes(TRACK_DRAG_TYPE)) return;
    event.preventDefault(); event.stopPropagation();
    if (event.dataTransfer.getData(TRACK_DRAG_TYPE) !== drag.trackId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const edge = event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
    setAlbums(current => current.map(album => album.id === activeAlbum.id ? reorderAlbumTrack(album, drag.trackId, targetId, edge) : album));
    albumDragRef.current = null; setAlbumDrag(""); setAlbumDrop(null);
    if (drag.trackId !== targetId) setMessage("Album order saved.");
  }

  const playAll = useCallback(async (shuffle = false) => {
    const ids = filteredTracks.filter((track) => track.availability === "available" || track.availability === "session").map((track) => track.id);
    if (!ids.length) return;
    shuffleBagRef.current = shuffle ? createShuffleBag(ids, "") : [];
    shuffleCycleStartedRef.current = shuffle;
    const first = shuffle ? shuffleBagRef.current.shift() ?? ids[0] : ids[0];
    patchSession((current) => ({ ...current, queue: ids, shuffle, history: [], playbackAlbumId: activeAlbumId }));
    await startTrack(first, true, 0);
  }, [filteredTracks, patchSession, startTrack, activeAlbumId]);

  function playLibraryTrack(trackId: string) {
    patchSession({ playbackAlbumId: activeAlbum?.trackIds.includes(trackId) ? activeAlbum.id : "" });
    return startTrack(trackId, true, 0);
  }

  async function togglePlay() {
    const primaryBuffer = audioEngine.getBuffer(0);
    if (primaryBuffer && loadedTrackIdRef.current === sessionRef.current.currentTrackId) {
      if (playingRef.current) pausePlayback();
      else {
        const maxDuration = audioEngine.getMaxDuration();
        const startAt = audioEngine.currentOffset >= maxDuration - 0.01 ? 0 : audioEngine.currentOffset;
        await startPlayback(startAt);
      }
      return;
    }
    const trackId = sessionRef.current.currentTrackId || sessionRef.current.queue[0] || tracksRef.current[0]?.id;
    if (trackId) await startTrack(trackId, true, sessionRef.current.currentTime);
  }

  useMediaSession({
    enabled: !!currentTrack,
    title: currentTrack ? trackDisplayName(activeSource > 0 ? comparisons.slots[activeSource]?.name ?? currentTrack.name : currentTrack.name) : "",
    album: currentTrack?.sourceLabel ?? "",
    isPlaying,
    duration: timelineDuration,
    position: isPlaying ? Math.floor(currentTime) : currentTime,
  }, {
    play: async () => { if (!playingRef.current) await togglePlay(); },
    pause: pausePlayback,
    next: async () => { if (!timingTrackId) await nextTrack(false); },
    previous: async () => { if (!timingTrackId) await previousTrack(); },
    seek: seekTo,
    getTime: getTimelineTime,
    onError: () => setMessage("System playback control failed. Try playing again from Vibloom."),
  });

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
    patchSession({ cacheEnabled: true });
    await platform.storage.requestPersistence().catch(() => false);
    let completed = 0;
    try {
      const available = tracksRef.current.filter(track => runtimeFilesRef.current.has(track.id) && track.persistence !== "cached");
      for (const track of available) {
        await platform.audioFiles.put(track.id, runtimeFilesRef.current.get(track.id)!);
        patchTracks(current => current.map(candidate => candidate.id === track.id ? { ...candidate, persistence: "cached", availability: "available" } : candidate));
        setCacheProgress(Math.round(++completed / Math.max(available.length, 1) * 100));
      }
      completed += await comparisons.cacheFiles();
      setMessage(`${completed} tracks kept on this device. Automatic caching is on.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not cache audio."); }
    finally { setCacheProgress(0); await refreshStorageState(); }
  }

  async function clearAudioCache() {
    cancelTransforms();
    await comparisons.preserveCachedFiles();
    await platform.audioFiles.clear();
    patchTracks(current => current.map(track => ({ ...track, persistence: "indexed", availability: runtimeFilesRef.current.has(track.id) ? "session" : "reconnect" })));
    comparisons.updateCacheStatus(false);
    patchSession({ cacheEnabled: false });
    await refreshStorageState(); setStorageOpen(false); setConfirmAction(null);
    setMessage("Cached audio cleared. Playlists and lyrics were kept.");
  }

  async function toggleTrackCache(track: LibraryTrack) {
    try {
      if (track.persistence === "cached") {
        cancelTransforms();
        await comparisons.preserveCachedFiles(track.id);
        await platform.audioFiles.remove(track.id);
        for (const item of comparisonsOf(track)) await platform.audioFiles.remove(comparisonCacheKey(track.id, item));
        patchTracks(current => current.map(candidate => candidate.id === track.id ? { ...candidate, persistence: "indexed", availability: runtimeFilesRef.current.has(track.id) ? "session" : "reconnect" } : candidate));
        comparisons.updateCacheStatus(false, track.id);
        setMessage("Cached audio removed; library entries remain.");
      } else {
        const file = runtimeFilesRef.current.get(track.id);
        if (!file) { setMessage("Reconnect this track before keeping it on the device."); return; }
        await platform.audioFiles.put(track.id, file);
        patchTracks(current => current.map(candidate => candidate.id === track.id ? { ...candidate, persistence: "cached", availability: "available" } : candidate));
        await comparisons.cacheFiles(track.id);
        setMessage("Track and connected versions kept on this device.");
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not update cached audio."); }
    finally { setMenuTrackId(""); await refreshStorageState(); }
  }

  function releaseLoadedAudio() {
    setProcessingDialog(null);
    setProcessingError("");
    resetComparisons();
    primaryLoadVersionRef.current += 1;
    loadedTrackIdRef.current = "";
    preloadingTrackIdRef.current = "";
    playingRef.current = false;
    audioEngine.stop();
    audioEngine.setBuffer(0, null);
    audioEngine.setOffset(0);
    audioEngine.selectSourceImmediately(0);
    setIsPlaying(false);
    setActiveSource(0);
    setPrimaryLoad({ stage: "idle", progress: 0 });
    setPrimaryPeaks([]);
  }

  function clearQueue() {
    cancelTransforms();
    releaseLoadedAudio();
    patchSession({ queue: [], history: [], currentTrackId: "", currentTime: 0 });
    setCurrentTime(0);
    setDuration(0);
    setConfirmAction(null);
    setQueueOpen(false);
    setMessage("Queue cleared. Your library and cached audio remain.");
  }

  async function resetLibrary() {
    cancelTransforms();
    vocalJobs.reset();
    comparisons.clearFiles();
    setSingingKeys(new Set());
    releaseLoadedAudio();
    await platform.audioFiles.clear();
    await platform.repository.reset();
    runtimeFilesRef.current.clear();
    tracksRef.current = [];
    setTracks([]);
    setAlbums([]);
    setBrowsingAlbums(false);
    setActiveAlbumId("");
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
    setMessage("Comparison console ready. Add a version while the original keeps playing.");
  }

  async function loadComparisonFile(file: File, target = compareTargetRef.current) {
    if (!(file.type.startsWith("audio/") || SUPPORTED_AUDIO.test(file.name)) || file.size > MAX_FILE_BYTES) { setMessage("Choose a supported audio file smaller than 300 MB."); return; }
    await comparisons.importFile(file, target);
    await refreshStorageState();
  }
  function pickComparison(target = comparisons.nextTarget()) {
    if (target === null) { setMessage("All nine tracks are occupied. Replace or remove a version to add another."); return; }
    compareTargetRef.current = target; compareInputRef.current?.click();
  }
  function handleComparisonDrop(event: DragEvent<HTMLElement>, target = comparisons.nextTarget()) {
    event.preventDefault();
    if (target === null) { setMessage("All nine tracks are occupied."); return; }
    const file = Array.from(event.dataTransfer.files).find(candidate => candidate.type.startsWith("audio/") || SUPPORTED_AUDIO.test(candidate.name));
    if (file) void loadComparisonFile(file, target);
  }
  function switchSource(source: number) { soundPreview.end(); void comparisons.select(source); }
  function openProcessing(source: number, kind: TransformKind) {
    soundPreview.end();
    setProcessingError(""); setProcessingTarget(comparisons.jobs[source]?.target ?? comparisons.nextTarget(source) ?? (source === 1 ? 2 : 1));
    setProcessingDialog({ source, kind: comparisons.jobs[source]?.kind ?? kind, identity: `${currentTrack?.id}:${source === 0 ? currentTrack?.fingerprint : comparisons.record(source)?.id}` });
  }
  async function applyProcessing() {
    const dialog = processingDialog; if (!dialog) return;
    setProcessingError(""); soundPreview.end();
    try {
      await comparisons.process(dialog.source, processingTarget, dialog.kind, dialog.kind === "eq" ? soundSettings.presetId : remasterPreset, dialog.kind === "eq" ? soundSettings : undefined);
      setProcessingDialog(current => current === dialog ? null : current);
      await refreshStorageState();
    } catch (error) { if (error instanceof Error && error.name !== "AbortError") setProcessingError(error.message); }
  }
  function prepareVocals(source: number) {
    const root = readRoot(); if (!root) return;
    const key = vocalJobKey(root, source), item = comparisons.record(source);
    const job = jobsSnapshot[key];
    if (job?.status === "queued" || job?.status === "working") { vocalJobs.cancel(key); return; }
    const analysis = job?.analysis ?? (source === 0 ? root.vocalAnalysis : item?.vocalAnalysis);
    const sourceDuration = source === 0 ? primaryDuration : item?.duration ?? 0;
    if (isCurrentVocalAnalysis(analysis, sourceDuration)) {
      setSingingKeys(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; }); return;
    }
    vocalJobs.prepare(key, () => { if (readRoot()?.id !== root.id || source > 0 && comparisons.record(source)?.id !== item?.id) throw new DOMException("Source changed", "AbortError"); return comparisons.ensureBuffer(source); }, result => {
      patchTracks(current => current.map(track => {
        if (track.id !== root.id || track.fingerprint !== root.fingerprint) return track;
        if (source === 0) return { ...track, vocalAnalysis: result };
        return withComparisons(track, comparisonsOf(track).map(version => version.id === item?.id ? { ...version, vocalAnalysis: result } : version));
      }));
      setSingingKeys(current => new Set(current).add(key));
    });
  }
  function cardTools(source: number, ready: boolean) {
    const key = currentTrack ? vocalJobKey(currentTrack, source) : "", job = jobsSnapshot[key], transform = comparisons.jobs[source];
    const analysis = job?.analysis ?? (source === 0 ? currentTrack?.vocalAnalysis : comparisons.record(source)?.vocalAnalysis);
    const vocalsReady = isCurrentVocalAnalysis(analysis, source === 0 ? primaryDuration : comparisons.slots[source]?.duration ?? 0);
    const vocalsBusy = job?.status === "working" || job?.status === "queued";
    return <span className="card-processing-tools">
      <ToolButton aria-label={`EQ track ${source + 1}`} title="EQ & mastering · Preview and shape this track" className={transform?.kind === "eq" ? "is-working" : ""} disabled={comparisons.clearing || !ready && !transform} onClick={() => openProcessing(source, "eq")}><SlidersHorizontal size={14} /></ToolButton>
      <ToolButton aria-label={`Audio repair track ${source + 1}`} title="Audio repair · Clean shimmer, noise and resonance" className={transform?.kind === "remaster" ? "is-working" : ""} disabled={comparisons.clearing || !ready && !transform} onClick={() => openProcessing(source, "remaster")}><WandSparkles size={14} /></ToolButton>
      <ToolButton data-vocal-track={source + 1} data-vocal-status={vocalsBusy ? "working" : vocalsReady ? "ready" : job?.status ?? "idle"} aria-label={`${vocalsBusy ? "Cancel vocals" : vocalsReady ? singingKeys.has(key) ? "Disable singing" : "Enable singing" : "Prepare vocals"} track ${source + 1}`} title={job?.status === "error" ? job.error : vocalsBusy ? `${job.phase} · Click to cancel` : vocalsReady ? singingKeys.has(key) ? "Vocal lip sync · Disable singing" : "Vocal lip sync · Enable singing" : "Vocal lip sync · Prepare vocals (first download: 172 MiB)"} disabled={source > 0 && comparisons.clearing || !ready && !vocalsBusy} aria-pressed={vocalsReady ? singingKeys.has(key) : undefined} className={vocalsBusy ? "is-working" : singingKeys.has(key) ? "is-enabled" : ""} onClick={() => prepareVocals(source)}><MicVocal size={14} /></ToolButton>
    </span>;
  }
  function cardProgress(source: number) {
    const transform = Object.values(comparisons.jobs).find(job => job.source === source);
    const vocals = currentTrack ? jobsSnapshot[vocalJobKey(currentTrack, source)] : undefined;
    const vocalBusy = vocals?.status === "working" || vocals?.status === "queued";
    const progress = vocalBusy && (!transform || transform.progress === 0) ? vocals : transform;
    return progress ? <CardProgress progress={progress.progress} label={`Track ${source + 1}: ${progress.phase}`} /> : null;
  }
  function cardVocalStatus(source: number) {
    const job = currentTrack ? jobsSnapshot[vocalJobKey(currentTrack, source)] : undefined;
    if (!job || job.status === "idle" || job.status === "ready") return null;
    return <span className={`card-vocal-status is-${job.status}`} role="status" title={job.error ?? job.phase}>{job.status === "error" ? job.error : `${job.phase} · ${Math.round(job.progress * 100)}%`}</span>;
  }

  useEffect(() => {
    audioEngine.setVolume(session.volume);
  }, [audioEngine, session.volume]);

  usePlaybackTitle(currentTrack?.name ?? "", isPlaying, tracks.length);

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
      if (event.defaultPrevented || timingTrackId || target?.closest("input, textarea, select, [contenteditable='true']")) return;
      const key = event.key.toLowerCase();
      if (target?.closest("dialog") && !(audioEngine.previewSource !== null && /^[1-9]$/.test(key))) return;
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
      } else if (/^[1-9]$/.test(key) && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault(); shortcutSwitchSourceRef.current(Number(key) - 1);
      } else if (key === "arrowleft" || key === "arrowright") {
        event.preventDefault();
        void seekTo(getTimelineTime() + (key === "arrowleft" ? -5 : 5));
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [getTimelineTime, seekTo, setFocusWithTransition, toggleFocusMode, timingTrackId]);

  const changeTimedLyrics = useCallback((lyricTiming: LyricTimingLine[]) => {
    patchTracks((current) => current.map((track) => track.id === timingTrackId ? { ...track, lyricTiming } : track));
  }, [timingTrackId, patchTracks]);
  const closeTimingEditor = useCallback(() => setTimingTrackId(""), []);
  const toggleTimingPlayback = useCallback(() => { void shortcutTogglePlayRef.current(); }, []);

  const albumCollections = <AlbumCollections albums={albums} tracks={tracks} activeId={activeAlbumId} browsing={browsingAlbums} onBrowse={setBrowsingAlbums}
    onSelect={(id) => { setActiveAlbumId(id); setMenuTrackId(""); }}
    onSave={(album) => { setAlbums((current) => current.some((candidate) => candidate.id === album.id) ? current.map((candidate) => candidate.id === album.id ? album : candidate) : [...current, album]); setActiveAlbumId(album.id); setBrowsingAlbums(false); }}
    onDelete={(id) => { setAlbums((current) => current.filter((album) => album.id !== id)); if (activeAlbumId === id) { setActiveAlbumId(""); setBrowsingAlbums(true); } setMessage("Album deleted. Your songs remain in the library."); }}
    onAddTrack={addTrackToAlbum} onFilesDrop={(event, id) => void handleDrop(event, id)} />;

  return (
    <main data-companion={session.companionId} className={`library-app ${tracks.length ? "has-library" : "is-empty"} ${focusMode ? "is-library-focus" : ""}`}>
      <div className="scene-curtain" aria-hidden="true">
        <span className="scene-curtain-disc" />
        <span className="scene-curtain-line scene-curtain-line-one" />
        <span className="scene-curtain-line scene-curtain-line-two" />
        <span className="scene-curtain-copy scene-curtain-copy-enter"><small>Listening room</small><strong><span>The room is</span><em>listening.</em></strong><i>Your library and companion are ready</i></span>
        <span className="scene-curtain-copy scene-curtain-copy-workspace-player"><small>Playback room</small><strong><span>Back to the</span><em>music.</em></strong><i>Controls and companion ready</i></span>
        <span className="scene-curtain-copy scene-curtain-copy-workspace-library"><small>Your collection</small><strong><span>Open the</span><em>library.</em></strong><i>Queue, lyrics and local tracks</i></span>
        <span className="scene-curtain-copy scene-curtain-copy-focus-enter"><small>Focus mode</small><strong><span>The noise</span><em>falls away.</em></strong><i>One track · One room · One moment</i></span>
        <span className="scene-curtain-copy scene-curtain-copy-focus-exit"><small>Full room</small><strong><span>The session</span><em>returns.</em></strong><i>Controls and comparison restored</i></span>
      </div>
      <input ref={filesInputRef} type="file" accept="audio/*,.flac,.aiff,.aif,.lrc,.txt" multiple hidden onChange={handleFilesInput} />
      <input ref={folderInputRef} type="file" accept="audio/*,.flac,.aiff,.aif,.lrc,.txt" multiple hidden onChange={handleFilesInput} />
      <input ref={compareInputRef} type="file" accept="audio/*,.flac,.aiff,.aif" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void loadComparisonFile(file); event.target.value = ""; }} />
      <input ref={lyricsInputRef} type="file" accept=".lrc,.txt,text/plain" hidden onChange={(event) => void handleLyricsInput(event)} />
      {focusMode && <button className="focus-exit-control" type="button" aria-label="Exit focus mode (F or Escape)" onClick={() => setFocusWithTransition(false)}><Minimize2 size={15} /><span>Exit focus</span><kbd>Esc</kbd></button>}

      <header className="library-header">
        <button className="mobile-nav-button" type="button" aria-label="Open library navigation" onClick={() => setLibraryOpen(true)}><Menu size={20} /></button>
        <div className="brand">
          <a className="brand-home" href="#library-top" aria-label="Vibloom home">
            <span className="brand-mark"><BrandMark /></span>
            <span className="brand-copy"><strong>Vibloom</strong><small>Local listening room</small></span>
          </a>
          <UpdateControl />
        </div>
        {tracks.length > 0 && <div className="library-header-status"><span>{tracks.length} tracks</span><strong>{currentTrack ? trackDisplayName(currentTrack.name) : "Library ready"}</strong></div>}
        <div className="library-header-actions">
          <label className="companion-selector">
            <span>Companion</span>
            <StyledSelect label="Music companion" value={session.companionId} disabled={!restored} onChange={value => patchSession({ companionId: value as CompanionId })} options={Object.entries(COMPANIONS).map(([id, model]) => ({ value: id, label: model.name }))}/>
          </label>
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
          onDragEnter={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDragging(true); } }}
          onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } }}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
          onDrop={handleDrop}
        >
          <div className="library-welcome-copy">
            <p className="eyebrow"><Headphones size={15} /> Your private local music library</p>
            <h1>Bring a folder.<br /><em>Let it bloom.</em></h1>
            <p>Build a queue from your own music, keep lyrics in sync, and let your companion stay with every track. Nothing is uploaded.</p>
            <div className="welcome-import-surface">
              <button className="welcome-import-primary" type="button" onClick={() => setImportOpen((value) => !value)}><Upload size={18} /><span><strong>Import your music</strong><small>Files, albums, lyrics, or a complete folder</small></span><ChevronDown size={16} /></button>
              {importOpen && <div className="welcome-import-menu"><button type="button" onClick={() => openFiles()}><FileAudio size={17} /><span><strong>Choose files</strong><small>Audio, LRC, and TXT lyric files</small></span></button><button type="button" onClick={() => openFolder()}><FolderOpen size={17} /><span><strong>Choose a folder</strong><small>Preserve album order and matching lyrics</small></span></button></div>}
              <p>Drop files here anytime · everything stays on this device</p>
            </div>
          </div>
          <div className="library-welcome-stage">
            <Live2DStage companionId={session.companionId} featuresRef={audioVisualRef} vocalLevelRef={vocalLevelRef} variant="welcome" trackLabel="Waiting for your library" activeSource={0} isComparing={false} isPlaying={false} focusMode={false} />
          </div>
        </section>
      ) : (
        <div className={`unified-shell ${workspace === "player" ? `is-player-shell ${comparisonExpanded ? "has-version-b" : "is-solo-player"}` : "is-library-shell"}`} id="library-top">
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
              <div className={`comparison-deck ${comparisonExpanded ? "has-version-b" : "is-solo"}`}>
                <div className="version-a-zone">
                  <article className={`waveform-card version-a ${activeSource === 0 ? "is-active" : ""}`} data-track-number="1">
                    <div className="waveform-card-heading"><button className="source-selector" type="button" aria-label="Listen to track 1" onClick={() => switchSource(0)} aria-pressed={activeSource === 0}>1</button><div><small>ORIGINAL</small><strong>{currentTrack ? trackDisplayName(currentTrack.name) : "Choose a track"}</strong></div><span className="waveform-card-tools">{formatTime(primaryDuration)}</span></div>
                    <PrecisionWaveform peaks={primaryPeaks} currentTime={currentTime} duration={primaryDuration} label="Track 1" source={0} onSeek={time => { void seekTo(time); }} onScrubStart={beginWaveformScrub} onScrub={previewWaveformSeek} onScrubEnd={time => { void finishWaveformScrub(time); }} />
                    <div className="waveform-card-foot">{cardTools(0, !!currentTrack && primaryLoad.stage === "idle" && !!primaryPeaks.length)}{cardVocalStatus(0)}<span className={currentTrack && ["working", "queued", "error"].includes(jobsSnapshot[vocalJobKey(currentTrack)]?.status ?? "") ? "is-job-hidden" : ""}>{primaryLoad.stage !== "idle" ? "LOADING AUDIO" : comparisons.jobs[0] ? `${comparisons.jobs[0].phase} · ${Math.round(comparisons.jobs[0].progress * 100)}%` : activeSource === 0 && isPlaying ? "AUDIBLE" : "ORIGINAL · UNCHANGED"}</span></div>
                    {cardProgress(0)}
                  </article>
                  {!comparisonVisible && <aside className="solo-track-context" aria-label="Solo track details"><span>SOLO MASTER</span><strong>{formatTime(Math.max(0, primaryDuration - currentTime))}</strong><small>remaining</small><i /><p>Drag the waveform<br />to seek</p></aside>}
                </div>
                <div className="center-stage-reserve" aria-hidden="true" />
                <div className={`comparison-versions ${comparisonSlots.length > 1 ? "has-multiple-tracks" : ""} ${comparisonSlots.length >= 6 ? "has-many-tracks" : ""}`} aria-label="Comparison tracks">
                  {comparisonVisible && <div className="comparison-stack-actions"><span>{comparisonSlots.length + 1} / 9 tracks</span><ToolButton aria-label="Clear all comparisons" title="Clear comparisons · Remove tracks 2–9 and their local audio" disabled={comparisons.clearing} onClick={() => { soundPreview.end(); setProcessingDialog(null); void comparisons.clearAll(); }}><Trash2 size={12} />{comparisons.clearing ? "Clearing…" : "Clear"}</ToolButton></div>}
                  {comparisonSlots.map(slot => {
                    const expanded = comparisonSlots.length === 1 || expandedComparison === slot.slot;
                    return <article key={slot.id} data-track-number={slot.slot + 1} data-expanded={expanded} className={`waveform-card version-b ${activeSource === slot.slot ? "is-active" : ""} ${expanded ? "is-expanded" : "is-compact"} is-${slot.status}`} onClick={event => { if (!expanded && slot.status === "ready" && !(event.target as Element).closest("button, summary, details, input")) switchSource(slot.slot); }} onDragOver={event => event.preventDefault()} onDrop={event => handleComparisonDrop(event, slot.slot)}>
                    <div className="waveform-card-heading"><button className="source-selector" type="button" aria-label={`Listen to track ${slot.slot + 1}`} disabled={comparisons.clearing || slot.status === "reconnect" || slot.status === "error" || Object.values(comparisons.jobs).some(job => job.target === slot.slot)} onClick={() => switchSource(slot.slot)} aria-pressed={activeSource === slot.slot} aria-expanded={expanded}>{slot.slot + 1}</button><div><small title={slot.source ? `From track ${slot.source.number} · ${slot.source.name}` : "Imported comparison"}>{slot.mastering?.settings.mode === "mastering" ? "EQ + MASTERING" : slot.eq ? `EQ · ${EQ_PRESETS.find(preset => preset.id === slot.eq?.presetId)?.name ?? "Custom"}` : slot.remaster ? `AUDIO REPAIR · ${REPAIR_PRESETS.find(preset => preset.id === slot.remaster?.presetId)?.name}` : "COMPARISON"}{slot.source && ` · FROM ${slot.source.number}`}</small><strong title={slot.name}>{!expanded && cardVocalStatus(slot.slot) || trackDisplayName(slot.name)}</strong></div><ComparisonActions number={slot.slot + 1} ready={slot.status === "ready"} onDownload={() => void comparisons.download(slot.slot)} onReplace={() => pickComparison(slot.slot)} onRemove={() => void comparisons.remove(slot.slot)} /></div>
                    <ComparisonCardBody expanded={expanded}>
                    <PrecisionWaveform peaks={slot.peaks ?? []} currentTime={expanded ? currentTime : 0} duration={slot.duration} label={`Track ${slot.slot + 1}`} source={slot.slot} onSeek={time => { void seekTo(time); }} onScrubStart={beginWaveformScrub} onScrub={previewWaveformSeek} onScrubEnd={time => { void finishWaveformScrub(time); }} />
                    {Math.abs(primaryDuration - slot.duration) > .05 && <div className="comparison-duration-alert"><strong>Different lengths</strong><span>Shared timeline: {formatTime(timelineDuration, true)}</span></div>}
                    </ComparisonCardBody>
                    <div className="waveform-card-foot">{cardTools(slot.slot, slot.status === "ready")}{cardVocalStatus(slot.slot)}<span className={currentTrack && ["working", "queued", "error"].includes(jobsSnapshot[vocalJobKey(currentTrack, slot.slot)]?.status ?? "") ? "is-job-hidden" : ""} title={slot.error}>{slot.status === "loading" ? `LOADING · ${Math.round(slot.loadProgress)}%` : slot.status === "reconnect" || slot.status === "error" ? <button type="button" className="reconnect-version" onClick={() => pickComparison(slot.slot)}>Reconnect audio</button> : comparisons.jobs[slot.slot] ? `${comparisons.jobs[slot.slot].phase} · ${Math.round(comparisons.jobs[slot.slot].progress * 100)}%` : `${formatTime(slot.duration)} · ${activeSource === slot.slot && isPlaying ? "AUDIBLE" : "READY"}`}</span></div>
                    {cardProgress(slot.slot)}
                  </article>;
                  })}
                  {comparisonSlots.length < 8 && <div className="quiet-compare-entry" onDragOver={event => event.preventDefault()} onDrop={event => handleComparisonDrop(event)}><span>{comparisonVisible ? `${comparisonSlots.length + 1} / 9 tracks` : "Compare another mix?"}</span><button type="button" aria-label="Add comparison track" disabled={!currentTrack || comparisons.nextTarget() === null} onClick={() => pickComparison()}><Plus size={15} /> Add track</button><small>{comparisonVisible ? "Switch instantly with keys 1–9." : "Choose a file, or create a version from track 1."}</small></div>}
                </div>
              </div>
              <div className="console-footer">
                {activeSourceEnded && <div className="comparison-status-lane" aria-live="polite">
                  <div className="comparison-ended-alert">Track {activeSource + 1} ended at {formatTime(activeDuration, true)}. Switch source to hear the remaining audio.</div>
                </div>}
                <div className="console-lower"><LyricsPanel timing={currentTrack?.lyricTiming} onTiming={() => { if (currentTrack) void openTimingEditor(currentTrack.id); }} lines={currentTrack?.lyrics ?? []} currentTime={currentTime} fileName={currentTrack?.lyricsFileName ?? ""} activeSource={activeSource} onAttachLyrics={() => { if (currentTrack) openLyricsPicker(currentTrack.id); }} onRemoveLyrics={() => { if (currentTrack) removeTrackLyrics(currentTrack.id); }} /><button className="open-library-button" type="button" onClick={() => changeWorkspace("library")}><Library size={16} /> Browse {tracks.length} tracks</button></div>
              </div>
            </div>
          ) : (
          <div className="library-list-panel">
            {unavailableCount > 0 && <div className="library-reconnect-banner"><FolderOpen size={17} /><span><strong>Some music needs to be reconnected.</strong><small>Your playlists and order are still here.</small></span><button type="button" onClick={() => openFolder(true)}>Reconnect folder</button></div>}
            <div className={`library-list-heading ${activeAlbum ? "library-album-heading" : ""}`}>
              {activeAlbum && <span className="library-album-heading-cover">{activeAlbum.cover ? <img src={activeAlbum.cover} alt={`${activeAlbum.name} cover`} draggable={false} /> : <Music2 size={34} strokeWidth={1.2} />}</span>}
              <div>{activeAlbum ? <><button type="button" className="album-back" onClick={() => { setActiveAlbumId(""); setBrowsingAlbums(true); }}><ChevronLeft size={12} /> Back to albums</button><h1>{activeAlbum.name}</h1><span>{filteredTracks.length} tracks · Drag rows to reorder</span></> : <><p>{browsingAlbums ? "GROUPED COLLECTIONS" : "LOCAL LIBRARY"}</p><h1>{browsingAlbums ? <>Virtual <em>albums.</em></> : <>Collected <em>manuscripts.</em></>}</h1><span>{browsingAlbums ? `${albums.length} collections · ${tracks.length} tracks` : `${filteredTracks.length} of ${tracks.length} tracks`}</span></>}</div>
              <div className="import-menu-wrap">
                <button className="library-import-button" type="button" onClick={() => setImportOpen((value) => !value)}><Plus size={17} /><span>Import</span><ChevronDown size={14} /></button>
                {importOpen && <div className="import-popover"><button type="button" onClick={() => openFiles()}><FileAudio size={16} /> Add files</button><button type="button" onClick={() => openFolder()}><FolderOpen size={16} /> Add folder</button></div>}
              </div>
            </div>
            {albumCollections}
            {!browsingAlbums && <>
            <div className="library-list-toolbar">
              <div><button type="button" onClick={() => void playAll(false)}><Play size={16} fill="currentColor" /> Play all</button><button type="button" onClick={() => void playAll(true)}><Shuffle size={16} /> Shuffle</button></div>
              <label><Search size={15} /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search your library" /></label>
            </div>
            <div className="library-vocal-toolbar">
              {vocalSelectionMode ? <><label><input type="checkbox" aria-label="Select all visible songs for vocal preparation" checked={filteredTracks.length > 0 && filteredTracks.every((track) => selectedVocalTracks.includes(track.id))} onChange={(event) => setSelectedVocalTracks(event.target.checked ? filteredTracks.map((track) => track.id) : [])} /> Select songs</label>
              <button type="button" disabled={!selectedVocalTracks.length} onClick={() => { libraryVocals.prepare(tracks.filter((track) => selectedVocalTracks.includes(track.id))); setSelectedVocalTracks([]); setVocalSelectionMode(false); }}>Prepare vocal lip sync{selectedVocalTracks.length ? ` (${selectedVocalTracks.length})` : ""}</button>
              <button type="button" onClick={() => { setVocalSelectionMode(false); setSelectedVocalTracks([]); }}>Cancel selection</button></> : <button type="button" onClick={() => setVocalSelectionMode(true)}>Prepare lip sync</button>}<small>Processes in the background · keep listening</small>
            </div>
            <FileDropRegion albumName={activeAlbum?.name} onFilesDrop={(event) => void handleDrop(event)}>
            <div className="track-table" role="table" aria-label="Local music library">
              <div className="track-row track-table-header" role="row"><span>#</span><span>Track</span><span>Status</span><span>Time</span><span /></div>
              {filteredTracks.map((track, index) => {
                const jobKey = vocalJobKey(track);
                const vocalJob = libraryVocals.jobs[jobKey];
                const active = track.id === session.currentTrackId;
                const unavailable = track.availability === "reconnect" || track.availability === "missing";
                return (
                  <div className={`track-row ${active ? "is-active" : ""} ${unavailable ? "is-unavailable" : ""} ${albumDrag === track.id ? "is-album-dragging" : ""} ${albumDrop?.id === track.id ? `album-drop-${albumDrop.edge}` : ""}`} role="row" key={track.id} data-track-id={track.id} draggable
                    onDragStart={(event) => { event.dataTransfer.setData(TRACK_DRAG_TYPE, track.id); event.dataTransfer.effectAllowed = "all"; albumDragRef.current = activeAlbum ? { albumId: activeAlbum.id, trackId: track.id } : null; if (activeAlbum) { setAlbumDrag(track.id); setMenuTrackId(""); } }}
                    onDragOver={(event) => previewAlbumDrop(event, track.id)}
                    onDrop={(event) => dropAlbumTrack(event, track.id)}
                    onDoubleClick={() => void playLibraryTrack(track.id)}>
                    <button className="track-index" type="button" aria-label={`Play ${trackDisplayName(track.name)}`} title={activeAlbum ? "Drag row to reorder · Click to play" : undefined} onClick={() => void playLibraryTrack(track.id)}>{active && isPlaying ? <AudioLines size={14} /> : String(index + 1).padStart(2, "0")}{activeAlbum && <GripVertical className="album-drag-grip" size={14} aria-hidden="true" />}</button>
                    <span className="track-title"><label className="vocal-track-select">{vocalSelectionMode && <input type="checkbox" checked={selectedVocalTracks.includes(track.id)} aria-label={`Select ${trackDisplayName(track.name)} for vocal preparation`} onDoubleClick={(event) => event.stopPropagation()} onChange={(event) => setSelectedVocalTracks((ids) => event.target.checked ? [...ids, track.id] : ids.filter((id) => id !== track.id))} />}<strong>{trackDisplayName(track.name)}</strong></label><small title={track.name}>{track.sourceLabel} · {track.name}</small></span>
                    <span className="track-states">
                      <span className={`track-availability availability-${track.availability} ${track.persistence === "cached" ? "is-cached" : ""}`}>{track.persistence === "cached" ? "On device" : track.availability === "available" ? "Available" : track.availability === "session" ? "This session" : track.availability === "missing" ? "Missing" : "Reconnect"}</span>
                      {((vocalJob && vocalJob.status !== "idle") || track.vocalAnalysis) && <span className="track-vocal-job" role="status">
                        {vocalJob?.status === "working" || vocalJob?.status === "queued" ? <><span>{vocalJob.phase} · {Math.round(vocalJob.progress * 100)}%</span><progress aria-label={`Vocal preparation for ${trackDisplayName(track.name)}`} max={1} value={vocalJob.progress} /><button type="button" aria-label={`Cancel vocal preparation for ${trackDisplayName(track.name)}`} onClick={() => libraryVocals.cancel(jobKey)}>Cancel</button></> : vocalJob?.status === "error" ? <><span>{vocalJob.error}</span><button type="button" onClick={() => libraryVocals.prepare([track])}>Retry</button></> : track.vocalAnalysis?.version === 4 || vocalJob?.status === "ready" ? "Vocals ready" : "Reprepare lip sync"}
                      </span>}
                      <span className="track-feature-icons">
                        {(track.lyrics.length > 0 || !!track.lyricTiming?.length) && <span className="has-lyrics" role="img" aria-label={track.lyrics.length ? "Synced lyrics attached" : "TXT lyrics attached"} title={track.lyrics.length ? "Synced lyrics attached" : "TXT lyrics attached"}><FileText size={13} /></span>}
                        {comparisonsOf(track).length > 0 && <span className={`has-version-b comparison-${comparisonsOf(track)[0].availability}`} role="img" aria-label={`${comparisonsOf(track).length} comparison tracks attached`} title={`${comparisonsOf(track).length} comparison versions`}><ArrowLeftRight size={13} /></span>}
                      </span>
                    </span>
                    <span className="track-duration">{track.duration ? formatTime(track.duration) : "—"}</span>
                    <span className="track-menu-wrap"><button type="button" aria-label={`Actions for ${trackDisplayName(track.name)}`} onClick={() => setMenuTrackId(menuTrackId === track.id ? "" : track.id)}><MoreHorizontal size={18} /></button>
                      {menuTrackId === track.id && <span className="track-popover">
                        {!!albums.length && <label className="track-album-select">Add to album<StyledSelect label={`Add ${trackDisplayName(track.name)} to album`} value="" onChange={value => { if (value) addTrackToAlbum(value, track.id); }} options={[{ value: "", label: "Choose album…", disabled: true }, ...albums.map(album => ({ value: album.id, label: album.name }))]}/></label>}
                        {activeAlbumId && <button type="button" onClick={() => { setAlbums((current) => current.map((album) => album.id === activeAlbumId ? { ...album, trackIds: album.trackIds.filter((id) => id !== track.id) } : album)); setMenuTrackId(""); }}>Remove from album</button>}
                        {activeAlbum && ["before", "after"].map(edge => {
                          const position = activeAlbum.trackIds.indexOf(track.id), targetId = activeAlbum.trackIds[position + (edge === "before" ? -1 : 1)];
                          return <button key={edge} type="button" disabled={!targetId} onClick={() => { setAlbums(current => current.map(album => album.id === activeAlbum.id ? reorderAlbumTrack(album, track.id, targetId, edge as "before" | "after") : album)); setMenuTrackId(""); setMessage("Album order saved."); }}>{edge === "before" ? "Move up in album" : "Move down in album"}</button>;
                        })}
                        <button type="button" onClick={() => { libraryVocals.prepare([track]); setMenuTrackId(""); }}>Prepare vocal lip sync</button><button type="button" onClick={() => addPlayNext(track.id)}>Play next</button><button type="button" onClick={() => appendQueue(track.id)}>Add to queue</button><button type="button" onClick={() => openLyricsPicker(track.id)}>{(track.lyrics.length || track.lyricTiming?.length) ? "Replace lyrics (.lrc / .txt)" : "Attach lyrics (.lrc / .txt)"}</button>{(track.lyrics.length > 0 || !!track.lyricTiming?.length) && <button type="button" onClick={() => removeTrackLyrics(track.id)}>Remove lyrics</button>}{(track.lyrics.length > 0 || track.lyricTiming !== undefined) && <button type="button" onClick={() => void openTimingEditor(track.id)}>{track.lyrics.length ? "Edit timing" : "Timestamp lyrics"}</button>}<button type="button" onClick={() => void toggleTrackCache(track)}>{track.persistence === "cached" ? "Remove cached copy" : "Keep on this device"}</button><button type="button" onClick={() => openComparison(track.id)}>Open in player / compare</button></span>}
                    </span>
                  </div>
                );
              })}
              {!filteredTracks.length && <p className="library-empty-results">{search ? "No songs match your search." : "This album is empty. Drop music here, or use Edit album to choose songs from your library."}</p>}
            </div>
            </FileDropRegion>
            </>}
          </div>
          )}
          </section>

          <aside className="persistent-stage-panel">
            {focusMode && currentTrack && (currentTrack.lyrics.length || currentTrack.lyricTiming?.length) ? <LyricsPanel timing={currentTrack.lyricTiming} onTiming={() => void openTimingEditor(currentTrack.id)} lines={currentTrack.lyrics} currentTime={currentTime} fileName={currentTrack.lyricsFileName} activeSource={activeSource} variant="focus" onAttachLyrics={() => openLyricsPicker(currentTrack.id)} onRemoveLyrics={() => removeTrackLyrics(currentTrack.id)} /> : null}
            <div className="persistent-stage-canvas"><Live2DStage companionId={session.companionId} containModel layoutKey={`${workspace}:${focusMode ? "focus" : "room"}`} featuresRef={audioVisualRef} vocalLevelRef={vocalLevelRef} variant="player" trackLabel={currentTrack?.name ?? "Library ready"} activeSource={activeSource} isComparing={comparisonReady} isPlaying={isPlaying} focusMode={focusMode} /></div>
            <div className="stage-source-indicator"><span className={`is-active source-${activeSource === 0 ? "a" : "b"}`}>{activeSource + 1}</span><small>{comparisonReady ? `Listening to track ${activeSource + 1}` : "Solo playback"}</small></div>
          </aside>
        </div>
      )}

      {tracks.length > 0 && <footer className={`library-transport ${playbackAlbum?.cover ? "has-album-art" : ""}`}>
        <div className="transport-track"><span className={`transport-disc ${playbackAlbum?.cover ? "has-album-cover" : ""}`}>{playbackAlbum?.cover ? <img src={playbackAlbum.cover} alt={`${playbackAlbum.name} cover`} draggable={false} /> : <Music2 size={20} />}</span><span><strong>{currentTrack ? trackDisplayName(currentTrack.name) : "Nothing selected"}</strong><small>{currentTrack ? currentTrack.persistence === "cached" ? "Kept on this device" : currentTrack.sourceLabel : `${session.queue.length} tracks in queue`}</small></span></div>
        <div className="transport-center">
          <div className="transport-buttons"><button className={session.shuffle ? "is-active" : ""} type="button" aria-label="Shuffle" aria-pressed={session.shuffle} onClick={toggleShuffle}><Shuffle size={17} /></button><button type="button" aria-label="Back 5 seconds" onClick={() => void seekTo(currentTime - 5)}><Rewind size={18} /></button><button type="button" aria-label="Previous track" onClick={() => void previousTrack()}><SkipBack size={20} /></button><button className="transport-play" type="button" aria-label={isPlaying ? "Pause" : "Play"} onClick={() => void togglePlay()}>{isPlaying ? <Pause size={21} fill="currentColor" /> : <Play size={21} fill="currentColor" />}</button><button type="button" aria-label="Next track" onClick={() => void nextTrack(false)}><SkipForward size={20} /></button><button type="button" aria-label="Forward 5 seconds" onClick={() => void seekTo(currentTime + 5)}><FastForward size={18} /></button><button className={session.repeat !== "off" ? "is-active" : ""} type="button" aria-label={repeatLabel(session.repeat)} onClick={cycleRepeat}>{session.repeat === "one" ? <Repeat1 size={17} /> : <Repeat size={17} />}</button></div>
          <div className="transport-progress"><span>{formatTime(currentTime, comparisonReady)}</span><input aria-label="Playback position" type="range" min="0" max={Math.max(timelineDuration, 1)} step="0.001" value={Math.min(currentTime, Math.max(timelineDuration, 1))} onChange={(event) => void seekTo(Number(event.target.value))} /><span>{formatTime(timelineDuration, comparisonReady)}</span></div>
          {activeSourceEnded && <span className="transport-source-ended">Track {activeSource + 1} has ended · switch source</span>}
        </div>
        <div className="transport-secondary">{comparisonVisible && <TrackSelector key={currentTrack?.id} sources={[0, ...comparisonSlots.map(slot => slot.slot)]} active={activeSource} comparison={expandedComparison} names={Object.fromEntries([[0, "Original"], ...comparisonSlots.map(slot => [slot.slot, trackDisplayName(slot.name)])])} onSelect={switchSource} unavailable={[...comparisonSlots.filter(slot => comparisons.clearing || slot.status !== "ready").map(slot => slot.slot), ...Object.values(comparisons.jobs).map(job => job.target)]} />}<label><Volume2 size={17} /><input aria-label="Volume" type="range" min="0" max="1" step="0.01" value={session.volume} onChange={(event) => patchSession({ volume: Number(event.target.value) })} /></label><button type="button" className={queueOpen ? "is-active" : ""} onClick={() => setQueueOpen(true)}><ListMusic size={18} /><span>Queue</span></button></div>
      </footer>}

      {message && <div className="library-status" role="status">{message}</div>}

      {processingDialog && <ProcessingDialog kind={processingDialog.kind} source={processingDialog.source} trackName={trackDisplayName(processingDialog.source === 0 ? currentTrack?.name ?? "" : comparisons.slots[processingDialog.source]?.name ?? "")} duration={formatTime(processingDialog.source === 0 ? primaryDuration : comparisons.slots[processingDialog.source]?.duration ?? 0)} presetId={comparisons.jobs[processingDialog.source]?.presetId ?? (processingDialog.kind === "eq" ? soundSettings.presetId : remasterPreset)} progress={comparisons.jobs[processingDialog.source] ?? null} error={processingError} target={processingTarget} selectedSource={activeSource} slots={comparisonSlots} jobs={Object.values(comparisons.jobs)}
        isPlaying={isPlaying} onTogglePlayback={() => void togglePlay()} soundSettings={soundSettings} onSound={settings => { setSoundDrafts(current => ({ ...current, [processingDialog.identity]: settings })); setProcessingError(""); }} preview={soundPreview.preview} previewLoading={soundPreview.loading} previewStatus={soundPreview.status} previewRevision={soundPreview.appliedRevision} onPreview={() => void soundPreview.begin(processingDialog.source)} onBypass={soundPreview.bypass} canApply={primaryLoad.stage === "idle" && !!primaryPeaks.length} onTarget={setProcessingTarget} onPreset={id => { if (processingDialog.kind === "eq") setSoundDrafts(current => ({ ...current, [processingDialog.identity]: { ...soundSettings, presetId: id, gains: [...EQ_PRESETS.find(preset => preset.id === id)!.gains] } })); else setRepairDrafts(current => ({ ...current, [processingDialog.identity]: id })); setProcessingError(""); }} onApply={() => void applyProcessing()} onCancel={() => comparisons.cancel(processingDialog.source)} onDismiss={() => { soundPreview.end(); setProcessingDialog(null); }} />}

      {timingTrack?.lyricTiming && <LyricsTimingEditor key={timingTrack.id} name={trackDisplayName(timingTrack.name)} lines={timingTrack.lyricTiming} duration={timelineDuration} isPlaying={isPlaying} getTime={getTimelineTime}
        onChange={changeTimedLyrics}
        onScrubStart={beginWaveformScrub} onScrubEnd={finishWaveformScrub} onSeek={seekTo} onTogglePlay={toggleTimingPlayback} onSave={saveTimedLyrics} onClose={closeTimingEditor} />}
      {(importing || importSummary) && <div className="modal-backdrop"><section className="import-summary" role="dialog" aria-modal="true" aria-labelledby="import-title"><button className="sheet-close" type="button" aria-label="Close import summary" onClick={() => { if (!importing) setImportSummary(null); }}><X size={20} /></button><p>LOCAL INDEX</p><h2 id="import-title">{importing ? "Reading your music…" : "Import complete"}</h2>{importing ? <div className="import-loader"><span /><small>Indexing audio and matching lyrics without decoding every track.</small></div> : importSummary && <><div className="import-stats"><div><strong>{importSummary.accepted}</strong><span>New tracks</span></div><div><strong>{importSummary.lyrics}</strong><span>Lyrics matched</span></div><div><strong>{importSummary.duplicates}</strong><span>Reconnected / duplicate</span></div><div><strong>{importSummary.ignored}</strong><span>Ignored</span></div></div>{importSummary.errors.length > 0 && <div className="import-errors">{importSummary.errors.map((error) => <span key={error}>{error}</span>)}</div>}<button className="primary-action" type="button" onClick={() => setImportSummary(null)}>Open library</button></>}</section></div>}

      <div className={`side-sheet-backdrop ${queueOpen ? "is-open" : ""}`} onClick={() => setQueueOpen(false)}><aside className="side-sheet queue-sheet" onClick={(event) => event.stopPropagation()}><button className="sheet-close" type="button" aria-label="Close queue" onClick={() => setQueueOpen(false)}><X size={20} /></button><p>UP NEXT</p><h2>Current queue</h2><span>{session.queue.length} tracks · {session.shuffle ? "shuffle" : "in order"}</span><div className="queue-list">{session.queue.map((trackId, index) => { const track = tracks.find((candidate) => candidate.id === trackId); if (!track) return null; return <div className={trackId === session.currentTrackId ? "is-active" : ""} draggable onDragStart={(event) => event.dataTransfer.setData("text/plain", trackId)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => moveQueueTrack(event.dataTransfer.getData("text/plain"), trackId)} key={trackId}><span>{String(index + 1).padStart(2, "0")}</span><button type="button" onClick={() => void startTrack(trackId, true, 0)}><strong>{trackDisplayName(track.name)}</strong><small>{track.sourceLabel}</small></button><span className="queue-move"><button type="button" aria-label="Move up" onClick={() => reorderQueue(trackId, -1)}><ArrowUp size={13} /></button><button type="button" aria-label="Move down" onClick={() => reorderQueue(trackId, 1)}><ArrowDown size={13} /></button></span><button type="button" aria-label="Remove from queue" onClick={() => patchSession((current) => ({ ...current, queue: current.queue.filter((id) => id !== trackId) }))}><X size={14} /></button></div>; })}</div><button className="destructive-text-button" type="button" onClick={() => setConfirmAction("queue")}><Trash2 size={14} /> Clear queue only</button></aside></div>

      <div className={`side-sheet-backdrop ${storageOpen ? "is-open" : ""}`} onClick={() => setStorageOpen(false)}>
        <aside className="side-sheet storage-sheet" onClick={(event) => event.stopPropagation()}>
          <div className="sheet-heading"><div><p>LOCAL STORAGE</p><h2>Keep what matters.</h2></div><button className="sheet-close" type="button" aria-label="Close storage" onClick={() => setStorageOpen(false)}><X size={20} /></button></div>
          <p className="sheet-description">{storageState.persistent ? "Browser protection is enabled." : "The browser may clear cached audio when space is low."}</p>
          <section className="storage-usage" aria-label="Storage usage"><div><strong>{formatBytes(storageState.usage)}</strong><span>used of {storageState.quota ? formatBytes(storageState.quota) : "browser-managed space"}</span></div><div className="storage-bar"><i style={{ width: `${storageState.quota ? Math.min(100, storageState.usage / storageState.quota * 100) : 0}%` }} /></div></section>
          <label className="cache-toggle"><span><strong>Automatically keep new music</strong><small>On by default. New library tracks and comparison files remain playable after reopening Vibloom.</small></span><input type="checkbox" checked={session.cacheEnabled} onChange={(event) => { if (event.target.checked) void cacheAvailableTracks(); else { patchSession({ cacheEnabled: false }); setMessage("Automatic caching paused. Existing cached audio was kept."); } }} /></label>
          {cacheProgress > 0 && <div className="cache-progress"><i><b style={{ width: `${cacheProgress}%` }} /></i><span>Caching · {cacheProgress}%</span></div>}
          <div className="storage-actions"><button type="button" onClick={() => setConfirmAction("queue")}><span><strong>Clear queue only</strong><small>Keep library and audio</small></span><X size={16} /></button><button type="button" onClick={() => setConfirmAction("cache")}><span><strong>Clear cached audio</strong><small>Keep playlists and lyrics</small></span><Trash2 size={16} /></button><button className="is-destructive" type="button" onClick={() => setConfirmAction("reset")}><span><strong>Reset Vibloom</strong><small>Remove everything from this browser</small></span><Trash2 size={16} /></button></div>
          <div className="storage-app-version"><span>Vibloom version</span><strong>{APP_VERSION}</strong><small>Click the version beside the Vibloom logo to check for updates.</small></div>
        </aside>
      </div>

      {confirmAction && <div className="modal-backdrop"><section className="confirm-dialog" role="alertdialog" aria-modal="true"><p>PLEASE CONFIRM</p><h2>{confirmAction === "cache" ? "Clear cached audio?" : confirmAction === "queue" ? "Clear the current queue?" : "Reset Vibloom on this device?"}</h2><span>{confirmAction === "cache" ? "Your playlists, lyrics and track order will remain. Uncached tracks may need to be reconnected." : confirmAction === "queue" ? "Your library, playlists and cached audio will not be changed." : "This removes the library index, playlists, settings and all cached audio from this browser."}</span><div><button type="button" onClick={() => setConfirmAction(null)}>Cancel</button><button className="confirm-destructive" type="button" onClick={() => { if (confirmAction === "cache") void clearAudioCache(); else if (confirmAction === "queue") clearQueue(); else void resetLibrary(); }}>{confirmAction === "reset" ? "Reset Vibloom" : "Continue"}</button></div></section></div>}
    </main>
  );
}
