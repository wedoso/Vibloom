export type ViewportGaze = { x: number; y: number };

function normalizeAxis(value: number, origin: number, extent: number) {
  const clampedOrigin = Math.max(1, Math.min(extent - 1, origin));
  const distance = value - clampedOrigin;
  const available = distance < 0 ? clampedOrigin : extent - clampedOrigin;
  return Math.max(-1, Math.min(1, distance / Math.max(1, available)));
}

export function normalizeViewportGaze(
  clientX: number,
  clientY: number,
  originX: number,
  originY: number,
  viewportWidth: number,
  viewportHeight: number,
): ViewportGaze {
  return {
    x: normalizeAxis(clientX, originX, Math.max(2, viewportWidth)) || 0,
    y: -normalizeAxis(clientY, originY, Math.max(2, viewportHeight)) || 0,
  };
}
