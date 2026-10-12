import { useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { ListMusic, Maximize2, Minimize2, MoreHorizontal, Music2, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Volume2 } from "lucide-react";
import { albumForTrack, trackDisplayName } from "../domain/library";
import type { MobileLibrary } from "./useMobileLibrary";
import { mobileTrackLabel } from "./comparison";
import { formatTime } from "./format";

/** Scrub locally while dragging; seek once on release, keeping play/pause state. */
export function MobileDirectSeek({ library }: { library: MobileLibrary }) {
  const [scrub, setScrub] = useState<number | null>(null);
  const dragging = useRef(false), draft = useRef<number | null>(null);
  const pointer = useRef<number | null>(null);
  const position = scrub ?? library.time, maximum = Math.max(1, library.duration);
  const cancel = () => { dragging.current = false; pointer.current = null; draft.current = null; setScrub(null); };
  const preview = (event: PointerEvent<HTMLInputElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    // Match the 18px native thumb's travel and make track taps work on iOS.
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left - 9) / Math.max(1, rect.width - 18)));
    draft.current = Math.round(ratio * maximum * 100) / 100;
    setScrub(draft.current);
  };
  const finish = () => {
    if (!dragging.current) return;
    const target = draft.current; cancel(); if (target !== null) void library.seek(target);
  };
  return <div className="m-direct-seek" style={{ "--seek-progress": `${Math.min(100, position / maximum * 100)}%` } as CSSProperties}>
    <output aria-label="Elapsed time">{formatTime(position)}</output>
    <input aria-label="Playback position" aria-valuetext={`${formatTime(position)} of ${formatTime(library.duration)}`} type="range" min="0" max={maximum} step="0.01" value={Math.min(position, maximum)} disabled={!library.current || !!library.busy}
      onPointerDown={event => {
        if (event.button !== 0 || dragging.current) return;
        event.preventDefault(); dragging.current = true; pointer.current = event.pointerId;
        event.currentTarget.focus({ preventScroll: true });
        if (event.nativeEvent.isTrusted) event.currentTarget.setPointerCapture(event.pointerId);
        preview(event);
      }}
      onPointerMove={event => { if (dragging.current && pointer.current === event.pointerId) preview(event); }}
      onChange={event => { const value = Number(event.target.value); if (dragging.current) { draft.current = value; setScrub(value); } else void library.seek(value); }}
      onPointerUp={event => { if (dragging.current && pointer.current === event.pointerId) { preview(event); finish(); } }} onLostPointerCapture={finish} onPointerCancel={cancel} />
    <output aria-label="Track duration">{formatTime(library.duration)}</output>
  </div>;
}

export default function MobileTransport({ library, inPlayer, onPlayer, onQueue, onOptions, focus, onFocus }: {
  library: MobileLibrary; inPlayer: boolean; onPlayer: () => void; onQueue: () => void; onOptions: () => void; focus: boolean; onFocus: () => void;
}) {
  if (!library.current) return null;
  const album = albumForTrack(library.albums, library.current.id, library.session.playbackAlbumId);
  return <footer className={`m-playback-footer ${inPlayer ? "in-player" : "in-library"}`} aria-label="Playback controls">
    <button className="m-footer-track" aria-label="Open full player" onClick={onPlayer}><span className="m-mini-art">{album?.cover ? <img src={album.cover} alt="" /> : <Music2 size={20} />}</span><span><strong>{trackDisplayName(library.current.name)}</strong><small>{`Track ${mobileTrackLabel(library.source)}`} · {library.playing ? "Playing" : "Ready"}</small></span></button>
    <MobileDirectSeek library={library} />
    <div className="m-transport"><button className="m-icon" aria-label="Open queue" onClick={onQueue}><ListMusic size={20} /></button><button className="m-icon" aria-label="Previous track" disabled={!!library.busy} onClick={() => void library.previous()}><SkipBack size={22} /></button><button className="m-play-main" aria-label={library.playing ? "Pause" : "Play"} disabled={!!library.busy} onClick={() => library.playing ? library.pause() : void library.play()}>{library.playing ? <Pause size={26} fill="currentColor" /> : <Play size={26} fill="currentColor" />}</button><button className="m-icon" aria-label="Next track" disabled={!!library.busy} onClick={() => void library.next()}><SkipForward size={22} /></button><button className="m-icon" aria-label="Listening options" onClick={onOptions}><MoreHorizontal size={21} /></button></div>
    <div className="m-footer-extras"><button className="m-icon" aria-label="Shuffle" aria-pressed={library.session.shuffle} onClick={() => library.patchSession({ shuffle: !library.session.shuffle })}><Shuffle size={17} /></button><button className="m-icon" aria-label={`Repeat: ${library.session.repeat}`} aria-pressed={library.session.repeat !== "off"} onClick={() => library.patchSession({ repeat: library.session.repeat === "off" ? "all" : library.session.repeat === "all" ? "one" : "off" })}>{library.session.repeat === "one" ? <Repeat1 size={17} /> : <Repeat size={17} />}</button><button className="m-icon" aria-label={focus && inPlayer ? "Exit focus mode" : "Focus mode"} aria-pressed={focus && inPlayer} onClick={onFocus}>{focus ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button><label className="m-volume" style={{ "--volume-progress": `${library.session.volume * 100}%` } as CSSProperties}><Volume2 size={17} /><input aria-label="Player volume" type="range" min="0" max="1" step="0.01" value={library.session.volume} onChange={event => library.setVolume(Number(event.target.value))} /></label></div>
  </footer>;
}
