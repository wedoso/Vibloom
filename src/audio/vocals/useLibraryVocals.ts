import { useSyncExternalStore } from "react";
import { isCurrentVocalAnalysis, type LibraryTrack, type VocalAnalysis } from "../../domain/library";
import { VocalJobStore, vocalJobKey } from "./jobStore";

export function useLibraryVocals(store: VocalJobStore, resolve: (track: LibraryTrack) => Promise<File | null>, save: (track: LibraryTrack, analysis: VocalAnalysis) => void) {
  const jobs = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const prepare = (tracks: LibraryTrack[]) => {
    for (const track of tracks) {
      if (isCurrentVocalAnalysis(track.vocalAnalysis, track.duration || undefined)) continue;
      store.prepare(vocalJobKey(track), async () => {
        const file = await resolve(track);
        if (!file) throw new Error("Reconnect this audio file and retry.");
        return new OfflineAudioContext(2, 1, 44100).decodeAudioData(await file.arrayBuffer());
      }, (analysis) => save(track, analysis));
    }
  };
  return { jobs, prepare, cancel: store.cancel };
}
