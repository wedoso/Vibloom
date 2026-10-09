import { useRef, useState, type CSSProperties } from "react";
import { ListMusic, Maximize2, Minimize2, MoreHorizontal, Music2, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Volume2 } from "lucide-react";
import { albumForTrack, withoutExtension } from "../domain/library";
import type { MobileLibrary } from "./useMobileLibrary";
import { formatTime } from "./format";

/** Scrub locally while dragging; seek once on release, keeping play/pause state. */
function DirectSeek({ library }: { library: MobileLibrary }) {
  const [scrub, setScrub] = useState<number | null>(null);
  const dragging = useRef(false), draft = useRef<number | null>(null);
  const position = scrub ?? library.time, maximum = Math.max(1, library.duration);
  const cancel = () => { dragging.current = false; draft.current = null; setScrub(null); };
  const finish = () => {
    if (!dragging.current) return;
    const target = draft.current; cancel(); if (target !== null) void library.seek(target);
  };
  return <div className="m-direct-seek" style={{ "--seek-progress": `${Math.min(100, position / maximum * 100)}%` } as CSSProperties}>
    <output aria-label="Elapsed time">{formatTime(position)}</output>
    <input aria-label="Playback position" aria-valuetext={`${formatTime(position)} of ${formatTime(library.duration)}`} type="range" min="0" max={maximum} step="0.01" value={Math.min(position, maximum)} disabled={!library.current || !!library.busy}
      onPointerDown={() => { dragging.current = true; draft.current = library.time; setScrub(library.time); }}
      onChange={event => { const value = Number(event.target.value); if (dragging.current) { draft.current = value; setScrub(value); } else void library.seek(value); }}
      onPointerUp={finish} onLostPointerCapture={finish} onPointerCancel={cancel} />
    <output aria-label="Track duration">{formatTime(library.duration)}</output>
  </div>;
}

export default function MobileTransport({ library, inPlayer, onPlayer, onQueue, onOptions, focus, onFocus }: {
  library: MobileLibrary; inPlayer: boolean; onPlayer: () => void; onQueue: () => void; onOptions: () => void; focus: boolean; onFocus: () => void;
}) {
  if (!library.current) return null;
  const album = albumForTrack(library.albums, library.current.id, library.session.playbackAlbumId);
  return <footer className={`m-playback-footer ${inPlayer ? "in-player" : "in-library"}`} aria-label="Playback controls">
    <button className="m-footer-track" aria-label="Open full player" onClick={onPlayer}><span className="m-mini-art">{album?.cover ? <img src={album.cover} alt="" /> : <Music2 size={20} />}</span><span><strong>{withoutExtension(library.current.name)}</strong><small>{library.source === 0 ? "Original" : `Track ${library.source + 1}`} · {library.playing ? "Playing" : "Ready"}</small></span></button>
    <DirectSeek library={library} />
    <div className="m-transport"><button className="m-icon" aria-label="Open queue" onClick={onQueue}><ListMusic size={20} /></button><button className="m-icon" aria-label="Previous track" disabled={!!library.busy} onClick={() => void library.previous()}><SkipBack size={22} /></button><button className="m-play-main" aria-label={library.playing ? "Pause" : "Play"} disabled={!!library.busy} onClick={() => library.playing ? library.pause() : void library.play()}>{library.playing ? <Pause size={26} fill="currentColor" /> : <Play size={26} fill="currentColor" />}</button><button className="m-icon" aria-label="Next track" disabled={!!library.busy} onClick={() => void library.next()}><SkipForward size={22} /></button><button className="m-icon" aria-label="Listening options" onClick={onOptions}><MoreHorizontal size={21} /></button></div>
    <div className="m-footer-extras"><button className="m-icon" aria-label="Shuffle" aria-pressed={library.session.shuffle} onClick={() => library.patchSession({ shuffle: !library.session.shuffle })}><Shuffle size={17} /></button><button className="m-icon" aria-label={`Repeat: ${library.session.repeat}`} aria-pressed={library.session.repeat !== "off"} onClick={() => library.patchSession({ repeat: library.session.repeat === "off" ? "all" : library.session.repeat === "all" ? "one" : "off" })}>{library.session.repeat === "one" ? <Repeat1 size={17} /> : <Repeat size={17} />}</button><button className="m-icon" aria-label={focus ? "Exit focus mode" : "Focus mode"} aria-pressed={focus} onClick={onFocus}>{focus ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button><label className="m-volume"><Volume2 size={17} /><input aria-label="Player volume" type="range" min="0" max="1" step="0.01" value={library.session.volume} onChange={event => library.setVolume(Number(event.target.value))} /></label></div>
  </footer>;
}
