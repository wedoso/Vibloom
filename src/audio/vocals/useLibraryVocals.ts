import { useEffect, useRef, useState } from "react";
import type { LibraryTrack, VocalAnalysis } from "../../domain/library";
import { analyzeVocals, type VocalProgress } from "./analyzeVocals";

type Job = VocalProgress & { status: "queued" | "working" | "ready" | "error"; error?: string };
export function useLibraryVocals(resolve: (track: LibraryTrack) => Promise<File | null>, save: (track: LibraryTrack, analysis: VocalAnalysis) => void) {
  const [jobs, setJobs] = useState<Record<string, Job>>({});
  const controllers = useRef(new Map<string, AbortController>());
  const callbacks = useRef({ resolve, save });
  useEffect(() => { callbacks.current = { resolve, save }; }, [resolve, save]);
  useEffect(() => {
    const current = controllers.current;
    return () => { for (const controller of current.values()) controller.abort(); current.clear(); };
  }, []);
  const cancel = (id: string) => {
    controllers.current.get(id)?.abort();
    controllers.current.delete(id);
    setJobs((current) => { const next = { ...current }; delete next[id]; return next; });
  };
  const prepare = (tracks: LibraryTrack[]) => {
    for (const track of tracks) {
      if (controllers.current.has(track.id)) continue;
      if (track.vocalAnalysis?.version === 2) {
        setJobs((current) => ({ ...current, [track.id]: { status: "ready", phase: "Vocals ready", progress: 1 } }));
        continue;
      }
      const controller = new AbortController();
      controllers.current.set(track.id, controller);
      const update = (job: Job) => { if (!controller.signal.aborted) setJobs((current) => ({ ...current, [track.id]: job })); };
      update({ status: "queued", phase: "Queued", progress: 0 });
      void (async () => {
        try {
          // Decode only when the shared analysis queue reaches this song. This
          // neither replaces playback buffers nor retains a library of decoded PCM.
          const frames = await analyzeVocals(async () => {
            update({ status: "working", phase: "Reading audio", progress: 0 });
            const file = await callbacks.current.resolve(track);
            if (!file) throw new Error("Reconnect this audio file and retry.");
            const bytes = await file.arrayBuffer();
            controller.signal.throwIfAborted();
            return new OfflineAudioContext(2, 1, 44100).decodeAudioData(bytes);
          }, controller.signal, (progress) => update({ status: "working", ...progress }));
          controller.signal.throwIfAborted();
          callbacks.current.save(track, { version: 2, rms: Array.from(frames.rms, (v) => Math.round(Math.min(1, v) * 10000) / 10000), visemes: Array.from(frames.visemes) });
          update({ status: "ready", phase: "Vocals ready", progress: 1 });
        } catch (error) {
          update({ status: "error", phase: "", progress: 0, error: error instanceof Error ? error.message : "Analysis failed. Retry." });
        } finally {
          if (controllers.current.get(track.id) === controller) controllers.current.delete(track.id);
        }
      })();
    }
  };
  return { jobs, prepare, cancel };
}
