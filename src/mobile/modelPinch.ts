// Bridge mobile fingers to the existing camera's wheel control. The shared
// renderer, its zoom limits, camera presets and desktop input stay unchanged.
export function bindMobileModelPinch(canvas: HTMLCanvasElement, readout: HTMLOutputElement) {
  const host = canvas.closest<HTMLElement>(".live2d-host");
  const stage = canvas.closest<HTMLElement>(".live2d-stage");
  if (!host || !stage) return () => {};
  const points = new Map<number, { x: number; y: number }>();
  let startDistance = 0, startZoom = 1, target: number | null = null;
  let frame = 0, hideTimer = 0, blocked = false, pinching = false;
  const zoom = () => Number.parseFloat(stage.style.getPropertyValue("--camera-zoom")) || 1;
  const distance = () => {
    const [a, b] = [...points.values()];
    return a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0;
  };
  const hide = () => { window.clearTimeout(hideTimer); hideTimer = window.setTimeout(() => { readout.hidden = true; }, 900); };
  const cancel = () => {
    target = null; pinching = false; startDistance = 0;
    cancelAnimationFrame(frame); frame = 0; hide();
  };
  const tick = () => {
    frame = 0;
    if (target === null) return;
    if (!canvas.isConnected || stage.dataset.status !== "ready" || document.hidden || host.getBoundingClientRect().width === 0) { cancel(); return; }
    const current = zoom();
    // The native handler caps each wheel step and eases its camera. Continue
    // toward the absolute pinch target so fast moves and lifting retain it.
    const deltaY = -Math.log(target / current) / .0018;
    host.dispatchEvent(new WheelEvent("wheel", { deltaY, cancelable: true }));
    readout.value = `${Math.round(current * 100)}%`;
    readout.hidden = false;
    if (pinching || Math.abs(target - current) > .005) frame = requestAnimationFrame(tick);
    else { target = null; hide(); }
  };
  const schedule = () => { window.clearTimeout(hideTimer); if (!frame) frame = requestAnimationFrame(tick); };
  const down = (event: PointerEvent) => {
    if (event.pointerType !== "touch" || stage.dataset.status !== "ready") return;
    points.set(event.pointerId, { x: event.clientX, y: event.clientY });
    try { canvas.setPointerCapture(event.pointerId); } catch { /* A cancelled OS touch may already be gone. */ }
    if (points.size > 2) { blocked = true; cancel(); return; }
    if (points.size !== 2 || blocked) return;
    startDistance = distance(); startZoom = zoom();
    pinching = startDistance >= 10;
    if (pinching) event.preventDefault();
  };
  const move = (event: PointerEvent) => {
    if (!points.has(event.pointerId)) return;
    points.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (!pinching || points.size !== 2 || blocked) return;
    event.preventDefault();
    target = Math.max(.78, Math.min(4, startZoom * distance() / startDistance));
    schedule();
  };
  const up = (event: PointerEvent) => {
    if (!points.delete(event.pointerId)) return;
    if (points.size < 2) { pinching = false; startDistance = 0; }
    if (!points.size) blocked = false;
  };
  const interrupted = (event: PointerEvent) => { up(event); blocked = points.size > 0; cancel(); };
  const reset = () => { points.clear(); blocked = false; cancel(); };
  const camera = (event: Event) => { if (event.target instanceof Element && event.target.closest(".camera-capsule button")) reset(); };
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move, { passive: false });
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", interrupted);
  canvas.addEventListener("lostpointercapture", up);
  stage.addEventListener("click", camera, true);
  window.addEventListener("blur", reset); window.addEventListener("resize", reset);
  document.addEventListener("visibilitychange", reset);
  return () => {
    reset(); window.clearTimeout(hideTimer); readout.hidden = true;
    canvas.removeEventListener("pointerdown", down); canvas.removeEventListener("pointermove", move);
    canvas.removeEventListener("pointerup", up); canvas.removeEventListener("pointercancel", interrupted); canvas.removeEventListener("lostpointercapture", up);
    stage.removeEventListener("click", camera, true);
    window.removeEventListener("blur", reset); window.removeEventListener("resize", reset); document.removeEventListener("visibilitychange", reset);
  };
}
