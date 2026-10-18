import { Download, FileText, FolderOpen, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import "./lyrics-toolbar.css";

type Props = {
  fileName: string; untimed: boolean; focus: boolean; lrcError: string | null;
  onEdit: () => void; onReplace: () => void; onRemove: () => void; onExport: (format: "lrc" | "txt") => void;
};

export default function LyricsToolbar({ fileName, untimed, focus, lrcError, onEdit, onReplace, onRemove, onExport }: Props) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const close = (restore = false) => { popup.current?.hidePopover(); if (restore) trigger.current?.focus(); };
  const show = (last = false) => {
    const menu = popup.current!, anchor = trigger.current!.getBoundingClientRect();
    menu.style.width = `${Math.min(216, window.innerWidth - 24)}px`;
    menu.style.maxHeight = `${window.innerHeight - 24}px`;
    menu.showPopover();
    const bounds = menu.getBoundingClientRect(), below = window.innerHeight - anchor.bottom - 12, above = anchor.top - 12;
    const upward = below < bounds.height && above > below;
    menu.style.maxHeight = `${Math.max(60, upward ? above : below)}px`;
    menu.style.left = `${Math.max(12, Math.min(anchor.right - bounds.width, window.innerWidth - bounds.width - 12))}px`;
    menu.style.top = `${upward ? Math.max(12, anchor.top - menu.getBoundingClientRect().height - 6) : anchor.bottom + 6}px`;
    const items = menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
    (last ? items[items.length - 1] : items[0])?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const menu = popup.current;
    const dismiss = () => menu?.hidePopover();
    const scroll = (event: Event) => {
      if (event.target instanceof Node && trigger.current && event.target.contains(trigger.current)) dismiss();
    };
    window.addEventListener("resize", dismiss); window.addEventListener("scroll", scroll, true);
    return () => { window.removeEventListener("resize", dismiss); window.removeEventListener("scroll", scroll, true); };
  }, [open]);
  const key = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); close(true); return; }
    if (event.key === "Tab") { close(true); return; }
    const items = Array.from(popup.current!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "ArrowDown" ? (index + 1) % items.length : event.key === "ArrowUp" ? (index + items.length - 1) % items.length : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : -1;
    if (next >= 0) { event.preventDefault(); items[next]?.focus(); }
  };
  const act = (action: () => void) => { close(true); action(); };
  return <div className="library-lyrics-label lyrics-toolbar" onKeyDown={event => { if (event.key !== "Escape" || open) event.stopPropagation(); }}>
    <span className="lyrics-toolbar-title" title={fileName || undefined}><FileText size={12} />Lyrics{untimed && <small>Untimed</small>}</span>
    <div className="lyrics-toolbar-actions">
      {!focus && <button type="button" className="lyrics-edit" aria-label="Edit lyrics" title="Edit lyrics and timing" onClick={onEdit}>Edit</button>}
      <button ref={trigger} type="button" className="lyrics-more" aria-label="More lyric actions" title="More lyric actions" aria-haspopup="menu" aria-expanded={open} aria-controls={id} onClick={() => open ? close() : show()} onKeyDown={event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); event.stopPropagation(); show(event.key === "ArrowUp"); }
      }}><MoreHorizontal size={17} /></button>
    </div>
    <div ref={popup} id={id} popover="auto" role="menu" aria-label="Lyric actions" className="lyrics-action-menu" onToggle={event => setOpen(event.newState === "open")} onKeyDown={key}>
      {focus && <><button type="button" role="menuitem" onClick={() => act(onEdit)}><Pencil size={15} />Edit lyrics</button><hr /></>}
      <div title={lrcError ? "Add valid timestamps to every line before exporting LRC." : undefined}>
        <button type="button" role="menuitem" disabled={!!lrcError} aria-describedby={lrcError ? `${id}-hint` : undefined} onClick={() => act(() => onExport("lrc"))}><Download size={15} />Export LRC</button>
        {lrcError && <small id={`${id}-hint`}>Add timing to export LRC</small>}
      </div>
      <button type="button" role="menuitem" onClick={() => act(() => onExport("txt"))}><Download size={15} />Export TXT</button>
      <hr />
      <button type="button" role="menuitem" onClick={() => act(onReplace)}><FolderOpen size={15} />Replace lyrics…</button>
      <button type="button" role="menuitem" className="is-destructive" onClick={() => act(onRemove)}><Trash2 size={15} />Remove lyrics</button>
    </div>
  </div>;
}
