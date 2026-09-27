import { useEffect, useRef, useState } from "react";
import { Download, Pause, Play, Rewind, Undo2, X } from "lucide-react";
import { formatLrcTime, type LyricTimingLine, shiftLyricTiming, validateLyricTiming } from "./lrc";
import "./lyrics-timing.css";

type Props = {
  name: string;
  lines: LyricTimingLine[];
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  getTime: () => number;
  onChange: (lines: LyricTimingLine[]) => void;
  onSeek: (time: number) => void;
  onScrubStart: () => void;
  onScrub: (time: number) => void;
  onScrubEnd: (time: number) => void;
  onTogglePlay: () => void;
  onSave: (download: boolean) => void;
  onClose: () => void;
};

function TimeInput({ label, initial, action, onApply }: { label: string; initial: number | null; action: string; onApply: (seconds: number) => void }) {
  const [value, setValue] = useState(initial === null ? "" : String(initial));
  return <form className="lyric-time-input" onSubmit={(event) => { event.preventDefault(); if (value.trim() && Number.isFinite(Number(value))) onApply(Number(value)); }}>
    <label>{label}<input type="number" step="0.001" aria-label={label} value={value} placeholder="Seconds" onChange={(event) => setValue(event.target.value)} /></label>
    <button type="submit" disabled={!value.trim() || !Number.isFinite(Number(value))}>{action}</button>
  </form>;
}

