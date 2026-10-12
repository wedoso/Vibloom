type Move = (id: string, target: string, edge: "before" | "after") => void;

/** Touch listeners must be non-passive: allow scrolling before the hold, then
 * prevent native scrolling only once a drag has started (including iOS Safari). */
export function bindAlbumReorder(list: HTMLElement, onMove: Move) {
  let pending: { row: HTMLElement; id: string; x: number; y: number; touch?: number; pointer?: number } | undefined;
  let timer = 0, frame = 0, preview: HTMLElement | undefined;
  let target: { row: HTMLElement; id: string; edge: "before" | "after" } | undefined;
  let y = 0, offset = 0, suppressUntil = 0, previousTime = 0;
  const root = list.closest<HTMLElement>(".mobile-app")!;
  const clearTarget = () => {
    target?.row.classList.remove("album-drop-before", "album-drop-after");
    target = undefined;
  };
  const finish = (commit = false) => {
    window.clearTimeout(timer); cancelAnimationFrame(frame);
    const move = preview && pending && target ? { id: pending.id, target: target.id, edge: target.edge } : undefined;
    if (preview) suppressUntil = performance.now() + 600;
    pending?.row.classList.remove("is-album-dragging");
    preview?.remove(); preview = undefined; pending = undefined;
    root.classList.remove("is-reordering-album");
    clearTarget();
    if (commit && move) onMove(move.id, move.target, move.edge);
  };
  const locate = () => {
    if (!pending || !preview) return;
    preview.style.top = `${y - offset}px`;
    const bounds = list.getBoundingClientRect();
    const hit = document.elementFromPoint(pending.x, y)?.closest<HTMLElement>("[data-song-id]");
    let row = hit && list.contains(hit) ? hit : undefined;
    if (!row && y < bounds.top) row = list.querySelector<HTMLElement>("[data-song-id]") ?? undefined;
    if (!row && y > bounds.bottom) row = Array.from(list.querySelectorAll<HTMLElement>("[data-song-id]")).at(-1);
    if (!row || row === pending.row) { clearTarget(); return; }
    const rect = row.getBoundingClientRect(), edge = y < rect.top + rect.height / 2 ? "before" : "after";
    if (target?.row === row && target.edge === edge) return;
    clearTarget(); target = { row, id: row.dataset.songId!, edge };
    row.classList.add(`album-drop-${edge}`);
  };
  const tick = (time: number) => {
    if (!pending || !preview) return;
    if (!pending.row.isConnected) { finish(); return; }
    // Use the real scrolling ancestor; landscape may use an inner result pane.
    let scroll: HTMLElement = document.scrollingElement as HTMLElement;
    for (let parent = list.parentElement; parent; parent = parent.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY) && parent.scrollHeight > parent.clientHeight) { scroll = parent; break; }
    }
    const rect = scroll === document.scrollingElement ? { top: 0, bottom: window.innerHeight } : scroll.getBoundingClientRect();
    const header = root.querySelector(".m-header")?.getBoundingClientRect();
    const footer = root.querySelector(".m-playback-footer")?.getBoundingClientRect();
    const top = Math.max(rect.top, header?.bottom ?? 0), bottom = Math.min(rect.bottom, footer?.top ?? window.innerHeight);
    const speed = y < top + 48 ? -Math.min(1, (top + 48 - y) / 48) : y > bottom - 48 ? Math.min(1, (y - bottom + 48) / 48) : 0;
    if (speed) scroll.scrollTop += speed * Math.min(32, time - previousTime) * .45;
    previousTime = time; locate(); frame = requestAnimationFrame(tick);
  };
  const start = (event: Event, x: number, startY: number, input: { touch?: number; pointer?: number }) => {
    if (pending) finish();
    const button = (event.target as Element).closest<HTMLElement>(".m-song-main");
    const row = button?.closest<HTMLElement>("[data-song-id]");
    if (!row || !list.contains(row) || button?.hasAttribute("disabled")) return;
    pending = { row, id: row.dataset.songId!, x, y: startY, ...input }; y = startY;
    timer = window.setTimeout(() => {
      if (!pending) return;
      const rect = row.getBoundingClientRect(); offset = pending.y - rect.top;
      preview = row.cloneNode(true) as HTMLElement;
      preview.removeAttribute("data-song-id"); preview.setAttribute("aria-hidden", "true"); preview.inert = true;
      preview.className = "m-song-row m-song-drag-preview";
      Object.assign(preview.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
      root.append(preview); row.classList.add("is-album-dragging"); root.classList.add("is-reordering-album");
      previousTime = performance.now(); frame = requestAnimationFrame(tick);
    }, 450);
  };
  const move = (event: Event, x: number, nextY: number) => {
    if (!pending) return;
    if (!preview) { if (Math.hypot(x - pending.x, nextY - pending.y) > 8) finish(); return; }
    event.preventDefault(); y = nextY; locate();
  };
  const touchStart = (event: TouchEvent) => {
    if (event.touches.length !== 1) { finish(); return; }
    const touch = event.touches[0]; start(event, touch.clientX, touch.clientY, { touch: touch.identifier });
  };
  const touchMove = (event: TouchEvent) => {
    if (pending?.touch === undefined) return;
    if (event.touches.length !== 1) { finish(); return; }
    const touch = event.touches[0]; move(event, touch.clientX, touch.clientY);
  };
  const touchEnd = (event: TouchEvent) => {
    if (pending?.touch === undefined || !Array.from(event.changedTouches).some(touch => touch.identifier === pending?.touch)) return;
    if (preview) event.preventDefault(); finish(true);
  };
  const pointerDown = (event: PointerEvent) => {
    if (event.pointerType !== "touch" && event.isPrimary && event.button === 0) start(event, event.clientX, event.clientY, { pointer: event.pointerId });
  };
  const pointerMove = (event: PointerEvent) => { if (pending?.pointer === event.pointerId) move(event, event.clientX, event.clientY); };
  const pointerUp = (event: PointerEvent) => { if (pending?.pointer === event.pointerId) finish(true); };
  const cancel = () => finish();
  const click = (event: MouseEvent) => { if (performance.now() < suppressUntil) { event.preventDefault(); event.stopPropagation(); } };
  const context = (event: Event) => event.preventDefault();
  const key = (event: KeyboardEvent) => {
    if (event.key === "Escape") finish();
    if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
    const row = (event.target as Element).closest<HTMLElement>("[data-song-id]");
    if (!row || !list.contains(row)) return;
    const rows = Array.from(list.querySelectorAll<HTMLElement>("[data-song-id]"));
    const direction = event.key === "ArrowUp" ? -1 : 1, neighbor = rows[rows.indexOf(row) + direction];
    if (neighbor) { event.preventDefault(); onMove(row.dataset.songId!, neighbor.dataset.songId!, direction < 0 ? "before" : "after"); }
  };
  const visibility = () => { if (document.hidden) finish(); };
  list.addEventListener("touchstart", touchStart, { passive: true });
  document.addEventListener("touchmove", touchMove, { passive: false });
  document.addEventListener("touchend", touchEnd, { passive: false });
  document.addEventListener("touchcancel", cancel);
  list.addEventListener("pointerdown", pointerDown);
  document.addEventListener("pointermove", pointerMove);
  document.addEventListener("pointerup", pointerUp);
  document.addEventListener("pointercancel", cancel);
  list.addEventListener("click", click, true);
  list.addEventListener("contextmenu", context);
  document.addEventListener("keydown", key);
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("blur", cancel);
  window.addEventListener("orientationchange", cancel);
  return () => {
    finish();
    list.removeEventListener("touchstart", touchStart); document.removeEventListener("touchmove", touchMove);
    document.removeEventListener("touchend", touchEnd); document.removeEventListener("touchcancel", cancel);
    list.removeEventListener("pointerdown", pointerDown); document.removeEventListener("pointermove", pointerMove);
    document.removeEventListener("pointerup", pointerUp); document.removeEventListener("pointercancel", cancel);
    list.removeEventListener("click", click, true); list.removeEventListener("contextmenu", context);
    document.removeEventListener("keydown", key); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("blur", cancel);
    window.removeEventListener("orientationchange", cancel);
  };
}
