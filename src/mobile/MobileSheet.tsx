import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

export default function MobileSheet({ title, onClose, children, side = false }: { title: string; onClose: () => void; children: ReactNode; side?: boolean | "left" }) {
  const dialog = useRef<HTMLDialogElement>(null), id = useId();
  useEffect(() => {
    const node = dialog.current, previous = document.activeElement;
    node?.showModal();
    return () => { node?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); else document.querySelector<HTMLButtonElement>('[aria-label="Open navigation"]')?.focus(); };
  }, []);
  return <dialog ref={dialog} className={`m-sheet ${side ? "m-side-sheet" : ""} ${side === "left" ? "m-nav-sheet" : ""}`} aria-labelledby={id} onCancel={onClose} onClick={event => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.target === event.currentTarget && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) onClose();
  }}>
    <header><h2 id={id}>{title}</h2><button className="m-icon" type="button" aria-label="Close panel" onClick={onClose}><X size={20} /></button></header>
    <div key={title} className="m-sheet-content">{children}</div>
  </dialog>;
}
