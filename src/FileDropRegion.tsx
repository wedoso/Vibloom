import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Upload } from "lucide-react";
import { TRACK_DRAG_TYPE } from "./domain/library";

/** File hints live over the list, without reserving space in its layout. */
export default function FileDropRegion({ children, albumName, onFilesDrop }: {
  children: ReactNode;
  albumName?: string;
  onFilesDrop: (event: DragEvent<HTMLElement>) => void;
}) {
  const [active, setActive] = useState(false);
  const region = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const depth = useRef(0);
  const isFileDrag = (event: DragEvent<HTMLElement>) => event.dataTransfer.types.includes("Files") && !event.dataTransfer.types.includes(TRACK_DRAG_TYPE);
  useEffect(() => {
    const reset = () => { depth.current = 0; setActive(false); };
    const outside = (event: globalThis.DragEvent) => {
      if (!region.current?.contains(event.target as Node | null)) reset();
    };
    window.addEventListener("dragover", outside);
    window.addEventListener("drop", reset, true);
    window.addEventListener("dragend", reset);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("dragover", outside);
      window.removeEventListener("drop", reset, true);
      window.removeEventListener("dragend", reset);
      window.removeEventListener("blur", reset);
    };
  }, []);
  useLayoutEffect(() => {
    if (!active) return;
    const update = () => {
      if (!region.current || !overlay.current) return;
      const bounds = region.current.getBoundingClientRect();
      let top = Math.max(0, bounds.top), bottom = Math.min(innerHeight, bounds.bottom);
      // Clip to scroll containers, so even a thousand-row list has a visible hint.
      for (let parent = region.current.parentElement; parent; parent = parent.parentElement) {
        if (getComputedStyle(parent).overflowY === "visible") continue;
        const rect = parent.getBoundingClientRect();
        const edge = rect.top + parent.clientTop;
        top = Math.max(top, edge); bottom = Math.min(bottom, edge + parent.clientHeight);
      }
      overlay.current.style.top = `${Math.max(0, top - bounds.top)}px`;
      overlay.current.style.bottom = "auto";
      overlay.current.style.height = `${Math.max(0, bottom - top)}px`;
    };
    update();
    const resize = new ResizeObserver(update);
    if (region.current) resize.observe(region.current);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => { resize.disconnect(); window.removeEventListener("scroll", update, true); window.removeEventListener("resize", update); };
  }, [active]);
  return <div ref={region} className={`library-file-drop-region ${active ? "is-dragging" : ""}`}
    onDragEnter={(event) => {
      if (!isFileDrag(event)) return;
      event.preventDefault(); event.stopPropagation(); depth.current++; setActive(true);
    }}
    onDragOver={(event) => {
      if (!isFileDrag(event)) return;
      event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "copy"; setActive(true);
    }}
    onDragLeave={(event) => {
      if (!isFileDrag(event)) return;
      event.stopPropagation();
      depth.current = Math.max(0, depth.current - 1);
      if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget as Node)) return;
      if (!depth.current || event.relatedTarget) { depth.current = 0; setActive(false); }
    }}
    onDrop={(event) => {
      depth.current = 0; setActive(false);
      if (isFileDrag(event)) onFilesDrop(event);
    }}>
    {children}
    {active && <div ref={overlay} className="library-file-drop-overlay" role="status">
      <Upload size={28} strokeWidth={1.4} />
      <h2>Drop your <em>music</em> here.</h2>
      <p>Audio, folders, TXT and LRC lyrics</p>
      {albumName && <small>Add to {albumName}</small>}
    </div>}
  </div>;
}
