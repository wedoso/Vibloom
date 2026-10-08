import { useEffect, useId, useState, type ButtonHTMLAttributes, type CSSProperties } from "react";
import { createPortal } from "react-dom";

/** In-app tooltips also work in the embedded/desktop browser. */
export default function ToolButton({ title, onMouseEnter, onMouseLeave, onFocus, onBlur, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const id = useId();
  const [position, setPosition] = useState<{ x: number; y: number; theme: CSSProperties } | null>(null);
  const show = (button: HTMLButtonElement) => {
    const bounds = button.getBoundingClientRect();
    const styles = getComputedStyle(button);
    // The body portal must carry the card's theme tokens across that boundary.
    const theme = Object.fromEntries(["--library-ink", "--library-paper", "--library-line", "--library-sans"].map(name => [name, styles.getPropertyValue(name)])) as CSSProperties;
    setPosition({ x: Math.max(130, Math.min(innerWidth - 130, bounds.left + bounds.width / 2)), y: bounds.top - 8, theme });
  };
  useEffect(() => {
    if (!position) return;
    const hide = () => setPosition(null);
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") hide(); };
    window.addEventListener("scroll", hide, true); window.addEventListener("resize", hide);
    window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("scroll", hide, true); window.removeEventListener("resize", hide); window.removeEventListener("keydown", escape); };
  }, [position]);
  return <>
    <button {...props} type={props.type ?? "button"} data-tooltip={title} aria-describedby={position ? id : undefined}
      onMouseEnter={event => { show(event.currentTarget); onMouseEnter?.(event); }} onMouseLeave={event => { setPosition(null); onMouseLeave?.(event); }}
      onFocus={event => { show(event.currentTarget); onFocus?.(event); }} onBlur={event => { setPosition(null); onBlur?.(event); }} />
    {position && title && createPortal(<span id={id} role="tooltip" className="audio-tool-tooltip" style={{ ...position.theme, left: position.x, top: position.y }}>{title}</span>, document.body)}
  </>;
}
