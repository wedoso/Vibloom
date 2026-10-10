import { useSyncExternalStore } from "react";
import { isVocalAnalysisReady, type LibraryTrack, type VocalAnalysis } from "../../domain/library";
import { type VocalJobStore, vocalJobKey } from "./jobStore";
import { readLibraryVocalBuffer } from "./readLibraryVocalBuffer";

export function useLibraryVocals(store: VocalJobStore, resolve: (track: LibraryTrack) => Promise<File | null>, save: (track: LibraryTrack, analysis: VocalAnalysis) => void, readLoaded?: (track: LibraryTrack) => AudioBuffer | null) {
  const jobs = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const prepare = (tracks: LibraryTrack[]) => {
    for (const track of tracks) {
      if (isVocalAnalysisReady(track.vocalAnalysis, track.duration || undefined)) continue;
      store.prepare(vocalJobKey(track), signal => readLibraryVocalBuffer(track, resolve, signal, readLoaded), analysis => save(track, analysis));
    }
  };
  return { jobs, prepare, cancel: store.cancel };
}
