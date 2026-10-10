import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, FileText, FolderHeart, FolderOpen, HardDrive, Headphones, ListEnd, ListPlus, MicVocal, MoreHorizontal, RefreshCw, Timer, Trash2, X } from "lucide-react";
import StyledSelect from "../StyledSelect";
import type { LibraryAlbum, LibraryTrack } from "../domain/library";
import type { VocalJob } from "../audio/vocals/jobStore";
import { useVocalPreparationState } from "./TrackStatus";
import "./library-tracks.css";

type Props = {
  track: LibraryTrack; trackName: string; job?: VocalJob; open: boolean; albums: LibraryAlbum[]; activeAlbum?: LibraryAlbum;
  onToggle: () => void; onClose: () => void; onOpenPlayer: () => void; onNext: () => void; onQueue: () => void;
  onPrepare: () => void; onCancelVocals: () => void; onAttachLyrics: () => void; onRemoveLyrics: () => void;
  onEditTiming: () => void; onToggleCache: () => void; onReconnect: () => void; onAddToAlbum: (id: string) => void;
  onRemoveFromAlbum: () => void; onMoveInAlbum: (direction: "before" | "after") => void;
};
type View = "main" | "lyrics" | "albums" | "storage";
function Action({ icon, children, onClick, next = false, disabled = false, danger = false }: { icon: ReactNode; children: ReactNode; onClick: () => void; next?: boolean; disabled?: boolean; danger?: boolean }) {
  return <button type="button" className={danger ? "is-destructive" : ""} disabled={disabled} onClick={onClick}>{icon}<span>{children}</span>{next && <ChevronRight size={13} />}</button>;
}

