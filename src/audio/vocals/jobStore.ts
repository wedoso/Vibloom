import { comparisonsOf, type LibraryTrack, type VocalAnalysis } from "../../domain/library";
import { analyzeVocals, type VocalProgress } from "./analyzeVocals";
import type { VocalAnalysisStore } from "./analysisStore";

export type VocalJob = VocalProgress & { status: "idle" | "queued" | "working" | "ready" | "error"; error?: string; analysis?: VocalAnalysis; backend?: string; phases?: string[]; detail?: string };
export const vocalJobKey = (track: LibraryTrack, source = 0) => {
  const comparison = source ? comparisonsOf(track).find(item => item.slot === source) : null;
  return JSON.stringify([track.id, track.fingerprint, source, comparison && [comparison.id, comparison.name, comparison.size, comparison.lastModified]]);
};

/** One source identity, one task, any number of UI subscribers. */
export class VocalJobStore {
  private jobs: Record<string, VocalJob> = {};
  private controllers = new Map<string, AbortController>();
  private listeners = new Set<() => void>();
  constructor(private analyze = analyzeVocals, private storage?: VocalAnalysisStore) {}
  getSnapshot = () => this.jobs;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(key: string, job?: VocalJob) {
    const previous = this.jobs[key];
    this.jobs = { ...this.jobs };
    if (job) {
      const phases = job.phases ?? previous?.phases ?? [];
      const backend = job.phase.startsWith("Separating vocals · ") ? job.phase.slice("Separating vocals · ".length) : "backend" in job ? job.backend : previous?.backend;
      const processing = job.status === "working" && job.chunk !== undefined;
      this.jobs[key] = job.status === "idle" ? job : {
        ...job, backend,
        phase: processing ? `Preparing lip sync · Part ${job.chunk}/${job.chunks}` : job.phase,
        detail: job.phase,
        progress: processing ? Math.max(previous?.chunk === undefined ? 0 : previous.progress, job.progress) : job.progress,
        phases: job.phase && !phases.includes(job.phase) ? [...phases, job.phase].slice(-8) : phases,
      };
    } else delete this.jobs[key];
    this.listeners.forEach((listener) => listener());
  }
  prepare(key: string, source: AudioBuffer | ((signal: AbortSignal) => Promise<AudioBuffer>), save: (analysis: VocalAnalysis) => void) {
    if (this.controllers.has(key) || this.jobs[key]?.status === "ready") return;
    const controller = new AbortController();
    this.controllers.set(key, controller);
    this.publish(key, { status: "queued", phase: "Queued", progress: 0, phases: [], backend: undefined });
    void this.analyze(async () => {
      controller.signal.throwIfAborted();
      this.publish(key, { status: "working", phase: "Reading audio", progress: 0 });
      const buffer = typeof source === "function" ? await source(controller.signal) : source;
      controller.signal.throwIfAborted(); return buffer;
    }, controller.signal, (progress) => {
      if (!controller.signal.aborted) this.publish(key, { ...progress, status: progress.phase.startsWith("Queued") ? "queued" : "working" });
    }).then(async (frames) => {
      if (controller.signal.aborted) return;
      this.publish(key, { status: "working", phase: "Saving lip sync", progress: .99 });
      const roundRms = (v: number) => Math.round(Math.min(1, v) * 10000) / 10000;
      let analysis: VocalAnalysis = { version: 4,
        rms: this.storage ? Float64Array.from(frames.rms, roundRms) : Array.from(frames.rms, roundRms),
        vowels: this.storage ? frames.vowels : Array.from(frames.vowels) };
      if (this.storage) {
        try { analysis = await this.storage.put(analysis); }
        catch { /* Keep the finished analysis usable if persistent storage fails. */ }
        if (controller.signal.aborted) {
          if ("cacheKey" in analysis) await this.storage.remove(analysis.cacheKey).catch(() => undefined);
          return;
        }
      }
      save(analysis);
      this.publish(key, { status: "ready", phase: "Vocals ready", progress: 1, analysis });
    }).catch((error) => {
      if (!controller.signal.aborted) this.publish(key, { status: "error", phase: "", progress: 0, error: error instanceof Error ? error.message : "Analysis failed. Retry." });
    }).finally(() => { if (this.controllers.get(key) === controller) this.controllers.delete(key); });
  }
  cancel = (key: string) => { this.controllers.get(key)?.abort(); this.controllers.delete(key); this.publish(key, { status: "idle", phase: "", progress: 0 }); };
  forget = (key: string) => { this.controllers.get(key)?.abort(); this.controllers.delete(key); this.publish(key); };
  forgetReference = (cacheKey: string) => {
    for (const [key, job] of Object.entries(this.jobs)) if (job.analysis && "cacheKey" in job.analysis && job.analysis.cacheKey === cacheKey) this.forget(key);
  };
  reset = () => {
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
    this.jobs = {};
    this.listeners.forEach((listener) => listener());
  };
  dispose = () => { this.reset(); this.listeners.clear(); };
}
