export type VocalWorkerReply = { type: string; frames?: Float32Array; mono?: Float32Array; vowels?: Uint8Array; backend?: string; runtime?: string; models?: Blob[] };
export class VocalGpuInitializationError extends Error {}
type Progress = { phase: string; progress: number; step?: string; runtime?: string };
type Pending = { worker: Worker; resolve: (reply: VocalWorkerReply) => void; reject: (error: unknown) => void; progress: (update: Progress) => void };

/** Only the model/runtime is shared. Every request owns its PCM and callbacks. */
class VocalWorkerSession {
  initialized = false;
  backend = "";
  leased = false;
  private error: unknown = null;
  private disposed = false;
  private pending: Pending | null = null;
  private motionWorker: Worker | null = null;
  constructor(readonly separator: Worker, private createMotion: Worker | (() => Worker)) {
    this.bind(separator);
    if (typeof createMotion !== "function") { this.motionWorker = createMotion; this.bind(createMotion); }
  }
  get motion() {
    if (!this.healthy) throw this.error;
    if (!this.motionWorker) {
      try { this.motionWorker = (this.createMotion as () => Worker)(); this.bind(this.motionWorker); }
      catch (error) { this.dispose(error); throw error; }
    }
    return this.motionWorker;
  }
  private bind(worker: Worker) {
    worker.onerror = () => this.dispose(new Error("The vocal analysis worker could not start. Please retry."));
    worker.onmessageerror = () => this.dispose(new Error("The vocal analysis worker returned unreadable data. Please retry."));
    worker.onmessage = ({ data }) => {
      if (data.type === "error") {
        this.dispose(data.gpuInitialization ? new VocalGpuInitializationError(data.message) : new Error(data.message));
        return;
      }
      const pending = this.pending;
      if (!pending || pending.worker !== worker) return;
      if (data.type === "progress") {
        try { pending.progress({ phase: data.phase, progress: data.progress, step: data.step, runtime: data.runtime }); }
        catch (error) { this.dispose(error); }
      } else if (data.type === "ready" || data.type === "result") {
        this.pending = null;
        pending.resolve(data);
      }
    };
  }
  get healthy() { return !this.disposed; }
  request(worker: Worker, message: unknown, transfer: Transferable[], progress: (update: Progress) => void) {
    if (!this.healthy) return Promise.reject<VocalWorkerReply>(this.error);
    if (this.pending) return Promise.reject<VocalWorkerReply>(new Error("Vocal analysis is already working."));
    return new Promise<VocalWorkerReply>((resolve, reject) => {
      this.pending = { worker, resolve, reject, progress };
      try { worker.postMessage(message, transfer); }
      catch (error) { this.dispose(error); }
    });
  }
  dispose(error: unknown = new Error("Vocal analysis session was released.")) {
    if (!this.healthy) return;
    this.disposed = true;
    this.error = error;
    const pending = this.pending;
    this.pending = null;
    this.separator.terminate();
    this.motionWorker?.terminate();
    pending?.reject(error);
  }
}

/** The shared audio queue grants one lease at a time. Bound retention between
 * songs, and discard the entire pair on cancellation or any worker failure. */
export class VocalWorkerPool {
  private session: VocalWorkerSession | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  constructor(private create: () => { separator: Worker; motion: Worker | (() => Worker) }, private idleMilliseconds = 15_000) {}
  acquire() {
    if (this.session?.leased) throw new Error("Vocal analysis is already working.");
    if (this.idleTimer !== null) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    if (!this.session?.healthy) {
      const { separator, motion } = this.create();
      this.session = new VocalWorkerSession(separator, motion);
    }
    this.session.leased = true;
    return this.session;
  }
  discard(session: VocalWorkerSession, error?: unknown) {
    session.dispose(error);
    if (this.session !== session) return;
    if (this.idleTimer !== null) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    this.session = null;
  }
  release(session: VocalWorkerSession, reusable: boolean) {
    session.leased = false;
    if (!reusable || !session.healthy || this.idleMilliseconds === 0) { this.discard(session); return; }
    if (this.session !== session) return;
    this.idleTimer = setTimeout(() => this.discard(session), this.idleMilliseconds);
  }
  releaseIdle() {
    if (this.session && !this.session.leased) this.discard(this.session);
  }
}
