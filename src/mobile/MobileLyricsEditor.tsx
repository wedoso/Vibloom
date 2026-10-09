import { useState } from "react";
import { Check, Download, Timer, Plus, Trash2 } from "lucide-react";
import { formatLrcTime, serializeLrc, type LyricTimingLine } from "../lrc";
import type { MobileLibrary } from "./useMobileLibrary";
import MobileSheet from "./MobileSheet";

export default function MobileLyricsEditor({ library, onClose }: { library: MobileLibrary; onClose: () => void }) {
  const track = library.current!;
  const [lines, setLines] = useState<LyricTimingLine[]>(() => track.lyricTiming ?? track.lyrics.map(line => ({ ...line })));
  const [error, setError] = useState("");
  const save = (download: boolean) => {
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
  return <MobileSheet title="Edit lyric timing" onClose={onClose}>
    <p className="m-muted">Play the song, then stamp each line at the current time. You can also edit its timestamp.</p>
    <div className="m-editor-transport"><button className="m-button" onClick={() => library.playing ? library.pause() : void library.play()}>{library.playing ? "Pause" : "Play"}</button><output>{formatLrcTime(library.time)}</output></div>
    <div className="m-lyric-editor">{lines.map((line, index) => <div key={index}>
      <label><span>Line {index + 1}</span><textarea aria-label={`Lyric line ${index + 1}`} value={line.text} rows={2} onChange={event => setLines(items => items.map((item, i) => i === index ? { ...item, text: event.target.value } : item))} /></label>
      <div><input aria-label={`Time for line ${index + 1} in seconds`} type="number" min="0" step="0.01" placeholder="Seconds" value={line.time ?? ""} onChange={event => setLines(items => items.map((item, i) => i === index ? { ...item, time: event.target.value === "" ? null : Number(event.target.value) } : item))} /><button className="m-icon" aria-label={`Stamp line ${index + 1}`} onClick={() => setLines(items => items.map((item, i) => i === index ? { ...item, time: library.time } : item))}><Timer size={19} /></button><button className="m-icon" aria-label={`Delete lyric line ${index + 1}`} onClick={() => setLines(items => items.filter((_, i) => i !== index))}><Trash2 size={18} /></button></div>
    </div>)}</div>
    <button className="m-button" onClick={() => setLines(items => [...items, { time: null, text: "" }])}><Plus size={17} />Add line</button>
    {error && <p className="m-error" role="alert">{error}</p>}
    <div className="m-sheet-actions"><button className="m-button" onClick={() => save(true)}><Download size={17} />Download LRC</button><button className="m-button m-primary" onClick={() => save(false)}><Check size={17} />Save lyrics</button></div>
  </MobileSheet>;
}
