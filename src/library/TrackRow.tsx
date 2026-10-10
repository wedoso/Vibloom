import { memo, type DragEvent, type RefObject } from "react";
import { LibraryIcon } from "./LibraryIcons";
import type { LibraryAlbum, LibraryTrack } from "../domain/library";
import type { VocalJob } from "../audio/vocals/jobStore";
import TrackActions from "./TrackActions";
import { TrackStatus, TrackVocalProgress } from "./TrackStatus";

export type TrackRowHandlers = {
  play: (track: LibraryTrack) => void;
  select: (id: string, selected: boolean) => void;
  dragStart: (event: DragEvent<HTMLElement>, id: string) => void;
  dragOver: (event: DragEvent<HTMLElement>, id: string) => void;
  drop: (event: DragEvent<HTMLElement>, id: string) => void;
  toggleMenu: (id: string) => void;
  closeMenu: (id: string) => void;
  openPlayer: (track: LibraryTrack) => void;
  next: (track: LibraryTrack) => void;
  queue: (track: LibraryTrack) => void;
  prepare: (track: LibraryTrack) => void;
  cancel: (track: LibraryTrack) => void;
  attach: (track: LibraryTrack) => void;
  removeLyrics: (track: LibraryTrack) => void;
  editTiming: (track: LibraryTrack) => void;
  cache: (track: LibraryTrack) => void;
  reconnect: () => void;
  addToAlbum: (track: LibraryTrack, albumId: string) => void;
  removeFromAlbum: (track: LibraryTrack) => void;
  moveInAlbum: (track: LibraryTrack, edge: "before" | "after") => void;
};

/** Stable records and per-row state keep transport ticks out of song rows. */
export default memo(function TrackRow({ track, name, time, index, active, playing, album, albums, selected, selecting, menuOpen, dragged, dropEdge, job, handlers }: {
  track: LibraryTrack; name: string; time: string; index: number; active: boolean; playing: boolean;
  album?: LibraryAlbum; albums: LibraryAlbum[]; selected: boolean; selecting: boolean;
  menuOpen: boolean; dragged: boolean; dropEdge?: "before" | "after"; job?: VocalJob;
  handlers: RefObject<TrackRowHandlers | null>;
}) {
  const unavailable = track.availability === "reconnect" || track.availability === "missing";
  return <div className={`track-row ${active ? "is-active" : ""} ${unavailable ? "is-unavailable" : ""} ${dragged ? "is-album-dragging" : ""} ${dropEdge ? `album-drop-${dropEdge}` : ""}`} role="row" data-track-id={track.id} draggable
    onDragStart={event => handlers.current?.dragStart(event, track.id)} onDragOver={event => handlers.current?.dragOver(event, track.id)} onDrop={event => handlers.current?.drop(event, track.id)}
    onDoubleClick={event => { if (!(event.target as Element).closest("button, input, [role='dialog']")) handlers.current?.play(track); }}>
    <button className="track-index" type="button" aria-label={`Play ${name}`} title={album ? "Drag row to reorder · Click to play" : undefined} onClick={() => handlers.current?.play(track)}>{active && playing ? <LibraryIcon name="AudioLines" size={14} /> : String(index + 1).padStart(2, "0")}{album && <LibraryIcon name="GripVertical" className="album-drag-grip" size={14} hidden />}</button>
    <span className="track-title"><label className="vocal-track-select">{selecting && <input type="checkbox" checked={selected} aria-label={`Select ${name} for vocal preparation`} onDoubleClick={event => event.stopPropagation()} onChange={event => handlers.current?.select(track.id, event.target.checked)} />}<strong>{name}</strong></label><small title={track.name}>{track.sourceLabel} · {track.name}</small>
      <TrackVocalProgress trackName={name} job={job} onCancel={() => handlers.current?.cancel(track)} onRetry={() => handlers.current?.prepare(track)} />
    </span>
    <TrackStatus track={track} job={job} />
    <span className="track-duration">{time}</span>
    <TrackActions track={track} trackName={name} job={job} open={menuOpen} albums={albums} activeAlbum={album}
      onToggle={() => handlers.current?.toggleMenu(track.id)} onClose={() => handlers.current?.closeMenu(track.id)}
      onOpenPlayer={() => handlers.current?.openPlayer(track)} onNext={() => handlers.current?.next(track)} onQueue={() => handlers.current?.queue(track)}
      onPrepare={() => handlers.current?.prepare(track)} onCancelVocals={() => handlers.current?.cancel(track)}
      onAttachLyrics={() => handlers.current?.attach(track)} onRemoveLyrics={() => handlers.current?.removeLyrics(track)} onEditTiming={() => handlers.current?.editTiming(track)}
      onToggleCache={() => handlers.current?.cache(track)} onReconnect={() => handlers.current?.reconnect()}
      onAddToAlbum={id => handlers.current?.addToAlbum(track, id)} onRemoveFromAlbum={() => handlers.current?.removeFromAlbum(track)} onMoveInAlbum={edge => handlers.current?.moveInAlbum(track, edge)} />
  </div>;
});
