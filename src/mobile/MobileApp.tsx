import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { ArrowDown, ArrowUp, AudioLines, Check, ChevronLeft, ChevronRight, Database, Download, FileAudio, FileText, FolderOpen, Headphones, Library, ListMusic, MoreHorizontal, Music2, Play, Plus, Maximize2, Minimize2, Repeat, Repeat1, ScanFace, Search, Menu, MicVocal, ShieldCheck, Shuffle, SlidersHorizontal, Trash2, Upload, Volume2 } from "lucide-react";
import BrandMark from "../BrandMark";
import { APP_VERSION } from "../appVersion";
import { comparisonsOf, withoutExtension, type LibraryAlbum, type LibraryTrack } from "../domain/library";
import { COMPANIONS, type CompanionId } from "../live2d/models";
import { filePickerPolicy } from "../platform/filePickerPolicy";
import MobileSheet from "./MobileSheet";
import MobileCompanion from "./MobileCompanion";
import MobileVocals from "./MobileVocals";
import MobileTransport from "./MobileTransport";
import { formatTime } from "./format";
import MobileLyrics from "./MobileLyrics";
import MobileRoomOrbit from "./MobileRoomOrbit";
import { mobileTrackLabel } from "./comparison";
import MobileLyricsEditor from "./MobileLyricsEditor";
import { useMobileLibrary, type MobileLibrary } from "./useMobileLibrary";
import { bindMobileViewport } from "./viewport";
import "./mobile.css";
import "./editorial.css";

type Page = "library" | "player";
type Panel = { kind: "vocals"; id?: string } | { kind: "import" | "queue" | "clear" | "lyrics" | "words" | "volume" | "room" | "navigation" | "versions" | "storage" | "companion" | "clear-cache" | "clear-queue" } | { kind: "track" | "remove"; id: string } | { kind: "version"; source: number } | { kind: "album"; album?: LibraryAlbum } | null;
const sizeLabel = (bytes: number) => bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const trackName = (track: { name: string }) => withoutExtension(track.name);

function SongRows({ tracks, library, onOptions }: { tracks: LibraryTrack[]; library: MobileLibrary; onOptions: (id: string) => void }) {
  return <div className="m-song-list">{tracks.map((track, index) => <div className={`m-song-row ${library.current?.id === track.id ? "is-current" : ""}`} key={track.id}>
    <button className="m-song-main" disabled={!library.ready || library.importing} onClick={() => void library.load(track.id, true, 0)} aria-label={`Play ${trackName(track)}`}>
      <span className="m-song-number">{library.current?.id === track.id && library.playing ? <AudioLines size={18} /> : String(index + 1).padStart(2, "0")}</span><span className="m-song-copy"><strong>{trackName(track)}</strong><small>{track.availability === "missing" || track.availability === "reconnect" ? "Reconnect source file" : track.sourceLabel}{track.lyricsFileName ? " · Lyrics" : ""}{library.vocals.state(track).working ? " · Preparing vocals" : library.vocals.state(track).ready ? " · Vocals ready" : ""}</small></span><span className="m-song-duration">{track.duration ? formatTime(track.duration) : "—"}</span>
    </button><button className="m-icon" aria-label={`Options for ${trackName(track)}`} onClick={() => onOptions(track.id)}><MoreHorizontal size={20} /></button>
  </div>)}</div>;
}

