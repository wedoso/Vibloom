import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Download, MoreHorizontal, Pause, Pencil, Play, Plus, Timer, Trash2, Undo2 } from "lucide-react";
import { formatLrcTime, serializeLrc, type LyricTimingLine } from "../lrc";
import type { MobileLibrary } from "./useMobileLibrary";
import { MobileDirectSeek } from "./MobileTransport";
import MobileSheet from "./MobileSheet";

type EditSnapshot = { lines: LyricTimingLine[]; selected: number };

export default function MobileLyricsEditor({ library, onClose }: { library: MobileLibrary; onClose: () => void }) {
  const track = library.current!;
  const [lines, setLines] = useState<LyricTimingLine[]>(() => track.lyricTiming ?? track.lyrics.map(line => ({ ...line })));
  const [original] = useState(() => JSON.stringify(lines));
  const [selected, setSelected] = useState(() => {
    const untimed = lines.findIndex(line => line.time === null);
    if (untimed >= 0) return untimed;
    return lines.reduce((active, line, index) => (line.time ?? Infinity) <= library.time ? index : active, 0);
  });
  const [editing, setEditing] = useState(false), [more, setMore] = useState(false), [discard, setDiscard] = useState(false);
  const [history, setHistory] = useState<EditSnapshot[]>([]), [error, setError] = useState("");
  const list = useRef<HTMLDivElement>(null), rows = useRef<Array<HTMLDivElement | null>>([]), textarea = useRef<HTMLTextAreaElement>(null);
  const dirty = useMemo(() => JSON.stringify(lines) !== original, [lines, original]);
  const timed = lines.filter(line => line.time !== null).length;
  const change = (next: LyricTimingLine[], nextSelected = selected) => {
    setHistory(items => [...items.slice(-29), { lines, selected }]);
    setLines(next); setSelected(nextSelected); setError(""); setDiscard(false);
  };
  const update = (patch: Partial<LyricTimingLine>) => change(lines.map((line, index) => index === selected ? { ...line, ...patch } : line));
  const undo = () => {
    const previous = history.at(-1); if (!previous) return;
    setLines(previous.lines); setSelected(previous.selected); setHistory(items => items.slice(0, -1)); setError(""); setMore(false); setEditing(false);
  };
  useEffect(() => {
    const box = list.current, row = rows.current[selected]; if (!box || !row) return;
    const reveal = () => {
      const focus = document.activeElement;
      const target = focus instanceof HTMLElement && row.contains(focus) ? focus : row;
      const a = box.getBoundingClientRect(), b = target.getBoundingClientRect();
      if (b.top < a.top || b.bottom > a.bottom) box.scrollTo({ top: box.scrollTop + b.top - a.top - 8, behavior: "instant" });
    };
    const frame = requestAnimationFrame(reveal), observer = new ResizeObserver(reveal); observer.observe(box);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [selected, editing, lines.length]);
  useEffect(() => { if (editing) textarea.current?.focus({ preventScroll: true }); }, [editing, selected]);
  const save = (download: boolean) => {
    setMore(false);
    try {
      const text = serializeLrc(lines, track.lyricMetadata);
      if (download) {
        const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
        const anchor = document.createElement("a"); anchor.href = url; anchor.download = track.name.replace(/\.[^.]+$/u, "") + ".lrc"; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      } else {
        library.patchTracks(items => items.map(item => item.id === track.id ? { ...item, lyrics: lines.map(line => ({ time: line.time!, text: line.text })), lyricTiming: undefined } : item)); onClose();
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Check the lyric timestamps."); }
  };
  const close = () => { if (dirty) { setMore(false); setDiscard(true); } else onClose(); };
  const stamp = () => {
    if (!lines[selected]) return;
    change(lines.map((line, index) => index === selected ? { ...line, time: Math.round(library.time * 1000) / 1000 } : line), Math.min(selected + 1, lines.length - 1));
    setEditing(false);
  };
  return <MobileSheet title="Edit lyrics" className="m-lyrics-sheet" onClose={close}>
    <div className="m-lyrics-editor-toolbar">
      <button className="m-icon" aria-label={library.playing ? "Pause lyric preview" : "Play lyric preview"} disabled={!!library.busy} onClick={() => library.playing ? library.pause() : void library.play()}>{library.playing ? <Pause size={19} /> : <Play size={19} />}</button>
      <MobileDirectSeek library={library} />
    </div>
    <div className="m-lyrics-editor-caption"><span>Tap a line · stamp its time</span><output aria-label="Timed lyric lines">{timed}/{lines.length} timed</output></div>
    <div className="m-lyrics-editor-list" ref={list} aria-label="Lyric lines">
      {lines.map((line, index) => <div ref={node => { rows.current[index] = node; }} className={`m-lyrics-editor-row ${selected === index ? "is-selected" : ""}`} key={index}>
        <div className="m-lyrics-editor-line">
          <button className="m-lyrics-editor-select" aria-label={`Select lyric line ${index + 1}`} aria-pressed={selected === index} onClick={() => { setSelected(index); setEditing(false); setMore(false); }}><time>{line.time === null ? "— — : — —" : formatLrcTime(line.time)}</time><span>{line.text || "New lyric line"}</span></button>
          <button className="m-icon" aria-label={`Edit lyric line ${index + 1}`} aria-expanded={selected === index && editing} onClick={() => { setSelected(index); setEditing(selected === index ? !editing : true); setMore(false); }}><Pencil size={16} /></button>
        </div>
        {selected === index && editing && <div className="m-lyrics-editor-fields">
          <textarea ref={textarea} aria-label={`Lyric line ${index + 1}`} value={line.text} rows={2} onChange={event => update({ text: event.target.value })} />
          <div className="m-lyrics-editor-field-actions"><label><span>Seconds</span><input aria-label={`Time for line ${index + 1} in seconds`} type="number" inputMode="decimal" min="0" step="0.01" value={line.time ?? ""} placeholder="Untimed" onChange={event => update({ time: event.target.value === "" ? null : Number(event.target.value) })} /></label><button className="m-icon m-danger" aria-label={`Delete lyric line ${index + 1}`} onClick={() => { change(lines.filter((_, i) => i !== index), Math.max(0, Math.min(index, lines.length - 2))); setEditing(false); }}><Trash2 size={17} /></button><button className="m-icon" aria-label="Done editing line" onClick={() => setEditing(false)}><Check size={19} /></button></div>
        </div>}
      </div>)}
      {!lines.length && <p className="m-muted">Add your first lyric line from the actions menu.</p>}
    </div>
    <div className="m-lyrics-editor-bottom">
      {error && <p className="m-error" role="alert">{error}</p>}
      {discard ? <div className="m-lyrics-discard"><span>Discard unsaved edits?</span><button className="m-button" onClick={() => setDiscard(false)}>Keep editing</button><button className="m-button m-danger" onClick={onClose}>Discard</button></div> : <>
        {more && <div className="m-lyrics-actions" aria-label="Lyric actions"><button className="m-menu-action" onClick={() => { const index = lines.length ? selected + 1 : 0; change([...lines.slice(0, index), { time: null, text: "" }, ...lines.slice(index)], index); setMore(false); setEditing(true); }}><Plus size={18} />Add line</button><button className="m-menu-action" disabled={!history.length} onClick={undo}><Undo2 size={18} />Undo last edit</button><button className="m-menu-action" onClick={() => save(true)}><Download size={18} />Export LRC</button></div>}
        <div className="m-lyrics-editor-controls"><button className="m-icon m-bordered" aria-label="More lyric actions" aria-expanded={more} onClick={() => setMore(value => !value)}><MoreHorizontal size={21} /></button><button className="m-button" aria-label={`Stamp line ${selected + 1} and select next`} disabled={!lines.length || !!library.busy} onClick={stamp}><Timer size={17} /><span>{selected === lines.length - 1 ? "Stamp last line" : "Stamp & next"}</span></button><button className="m-button m-primary" aria-label="Save lyrics" onClick={() => save(false)}>Save</button></div>
      </>}
    </div>
  </MobileSheet>;
}
