import { memo, useEffect, useRef, useState } from "react";
import { Download, Pause, Play, Plus, Rewind, Timer, Trash2, Undo2, X } from "lucide-react";
import { formatLrcTime, type LyricTimingLine, shiftLyricTiming, validateLyricTiming } from "./lrc";
import "./lyrics-timing.css";

type Props = {
  name: string;
  lines: LyricTimingLine[];
  duration: number;
  isPlaying: boolean;
  getTime: () => number;
  onChange: (lines: LyricTimingLine[]) => void;
  onSeek: (time: number) => void;
  onScrubStart: () => void;
  onScrubEnd: (time: number) => void;
  onTogglePlay: () => void;
  onSave: (download: boolean, format?: "lrc" | "txt") => void;
  onClose: () => void;
};

function TimeInput({ label, initial, action, onApply }: { label: string; initial: number | null; action: string; onApply: (seconds: number) => void }) {
  const [value, setValue] = useState(initial === null ? "" : String(initial));
  return <form className="lyric-time-input" onSubmit={(event) => { event.preventDefault(); if (value.trim() && Number.isFinite(Number(value))) onApply(Number(value)); }}>
    <label>{label}<input type="number" step="0.001" aria-label={label} value={value} placeholder="Seconds" onChange={(event) => setValue(event.target.value)} /></label>
    <button type="submit" disabled={!value.trim() || !Number.isFinite(Number(value))}>{action}</button>
  </form>;
}

/** The visual playhead belongs to the audio clock, or exclusively to the
 * pointer during a drag. Neither path schedules a React render. */
