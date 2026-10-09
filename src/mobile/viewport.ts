/** Constrain mobile dialogs to the visual viewport when the on-screen keyboard opens. */
export function bindMobileViewport(root: HTMLElement, viewport: VisualViewport | null) {
  if (!viewport) return () => {};
  const update = () => {
    root.style.setProperty("--m-vv-height", `${Math.round(viewport.height)}px`);
    root.style.setProperty("--m-vv-bottom", `${Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop))}px`);
    const focus = document.activeElement;
    if (focus instanceof HTMLElement && root.contains(focus) && focus.matches("input, textarea, select")) {
      requestAnimationFrame(() => focus.scrollIntoView({ block: "nearest", inline: "nearest" }));
    }
  };
  update(); window.addEventListener("resize", update); viewport.addEventListener("resize", update); viewport.addEventListener("scroll", update);
  return () => { window.removeEventListener("resize", update); viewport.removeEventListener("resize", update); viewport.removeEventListener("scroll", update); root.style.removeProperty("--m-vv-height"); root.style.removeProperty("--m-vv-bottom"); };
}
