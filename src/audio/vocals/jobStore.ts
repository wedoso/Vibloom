import { comparisonsOf, type LibraryTrack, type VocalAnalysis } from "../../domain/library";
import { analyzeVocals, type VocalProgress } from "./analyzeVocals";

export type VocalJob = VocalProgress & { status: "idle" | "queued" | "working" | "ready" | "error"; error?: string; analysis?: VocalAnalysis };
export const vocalJobKey = (track: LibraryTrack, source = 0) => {
  const comparison = source ? comparisonsOf(track).find(item => item.slot === source) : null;
  return JSON.stringify([track.id, track.fingerprint, source, comparison && [comparison.id, comparison.name, comparison.size, comparison.lastModified]]);
};

/** One source identity, one task, any number of UI subscribers. */
export class VocalJobStore {
  private jobs: Record<string, VocalJob> = {};
  private controllers = new Map<string, AbortController>();
  private listeners = new Set<() => void>();
  constructor(private analyze = analyzeVocals) {}
  getSnapshot = () => this.jobs;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(key: string, job?: VocalJob) {
    this.jobs = { ...this.jobs };
    if (job) this.jobs[key] = job; else delete this.jobs[key];
    this.listeners.forEach((listener) => listener());
  }
  prepare(key: string, source: AudioBuffer | (() => Promise<AudioBuffer>), save: (analysis: VocalAnalysis) => void) {
    if (this.controllers.has(key) || this.jobs[key]?.status === "ready") return;
    const controller = new AbortController();
    this.controllers.set(key, controller);
    this.publish(key, { status: "queued", phase: "Queued", progress: 0 });
    void this.analyze(async () => {
      controller.signal.throwIfAborted();
      this.publish(key, { status: "working", phase: "Reading audio", progress: 0 });
      return typeof source === "function" ? source() : source;
    }, controller.signal, (progress) => {
      if (!controller.signal.aborted) this.publish(key, { ...progress, status: progress.phase.startsWith("Queued") ? "queued" : "working" });
    }).then((frames) => {
      if (controller.signal.aborted) return;
      const analysis: VocalAnalysis = { version: 4, rms: Array.from(frames.rms, (v) => Math.round(Math.min(1, v) * 10000) / 10000), vowels: Array.from(frames.vowels) };
      save(analysis);
      this.publish(key, { status: "ready", phase: "Vocals ready", progress: 1, analysis });
    }).catch((error) => {
      if (!controller.signal.aborted) this.publish(key, { status: "error", phase: "", progress: 0, error: error instanceof Error ? error.message : "Analysis failed. Retry." });
    }).finally(() => { if (this.controllers.get(key) === controller) this.controllers.delete(key); });
  }
  cancel = (key: string) => { this.controllers.get(key)?.abort(); this.controllers.delete(key); this.publish(key, { status: "idle", phase: "", progress: 0 }); };
  forget = (key: string) => { this.controllers.get(key)?.abort(); this.controllers.delete(key); this.publish(key); };
  reset = () => {
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
    this.jobs = {};
    this.listeners.forEach((listener) => listener());
  };
  dispose = () => { this.reset(); this.listeners.clear(); };
}
