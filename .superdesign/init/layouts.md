# Layouts

Vibloom is a single-page application. `App` owns the complete shell: header, listening scene, track workspace, transport, keyboard help, and footer.

## App shell
- Path: `src/App.tsx`

```tsx
import {
  ArrowLeftRight,
  Check,
  FastForward,
  FileAudio,
  Headphones,
  Keyboard,
  Music2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Repeat2,
  Rewind,
  ShieldCheck,
  Trash2,
  Upload,
  Volume2,
  X,
} from "lucide-react";
import {
  ChangeEvent,
  DragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import Live2DStage from "./Live2DStage";
import { EMPTY_AUDIO_VISUAL, sampleAnalyser } from "./audioVisual";

type SlotStatus = "empty" | "loading" | "ready" | "error";
type LoadStage = "idle" | "reading" | "decoding";

type AudioSlot = {
  file: File | null;
  name: string;
  size: number;
  duration: number;
  peaks: number[];
  status: SlotStatus;
  loadStage: LoadStage;
  loadProgress: number;
  error: string;
};

const EMPTY_SLOT: AudioSlot = {
  file: null,
  name: "",
  size: 0,
  duration: 0,
  peaks: [],
  status: "empty",
  loadStage: "idle",
  loadProgress: 0,
  error: "",
};

const SUPPORTED_AUDIO = /\.(mp3|wav|wave|m4a|aac|ogg|oga|flac|opus|webm|aiff|aif)$/i;
const FADE_SECONDS = 0.018;
const SOURCE_LEAD_SECONDS = 0.025;
const MAX_FILE_BYTES = 300 * 1024 * 1024;

function formatTime(seconds: number, precise = false) {
  if (!Number.isFinite(seconds) || seconds < 0) return precise ? "00:00.000" : "00:00";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const wholeSeconds = Math.floor(seconds % 60);
  const milliseconds = Math.floor((seconds % 1) * 1000);
  const base = `${hours ? `${String(hours).padStart(2, "0")}:` : ""}${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}`;
  return precise ? `${base}.${String(milliseconds).padStart(3, "0")}` : base;
}

function formatSize(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** unit).toFixed(unit > 1 ? 1 : 0)} ${units[unit]}`;
}

function makePeaks(buffer: AudioBuffer, count = 112): number[] {
  const peaks = new Array(count).fill(0);
  const channels = Math.min(buffer.numberOfChannels, 2);
  const block = Math.max(1, Math.floor(buffer.length / count));

  for (let index = 0; index < count; index += 1) {
    const start = index * block;
    const end = Math.min(buffer.length, start + block);
    let max = 0;
    const stride = Math.max(1, Math.floor((end - start) / 180));
    for (let channel = 0; channel < channels; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let sample = start; sample < end; sample += stride) {
        max = Math.max(max, Math.abs(data[sample]));
      }
    }
    peaks[index] = Math.max(0.07, Math.min(1, Math.sqrt(max)));
  }
  return peaks;
}

function Waveform({ peaks, label }: { peaks: number[]; label: string }) {
  const bars = peaks.length ? peaks : new Array(112).fill(0.16);
  return (
    <div className="waveform" aria-label={`${label} waveform`} role="img">
      {bars.map((peak, index) => (
        <span key={`${label}-${index}`} style={{ height: `${Math.max(8, peak * 100)}%` }} />
      ))}
    </div>
  );
}