function AlbumEditor({ library, album, onClose }: { library: MobileLibrary; album?: LibraryAlbum; onClose: () => void }) {
  const [name, setName] = useState(album?.name ?? ""), [ids, setIds] = useState(album?.trackIds ?? []), [cover, setCover] = useState(album?.cover ?? ""), [error, setError] = useState(""), [deleting, setDeleting] = useState(false);
  const coverInput = useRef<HTMLInputElement>(null);
  const save = () => {
    if (!name.trim()) { setError("Give your album a name."); return; }
    const updated: LibraryAlbum = { id: album?.id ?? crypto.randomUUID(), name: name.trim(), trackIds: ids, ...(cover ? { cover } : {}) };
    library.setAlbums(items => album ? items.map(item => item.id === album.id ? updated : item) : [...items, updated]); onClose();
  };
  const readCover = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) { setError("Choose an image smaller than 5 MB."); return; }
    const reader = new FileReader(); reader.onload = () => setCover(String(reader.result)); reader.onerror = () => setError("Could not read this image."); reader.readAsDataURL(file);
  };
  return <MobileSheet title={album ? "Edit album" : "New album"} className="m-album-sheet" onClose={onClose}>
    <label className="m-field"><span>Album name</span><input aria-label="Album name" value={name} maxLength={150} onChange={event => setName(event.target.value)} placeholder="A name for this collection" /></label>
    <input ref={coverInput} type="file" accept="image/*" hidden onChange={readCover} />
    <div className="m-album-cover-edit">{cover && <img src={cover} alt="Album artwork" />}<button className="m-button" onClick={() => coverInput.current?.click()}>Choose cover</button>{cover && <button className="m-button" onClick={() => setCover("")}>Remove cover</button>}</div>
    <p className="m-kicker">Songs in this album · {ids.length}</p>
    <div className="m-album-song-selection">{library.tracks.map(track => <label key={track.id}><input type="checkbox" checked={ids.includes(track.id)} onChange={event => setIds(current => event.target.checked ? [...current, track.id] : current.filter(id => id !== track.id))} /><span>{trackName(track)}</span></label>)}</div>
    {error && <p className="m-error" role="alert">{error}</p>}
    <button className="m-button m-primary m-full" onClick={save}><Check size={18} />Save album</button>
    {album && <div className="m-delete-album">{deleting && <p>Delete this album? Its songs stay in your library.</p>}<button className="m-button m-danger" onClick={() => { if (!deleting) setDeleting(true); else { library.setAlbums(items => items.filter(item => item.id !== album.id)); onClose(); } }}>{deleting ? "Confirm album deletion" : "Delete album"}</button></div>}
  </MobileSheet>;
}

