import { ChevronDown } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

type Props = {
  sources: number[];
  active: number;
  comparison?: number;
  names?: Record<number, string>;
  onSelect: (source: number) => void;
  unavailable?: number[];
};

/** One-click original/comparison switching; other versions live in the picker. */
export default function TrackSelector({ sources, active, comparison, names = {}, onSelect, unavailable = [] }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const incomingRef = useRef<HTMLSpanElement>(null);
  const outgoingRef = useRef<HTMLSpanElement>(null);
  const remembered = active > 0 ? active : comparison ?? sources.find(source => source > 0);
  const previousRef = useRef(remembered);
  const [menu, setMenu] = useState<{ active: number; identity: string } | null>(null);
  const menuId = useId();
  const identity = sources.join(",");
  const open = menu !== null && menu.active === active && menu.identity === identity;
  const disabled = (source: number) => !sources.includes(source) || unavailable.includes(source);
  const close = (restoreFocus = false) => {
    setMenu(null);
    if (restoreFocus) pickerRef.current?.focus();
  };
  const select = (source: number, restoreFocus = false) => {
    if (disabled(source)) return;
    close(restoreFocus);
    onSelect(source);
  };

  useLayoutEffect(() => {
    const previous = previousRef.current;
    previousRef.current = remembered;
    const incoming = incomingRef.current, outgoing = outgoingRef.current;
    if (!incoming || !outgoing || previous === remembered || previous === undefined || remembered === undefined
      || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const offset = remembered > previous ? 8 : -8;
    outgoing.textContent = String(previous + 1);
    const options = { duration: 160, easing: "cubic-bezier(.2,.8,.2,1)" };
    const enter = incoming.animate([{ opacity: 0, transform: `translateY(${offset}px)` }, { opacity: 1, transform: "translateY(0)" }], options);
    const leave = outgoing.animate([{ opacity: 1, transform: "translateY(0)" }, { opacity: 0, transform: `translateY(${-offset}px)` }], options);
    leave.onfinish = () => { outgoing.textContent = ""; };
    return () => { leave.onfinish = null; enter.cancel(); leave.cancel(); outgoing.textContent = ""; };
  }, [remembered]);

  useEffect(() => {
    // A delayed dismissal from an earlier selection must not close a new picker.
    const timer = window.setTimeout(() => setMenu(current => current && (current.active !== active || current.identity !== identity) ? null : current), 0);
    return () => clearTimeout(timer);
  }, [active, identity]);

  useLayoutEffect(() => {
    if (open) (menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]:not(:disabled)')
      ?? menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)"))?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setMenu(null); };
    const hide = () => setMenu(null);
    const digits = (event: globalThis.KeyboardEvent) => { if (/^[1-9]$/.test(event.key)) setMenu(null); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", digits);
    window.addEventListener("resize", hide);
    window.addEventListener("scroll", hide, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", digits);
      window.removeEventListener("resize", hide);
      window.removeEventListener("scroll", hide, true);
    };
  }, [open]);

  const handleKey = (event: KeyboardEvent<HTMLDivElement>) => {
    // Space/Enter activate these buttons without toggling global playback.
    if (event.key === " " || event.key === "Enter") event.stopPropagation();
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation(); close(true); return;
    }
    if (/^[1-9]$/.test(event.key) && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault(); event.stopPropagation(); select(Number(event.key) - 1, true); return;
    }
    if (event.key === "Tab") { close(true); return; }
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 };
    const step = steps[event.key];
    if (!step && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault(); event.stopPropagation();
    const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    if (event.key === "Home" || event.key === "End") {
      (event.key === "Home" ? buttons : buttons.reverse()).find(button => !button.disabled)?.focus(); return;
    }
    let index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    for (let i = 0; i < 9; i++) {
      index = (index + step! + 9) % 9;
      if (!buttons[index]?.disabled) { buttons[index]?.focus(); break; }
    }
  };

  return <div ref={rootRef} className={`source-switch ${active === 0 ? "is-source-a" : "is-source-b"}`} role="group" aria-label="Choose audible source"
    onKeyDown={handleKey} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close(); }}>
    <i className="source-switch-thumb" aria-hidden="true" />
    <button type="button" className="source-switch-original" aria-label="Switch to track 1" title="Original · Key 1" disabled={disabled(0)} aria-pressed={active === 0} onClick={() => select(0)}>1</button>
    <button type="button" className="source-switch-comparison" aria-label={remembered === undefined ? "No comparison track" : `Switch to track ${remembered + 1}`}
      title={remembered === undefined ? "Add a comparison track" : `Track ${remembered + 1} · ${names[remembered] ?? "Comparison"} · Key ${remembered + 1}`}
      disabled={remembered === undefined || disabled(remembered)} aria-pressed={active > 0} onClick={() => remembered !== undefined && select(remembered)}>
      <span className="source-switch-number"><span ref={incomingRef}>{remembered === undefined ? "–" : remembered + 1}</span><span ref={outgoingRef} aria-hidden="true" className="source-switch-outgoing" /></span>
    </button>
    <button ref={pickerRef} type="button" className="source-switch-picker" aria-label="Choose comparison track" title="Choose a track · Keys 1–9" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => setMenu(open ? null : { active, identity })}><ChevronDown size={11} aria-hidden="true" /></button>
    {open && <div className="source-switch-popover">
      <div className="source-switch-menu-heading"><span>COMPARE</span><small>Keys 1–9</small></div>
      <div ref={menuRef} id={menuId} role="menu" aria-label="Comparison tracks" className="source-switch-grid">
        {Array.from({ length: 9 }, (_, source) => <button key={source} type="button" role="menuitemradio" aria-checked={active === source} data-source={source}
          className={source === 0 ? "source-a" : "source-b"} disabled={disabled(source)} tabIndex={active === source ? 0 : -1}
          aria-label={`Track ${source + 1} · ${names[source] ?? (source === 0 ? "Original" : "Empty")}`}
          title={unavailable.includes(source) ? `Track ${source + 1} · Unavailable while preparing` : names[source] ?? (source === 0 ? "Original" : "Empty track")}
          onClick={() => select(source, true)}>{source + 1}</button>)}
      </div>
      <p title={names[active]}>{active === 0 ? "Original" : `Track ${active + 1}`}{names[active] && names[active] !== "Original" && <span>{names[active]}</span>}</p>
    </div>}
  </div>;
}
