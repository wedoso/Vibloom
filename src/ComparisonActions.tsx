import { Download, FolderOpen, MoreHorizontal, Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";

type Props = { number: number; ready: boolean; onDownload: () => void; onReplace: () => void; onRemove: () => void };

export default function ComparisonActions({ number, ready, onDownload, onReplace, onRemove }: Props) {
  const menuRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node) && menuRef.current) menuRef.current.open = false; };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);
  const act = (action: () => void) => { if (menuRef.current) menuRef.current.open = false; action(); };
  return <span className="version-b-actions">
    {ready && <button type="button" aria-label={`Download track ${number}`} title={`Download track ${number}`} onClick={onDownload}><Download size={14} /></button>}
    <details ref={menuRef} className="comparison-actions-menu" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false; }}
      onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}>
      <summary aria-label={`Track ${number} options`} title={`Track ${number} options`}><MoreHorizontal size={15} /></summary>
      <span className="comparison-actions-popover"><button type="button" aria-label={`Replace track ${number}`} onClick={() => act(onReplace)}><FolderOpen size={14} /> Choose another file</button><button type="button" aria-label={`Remove track ${number}`} onClick={() => act(onRemove)}><Trash2 size={14} /> Remove track</button></span>
    </details>
  </span>;
}