const TimingPlayhead = memo(function TimingPlayhead({ duration, getTime, onSeek, onScrubStart, onScrubEnd }: Pick<Props, "duration" | "getTime" | "onSeek" | "onScrubStart" | "onScrubEnd">) {
  const slider = useRef<HTMLInputElement>(null);
  const output = useRef<HTMLOutputElement>(null);
  const scrubbing = useRef(false);
  const scrubTime = useRef(0);
  useEffect(() => {
    let frame = 0, lastText = -Infinity;
    const tick = (now: number) => {
      if (!scrubbing.current) {
        const time = Math.max(0, Math.min(duration, getTime()));
        if (slider.current) slider.current.value = String(time);
        if (output.current && now - lastText >= 100) { output.current.textContent = formatLrcTime(time); lastText = now; }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      if (scrubbing.current) { scrubbing.current = false; onScrubEnd(scrubTime.current); }
    };
  }, [duration, getTime, onScrubEnd]);
  const finish = () => {
    if (!scrubbing.current) return;
    scrubbing.current = false;
    onScrubEnd(scrubTime.current);
  };
  return <>
    <output ref={output}>{formatLrcTime(0)}</output>
    <input ref={slider} type="range" aria-label="Timestamp playback position" min={0} max={Math.max(duration, .01)} step={.001} defaultValue={0}
      onPointerDown={(event) => {
        scrubbing.current = true;
        scrubTime.current = Number(event.currentTarget.value);
        event.currentTarget.setPointerCapture(event.pointerId);
        onScrubStart();
      }}
      onChange={(event) => {
        const time = Number(event.currentTarget.value);
        scrubTime.current = time;
        if (output.current) output.current.textContent = formatLrcTime(time);
        if (!scrubbing.current) onSeek(time);
      }}
      onPointerUp={finish} onLostPointerCapture={finish} onPointerCancel={finish} />
    <span>{formatLrcTime(duration)}</span>
  </>;
});

const LyricsTimingEditor = memo(function LyricsTimingEditor({ name, lines, duration, isPlaying, getTime, onChange, onSeek, onScrubStart, onScrubEnd, onTogglePlay, onSave, onClose }: Props) {
  const [selected, setSelected] = useState(() => {
    const next = lines.findIndex((line) => line.time === null);
    return next < 0 ? 0 : next;
  });
  const [history, setHistory] = useState<Array<{ lines: LyricTimingLine[]; selected: number }>>([]);
  const [editError, setEditError] = useState("");
  const selectedLine = lines[selected];
  const dialogRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const textUndoStarted = useRef(false);
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
    textUndoStarted.current = false;
    setEditError("");
    setHistory((previous) => [...previous.slice(-99), { lines, selected }]);
    onChange(next);
    setSelected(nextSelected);
  }

  function stamp(advance = true) {
    if (selected >= lines.length) return;
    const time = Math.round(Math.max(0, Math.min(duration, getTime())) * 100) / 100;
    change(lines.map((line, index) => index === selected ? { ...line, time } : line), advance ? selected + 1 : selected);
  }

  function editText(text: string) {
    setEditError("");
    // One focused text edit is one undo step, regardless of character count.
    if (!textUndoStarted.current) {
      setHistory((previous) => [...previous.slice(-99), { lines, selected }]);
      textUndoStarted.current = true;
    }
    onChange(lines.map((line, index) => index === selected ? { ...line, text } : line));
  }

  function insertLine(after: boolean) {
    const index = Math.min(lines.length, selected + (after && selectedLine ? 1 : 0));
    change([...lines.slice(0, index), { text: "", time: null }, ...lines.slice(index)], index);
  }

  function deleteLine() {
    if (!selectedLine) return;
    const next = lines.filter((_, index) => index !== selected);
    change(next, Math.max(0, Math.min(selected, next.length - 1)));
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
    textUndoStarted.current = false;
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
            const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), textarea:not(:disabled)") ?? []);
            const first = focusable[0];
            const last = focusable.at(-1);
            if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
            return;
          }
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.repeat) { event.preventDefault(); stamp(false); return; }
          if ((event.target as HTMLElement).matches("input:not([type=range]), textarea")) return;
          if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
          if (event.code === "KeyT") { event.preventDefault(); stamp(); }
          if (event.code === "KeyS") { event.preventDefault(); stamp(false); }
          if (event.code === "Space") { event.preventDefault(); onTogglePlay(); }
          if (event.code === "KeyZ") { event.preventDefault(); undo(); }
        }}>
        <header><div><small>LYRICS · TEXT & TIMING</small><h2 id="lyric-timing-title">{name}</h2></div><button type="button" aria-label="Close timestamp editor" onClick={onClose}><X size={20} /></button></header>
        <p id="lyric-timing-help">Select a line to edit. <kbd>T</kbd> stamps and advances; <kbd>S</kbd> overwrites its time. <kbd>Space</kbd> plays / pauses.</p>
        <div className="lyric-timing-transport">
          <button type="button" aria-label="Rewind 5 seconds" onClick={() => onSeek(Math.max(0, getTime() - 5))}><Rewind size={16} /></button>
          <button type="button" aria-label={isPlaying ? "Pause timing playback" : "Play timing playback"} onClick={onTogglePlay}>{isPlaying ? <Pause size={17} /> : <Play size={17} />}</button>
          <TimingPlayhead duration={duration} getTime={getTime} onSeek={onSeek} onScrubStart={onScrubStart} onScrubEnd={onScrubEnd} />
        </div>
        <div className="lyric-timing-progress"><strong>{count} / {lines.length} timed</strong><span>Draft saved with this track</span><div><button type="button" disabled={!history.length} onClick={undo}><Undo2 size={13} /> Undo</button><button type="button" disabled={!count} onClick={() => change(lines.map((line) => ({ ...line, time: null })), 0)}>Reset</button></div></div>
        <div className="lyric-editor-columns">
          <div className="lyric-timing-lines" aria-label="Lyrics to timestamp">
            {lines.map((line, index) => <button type="button" key={index} ref={(node) => { rowRefs.current[index] = node; }} className={selected === index ? "is-selected" : ""} aria-pressed={selected === index} onClick={() => setSelected(index)}>
              <span>{index + 1}</span><time>{line.time === null ? "--:--.--" : formatLrcTime(line.time)}</time><span className={!line.text ? "is-empty-line" : ""}>{line.text || "Empty line"}</span>
            </button>)}
            {!lines.length && <p className="lyric-empty-lines">No lyric lines. Add a line to start.</p>}
          </div>
          <div className="lyric-editor-pane">
            {selectedLine ? <>
              <label className="lyric-text-edit">Line {selected + 1} lyrics
                <textarea aria-label={`Line ${selected + 1} lyrics`} value={selectedLine.text} rows={3}
                  onFocus={() => { textUndoStarted.current = false; }} onBlur={() => { textUndoStarted.current = false; }}
                  onChange={(event) => editText(event.target.value)} />
              </label>
              <p className="lyric-editor-key-hint"><kbd>⌘ / Ctrl + Enter</kbd> sets the current playback time while typing.</p>
            </> : <p className="lyric-editor-finished">{lines.length ? "All lines stamped. Select a line to keep editing." : "Start with your first lyric line."}</p>}
            <div className="lyric-timing-actions">
              <button className="lyric-timing-overwrite" type="button" disabled={!selectedLine} onClick={() => stamp(false)}><Timer size={17} /> Set current time <kbd>S</kbd></button>
              <button className="lyric-timing-stamp" type="button" disabled={selected >= lines.length} onClick={() => stamp()}>{selected < lines.length ? `Timestamp line ${selected + 1} · T` : "Select a line to timestamp"}</button>
            </div>
            <div className="lyric-line-tools">
              <button type="button" onClick={() => insertLine(false)}><Plus size={13} /> {selectedLine ? "Insert before" : "Add line"}</button>
              {selectedLine && <button type="button" onClick={() => insertLine(true)}><Plus size={13} /> Insert after</button>}
              <button type="button" disabled={!selectedLine} onClick={deleteLine}><Trash2 size={13} /> Delete line</button>
            </div>
            {selectedLine && <div className="lyric-timing-adjust">
              <TimeInput key={`${selected}:${selectedLine.time}`} label={`Line ${selected + 1} time (seconds)`} initial={selectedLine.time} action="Set time" onApply={setTime} />
              <div className="lyric-timing-nudge">
                <button type="button" disabled={selectedLine.time === null} onClick={() => setTime((selectedLine.time ?? 0) - 0.1)}>−0.1 s</button>
                <button type="button" disabled={selectedLine.time === null} onClick={() => setTime((selectedLine.time ?? 0) + 0.1)}>+0.1 s</button>
                <button type="button" disabled={selectedLine.time === null} onClick={() => onSeek(selectedLine.time ?? 0)}>Seek to line</button>
              </div>
            </div>}
            <div className="lyric-timing-adjust lyric-offset-adjust">
              <TimeInput label="All lines offset (seconds)" initial={0} action="Shift all" onApply={shiftAll} />
              <small>Negative = earlier · Positive = later. <kbd>Z</kbd> undoes outside text fields.</small>
            </div>
          </div>
        </div>
        <p className="lyric-timing-hint" role="status">{editError || validation || "Ready to save. Text and timing changes stay in your draft."}</p>
        <footer><button type="button" onClick={onClose}>Save draft</button><button type="button" disabled={!lines.length} onClick={() => onSave(true, "txt")}><Download size={14} /> Download .txt</button><button type="button" disabled={!!validation} onClick={() => onSave(false)}>Save synced lyrics</button><button type="button" className="lyric-timing-download" disabled={!!validation} onClick={() => onSave(true)}><Download size={14} /> Save & download .lrc</button></footer>
      </div>
    </div>
  );
});

export default LyricsTimingEditor;
