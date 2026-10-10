import { comparisonsOf, type LibraryTrack } from "../domain/library";

/** Mobile exposes one comparison without rewriting older multi-track records. */
export const mobileComparisons = (track: LibraryTrack | null) => track ? comparisonsOf(track).filter(item => item.slot === 1) : [];
export const mobileTrackLabel = (source: number) => source === 0 ? "A" : "B";
