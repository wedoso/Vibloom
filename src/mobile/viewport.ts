/** Constrain mobile dialogs to the visual viewport when the on-screen keyboard opens. */
export function bindMobileViewport(root: HTMLElement, viewport: VisualViewport | null) {
  if (!viewport) return () => {};
  const update = () => {
    root.style.setProperty("--m-vv-height", `${Math.round(viewport.height)}px`);
    // Top-layer dialogs use the fixed viewport; Safari also pans offsetTop when focusing.
    root.classList.toggle("has-compact-keyboard", viewport.scale === 1 && viewport.height < 240 && window.innerHeight - viewport.height > 80);
    root.style.setProperty("--m-vv-bottom", `${Math.max(0, Math.round(window.innerHeight - viewport.height))}px`);
    requestAnimationFrame(() => {
      const focus = document.activeElement;
      if (!(focus instanceof HTMLElement) || !root.contains(focus) || !focus.matches("input, textarea, select")) return;
      const scroller = focus.closest<HTMLElement>(".m-lyrics-editor-list, .m-sheet-content");
      if (!scroller) return;
      const field = focus.getBoundingClientRect(), body = scroller.getBoundingClientRect();
      // Scroll only the editor body, keeping the dialog and its close button in place.
      if (field.bottom > body.bottom) scroller.scrollTop += field.bottom - body.bottom;
      else if (field.top < body.top) scroller.scrollTop += field.top - body.top;
    });
  };
  update(); window.addEventListener("resize", update); viewport.addEventListener("resize", update); viewport.addEventListener("scroll", update);
  return () => { window.removeEventListener("resize", update); viewport.removeEventListener("resize", update); viewport.removeEventListener("scroll", update); root.classList.remove("has-compact-keyboard"); root.style.removeProperty("--m-vv-height"); root.style.removeProperty("--m-vv-bottom"); };
}