export default function LyricsTimingEditor({ name, lines, currentTime, duration, isPlaying, getTime, onChange, onSeek, onScrubStart, onScrub, onScrubEnd, onTogglePlay, onSave, onClose }: Props) {
  const [selected, setSelected] = useState(() => {
    const next = lines.findIndex((line) => line.time === null);
    return next < 0 ? 0 : next;
  });
  const [history, setHistory] = useState<Array<{ lines: LyricTimingLine[]; selected: number }>>([]);
  const [editError, setEditError] = useState("");
  const scrubbing = useRef(false);
  const scrubTime = useRef(currentTime);
  const selectedLine = lines[selected];
  const dialogRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const count = lines.filter((line) => line.time !== null).length;
  const validation = validateLyricTiming(lines);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => previousFocus?.focus();
  }, []);

  useEffect(() => {
    rowRefs.current[selected]?.scrollIntoView({ block: "nearest", behavior: "auto" });
  }, [selected]);

  function change(next: LyricTimingLine[], nextSelected: number) {
    setEditError("");
    setHistory((previous) => [...previous, { lines, selected }]);
    onChange(next);
    setSelected(nextSelected);
  }

  function stamp() {
    if (selected >= lines.length) return;
    const time = Math.round(Math.max(0, Math.min(duration, getTime())) * 100) / 100;
    change(lines.map((line, index) => index === selected ? { ...line, time } : line), selected + 1);
  }

  function setTime(time: number) {
    if (!Number.isFinite(time) || time < 0) { setEditError("Enter a valid, non-negative time in seconds."); return; }
    change(lines.map((line, index) => index === selected ? { ...line, time: Math.round(time * 1000) / 1000 } : line), selected);
  }

  function shiftAll(seconds: number) {
    try { change(shiftLyricTiming(lines, seconds), selected); }
    catch (error) { setEditError(error instanceof Error ? error.message : "Could not shift timestamps."); }
  }

  function undo() {
    setEditError("");
    const previous = history.at(-1);
    if (!previous) return;
    onChange(previous.lines);
    setSelected(previous.selected);
    setHistory((entries) => entries.slice(0, -1));
  }

  return (
    <div className="modal-backdrop lyric-timing-backdrop">
      <div className="lyric-timing-editor" role="dialog" aria-modal="true" aria-labelledby="lyric-timing-title" aria-describedby="lyric-timing-help" tabIndex={-1} ref={dialogRef}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
          if (event.key === "Tab") {
            const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)") ?? []);
            const first = focusable[0];
            const last = focusable.at(-1);
            if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
            return;
          }
          if ((event.target as HTMLElement).matches("input:not([type=range])")) return;
          if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
          if (event.code === "KeyT") { event.preventDefault(); stamp(); }
          if (event.code === "Space") { event.preventDefault(); onTogglePlay(); }
          if (event.code === "KeyZ") { event.preventDefault(); undo(); }
        }}>
        <header><div><small>LYRICS · TIMING EDITOR</small><h2 id="lyric-timing-title">Timestamp lyrics</h2><p>{name}</p></div><button type="button" aria-label="Close timestamp editor" onClick={onClose}><X size={20} /></button></header>
        <p id="lyric-timing-help">Play the song and press <kbd>T</kbd> when each line starts. Select any line to timestamp it again. <kbd>Space</kbd> plays / pauses; <kbd>Z</kbd> undoes.</p>
        <div className="lyric-timing-transport">
          <button type="button" aria-label="Rewind 5 seconds" onClick={() => onSeek(Math.max(0, getTime() - 5))}><Rewind size={18} /></button>
          <button type="button" aria-label={isPlaying ? "Pause timing playback" : "Play timing playback"} onClick={onTogglePlay}>{isPlaying ? <Pause size={20} /> : <Play size={20} />}</button>
          <output>{formatLrcTime(currentTime)}</output>
          <input type="range" aria-label="Timestamp playback position" min={0} max={Math.max(duration, 0.01)} step={0.001} value={Math.min(currentTime, duration)} onPointerDown={(event) => { scrubbing.current = true; scrubTime.current = currentTime; event.currentTarget.setPointerCapture(event.pointerId); onScrubStart(); }}
            onChange={(event) => { const time = Number(event.target.value); scrubTime.current = time; if (scrubbing.current) onScrub(time); else onSeek(time); }}
            onPointerUp={() => { if (scrubbing.current) { scrubbing.current = false; onScrubEnd(scrubTime.current); } }}
            onLostPointerCapture={() => { if (scrubbing.current) { scrubbing.current = false; onScrubEnd(scrubTime.current); } }}
            onPointerCancel={() => { if (scrubbing.current) { scrubbing.current = false; onScrubEnd(scrubTime.current); } }} />
          <span>{formatLrcTime(duration)}</span>
        </div>
        <div className="lyric-timing-progress"><strong>{count} / {lines.length} timed</strong><span>Draft saved with this track</span></div>
        <div className="lyric-timing-lines" aria-label="Lyrics to timestamp">
          {lines.map((line, index) => <button type="button" key={index} ref={(node) => { rowRefs.current[index] = node; }} className={selected === index ? "is-selected" : ""} aria-pressed={selected === index} onClick={() => setSelected(index)}>
            <span>{index + 1}</span><time>{line.time === null ? "--:--.--" : formatLrcTime(line.time)}</time><span>{line.text}</span>
          </button>)}
        </div>
        {selectedLine && <div className="lyric-timing-adjust">
          <TimeInput key={`${selected}:${selectedLine.time}`} label={`Line ${selected + 1} time (seconds)`} initial={selectedLine.time} action="Set time" onApply={setTime} />
          <div className="lyric-timing-nudge">
            <button type="button" disabled={selectedLine.time === null} onClick={() => setTime((selectedLine.time ?? 0) - 0.1)}>−0.1 s</button>
            <button type="button" disabled={selectedLine.time === null} onClick={() => setTime((selectedLine.time ?? 0) + 0.1)}>+0.1 s</button>
            <button type="button" disabled={selectedLine.time === null} onClick={() => onSeek(selectedLine.time ?? 0)}>Seek to line</button>
          </div>
        </div>}
        <div className="lyric-timing-adjust">
          <TimeInput label="All lines offset (seconds)" initial={0} action="Shift all" onApply={shiftAll} />
          <small>Negative = earlier · Positive = later. Untimed lines stay untimed.</small>
        </div>
        <div className="lyric-timing-actions">
          <button className="lyric-timing-stamp" type="button" disabled={selected >= lines.length} onClick={stamp}>{selected < lines.length ? `Timestamp line ${selected + 1} · T` : "All lines timed"}</button>
          <button type="button" disabled={!history.length} onClick={undo}><Undo2 size={16} /> Undo</button>
          <button type="button" disabled={!count} onClick={() => change(lines.map((line) => ({ ...line, time: null })), 0)}>Reset</button>
        </div>
        <p className="lyric-timing-hint" role="status">{editError || validation || "Ready to save and download. Select a line to adjust its timestamp."}</p>
        <footer><button type="button" disabled={!!validation} onClick={() => onSave(false)}>Save synced lyrics</button><button type="button" className="lyric-timing-download" disabled={!!validation} onClick={() => onSave(true)}><Download size={16} /> Save & download .lrc</button></footer>
      </div>
    </div>
  );
}
