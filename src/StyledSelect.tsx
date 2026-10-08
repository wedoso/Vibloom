import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import "./styled-select.css";

type Option = { value: string; label: string; disabled?: boolean };
type Props = { label: string; value: string; options: Option[]; disabled?: boolean; onChange: (value: string) => void };

/** A themed, top-layer listbox so menus are never clipped by cards or dialogs. */
export default function StyledSelect({ label, value, options, disabled = false, onChange }: Props) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selected = options.find(option => option.value === value);
  const typeahead = useRef({ text: "", time: 0 });
  const close = (restore = false) => {
    menu.current?.hidePopover();
    if (restore) trigger.current?.focus();
  };
  const show = (last = false) => {
    if (disabled) return;
    const popup = menu.current!, button = trigger.current!, rect = button.getBoundingClientRect();
    popup.style.width = `${Math.min(Math.max(rect.width, 168), window.innerWidth - 24)}px`;
    popup.style.maxHeight = "280px";
    typeahead.current = { text: "", time: 0 };
    popup.showPopover();
    const bounds = popup.getBoundingClientRect(), below = window.innerHeight - rect.bottom - 12, above = rect.top - 12;
    const upward = below < Math.min(bounds.height, 180) && above > below;
    popup.style.maxHeight = `${Math.max(60, Math.min(280, upward ? above : below))}px`;
    popup.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - bounds.width - 12))}px`;
    popup.style.top = `${upward ? Math.max(12, rect.top - popup.getBoundingClientRect().height - 6) : rect.bottom + 6}px`;
    const enabled = Array.from(popup.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    (last ? enabled.at(-1) : enabled.find(button => button.value === value) ?? enabled[0])?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const popup = menu.current;
    const dismiss = () => popup?.hidePopover();
    const scroll = (event: Event) => { if (!popup?.contains(event.target as Node)) dismiss(); };
    window.addEventListener("resize", dismiss); window.addEventListener("scroll", scroll, true);
    return () => { window.removeEventListener("resize", dismiss); window.removeEventListener("scroll", scroll, true); };
  }, [open]);
  const keyboard = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.key === "Tab") { close(true); return; }
    if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(true); return; }
    // Sound/player shortcuts must not handle keys intended for this control.
    event.stopPropagation();
    if (!open && ["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      event.preventDefault(); show(event.key === "ArrowUp"); return;
    }
    if (!open) return;
    const enabled = Array.from(menu.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    const index = enabled.indexOf(document.activeElement as HTMLButtonElement);
    let next: HTMLButtonElement | undefined;
    if (event.key === "ArrowDown") next = enabled[(index + 1) % enabled.length];
    else if (event.key === "ArrowUp") next = enabled[(index + enabled.length - 1) % enabled.length];
    else if (event.key === "Home") next = enabled[0];
    else if (event.key === "End") next = enabled.at(-1);
    else if (event.key.length === 1 && event.key !== " " && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const now = performance.now(), previous = typeahead.current;
      const text = (now - previous.time < 600 ? previous.text : "") + event.key.toLowerCase();
      typeahead.current = { text, time: now };
      next = enabled.find(button => button.textContent?.trim().toLowerCase().startsWith(text));
    }
    if (next) { event.preventDefault(); next.focus(); }
  };
  return <span className="styled-select" onKeyDown={keyboard}>
    <button ref={trigger} className="styled-select-trigger" type="button" role="combobox" aria-label={label} aria-expanded={open} aria-controls={id} aria-haspopup="listbox" value={value} disabled={disabled} onClick={() => open ? close(true) : show()}><span>{selected?.label ?? "Choose…"}</span><ChevronDown size={12} aria-hidden="true"/></button>
    <div ref={menu} id={id} className="styled-select-menu" popover="auto" role="listbox" aria-label={label} onToggle={event => setOpen(event.newState === "open")}>
      {options.map(option => <button key={option.value} type="button" role="option" aria-selected={option.value === value} value={option.value} data-value={option.value} disabled={option.disabled} tabIndex={-1} onClick={() => { onChange(option.value); close(true); }}><span>{option.label}</span><Check size={12} aria-hidden="true" style={{ visibility: option.value === value ? "visible" : "hidden" }}/></button>)}
    </div>
  </span>;
}
