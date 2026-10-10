import { memo, type RefObject } from "react";
import type { LibraryAlbum, LibraryTrack } from "../domain/library";
import { vocalJobKey, type VocalJob } from "../audio/vocals/jobStore";
import TrackRow, { type TrackRowHandlers } from "./TrackRow";
import RenderGroups from "./RenderGroups";
import { LibraryIcons } from "./LibraryIcons";
/** The entire list is independent of transport time, not only individual rows. */
export default memo(function TrackRows({ tracks, activeId, playing, album, albums, selectedIds, selecting, menuId, draggedId, drop, jobs, handlers, displayName, duration }: {
  tracks: LibraryTrack[]; activeId: string; playing: boolean; album?: LibraryAlbum; albums: LibraryAlbum[];
  selectedIds: string[]; selecting: boolean; menuId: string; draggedId: string | null;
  drop: { id: string; edge: "before" | "after" } | null; jobs: Record<string, VocalJob>; handlers: RefObject<TrackRowHandlers | null>;
  displayName: (name: string) => string; duration: (seconds: number) => string;
}) {
  const selected = new Set(selectedIds);
  return <LibraryIcons shared={tracks.length >= 128}><RenderGroups rowHeight={64} table>{tracks.map((track, index) => <TrackRow key={track.id} track={track} name={displayName(track.name)} time={track.duration ? duration(track.duration) : "—"} index={index}
    active={track.id === activeId} playing={track.id === activeId && playing} album={album} albums={albums} selected={selected.has(track.id)} selecting={selecting} menuOpen={menuId === track.id}
    dragged={draggedId === track.id} dropEdge={drop?.id === track.id ? drop.edge : undefined} job={jobs[vocalJobKey(track)]} handlers={handlers} />)}</RenderGroups></LibraryIcons>;
});
