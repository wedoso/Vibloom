import type { CompanionId } from "./models";

// Above the normal portrait preset, zoom around the upper body rather than
// the artwork's transparent top margin. Leave portrait and wide framing alone.
export function desktopPlayerZoomOffset(modelHeight: number, portraitHeight: number, companionId: CompanionId) {
  const upperBodyAnchor = companionId === "hong-xi" ? 0.22 : 0.12;
  return Math.max(0, modelHeight - portraitHeight) * upperBodyAnchor;
}