export default function TrackActions(props: Props) {
  const { track, job, open, albums, activeAlbum, onToggle, onClose } = props;
  const name = props.trackName, id = useId();
  const trigger = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null);
  const dismiss = useRef(onClose);
  const [view, setView] = useState<View>("main");
  const state = useVocalPreparationState(track, job);
  const busy = state === "working" || state === "queued";
  const unavailable = track.availability === "missing" || track.availability === "reconnect";
  const hasLyrics = track.lyrics.length > 0 || !!track.lyricTiming?.length;
  useEffect(() => { dismiss.current = onClose; }, [onClose]);
  useLayoutEffect(() => {
    if (!open) return;
    const menu = popup.current!, button = trigger.current!;
    const place = () => {
      const anchor = button.getBoundingClientRect();
      if (anchor.bottom < 0 || anchor.top > window.innerHeight) { dismiss.current(); return; }
      menu.style.width = `${Math.min(252, window.innerWidth - 24)}px`;
      menu.style.maxHeight = `${Math.min(440, window.innerHeight - 24)}px`;
      const height = menu.getBoundingClientRect().height;
      const below = window.innerHeight - anchor.bottom - 18, above = anchor.top - 18;
      const upward = below < height && above > below;
      menu.style.maxHeight = `${Math.max(60, Math.min(440, upward ? above : below))}px`;
      menu.style.left = `${Math.max(12, Math.min(anchor.right - menu.getBoundingClientRect().width, window.innerWidth - menu.getBoundingClientRect().width - 12))}px`;
      menu.style.top = `${upward ? Math.max(12, anchor.top - menu.getBoundingClientRect().height - 6) : anchor.bottom + 6}px`;
    };
    if (!menu.matches(":popover-open")) menu.showPopover();
    place();
    menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const scroll = (event: Event) => { if (!menu.contains(event.target as Node)) place(); };
    window.addEventListener("resize", place); window.addEventListener("scroll", scroll, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", scroll, true); };
  }, [open, view]);
  const changeView = (next: View) => setView(next);
  const act = (action: () => void) => { action(); onClose(); };
  const keyboard = (event: KeyboardEvent<HTMLSpanElement>) => {
    event.stopPropagation();
    if (!open) return;
    if (event.key === "Escape") { event.preventDefault(); popup.current?.hidePopover(); onClose(); trigger.current?.focus(); return; }
    const buttons = Array.from(popup.current!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")).filter(button => button.getClientRects().length > 0);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next: HTMLButtonElement | undefined;
    if (event.key === "ArrowDown") next = buttons[(index + 1) % buttons.length];
    if (event.key === "ArrowUp") next = buttons[(index + buttons.length - 1) % buttons.length];
    if (event.key === "Home") next = buttons[0];
    if (event.key === "End") next = buttons.at(-1);
    if (event.key === "ArrowLeft" && view !== "main") { event.preventDefault(); setView("main"); }
    if (next) { event.preventDefault(); next.focus(); }
  };
  return <span className="track-menu-wrap" onKeyDown={keyboard} onDoubleClick={event => event.stopPropagation()}>
    <button ref={trigger} type="button" aria-label={`Actions for ${name}`} aria-expanded={open} aria-controls={open ? id : undefined} aria-haspopup="dialog" className={open ? "is-open" : ""} onClick={() => { if (!open) setView("main"); onToggle(); }}><MoreHorizontal size={18} /></button>
    {open && <div ref={popup} id={id} className="track-popover track-action-popover" popover="auto" role="dialog" aria-label={`Actions for ${name}`} onToggle={event => { if (event.newState === "closed") onClose(); }}>
      {view === "main" ? <>
        <div className="track-action-heading"><strong title={name}>{name}</strong>{state === "ready" && <small><MicVocal size={12} /> Vocal lip sync ready</small>}</div>
        <Action icon={<Headphones size={16} />} onClick={() => act(props.onOpenPlayer)}>Open in Player</Action>
        <Action icon={<ListPlus size={16} />} onClick={() => act(props.onNext)}>Play next</Action>
        <Action icon={<ListEnd size={16} />} onClick={() => act(props.onQueue)}>Add to queue</Action>
        <hr />
        {state !== "ready" && <Action icon={busy ? <X size={16} /> : state === "error" ? <RefreshCw size={16} /> : <MicVocal size={16} />} disabled={unavailable && !busy} onClick={() => act(busy ? props.onCancelVocals : props.onPrepare)}>{busy ? "Cancel preparation" : state === "error" ? "Retry lip sync" : state === "outdated" ? "Reprepare lip sync" : "Prepare vocal lip sync"}</Action>}
        <Action icon={<FileText size={16} />} next onClick={() => changeView("lyrics")}>Lyrics…</Action>
        {(albums.length > 0 || activeAlbum) && <Action icon={<FolderHeart size={16} />} next onClick={() => changeView("albums")}>Albums…</Action>}
        <hr /><Action icon={<HardDrive size={16} />} next onClick={() => changeView("storage")}>On this device…</Action>
      </> : <>
        <button type="button" className="track-action-back" onClick={() => changeView("main")}><ChevronLeft size={13} /><span>Song actions</span></button>
        <div className="track-action-heading"><strong>{view === "lyrics" ? "Lyrics" : view === "albums" ? "Albums" : "On this device"}</strong><small title={name}>{name}</small></div>
        {view === "lyrics" && <>
          <div className="track-action-file"><FileText size={17} /><div><strong>{hasLyrics ? track.lyricsFileName || "Lyrics attached" : "No lyrics attached"}</strong><small>{hasLyrics ? track.lyrics.length ? "Synced lyrics" : "TXT lyrics" : "Choose an LRC or TXT file"}</small></div></div>
          {(track.lyrics.length > 0 || track.lyricTiming !== undefined) && <Action icon={<Timer size={16} />} onClick={() => act(props.onEditTiming)}>{track.lyrics.length ? "Edit timing" : "Timestamp lyrics"}</Action>}
          <Action icon={<FolderOpen size={16} />} onClick={() => act(props.onAttachLyrics)}>{hasLyrics ? "Replace lyrics (.lrc / .txt)" : "Attach lyrics (.lrc / .txt)"}</Action>
          {hasLyrics && <><hr /><Action icon={<Trash2 size={16} />} danger onClick={() => act(props.onRemoveLyrics)}>Remove lyrics</Action></>}
        </>}
        {view === "albums" && <>
          <label className="track-action-album-select">Add to album<StyledSelect label={`Add ${name} to album`} value="" onChange={value => { if (value) act(() => props.onAddToAlbum(value)); }} options={[{ value: "", label: "Choose album…", disabled: true }, ...albums.filter(album => !album.trackIds.includes(track.id)).map(album => ({ value: album.id, label: album.name }))]} /></label>
          {albums.filter(album => album.trackIds.includes(track.id)).map(album => <small className="track-action-membership" key={album.id}><FolderHeart size={12} /> {album.name}</small>)}
          {activeAlbum && <>
            <hr /><Action icon={<Trash2 size={16} />} onClick={() => act(props.onRemoveFromAlbum)}>Remove from album</Action>
            <Action icon={<ArrowUp size={16} />} disabled={activeAlbum.trackIds.indexOf(track.id) <= 0} onClick={() => act(() => props.onMoveInAlbum("before"))}>Move up in album</Action>
            <Action icon={<ArrowDown size={16} />} disabled={activeAlbum.trackIds.indexOf(track.id) === activeAlbum.trackIds.length - 1} onClick={() => act(() => props.onMoveInAlbum("after"))}>Move down in album</Action>
          </>}
        </>}
        {view === "storage" && <>
          <p className="track-action-description">{unavailable ? "Reconnect the original audio file to play this song." : track.persistence === "cached" ? "Audio is kept on this device. The original file stays where it is." : "Keep a local copy to play after reopening."}</p>
          {unavailable && <Action icon={<FolderOpen size={16} />} onClick={() => act(props.onReconnect)}>Reconnect audio…</Action>}
          <Action icon={track.persistence === "cached" ? <Trash2 size={16} /> : <HardDrive size={16} />} disabled={unavailable && track.persistence !== "cached"} onClick={() => act(props.onToggleCache)}>{track.persistence === "cached" ? "Remove cached copy" : "Keep on this device"}</Action>
        </>}
      </>}
    </div>}
  </span>;
}
