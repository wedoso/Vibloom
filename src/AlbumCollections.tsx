import { useEffect, useRef, useState, type DragEvent } from "react";
import { ImagePlus, Music2, Plus, Search, Trash2, X } from "lucide-react";
import { TRACK_DRAG_TYPE, type LibraryAlbum, type LibraryTrack, withoutExtension, normalizeFileName } from "./domain/library";
import "./albums.css";

type Props = {
  albums: LibraryAlbum[];
  tracks: LibraryTrack[];
  activeId: string;
  browsing: boolean;
  onBrowse: (browsing: boolean) => void;
  onSelect: (id: string) => void;
  onSave: (album: LibraryAlbum) => void;
  onDelete: (id: string) => void;
  onAddTrack: (albumId: string, trackId: string) => void;
  onFilesDrop: (event: DragEvent<HTMLElement>, albumId: string) => void;
};

async function readCover(file: File) {
  if (!/^image\/(png|jpeg|webp|gif)$/u.test(file.type) || file.size > 10 * 1024 * 1024) {
    throw new Error("Choose a PNG, JPG, WebP, or GIF image up to 10 MB.");
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, 640 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not read this cover image.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/webp", .85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function AlbumEditor({ album, tracks, onSave, onDelete, onClose }: {
  album?: LibraryAlbum;
  tracks: LibraryTrack[];
  onSave: (album: LibraryAlbum) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(album?.name ?? "");
  const [cover, setCover] = useState(album?.cover);
  const [ids, setIds] = useState(album?.trackIds ?? []);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [readingCover, setReadingCover] = useState(false);
  const dialog = useRef<HTMLFormElement>(null);
  const coverRead = useRef(0);
  const coverInput = useRef<HTMLInputElement>(null);
  const visible = tracks.filter((track) => normalizeFileName(`${track.name} ${track.relativePath}`).includes(normalizeFileName(search)));
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const pendingCoverRead = coverRead;
    dialog.current?.querySelector<HTMLInputElement>('input[name="albumName"]')?.focus();
    return () => { pendingCoverRead.current++; previous?.focus(); };
  }, []);
  return <div className="modal-backdrop album-editor-backdrop">
    <form className="album-editor" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="album-editor-title"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim() || readingCover) return;
        onSave({ id: album?.id ?? `album-${crypto.randomUUID()}`, name: name.trim(), trackIds: ids, cover });
        onClose();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") { event.preventDefault(); onClose(); }
        if (event.key !== "Tab") return;
        const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled):not([type=file])") ?? []);
        if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
      }}>
      <header><div><small>VIRTUAL ALBUM</small><h2 id="album-editor-title">{album ? "Edit" : "Create"} <em>album.</em></h2></div><button type="button" aria-label="Close album editor" onClick={onClose}><X size={20} /></button></header>
      <div className="album-editor-body">
        <div className="album-cover-controls">
          <button className="album-cover-preview" type="button" aria-label="Choose album cover" disabled={readingCover} onClick={() => coverInput.current?.click()}>
            {cover ? <img src={cover} alt="Album cover preview" draggable={false} /> : <ImagePlus size={32} strokeWidth={1.3} />}
            <span>{readingCover ? "Reading image…" : cover ? "Change cover" : "Choose cover"}</span>
          </button>
          <input ref={coverInput} type="file" hidden aria-label="Album cover image" accept="image/png,image/jpeg,image/webp,image/gif" disabled={readingCover} onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            const request = ++coverRead.current;
            setReadingCover(true); setError("");
            try { const next = await readCover(file); if (request === coverRead.current) setCover(next); }
            catch (error) { if (request === coverRead.current) setError(error instanceof Error ? error.message : "Could not read this image."); }
            finally { if (request === coverRead.current) setReadingCover(false); }
          }} />
          <div className="album-details-fields">
            <label className="album-name-label">Album name<input name="albumName" aria-label="Album name" maxLength={120} value={name} onChange={(event) => setName(event.target.value)} required placeholder="Name your collection" /></label>
            <p>Group songs in a virtual folder. Your music files stay where they are.</p>
            {cover && <button className="album-remove-cover" type="button" disabled={readingCover} onClick={() => setCover(undefined)}>Remove cover</button>}
          </div>
        </div>
      <div className="album-song-toolbar"><strong>{ids.length} songs selected</strong><label><Search size={15} /><input type="search" aria-label="Search songs for album" placeholder="Search songs" value={search} onChange={(event) => setSearch(event.target.value)} /></label></div>
      <label className="album-select-all"><input type="checkbox" checked={visible.length > 0 && visible.every((track) => ids.includes(track.id))} disabled={!visible.length} onChange={(event) => setIds(event.target.checked ? [...new Set([...ids, ...visible.map((track) => track.id)])] : ids.filter((id) => !visible.some((track) => track.id === id)))} /> Select all visible songs</label>
      <div className="album-song-list">
        {visible.map((track) => <label key={track.id}><input type="checkbox" aria-label={`Include ${withoutExtension(track.name)} in album`} checked={ids.includes(track.id)} onChange={(event) => setIds(event.target.checked ? [...ids, track.id] : ids.filter((id) => id !== track.id))} /><span><strong>{withoutExtension(track.name)}</strong><small>{track.relativePath}</small></span></label>)}
        {!visible.length && <p>No matching songs. You can add music to this album later.</p>}
      </div>
      {error && <p role="alert">{error}</p>}
      </div>
      <footer>{album && <button type="button" className="album-delete" onClick={() => { onDelete(album.id); onClose(); }}><Trash2 size={15} /> Delete album</button>}<button type="button" onClick={onClose}>Cancel</button><button className="album-save" type="submit" disabled={!name.trim() || readingCover}>{album ? "Save album" : "Create album"}</button></footer>
    </form>
  </div>;
}

