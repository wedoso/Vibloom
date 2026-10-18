import { downloadTrackLyrics } from "../platform/lyricExport";
import { validateLyricTiming } from "../lrc";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Download, FileText, LocateFixed, Pencil } from "lucide-react";
import type { MobileLibrary } from "./useMobileLibrary";

/** Desktop lyric centering/progress, with touch browsing and tap-to-seek. */
export default function MobileLyrics({ library, onAttach, onEdit, expanded = false }: {
  library: MobileLibrary; onAttach: () => void; onEdit: () => void; expanded?: boolean;
}) {
  const viewport = useRef<HTMLDivElement>(null), rows = useRef<Array<HTMLButtonElement | null>>([]);
  const [following, setFollowing] = useState(true);
  const lines = library.current?.lyrics ?? [], timing = library.current?.lyricTiming ?? [];
  const exportLyrics = (format: "lrc" | "txt") => {
    if (!library.current) return;
    try { downloadTrackLyrics(library.current, format); } catch (error) { library.setMessage(error instanceof Error ? error.message : "Lyrics could not be exported."); }
  };
  const active = lines.reduce((index, line, next) => line.time <= library.time + .03 ? next : index, -1);
  const line = lines[active], next = lines[active + 1];
  const progress = line ? next && next.time > line.time ? Math.min(100, Math.max(0, (library.time - line.time) / (next.time - line.time) * 100)) : 100 : 0;
  useEffect(() => {
    const box = viewport.current, row = rows.current[Math.max(0, active)];
    if (!box || !row) return;
    const center = () => {
      box.style.setProperty("--m-lyric-pad", `${Math.max(0, box.clientHeight / 2 - 24)}px`);
      if (!following) return;
      const a = box.getBoundingClientRect(), b = row.getBoundingClientRect();
      box.scrollTo({ top: box.scrollTop + b.top - a.top - box.clientHeight / 2 + b.height / 2, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    };
    center();
    const observer = new ResizeObserver(center); observer.observe(box); observer.observe(row);
    return () => observer.disconnect();
  }, [active, following, expanded]);
  return <section className={`m-live-lyrics ${expanded ? "is-expanded" : ""} ${library.source ? "is-comparison" : ""}`} aria-label="Scrolling lyrics">
    {expanded && <header><span><FileText size={14} />{timing.length && !lines.length ? "Lyrics · add timing" : "Words, in time"}</span><div>{!following && lines.length > 0 && <button className="m-icon" aria-label="Follow current lyric" onClick={() => setFollowing(true)}><LocateFixed size={17} /></button>}<button className="m-icon" aria-label="Edit lyric timing" onClick={onEdit}><Pencil size={17} /></button><button className="m-icon" aria-label="Attach lyrics" onClick={onAttach}><FileText size={17} /></button></div></header>}
    {!expanded && (lines.length > 0 || timing.length > 0) && <button className="m-text-button m-lyric-options" onClick={onEdit}><Pencil size={14} />Edit lyrics</button>}
    {lines.length ? <div className="m-lyrics-viewport" ref={viewport} onPointerDown={() => setFollowing(false)} onWheel={() => setFollowing(false)} tabIndex={0} aria-label="Synced lyric lines"><div className="m-lyrics">{lines.map((item, index) => <button key={`${item.time}-${index}`} ref={node => { rows.current[index] = node; }} className={index === active ? "is-current" : index < active ? "is-past" : ""} aria-current={index === active ? "true" : undefined} style={{ "--lyric-progress": `${index === active ? progress : 0}%` } as CSSProperties} onClick={() => { setFollowing(true); void library.seek(item.time); }}><span>{item.text || "♪"}</span></button>)}</div></div> : timing.length ? <div className="m-lyrics-viewport m-plain-lyrics">{timing.map((item, index) => <p key={index}>{item.text}</p>)}</div> : <button className="m-lyrics-empty" aria-label="Attach LRC / TXT lyrics" onClick={onAttach}><FileText size={17} aria-hidden="true" /><span>Add lyrics<small>Choose an LRC / TXT file</small></span></button>}
    {expanded && (lines.length > 0 || timing.length > 0) && <div className="lyric-export-actions"><button className="m-button" onClick={() => exportLyrics("txt")}><Download size={16} />Export TXT</button><button className="m-button" disabled={!!validateLyricTiming(timing.length ? timing : lines)} onClick={() => exportLyrics("lrc")}><Download size={16} />Export LRC</button></div>}
  </section>;
}