export default function MobileApp() {
  const library = useMobileLibrary();
  const { current: currentTrack, playing: isPlaying, message: announcement, setMessage: setAnnouncement } = library;
  const [page, setPage] = useState<Page>("player"), [panel, setPanel] = useState<Panel>(null), [search, setSearch] = useState(""), [view, setView] = useState<"tracks" | "albums">("tracks"), [albumId, setAlbumId] = useState("");
  const [policy] = useState(() => {
    const directoryInput = "webkitdirectory" in document.createElement("input");
    const result = filePickerPolicy(navigator, directoryInput);
    return { ...result, supportsDirectories: result.isIOS ? result.supportsDirectories : directoryInput };
  });
  const filesInput = useRef<HTMLInputElement>(null), folderInput = useRef<HTMLInputElement>(null), compareInput = useRef<HTMLInputElement>(null), lyricsInput = useRef<HTMLInputElement>(null);
  const lyricsTarget = useRef(""), comparisonTarget = useRef<number | null>(null);
  const root = useRef<HTMLDivElement>(null), focusExit = useRef<HTMLButtonElement>(null);
  const switchRequest = useRef(0);
  const [focus, setFocus] = useState(false);
  const [switchingSource, setSwitchingSource] = useState<number | null>(null);
  const activeAlbum = library.albums.find(album => album.id === albumId);
  const visibleTracks = useMemo(() => {
    const rows = activeAlbum ? activeAlbum.trackIds.flatMap(id => library.tracks.find(track => track.id === id) ?? []) : library.tracks;
    const query = search.trim().toLocaleLowerCase(); return rows.filter(track => `${track.name} ${track.relativePath}`.toLocaleLowerCase().includes(query));
  }, [activeAlbum, library.tracks, search]);
  const roomPage = page === "player";
  const mini = !!library.current && !roomPage;
  const close = () => setPanel(null);
  const navigate = (next: Page) => { close(); setFocus(false); setPage(next); window.scrollTo({ top: 0 }); };
  const toggleFocus = () => { close(); setPage("player"); setFocus(value => !value || !roomPage); window.scrollTo({ top: 0 }); };
  useEffect(() => {
    if (!focus || !roomPage) return;
    focusExit.current?.focus();
    const exit = (event: KeyboardEvent) => { if (event.key === "Escape" && !root.current?.querySelector("dialog[open], .is-camera-open")) setFocus(false); };
    window.addEventListener("keydown", exit);
    return () => window.removeEventListener("keydown", exit);
  }, [focus, roomPage]);
  const pickFiles = (folder = false) => { close(); (folder && policy.supportsDirectories ? folderInput : filesInput).current?.click(); };
  const pickLyrics = (trackId: string) => { lyricsTarget.current = trackId; close(); lyricsInput.current?.click(); };
  const pickComparison = (target = library.comparisons.nextTarget()) => {
    comparisonTarget.current = target; compareInput.current?.click();
  };
  const selectSource = async (slot: number) => {
    if (!library.current || library.busy) return;
    const request = ++switchRequest.current;
    setSwitchingSource(slot);
    try {
      if (!library.engine.getBuffer(0) && !await library.load(library.current.id, false, library.time)) return;
      if (request !== switchRequest.current) return;
      await library.comparisons.select(slot);
    } finally { if (request === switchRequest.current) setSwitchingSource(null); }
  };
  useEffect(() => { if (folderInput.current) (folderInput.current as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = policy.supportsDirectories; }, [policy]);
  useEffect(() => root.current ? bindMobileViewport(root.current, window.visualViewport) : undefined, []);
  useEffect(() => {
    document.title = `${isPlaying ? "Playing" : "Ready"} · ${currentTrack ? trackName(currentTrack) : "Mobile listening room"} — Vibloom`;
  }, [isPlaying, currentTrack]);
  useEffect(() => {
    if (announcement) { const timer = window.setTimeout(() => setAnnouncement(""), 6500); return () => window.clearTimeout(timer); }
  }, [announcement, setAnnouncement]);
  const importSelection = (event: ChangeEvent<HTMLInputElement>) => { const selected = Array.from(event.target.files ?? []); event.target.value = ""; void library.importFiles(selected, albumId); };
  const versions = [{ slot: 0, name: library.current?.name ?? "Original", duration: library.current?.duration ?? 0, status: library.busy ? "loading" : "ready" }, ...Object.values(library.comparisons.slots).sort((a, b) => a.slot - b.slot)];
  const optionVersion = panel?.kind === "version" ? versions.find(version => version.slot === panel.source) : null;
  const optionTrack = panel?.kind === "track" || panel?.kind === "remove" ? library.tracks.find(track => track.id === panel.id) : null;

  const vocalTask = library.vocals.activeJobs[0];
  const vocalTaskButton = vocalTask && <button className="m-icon m-vocal-task" aria-label="Open vocal preparation" title={vocalTask.job?.status === "error" ? "Vocal preparation needs attention" : `${vocalTask.job?.phase} · ${Math.round((vocalTask.job?.progress ?? 0) * 100)}%`} onClick={() => setPanel({ kind: "vocals", id: vocalTask.track.id })}><MicVocal size={19} /><small>{library.vocals.activeJobs.length}</small></button>;
  return <div ref={root} className={`mobile-app ${library.current ? "has-playback" : ""} ${mini ? "has-library-playback" : ""} ${roomPage ? "is-room" : ""} ${focus && roomPage ? "is-focus" : ""}`} data-companion={library.session.companionId}>
    <input ref={filesInput} type="file" accept={policy.libraryAccept} multiple hidden data-picker="files" onChange={importSelection} />
    <input ref={folderInput} type="file" accept={policy.libraryAccept} multiple hidden data-picker="folder" onChange={importSelection} />
    <input ref={compareInput} type="file" accept={policy.audioAccept} hidden data-picker="comparison" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; const target = comparisonTarget.current; if (file && target !== null) {
      if (file.size > 300 * 1024 * 1024 || !(/\.(mp3|wav|wave|m4a|aac|ogg|oga|flac|opus|webm|aiff|aif)$/iu.test(file.name) || file.type.startsWith("audio/"))) { library.setMessage("Choose a supported music file smaller than 300 MB."); return; }
      void (async () => { if (library.current && !library.engine.getBuffer(0) && !await library.load(library.current.id, false, library.time)) return; await library.comparisons.importFile(file, target); })();
    } }} />
    <input ref={lyricsInput} type="file" accept={policy.lyricsAccept} hidden data-picker="lyrics" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void library.attachLyrics(lyricsTarget.current, file); }} />
    <header className="m-header" inert={focus && roomPage} aria-hidden={focus && roomPage}><div className="m-header-leading"><button className="m-icon" aria-label="Open navigation" aria-expanded={panel?.kind === "navigation"} onClick={event => { event.currentTarget.focus(); setPanel({ kind: "navigation" }); }}><Menu size={22} /></button><button className="m-brand" aria-label="Vibloom home" onClick={() => navigate("player")}><BrandMark /><span><strong>Vibloom</strong><small>Local listening room</small></span></button></div><div className="m-header-actions">{!focus && vocalTaskButton}<button className="m-icon m-bordered" disabled={!library.ready || library.importing} aria-label="Import music" onClick={() => setPanel({ kind: "import" })}><Plus size={22} /></button></div></header>
    {focus && roomPage && <header className="m-focus-header"><span>{library.current ? trackName(library.current) : "Your listening room"}</span><div className="m-header-actions">{vocalTaskButton}<button ref={focusExit} className="m-icon m-bordered" aria-label="Exit focus mode" onClick={() => setFocus(false)}><Minimize2 size={20} /></button></div></header>}
    <main data-workspace={page} className="m-content" id="mobile-content" aria-busy={!library.ready || library.importing}>
      <section className={`m-room-hero ${!roomPage ? "is-away" : ""}`} inert={!roomPage} aria-hidden={!roomPage} aria-label="Live2D listening room">
        <div className="m-room-title"><h1 className={library.current ? "m-song-title" : undefined}>{library.current ? trackName(library.current) : <>A little <em>company.</em></>}</h1><p>{library.current ? `${library.source === 0 ? "Original" : `Track ${mobileTrackLabel(library.source)}`} · ${library.playing ? "Playing" : "Ready to listen"}` : "Bring your music. Let it bloom."}</p></div>
        <div className="m-room-orbit"><MobileCompanion library={library} focus={focus && roomPage} onVocals={() => setPanel({ kind: "vocals" })} /><div className="m-source-controls" inert={focus && roomPage} aria-hidden={focus && roomPage}>{library.current && <MobileRoomOrbit key={library.current.id} library={library} pendingSource={switchingSource} onSelect={source => void selectSource(source)} onAdd={() => pickComparison()} />}</div></div>

      </section>
      {roomPage && library.current && <MobileLyrics key={library.current.id} library={library} onAttach={() => pickLyrics(library.current!.id)} onEdit={() => setPanel({ kind: "lyrics" })} />}
      {!library.ready ? <div className="m-empty"><p className="m-kicker">ON THIS DEVICE</p><h1>Opening your <em>room.</em></h1><p>Restoring your mobile library…</p></div> : page === "library" ? <section className="m-library-page" key={`${view}-${albumId}`} aria-label="Music library">
        <div className="m-page-heading"><div><p className="m-kicker">{activeAlbum ? "YOUR COLLECTION" : "LOCAL LIBRARY"}</p><h1>{activeAlbum ? activeAlbum.name : view === "albums" ? <>Your <em>albums.</em></> : <>Your <em>collection.</em></>}</h1><p>{activeAlbum ? `${visibleTracks.length} songs` : `${library.tracks.length} tracks · ${library.albums.length} albums`}</p></div>{activeAlbum && <button className="m-icon" aria-label="Edit this album" onClick={() => setPanel({ kind: "album", album: activeAlbum })}><MoreHorizontal size={22} /></button>}</div>
        <div className="m-library-tools">
        {activeAlbum ? <button className="m-text-button" onClick={() => { setAlbumId(""); setView("albums"); setSearch(""); }}><ChevronLeft size={18} />Back to albums</button> : <div className="m-segment" aria-label="Library view"><button aria-pressed={view === "tracks"} onClick={() => setView("tracks")}>Tracks</button><button aria-pressed={view === "albums"} onClick={() => setView("albums")}>Albums</button></div>}
        {library.tracks.length > 0 && (view === "albums" && !activeAlbum ? <>
          <button className="m-button" onClick={() => setPanel({ kind: "album" })}><Plus size={18} />New album</button>
        </> : <>
          <label className="m-search"><Search size={19} /><input aria-label="Search your library" type="search" placeholder="Search your library" value={search} onChange={event => setSearch(event.target.value)} /></label>
          <div className="m-library-toolbar"><button className="m-button m-primary" disabled={!visibleTracks.length || !!library.busy} onClick={() => void library.playAll(visibleTracks.map(track => track.id), albumId)}><Play size={17} fill="currentColor" />Play all</button><button className="m-icon m-bordered" aria-label="Shuffle and play these songs" disabled={!visibleTracks.length} onClick={() => { library.patchSession({ shuffle: true }); void library.playAll(visibleTracks.map(track => track.id), albumId); }}><Shuffle size={18} /></button><span>{visibleTracks.length} songs</span></div>
        </>)}
        </div>
        <div className="m-library-results">
        {!library.tracks.length ? <section className="m-welcome"><div className="m-welcome-disc" aria-hidden="true"><Music2 size={44} strokeWidth={1.1} /></div><h2>Bring your music.<br /><em>Let it bloom.</em></h2><p>Your songs, lyrics, and companion.<br />A listening room that stays on this device.</p><button className="m-button m-primary" onClick={() => setPanel({ kind: "import" })}><Upload size={18} />Import your music</button><span className="m-privacy"><ShieldCheck size={15} />No uploads · No account</span></section> : view === "albums" && !activeAlbum ? <>
          <div className="m-album-grid">{library.albums.map(album => <div className="m-album-card" key={album.id}><button className="m-album-open" onClick={() => { setAlbumId(album.id); setSearch(""); }}><span className="m-album-art">{album.cover ? <img src={album.cover} alt="" /> : <Music2 size={36} strokeWidth={1.3} />}</span><strong>{album.name}</strong><small>{album.trackIds.length} songs</small></button><button className="m-icon" aria-label={`Edit album ${album.name}`} onClick={() => setPanel({ kind: "album", album })}><MoreHorizontal size={20} /></button></div>)}</div>{!library.albums.length && <p className="m-muted">Create a collection from songs already in your library.</p>}
        </> : <>
          {library.tracks.some(track => track.availability === "missing" || track.availability === "reconnect") && <div className="m-reconnect"><FolderOpen size={20} /><span>Some songs need their source files.</span><button onClick={() => pickFiles()}>Reconnect</button></div>}
          <SongRows tracks={visibleTracks} library={library} onOptions={id => setPanel({ kind: "track", id })} />
          {!visibleTracks.length && <p className="m-muted">{search ? "No songs match your search." : "This album is empty. Edit it to add songs."}</p>}
        </>}
        </div>
      </section> : roomPage ? library.current ? <>
        {Object.values(library.comparisons.jobs).map(job => <div className="m-job" role="status" key={job.source}><span>Preparing B file · {job.phase}</span><progress max="1" value={job.progress} /><button className="m-button" onClick={() => library.comparisons.cancel(job.source)}>Cancel import</button></div>)}
      </> : <div className="m-room-empty"><button className="m-button m-primary" onClick={() => setPanel({ kind: "import" })}><Upload size={18} />Import your music</button><span className="m-privacy"><ShieldCheck size={15} />No uploads · No account</span></div> : null}
      {(library.busy || library.importing) && <div className="m-loading" role="status"><span />{library.importing ? "Importing your music…" : library.busy}</div>}
    </main>
    <MobileTransport key={`transport-${library.current?.id ?? "empty"}`} library={library} inPlayer={roomPage} onPlayer={() => navigate("player")} onQueue={() => setPanel({ kind: "queue" })} onOptions={() => setPanel({ kind: "room" })} focus={focus} onFocus={toggleFocus} />
    {panel?.kind === "navigation" && <MobileSheet title="Your room" side="left" onClose={close}><nav className="m-navigation" aria-label="Main navigation">{([{ id: "player", label: "Player", icon: Headphones }, { id: "library", label: "Library", icon: Library }] as const).map(item => <button key={item.id} aria-current={page === item.id ? "page" : undefined} onClick={() => navigate(item.id)}><item.icon size={21} /><span>{item.label}</span></button>)}<button aria-label="Queue" onClick={() => setPanel({ kind: "queue" })}><ListMusic size={21} /><span>Queue</span><small>{library.session.queue.length}</small></button><button aria-label="Storage" onClick={() => { setPanel({ kind: "storage" }); void library.refreshStorage(); }}><Database size={21} /><span>Storage</span></button><button aria-label="Music companion" onClick={() => setPanel({ kind: "companion" })}><ScanFace size={21} /><span>Companion</span></button></nav></MobileSheet>}
    {library.message && <div className="m-toast" role="status">{library.message}</div>}
    {panel?.kind === "import" && <MobileSheet title="Bring your music" onClose={close}><p className="m-muted">Music and matching LRC / TXT lyrics stay on your device.</p><button className="m-import-option" onClick={() => pickFiles()}><FileAudio size={24} /><span><strong>Choose files</strong><small>{policy.isIOS ? "Browse iCloud Drive or On My iPhone in Files" : "Select music and lyric files together"}</small></span><ChevronRight size={20} /></button><button className="m-import-option" onClick={() => pickFiles(true)}><FolderOpen size={24} /><span><strong>{policy.supportsDirectories ? "Choose a folder" : "Choose files from a folder"}</strong><small>{policy.supportsDirectories ? "Include its music and matching lyrics" : "Open the folder, then select its files"}</small></span><ChevronRight size={20} /></button>{policy.isIOS && <p className="m-picker-hint">In the Files picker, use Browse → iCloud Drive. Select the music you want, then tap Open.</p>}<span className="m-privacy"><ShieldCheck size={16} />Nothing is uploaded.</span></MobileSheet>}
    {library.summary && <MobileSheet title="Import complete" onClose={() => library.setSummary(null)}><div className="m-import-stats"><span><strong>{library.summary.accepted}</strong>New songs</span><span><strong>{library.summary.reconnected}</strong>Reconnected</span><span><strong>{library.summary.lyrics}</strong>Lyrics</span><span><strong>{library.summary.ignored}</strong>Ignored</span></div>{library.summary.errors.length > 0 && <div className="m-import-errors"><h3>Some files need attention</h3><ul>{library.summary.errors.map((error, i) => <li key={i}>{error}</li>)}</ul></div>}<button className="m-button m-primary m-full" onClick={() => library.setSummary(null)}>Continue to library</button></MobileSheet>}
    {panel?.kind === "queue" && <MobileSheet title="Up next" side onClose={close}><p className="m-muted">Move songs with the arrows. Your playback keeps its place.</p><div className="m-queue-list">{library.session.queue.map((id, index) => { const track = library.tracks.find(item => item.id === id); if (!track) return null; const move = (step: number) => { const ids = [...library.session.queue]; const to = index + step; [ids[index], ids[to]] = [ids[to], ids[index]]; library.patchSession({ queue: ids }); }; return <div className={`m-queue-row ${library.current?.id === id ? "is-current" : ""}`} key={id}><button className="m-queue-song" onClick={() => void library.load(id, true, 0)}><small>{index + 1}</small><strong>{trackName(track)}</strong></button><div><button className="m-icon" aria-label={`Move ${trackName(track)} up`} disabled={index === 0} onClick={() => move(-1)}><ArrowUp size={18} /></button><button className="m-icon" aria-label={`Move ${trackName(track)} down`} disabled={index === library.session.queue.length - 1} onClick={() => move(1)}><ArrowDown size={18} /></button><button className="m-icon" aria-label={`Remove ${trackName(track)} from queue`} onClick={() => library.patchSession({ queue: library.session.queue.filter(trackId => trackId !== id) })}><Trash2 size={17} /></button></div></div>; })}</div>{!library.session.queue.length && <p className="m-muted">Your queue is empty. Play all from the library to fill it.</p>}{library.session.queue.length > 0 && <button className="m-button m-danger" onClick={() => setPanel({ kind: "clear-queue" })}>Clear queue only</button>}</MobileSheet>}
    {panel?.kind === "track" && optionTrack && <MobileSheet title={trackName(optionTrack)} onClose={close}><p className="m-file-detail">{optionTrack.relativePath}<br />{sizeLabel(optionTrack.size)} · {optionTrack.persistence === "cached" ? "Cached on this device" : "Keep the source file to reconnect"}</p><button className="m-menu-action" onClick={() => { close(); navigate("player"); void library.load(optionTrack.id, true, 0); }}><Play size={20} />Play song</button><button className="m-menu-action" onClick={() => setPanel({ kind: "vocals", id: optionTrack.id })}><MicVocal size={20} />Vocal lip sync</button><button className="m-menu-action" onClick={() => { library.patchSession({ queue: [...new Set([...library.session.queue, optionTrack.id])] }); close(); library.setMessage("Song added to queue."); }}><ListMusic size={20} />Add to queue</button><button className="m-menu-action" onClick={() => pickLyrics(optionTrack.id)}><FileText size={20} />{optionTrack.lyricsFileName ? "Replace lyrics" : "Attach lyrics"}</button><button className="m-menu-action" onClick={() => { close(); navigate("player"); void library.load(optionTrack.id, false, 0); setPanel({ kind: "versions" }); }}><SlidersHorizontal size={20} />A/B tracks</button><button className="m-menu-action m-danger" onClick={() => setPanel({ kind: "remove", id: optionTrack.id })}><Trash2 size={20} />Remove from library</button></MobileSheet>}
    {panel?.kind === "vocals" && (library.tracks.find(track => track.id === (panel.id ?? library.current?.id))) && <MobileVocals library={library} track={library.tracks.find(track => track.id === (panel.id ?? library.current?.id))!} onClose={close} />}
    {panel?.kind === "remove" && optionTrack && <MobileSheet title="Remove this song?" onClose={close}><p className="m-muted">{trackName(optionTrack)} and its comparison versions will be removed from your mobile library. Your original source file stays intact.</p><div className="m-sheet-actions"><button className="m-button" onClick={close}>Cancel</button><button className="m-button m-danger" onClick={() => { close(); void library.removeTrack(optionTrack.id); }}>Remove song</button></div></MobileSheet>}
    {panel?.kind === "album" && <AlbumEditor key={panel.album?.id ?? "new"} library={library} album={panel.album} onClose={close} />}
    {panel?.kind === "versions" && <MobileSheet title="A/B tracks" onClose={close}><p className="m-muted">Tap A or B to switch audio at the same playback position. A is your original; B is one comparison file.</p><div className="m-track-manager">{versions.map(version => <button className="m-managed-track" key={version.slot} aria-label={`Open track ${mobileTrackLabel(version.slot)} controls`} onClick={() => setPanel({ kind: "version", source: version.slot })}><span>{mobileTrackLabel(version.slot)}</span><strong>{trackName(version)}</strong><ChevronRight size={18} /></button>)}</div><p className="m-picker-hint">For EQ, Mastering, Remaster and more comparison tracks, use Vibloom on desktop. <a href="?ui=desktop">Open desktop version</a>. Desktop uses its own library.</p></MobileSheet>}
    {panel?.kind === "room" && <MobileSheet title="Listening options" onClose={close}>
      <div className="m-listening-toggles"><button className="m-button" aria-label="Shuffle" aria-pressed={library.session.shuffle} onClick={() => library.patchSession({ shuffle: !library.session.shuffle })}><Shuffle size={18} />Shuffle</button><button className="m-button" aria-label={`Repeat: ${library.session.repeat}`} aria-pressed={library.session.repeat !== "off"} onClick={() => library.patchSession({ repeat: library.session.repeat === "off" ? "all" : library.session.repeat === "all" ? "one" : "off" })}>{library.session.repeat === "one" ? <Repeat1 size={18} /> : <Repeat size={18} />}Repeat · {library.session.repeat}</button></div>
      <button className="m-menu-action" onClick={() => setPanel({ kind: "vocals" })}><MicVocal size={19} />Vocal lip sync</button>
      <button className="m-menu-action" onClick={() => setPanel({ kind: "versions" })}><ListMusic size={19} />A/B tracks</button>
      <button className="m-menu-action" aria-label="Add a comparison file" disabled={!library.current || !!library.busy || Object.keys(library.comparisons.jobs).length > 0} onClick={() => { close(); pickComparison(); }}><Plus size={19} />{versions.length > 1 ? "Replace B file" : "Add B comparison file"}</button>
      <button className="m-menu-action" onClick={() => setPanel({ kind: "words" })}><FileText size={19} />Lyrics</button><button className="m-menu-action" aria-label="Adjust volume" onClick={() => setPanel({ kind: "volume" })}><Volume2 size={19} />Volume</button>
      <button className="m-menu-action" aria-pressed={focus && roomPage} onClick={toggleFocus}>{focus ? <Minimize2 size={19} /> : <Maximize2 size={19} />}{focus ? "Exit focus mode" : "Focus mode"}</button>
      <button className="m-menu-action" onClick={() => setPanel({ kind: "companion" })}><ScanFace size={19} />Choose companion</button>
    </MobileSheet>}
    {panel?.kind === "volume" && <MobileSheet title="Volume" onClose={close}>            <label className="m-volume"><Volume2 size={17} /><input aria-label="Volume" type="range" min="0" max="1" step="0.01" value={library.session.volume} onChange={event => library.setVolume(Number(event.target.value))} /></label></MobileSheet>}
    {panel?.kind === "words" && library.current && <MobileSheet title="Words, in time" onClose={close}><MobileLyrics key={library.current.id} expanded library={library} onAttach={() => pickLyrics(library.current!.id)} onEdit={() => setPanel({ kind: "lyrics" })} /></MobileSheet>}
    {panel?.kind === "version" && optionVersion && <MobileSheet title={`Track ${mobileTrackLabel(optionVersion.slot)} · ${optionVersion.slot === 0 ? "Original" : "Comparison"}`} onClose={close}>
      <p className="m-version-title">{trackName(optionVersion)}</p><p className="m-muted">{formatTime(optionVersion.duration)} · {optionVersion.status === "reconnect" || optionVersion.status === "error" ? "Reconnect this file" : library.source === optionVersion.slot ? "Selected for listening" : "Ready"}</p>
      <button className="m-button m-primary" disabled={!!library.busy} onClick={() => { void selectSource(optionVersion.slot); close(); }}><Headphones size={17} />Listen to this version</button>
      <button className="m-menu-action" onClick={() => setPanel({ kind: "vocals" })}><MicVocal size={19} />Vocal lip sync</button>
      <p className="m-picker-hint">For EQ, Mastering, Remaster and more comparison tracks, use Vibloom on desktop. <a href="?ui=desktop">Open desktop version</a>. Desktop uses its own library.</p>
      {optionVersion.slot > 0 && <><button className="m-menu-action" onClick={() => void library.comparisons.download(optionVersion.slot)}><Download size={18} />Download this version</button><button className="m-menu-action" disabled={!!library.busy || Object.keys(library.comparisons.jobs).length > 0} onClick={() => { close(); pickComparison(optionVersion.slot); }}><Upload size={18} />{optionVersion.status === "reconnect" || optionVersion.status === "error" ? "Reconnect B file" : "Replace B file"}</button><button className="m-menu-action m-danger" onClick={() => { close(); void library.comparisons.remove(optionVersion.slot); }}><Trash2 size={18} />Remove this version</button></>}
    </MobileSheet>}
    {panel?.kind === "lyrics" && library.current && <MobileLyricsEditor key={`lyrics-editor-${library.current.id}`} library={library} onClose={close} />}
    {panel?.kind === "storage" && <MobileSheet title="Keep what matters." side onClose={close}>        <div className="m-settings-card"><label className="m-setting-row"><span><strong>Keep imported music</strong><small>Cache future imports for your next visit.</small></span><input type="checkbox" role="switch" checked={library.session.cacheEnabled} onChange={event => library.patchSession({ cacheEnabled: event.target.checked })} /></label><div className="m-setting-row"><span>Cached mobile audio</span><strong>{sizeLabel(library.tracks.filter(track => track.persistence === "cached").reduce((sum, track) => sum + track.size + comparisonsOf(track).filter(item => item.persistence === "cached").reduce((bytes, item) => bytes + item.size, 0), 0))}</strong></div><div className="m-setting-row"><span>Browser storage usage<small>Shared by this website’s entries.</small></span><strong>{sizeLabel(library.storage.usage)}</strong></div><button className="m-setting-row m-setting-action" onClick={() => { void library.platform.storage.requestPersistence().then(() => library.refreshStorage()).catch(() => library.setMessage("Persistent storage is unavailable in this browser.")); }}><span>Request persistent storage<small>{library.storage.persistent ? "Granted by this browser" : "Your browser decides whether to grant it."}</small></span><Database size={19} /></button></div>
        <button className="m-button m-full" disabled={library.importing || !!library.busy || Object.keys(library.comparisons.jobs).length > 0} onClick={() => setPanel({ kind: "clear-cache" })}><Trash2 size={17} />Clear cached audio</button><p className="m-muted">Your mobile library is separate from the desktop library. Keep your original files: browser storage can be cleared.</p><button className="m-button m-danger m-full" disabled={library.importing || !!library.busy || Object.keys(library.comparisons.jobs).length > 0} onClick={() => setPanel({ kind: "clear" })}><Trash2 size={17} />Clear mobile library</button>
        <div className="m-about"><BrandMark /><strong>Vibloom · {APP_VERSION}</strong><span>Private music. A little company.</span><a href="?ui=desktop">Open desktop version</a><small>Desktop app always uses its original interface.</small></div></MobileSheet>}
    {panel?.kind === "companion" && <MobileSheet title="Your companion" onClose={close}><div className="m-companion-options">{Object.entries(COMPANIONS).map(([id, model]) => <button key={id} aria-pressed={library.session.companionId === id} onClick={() => library.patchSession({ companionId: id as CompanionId })}><span className={`m-theme-swatch ${id}`} /><span><strong>{model.name}</strong><small>{id === "hiyori" ? "Warm paper & copper" : "Powder blue & silver"}</small></span>{library.session.companionId === id && <Check size={19} />}</button>)}</div></MobileSheet>}
    {panel?.kind === "clear-queue" && <MobileSheet title="Clear the current queue?" onClose={close}><p className="m-muted">Your library, albums, lyrics and cached audio stay intact. The current song keeps playing.</p><div className="m-sheet-actions"><button className="m-button" onClick={close}>Keep queue</button><button className="m-button m-danger" onClick={() => { library.patchSession({ queue: [] }); setPanel({ kind: "queue" }); }}>Clear queue only</button></div></MobileSheet>}
    {panel?.kind === "clear-cache" && <MobileSheet title="Clear cached audio?" onClose={close}><p className="m-muted">Keep albums, queue, lyrics and track order. Songs may need their source files again on your next visit.</p><div className="m-sheet-actions"><button className="m-button" onClick={close}>Keep audio</button><button className="m-button m-danger" onClick={() => { close(); void library.clearAudioCache(); }}>Clear cached audio</button></div></MobileSheet>}
    {panel?.kind === "clear" && <MobileSheet title="Clear your mobile library?" onClose={close}><p className="m-muted">This removes the mobile song index, cached audio, albums and queue. Desktop library data and original source files remain intact.</p><div className="m-sheet-actions"><button className="m-button" onClick={close}>Keep library</button><button className="m-button m-danger" onClick={() => { close(); void library.clearLibrary(); }}>Clear mobile library</button></div></MobileSheet>}
  </div>;
}