export default function AlbumCollections({ albums, tracks, activeId, browsing, onBrowse, onSelect, onSave, onDelete, onAddTrack, onFilesDrop }: Props) {
  const [editor, setEditor] = useState<{ album?: LibraryAlbum } | null>(null);
  const [dropId, setDropId] = useState("");
  const [dragChoosing, setDragChoosing] = useState(false);
  const active = albums.find((album) => album.id === activeId);
  useEffect(() => {
    const reset = () => { setDropId(""); setDragChoosing(false); };
    window.addEventListener("drop", reset); window.addEventListener("dragend", reset); window.addEventListener("blur", reset);
    return () => { window.removeEventListener("drop", reset); window.removeEventListener("dragend", reset); window.removeEventListener("blur", reset); };
  }, []);
  return <section className="album-collections" aria-label="Virtual albums">
    <nav className="album-navigation" aria-label="Library collections">
      <button type="button" className={!browsing && !active ? "is-active" : ""} aria-pressed={!browsing && !active} onClick={() => { setDragChoosing(false); onSelect(""); onBrowse(false); }}>All songs</button>
      <button type="button" className={browsing || active ? "is-active" : ""} aria-pressed={browsing || !!active} onClick={() => { setDragChoosing(false); onSelect(""); onBrowse(true); }}
        onDragEnter={(event) => { if (event.dataTransfer.types.includes(TRACK_DRAG_TYPE)) { event.preventDefault(); setDragChoosing(true); } }}
        onDragOver={(event) => { if (event.dataTransfer.types.includes(TRACK_DRAG_TYPE)) event.preventDefault(); }}>Albums{albums.length > 0 && <small>{albums.length}</small>}</button>
      <span className="album-navigation-actions">{active && <button type="button" onClick={() => setEditor({ album: active })}>Edit album</button>}<button type="button" onClick={() => setEditor({})}><Plus size={13} /> New album</button></span>
    </nav>
    {active && !tracks.length && <p className="album-active-caption">{active.name} · {active.trackIds.length} tracks</p>}
    {(browsing || dragChoosing) && <div className={`album-cards ${!browsing ? "album-drag-chooser" : ""}`}>
      {albums.map((album, index) => <button type="button" key={album.id} className={`album-card ${dropId === album.id ? "is-drop-target" : ""}`} aria-label={`Open album ${album.name}`} onClick={() => { onSelect(album.id); onBrowse(false); }}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes(TRACK_DRAG_TYPE) && !event.dataTransfer.types.includes("Files")) return;
          event.preventDefault(); event.stopPropagation();
          event.dataTransfer.dropEffect = event.dataTransfer.types.includes("Files") ? "copy" : "link";
          setDropId(album.id);
        }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropId(""); }}
        onDrop={(event) => {
          const trackId = event.dataTransfer.getData(TRACK_DRAG_TYPE);
          if (!trackId && !event.dataTransfer.types.includes("Files")) return;
          event.preventDefault(); event.stopPropagation(); setDropId(""); setDragChoosing(false);
          if (trackId) onAddTrack(album.id, trackId);
          else onFilesDrop(event, album.id);
        }}>
        <span className={`album-card-cover ${album.cover ? "has-cover" : ""}`}>
          {album.cover ? <img src={album.cover} alt="" draggable={false} /> : <><Music2 size={42} strokeWidth={1} /><small>VOL. {String(index + 1).padStart(2, "0")}</small></>}
          {dropId === album.id && <span className="album-card-drop-hint">Drop to add songs</span>}
        </span>
        <strong>{album.name}</strong><small>{album.trackIds.length} tracks · Local library</small>
      </button>)}
      {!dragChoosing && <button className="album-card album-new-card" type="button" onClick={() => setEditor({})}><span className="album-card-cover"><Plus size={30} strokeWidth={1} /></span><strong>Create new</strong><small>A place for your music</small></button>}
    </div>}
    {editor && <AlbumEditor album={editor.album} tracks={tracks} onSave={onSave} onDelete={onDelete} onClose={() => setEditor(null)} />}
  </section>;
}