export default function Home() {
  const [slots, setSlots] = useState<[AudioSlot, AudioSlot]>([
    { ...EMPTY_SLOT },
    { ...EMPTY_SLOT },
  ]);
  const slotsRef = useRef(slots);
  const [active, setActive] = useState<0 | 1>(0);
  const activeRef = useRef<0 | 1>(0);
  const [currentTime, setCurrentTime] = useState(0);
  const currentTimeRef = useRef(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const playingRef = useRef(false);
  const [loop, setLoop] = useState(false);
  const loopRef = useRef(false);
  const [volume, setVolume] = useState(0.9);
  const [message, setMessage] = useState("");
  const [dragging, setDragging] = useState<0 | 1 | null>(null);

  const inputARef = useRef<HTMLInputElement>(null);
  const inputBRef = useRef<HTMLInputElement>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const gainARef = useRef<GainNode | null>(null);
  const gainBRef = useRef<GainNode | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const analysersRef = useRef<[AnalyserNode | null, AnalyserNode | null]>([null, null]);
  const frequencyDataRef = useRef<[Uint8Array<ArrayBuffer> | null, Uint8Array<ArrayBuffer> | null]>([null, null]);
  const timeDataRef = useRef<[Uint8Array<ArrayBuffer> | null, Uint8Array<ArrayBuffer> | null]>([null, null]);
  const audioVisualRef = useRef({ ...EMPTY_AUDIO_VISUAL });
  const buffersRef = useRef<[AudioBuffer | null, AudioBuffer | null]>([null, null]);
  const sourcesRef = useRef<[AudioBufferSourceNode | null, AudioBufferSourceNode | null]>([null, null]);
  const readersRef = useRef<[FileReader | null, FileReader | null]>([null, null]);
  const loadVersionsRef = useRef<[number, number]>([0, 0]);
  const playbackOffsetRef = useRef(0);
  const playbackStartedAtRef = useRef(0);
  const volumeRef = useRef(volume);
  const rafRef = useRef<number | null>(null);

  const maxDuration = Math.max(slots[0].duration, slots[1].duration, 0);
  const bothReady = slots[0].status === "ready" && slots[1].status === "ready";
  const durationDelta = bothReady ? Math.abs(slots[0].duration - slots[1].duration) : 0;
  const progress = maxDuration ? Math.min(100, (currentTime / maxDuration) * 100) : 0;
  const hasAnyTrack = slots.some((slot) => slot.status !== "empty");
  const readyCount = slots.filter((slot) => slot.status === "ready").length;
  const sessionLabel = readyCount > 1 ? "A/B comparison" : "Live2D listening";
  const liveTrackLabel = slots[active].name || slots.find((slot) => slot.name)?.name || "Waiting for audio";

  function inputAt(index: 0 | 1) {
    return index === 0 ? inputARef.current : inputBRef.current;
  }

  function updateSlots(next: [AudioSlot, AudioSlot]) {
    slotsRef.current = next;
    setSlots(next);
  }

  function patchSlot(index: 0 | 1, patch: Partial<AudioSlot>) {
    const next = [...slotsRef.current] as [AudioSlot, AudioSlot];
    next[index] = { ...next[index], ...patch };
    updateSlots(next);
  }

  const ensureAudioGraph = useCallback(async (resume = true) => {
    if (contextRef.current) {
      if (resume && contextRef.current.state === "suspended") {
        try {
          await contextRef.current.resume();
        } catch {
          return null;
        }
      }
      return contextRef.current;
    }
    if (!window.AudioContext) return null;

    const context = new AudioContext();
    const gainA = context.createGain();
    const gainB = context.createGain();
    const master = context.createGain();
    const analyserA = context.createAnalyser();
    const analyserB = context.createAnalyser();
    analyserA.fftSize = 1024;
    analyserB.fftSize = 1024;
    analyserA.smoothingTimeConstant = 0.68;
    analyserB.smoothingTimeConstant = 0.68;
    analyserA.connect(gainA);
    analyserB.connect(gainB);
    gainA.connect(master);
    gainB.connect(master);
    master.connect(context.destination);
    gainA.gain.value = activeRef.current === 0 ? 1 : 0;
    gainB.gain.value = activeRef.current === 1 ? 1 : 0;
    master.gain.value = volumeRef.current;
    contextRef.current = context;
    gainARef.current = gainA;
    gainBRef.current = gainB;
    masterGainRef.current = master;
    analysersRef.current = [analyserA, analyserB];
    frequencyDataRef.current = [
      new Uint8Array(analyserA.frequencyBinCount),
      new Uint8Array(analyserB.frequencyBinCount),
    ];
    timeDataRef.current = [
      new Uint8Array(analyserA.fftSize),
      new Uint8Array(analyserB.fftSize),
    ];
    if (resume) {
      try {
        await context.resume();
      } catch {
        return null;
      }
    }
    return context;
  }, []);

  const applySourceGain = useCallback((nextActive: 0 | 1) => {
    const context = contextRef.current;
    const gains = [gainARef.current, gainBRef.current];
    if (context && gains[0] && gains[1]) {
      const now = context.currentTime;
      gains.forEach((gain, index) => {
        if (!gain) return;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.linearRampToValueAtTime(index === nextActive ? 1 : 0, now + FADE_SECONDS);
      });
    }
  }, []);

  const getTimelineTime = useCallback(() => {
    const context = contextRef.current;
    if (playingRef.current && context) {
      return playbackOffsetRef.current + Math.max(0, context.currentTime - playbackStartedAtRef.current);
    }
    return currentTimeRef.current;
  }, []);

  const stopSourceAt = useCallback((index: 0 | 1) => {
    const source = sourcesRef.current[index];
    if (!source) return;
    source.onended = null;
    try {
      source.stop();
    } catch {
      // A source may already have reached the end of a shorter track.
    }
    source.disconnect();
    sourcesRef.current[index] = null;
  }, []);

  const stopAllSources = useCallback(() => {
    stopSourceAt(0);
    stopSourceAt(1);
  }, [stopSourceAt]);

  const createSourceAt = useCallback((index: 0 | 1, when: number, offset: number) => {
    const context = contextRef.current;
    const buffer = buffersRef.current[index];
    const analyser = analysersRef.current[index];
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
    if (!context) {
      setMessage("This browser does not support Web Audio decoding.");
      return false;
    }

    stopAllSources();
    const when = context.currentTime + SOURCE_LEAD_SECONDS;
    const started = ([0, 1] as const).map((index) => createSourceAt(index, when, time));
    if (!started.some(Boolean)) return false;

    playbackOffsetRef.current = time;
    playbackStartedAtRef.current = when;
    currentTimeRef.current = time;
    setCurrentTime(time);
    playingRef.current = true;
    setIsPlaying(true);
    return true;
  }, [createSourceAt, ensureAudioGraph, stopAllSources]);

  async function switchSource(nextActive: 0 | 1) {
    if (slotsRef.current[nextActive].status !== "ready") return;
    await ensureAudioGraph();
    activeRef.current = nextActive;
    setActive(nextActive);
    applySourceGain(nextActive);
    setMessage(`Listening to ${nextActive === 0 ? "A" : "B"}`);
    window.setTimeout(() => setMessage(""), 900);
  }

  async function togglePlay() {
    if (!slotsRef.current.some((slot) => slot.status === "ready")) return;
    if (playingRef.current) {
      const pausedAt = getTimelineTime();
      stopAllSources();
      playbackOffsetRef.current = pausedAt;
      currentTimeRef.current = pausedAt;
      setCurrentTime(pausedAt);
      playingRef.current = false;
      setIsPlaying(false);
      return;
    }
    const duration = Math.max(...slotsRef.current.map((slot) => slot.duration));
    const startAt = currentTimeRef.current >= duration - 0.01 ? 0 : currentTimeRef.current;
    currentTimeRef.current = startAt;
    setCurrentTime(startAt);
    await startPlayback(startAt);
  }

  const seekTo = useCallback(async (rawTime: number) => {
    const duration = Math.max(...slotsRef.current.map((slot) => slot.duration), 0);
    const nextTime = Math.max(0, Math.min(rawTime, duration));
    currentTimeRef.current = nextTime;
    setCurrentTime(nextTime);
    playbackOffsetRef.current = nextTime;
    if (playingRef.current) await startPlayback(nextTime);
  }, [startPlayback]);

  function removeFile(index: 0 | 1) {
    loadVersionsRef.current[index] += 1;
    readersRef.current[index]?.abort();
    readersRef.current[index] = null;
    buffersRef.current[index] = null;
    stopSourceAt(index);
    const next = [...slotsRef.current] as [AudioSlot, AudioSlot];
    next[index] = { ...EMPTY_SLOT };
    updateSlots(next);

    const otherIndex = index === 0 ? 1 : 0;
    if (activeRef.current === index && next[otherIndex].status === "ready") {
      void switchSource(otherIndex);
    }
    if (!next.some((item) => item.status === "ready")) {
      stopAllSources();
      playingRef.current = false;
      setIsPlaying(false);
      playbackOffsetRef.current = 0;
      currentTimeRef.current = 0;
      setCurrentTime(0);
    }
  }

  function clearBothFiles() {
    ([0, 1] as const).forEach((index) => {
      loadVersionsRef.current[index] += 1;
      readersRef.current[index]?.abort();
      readersRef.current[index] = null;
      buffersRef.current[index] = null;
    });

    stopAllSources();
    updateSlots([{ ...EMPTY_SLOT }, { ...EMPTY_SLOT }]);
    activeRef.current = 0;
    setActive(0);
    playingRef.current = false;
    setIsPlaying(false);
    playbackOffsetRef.current = 0;
    currentTimeRef.current = 0;
    setCurrentTime(0);
    applySourceGain(0);
    setMessage("");
  }

  async function loadFile(file: File, index: 0 | 1) {
    if (!file.type.startsWith("audio/") && !SUPPORTED_AUDIO.test(file.name)) {
      patchSlot(index, {
        ...EMPTY_SLOT,
        status: "error",
        name: file.name,
        error: "That file does not look like supported audio.",
      });
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      patchSlot(index, {
        ...EMPTY_SLOT,
        status: "error",
        name: file.name,
        error: "For reliable in-browser decoding, choose a file smaller than 300 MB.",
      });
      return;
    }

    loadVersionsRef.current[index] += 1;
    const version = loadVersionsRef.current[index];
    readersRef.current[index]?.abort();
    buffersRef.current[index] = null;
    stopSourceAt(index);
    const otherIndex = index === 0 ? 1 : 0;
    if (playingRef.current && slotsRef.current[otherIndex].status !== "ready") {
      const pausedAt = getTimelineTime();
      stopAllSources();
      playingRef.current = false;
      setIsPlaying(false);
      playbackOffsetRef.current = pausedAt;
      currentTimeRef.current = pausedAt;
      setCurrentTime(pausedAt);
    } else if (activeRef.current === index && slotsRef.current[otherIndex].status === "ready") {
      activeRef.current = otherIndex;
      setActive(otherIndex);
      applySourceGain(otherIndex);
    }
    patchSlot(index, {
      file,
      name: file.name,
      size: file.size,
      duration: 0,
      peaks: [],
      status: "loading",
      loadStage: "reading",
      loadProgress: 0,
      error: "",
    });

    try {
      const reader = new FileReader();
      readersRef.current[index] = reader;
      const arrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
        reader.onprogress = (event) => {
          if (loadVersionsRef.current[index] !== version || !event.lengthComputable) return;
          patchSlot(index, { loadProgress: Math.round((event.loaded / event.total) * 50) });
        };
        reader.onload = () => {
          if (reader.result instanceof ArrayBuffer) resolve(reader.result);
          else reject(new Error("The audio file could not be read."));
        };
        reader.onerror = () => reject(reader.error ?? new Error("The audio file could not be read."));
        reader.onabort = () => reject(new DOMException("File reading was cancelled.", "AbortError"));
        reader.readAsArrayBuffer(file);
      });
      if (loadVersionsRef.current[index] !== version) return;

      patchSlot(index, { loadStage: "decoding", loadProgress: 55 });
      const context = await ensureAudioGraph(false);
      if (!context) throw new Error("Web Audio is unavailable in this browser.");
      const buffer = await context.decodeAudioData(arrayBuffer);
      if (loadVersionsRef.current[index] !== version) return;
      if (!Number.isFinite(buffer.duration) || buffer.duration <= 0) {
        throw new Error("The duration could not be read.");
      }

      const shouldActivate = slotsRef.current[activeRef.current].status !== "ready";
      buffersRef.current[index] = buffer;
      readersRef.current[index] = null;
      patchSlot(index, {
        duration: buffer.duration,
        peaks: makePeaks(buffer),
        status: "ready",
        loadStage: "idle",
        loadProgress: 100,
        error: "",
      });

      if (shouldActivate) {
        activeRef.current = index;
        setActive(index);
        applySourceGain(index);
      }

      if (playingRef.current) {
        const now = context.currentTime;
        const when = now + SOURCE_LEAD_SECONDS;
        const timelineAtStart = getTimelineTime() + SOURCE_LEAD_SECONDS;
        if (createSourceAt(index, when, timelineAtStart) && activeRef.current === index) {
          const gain = index === 0 ? gainARef.current : gainBRef.current;
          if (gain) {
            gain.gain.cancelScheduledValues(now);
            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(1, when + FADE_SECONDS);
          }
        }
      }
    } catch (error) {
      if (loadVersionsRef.current[index] !== version) return;
      readersRef.current[index] = null;
      buffersRef.current[index] = null;
      patchSlot(index, {
        status: "error",
        loadStage: "idle",
        loadProgress: 0,
        error: error instanceof Error && error.name !== "EncodingError"
          ? error.message
          : "This browser could not decode the file. Try WAV, MP3, M4A, FLAC, or OGG.",
      });
    }
  }

  function handleInput(event: ChangeEvent<HTMLInputElement>, index: 0 | 1) {
    const files = Array.from(event.target.files ?? []);
    if (files[0]) void loadFile(files[0], index);
    if (files[1]) void loadFile(files[1], index === 0 ? 1 : 0);
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLElement>, index: 0 | 1) {
    event.preventDefault();
    setDragging(null);
    const files = Array.from(event.dataTransfer.files);
    if (files[0]) void loadFile(files[0], index);
    if (files[1]) void loadFile(files[1], index === 0 ? 1 : 0);
  }

  function handleDropKey(event: ReactKeyboardEvent<HTMLDivElement>, index: 0 | 1) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      inputAt(index)?.click();
    }
  }

  useEffect(() => {
    slotsRef.current = slots;
  }, [slots]);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    loopRef.current = loop;
  }, [loop]);

  useEffect(() => {
    volumeRef.current = volume;
    if (masterGainRef.current && contextRef.current) {
      masterGainRef.current.gain.setTargetAtTime(volume, contextRef.current.currentTime, 0.015);
    }
  }, [volume]);

  useEffect(() => {
    audioVisualRef.current = {
      ...audioVisualRef.current,
      isPlaying,
      isComparing: bothReady,
      source: active,
      transient: isPlaying ? audioVisualRef.current.transient : 0,
    };
  }, [active, bothReady, isPlaying]);

  useEffect(() => {
    function tick() {
      if (!playingRef.current) return;
      const reference = getTimelineTime();
      const duration = Math.max(...slotsRef.current.map((slot) => slot.duration), 0);
      currentTimeRef.current = Math.min(reference, duration);
      setCurrentTime(Math.min(reference, duration));

      const sourceIndex = activeRef.current;
      const analyser = analysersRef.current[sourceIndex];
      const frequencyData = frequencyDataRef.current[sourceIndex];
      const timeData = timeDataRef.current[sourceIndex];
      if (analyser && frequencyData && timeData) {
        audioVisualRef.current = sampleAnalyser(
          analyser,
          frequencyData,
          timeData,
          audioVisualRef.current,
          reference,
          sourceIndex,
        );
      }

      if (duration > 0 && reference >= duration - 0.025) {
        if (loopRef.current) {
          void seekTo(0);
        } else {
          stopAllSources();
          playingRef.current = false;
          setIsPlaying(false);
          playbackOffsetRef.current = duration;
          currentTimeRef.current = duration;
          setCurrentTime(duration);
          return;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    }

    if (isPlaying) rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [getTimelineTime, isPlaying, seekTo, stopAllSources]);

  useEffect(() => {
    function handleKey(event: globalThis.KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "BUTTON"].includes(target.tagName)) return;
      if (event.code === "Space") {
        event.preventDefault();
        void togglePlay();
      } else if (event.key === "1" || event.key.toLowerCase() === "a") {
        void switchSource(0);
      } else if (event.key === "2" || event.key.toLowerCase() === "b") {
        void switchSource(1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        void seekTo(currentTimeRef.current - 5);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        void seekTo(currentTimeRef.current + 5);
      } else if (event.key.toLowerCase() === "l") {
        setLoop((value) => !value);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  useEffect(() => {
    const readers = readersRef.current;
    return () => {
      readers.forEach((reader) => reader?.abort());
      stopAllSources();
      void contextRef.current?.close();
    };
  }, [stopAllSources]);

  return (
    <main className="app-shell">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Vibloom home">
          <span className="brand-mark"><ArrowLeftRight size={18} strokeWidth={2.4} /></span>
          <span>Vibloom</span>
        </a>
        <div className="local-note"><ShieldCheck size={15} /> Files stay on this device</div>
      </header>

      <input
        ref={inputARef}
        type="file"
        accept="audio/*,.flac,.aiff,.aif"
        multiple
        hidden
        onChange={(event) => handleInput(event, 0)}
      />
      <input
        ref={inputBRef}
        type="file"
        accept="audio/*,.flac,.aiff,.aif"
        hidden
        onChange={(event) => handleInput(event, 1)}
      />

      <section
        className={`${hasAnyTrack ? "player-hero" : "welcome-screen"} ${dragging !== null ? "is-dragging" : ""}`}
        id="top"
        onDragEnter={(event) => { event.preventDefault(); if (!hasAnyTrack) setDragging(0); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(null); }}
        onDrop={(event) => { if (!hasAnyTrack) handleDrop(event, 0); }}
      >
        {!hasAnyTrack ? (
          <div className="welcome-copy">
            <p className="eyebrow"><Headphones size={15} /> A visual music player for close listening</p>
            <h1>Let your music<br /><em>move someone.</em></h1>
            <p>Hiyori listens locally in your browser. Her body follows low frequencies, her expression follows the midrange, and transients earn real gestures.</p>
          </div>
        ) : (
          <div className="player-hero-copy">
            <p className="eyebrow"><span className="live-dot" /> {sessionLabel}</p>
            <h1>{readyCount > 1 ? "Listen between the lines." : "Your music has company."}</h1>
            <p>{readyCount > 1
              ? "Hiyori stays on the same clock while you switch between A and B."
              : "Add a second version at any time to enter synchronized comparison mode."}</p>
          </div>
        )}

        <Live2DStage
          featuresRef={audioVisualRef}
          variant={hasAnyTrack ? "player" : "welcome"}
          trackLabel={hasAnyTrack ? liveTrackLabel : "Drop a track to begin"}
          activeSource={active}
          isComparing={bothReady}
          isPlaying={isPlaying}
          onPickAudio={() => inputAt(0)?.click()}
        />

        {!hasAnyTrack && (
          <>
            <div className="welcome-choices" aria-label="Choose a listening mode">
              <button type="button" onClick={() => inputAt(0)?.click()}>
                <span className="choice-icon"><Music2 size={19} /></span>
                <span><b>Play one track</b><small>Music player + interactive Hiyori</small></span>
                <Plus size={17} />
              </button>
              <button type="button" onClick={() => inputAt(0)?.click()}>
                <span className="choice-icon is-compare"><ArrowLeftRight size={19} /></span>
                <span><b>Compare two tracks</b><small>Select two files together for synced A/B</small></span>
                <Plus size={17} />
              </button>
            </div>
            <p className="welcome-drop-note"><Upload size={14} /> You can also drop one or two audio files anywhere on this stage</p>
          </>
        )}
      </section>

      {hasAnyTrack && (
        <>

      <section className="workspace" aria-label="Audio comparison workspace">
        <div className="file-grid">
          {([0, 1] as const).map((index) => {
            const slot = slots[index];
            const label = index === 0 ? "A" : "B";
            const isActive = active === index && slot.status === "ready";
            return (
              <div
                className={`file-slot ${slot.status !== "empty" ? "has-file" : ""} ${dragging === index ? "is-dragging" : ""} ${isActive ? "is-active" : ""}`}
                key={label}
                role="button"
                tabIndex={0}
                aria-label={`${label} audio file. ${slot.status === "empty" ? "Choose or drop a file" : slot.name}`}
                onClick={() => slot.status === "empty" && inputAt(index)?.click()}
                onKeyDown={(event) => handleDropKey(event, index)}
                onDragEnter={(event) => { event.preventDefault(); setDragging(index); }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(null); }}
                onDrop={(event) => handleDrop(event, index)}
              >
                <div className="slot-topline">
                  <span className={`source-badge source-${label.toLowerCase()}`}>{label}</span>
                  {isActive && <span className="playing-source"><span /> LIVE</span>}
                </div>

                {slot.status === "empty" ? (
                  <div className="empty-slot-content">
                    <span className="upload-icon"><Upload size={22} /></span>
                    <strong>{index === 1 && slots[0].status === "ready" ? "Add comparison track" : `Drop audio ${label}`}</strong>
                    <span>{index === 1 && slots[0].status === "ready" ? "enter synchronized A/B mode" : "or choose a file"}</span>
                  </div>
                ) : (
                  <div className="file-details">
                    <div className="file-icon"><FileAudio size={23} /></div>
                    <div className="file-copy">
                      <strong title={slot.name}>{slot.name || `Audio ${label}`}</strong>
                      <span>
                        {slot.status === "loading"
                          ? slot.loadStage === "reading"
                            ? `Reading audio… ${slot.loadProgress}%`
                            : "Decoding for seamless playback…"
                          : slot.status === "error"
                            ? slot.error
                            : `${formatTime(slot.duration)} · ${formatSize(slot.size)}`}
                      </span>
                      {slot.status === "loading" && (
                        <div
                          className={`decode-progress ${slot.loadStage === "decoding" ? "is-decoding" : ""}`}
                          role="progressbar"
                          aria-label={`Preparing audio ${label}`}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={slot.loadStage === "reading" ? slot.loadProgress : undefined}
                          aria-valuetext={slot.loadStage === "decoding" ? "Decoding audio" : undefined}
                        >
                          <span style={{ width: `${slot.loadProgress}%` }} />
                        </div>
                      )}
                    </div>
                    {slot.status === "ready" && <Check className="file-check" size={18} />}
                    <div className="file-actions">
                      <button type="button" className="icon-button" title={`Replace audio ${label}`} aria-label={`Replace audio ${label}`} onClick={(event) => { event.stopPropagation(); inputAt(index)?.click(); }}><RefreshCw size={15} /></button>
                      <button type="button" className="icon-button" title={`Remove audio ${label}`} aria-label={`Remove audio ${label}`} onClick={(event) => { event.stopPropagation(); removeFile(index); }}><X size={16} /></button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {slots.some((slot) => slot.status !== "empty") && (
          <div className="file-toolbar">
            <button type="button" className="clear-files-button" onClick={clearBothFiles}>
              <Trash2 size={14} />
              Clear both tracks
            </button>
          </div>
        )}

        {durationDelta > 0.05 && (
          <div className="duration-alert" role="status">
            <span>Different lengths</span>
            The timeline follows the longer file. {slots[0].duration > slots[1].duration ? "A" : "B"} is {formatTime(durationDelta, true)} longer.
          </div>
        )}

        <div className={`player ${maxDuration ? "is-ready" : ""}`}>
          <div className="player-heading">
            <div>
              <p className="section-label">Synchronized timeline</p>
              <p className="time-readout" aria-live="off">{formatTime(currentTime, true)}</p>
            </div>
            <span className="total-time">/ {formatTime(maxDuration, true)}</span>
          </div>

          <div className="timeline" style={{ "--progress": `${progress}%` } as React.CSSProperties}>
            <div className="wave-row wave-a">
              <span className="wave-label">A</span>
              <div className="wave-track">
                <Waveform peaks={slots[0].peaks} label="Audio A" />
                {slots[0].duration > 0 && slots[0].duration < maxDuration && <span className="audio-end" style={{ left: `${(slots[0].duration / maxDuration) * 100}%` }}>ends</span>}
              </div>
            </div>
            <div className="wave-row wave-b">
              <span className="wave-label">B</span>
              <div className="wave-track">
                <Waveform peaks={slots[1].peaks} label="Audio B" />
                {slots[1].duration > 0 && slots[1].duration < maxDuration && <span className="audio-end" style={{ left: `${(slots[1].duration / maxDuration) * 100}%` }}>ends</span>}
              </div>
            </div>
            <div className="timeline-track">
              <div className="playhead" aria-hidden="true"><span /></div>
              <input
                className="scrubber"
                aria-label="Playback position"
                type="range"
                min="0"
                max={maxDuration || 1}
                step="0.001"
                value={currentTime}
                disabled={!maxDuration}
                onChange={(event) => void seekTo(Number(event.target.value))}
              />
            </div>
          </div>

          <div className="controls">
            <div className="transport-controls">
              <button className="control-button" type="button" title="Back 5 seconds" aria-label="Back 5 seconds" disabled={!maxDuration} onClick={() => void seekTo(currentTime - 5)}><Rewind size={18} fill="currentColor" /></button>
              <button className="play-button" type="button" aria-label={isPlaying ? "Pause" : "Play"} disabled={!maxDuration} onClick={() => void togglePlay()}>{isPlaying ? <Pause size={22} fill="currentColor" /> : <Play className="play-icon" size={22} fill="currentColor" />}</button>
              <button className="control-button" type="button" title="Forward 5 seconds" aria-label="Forward 5 seconds" disabled={!maxDuration} onClick={() => void seekTo(currentTime + 5)}><FastForward size={18} fill="currentColor" /></button>
              <button className={`control-button ${loop ? "selected" : ""}`} type="button" title="Loop timeline" aria-label="Loop timeline" aria-pressed={loop} disabled={!maxDuration} onClick={() => setLoop(!loop)}><Repeat2 size={18} /></button>
            </div>

            <div className="ab-switch" aria-label="Choose audible source">
              <span className="switch-caption">HEARING</span>
              <button type="button" className={active === 0 ? "active" : ""} disabled={slots[0].status !== "ready"} onClick={() => void switchSource(0)}><kbd>1</kbd> Audio A</button>
              <button type="button" className={active === 1 ? "active" : ""} disabled={slots[1].status !== "ready"} onClick={() => void switchSource(1)}><kbd>2</kbd> Audio B</button>
            </div>

            <label className="volume-control" title="Output volume">
              <Volume2 size={18} />
              <span className="sr-only">Output volume</span>
              <input type="range" min="0" max="1" step="0.01" value={volume} onChange={(event) => setVolume(Number(event.target.value))} />
            </label>
          </div>

          <div className="player-status">
            <span>{maxDuration ? (currentTime > slots[active].duration && slots[active].duration > 0 ? `${active === 0 ? "A" : "B"} has ended here — switch to hear the longer file` : message || `Audio ${active === 0 ? "A" : "B"} is audible`) : "Add one or two files to begin"}</span>
            <span className="sync-state"><span /> {bothReady ? "Synced continuously" : "Solo listening mode"}</span>
          </div>
        </div>
      </section>

      <section className="shortcut-section" aria-label="Keyboard shortcuts">
        <div className="shortcut-heading"><Keyboard size={18} /><span><strong>Keep your ears focused.</strong> Use the keyboard while listening.</span></div>
        <div className="shortcut-list">
          <span><kbd>Space</kbd> Play / pause</span>
          <span><kbd>1</kbd><kbd>2</kbd> Switch A / B</span>
          <span><kbd>←</kbd><kbd>→</kbd> Seek 5 sec</span>
          <span><kbd>L</kbd> Loop</span>
        </div>
      </section>
        </>
      )}

      <footer>
        <span>Vibloom</span>
        <p>Private by design. Audio is decoded locally and never uploaded.</p>
      </footer>
    </main>
  );
}
```
