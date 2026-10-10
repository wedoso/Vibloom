import type { CompanionId } from "../live2d/models";

// Keep the normal portrait composition. Beyond it, lift the zoom anchor toward
// the upper body instead of magnifying the artwork's transparent top margin.
// The two models have different amounts of empty space above their hair.
export function mobileModelZoomOffset(modelHeight: number, portraitHeight: number, companionId: CompanionId) {
  return Math.max(0, modelHeight - portraitHeight) * (companionId === "hong-xi" ? .22 : .12);
}
