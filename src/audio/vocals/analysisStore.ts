import { comparisonsOf, isCurrentVocalAnalysis, migrateLibrarySnapshot, withComparisons, type LibrarySession, type MotionVocalAnalysis, type VocalAnalysis, type VocalAnalysisReference } from "../../domain/library";
import type { LibraryRepository } from "../../platform/libraryPlatform";

export type CompactVocalAnalysis = { version: 4; rms: Float64Array; vowels: Uint8Array };
export interface VocalStorage {
  get(key: string): Promise<unknown>;
  put(key: string, value: CompactVocalAnalysis): Promise<void>;
  remove(key: string): Promise<void>;
}
export function compactVocalAnalysis(analysis: MotionVocalAnalysis): CompactVocalAnalysis {
  if (!isCurrentVocalAnalysis(analysis)) throw new Error("Invalid vocal analysis.");
  // Float64 retains every existing v4 decimal exactly; playback still performs
  // the same Float32 conversion as before. Vowels are already byte weights.
  return { version: 4, rms: Float64Array.from(analysis.rms), vowels: Uint8Array.from(analysis.vowels) };
}
const bytesOf = (value: CompactVocalAnalysis) => value.rms.byteLength + value.vowels.byteLength;
export class VocalAnalysisStore {
  private cache = new Map<string, CompactVocalAnalysis>();
  private pending = new Map<string, Promise<CompactVocalAnalysis | null>>();
  private removed = new Set<string>();
  private bytes = 0;
  private epoch = 0;
  constructor(private storage: VocalStorage, private budget = 8 * 1024 * 1024) {}
  get residentBytes() { return this.bytes; }
  private remember(key: string, value: CompactVocalAnalysis) {
    const previous = this.cache.get(key);
    if (previous) this.bytes -= bytesOf(previous);
    this.cache.delete(key);
    if (bytesOf(value) > this.budget) return;
    this.cache.set(key, value); this.bytes += bytesOf(value);
    while (this.bytes > this.budget) {
      const oldest = this.cache.keys().next().value!;
      this.bytes -= bytesOf(this.cache.get(oldest)!); this.cache.delete(oldest);
    }
  }
  async put(analysis: MotionVocalAnalysis): Promise<VocalAnalysisReference> {
    const generation = this.epoch, value = compactVocalAnalysis(analysis), cacheKey = crypto.randomUUID();
    await this.storage.put(cacheKey, value);
    if (generation !== this.epoch) {
      await this.storage.remove(cacheKey).catch(() => undefined);
      throw new DOMException("Vocal storage changed", "AbortError");
    }
    // Writes do not warm the cache: a library batch must never accumulate all
    // its output curves. Only the audible source reads into the bounded LRU.
    return { version: 4, frames: value.rms.length, cacheKey };
  }
  async get(reference: VocalAnalysisReference): Promise<CompactVocalAnalysis | null> {
    const warm = this.cache.get(reference.cacheKey);
    if (warm) { this.remember(reference.cacheKey, warm); return warm.rms.length === reference.frames ? warm : null; }
    const existing = this.pending.get(reference.cacheKey);
    if (existing) { const value = await existing; return value?.rms.length === reference.frames ? value : null; }
    const generation = this.epoch;
    const task = (async () => {
      const raw = await this.storage.get(reference.cacheKey) as VocalAnalysis | undefined;
      if (generation !== this.epoch || this.removed.has(reference.cacheKey) || !isCurrentVocalAnalysis(raw)) return null;
      const value = raw.rms instanceof Float64Array && raw.vowels instanceof Uint8Array
        ? raw as CompactVocalAnalysis : compactVocalAnalysis(raw);
      if (value.rms.length !== reference.frames) return null;
      this.remember(reference.cacheKey, value); return value;
    })();
    this.pending.set(reference.cacheKey, task);
    try { return await task; } finally {
      if (this.pending.get(reference.cacheKey) === task) { this.pending.delete(reference.cacheKey); this.removed.delete(reference.cacheKey); }
    }
  }
  release() { this.epoch++; this.cache.clear(); this.pending.clear(); this.removed.clear(); this.bytes = 0; }
  remove(key: string) {
    if (this.pending.has(key)) this.removed.add(key);
    const value = this.cache.get(key);
    if (value) { this.cache.delete(key); this.bytes -= bytesOf(value); }
    return this.storage.remove(key);
  }
}

/** Split only valid v4 curves, and publish references only after durable writes.
 * Old versions and unavailable storage retain the original data unchanged. */
export function withVocalStorage(repository: LibraryRepository, store: VocalAnalysisStore): LibraryRepository {
  let tail = Promise.resolve(), generation = 0;
  const cancelled = () => new DOMException("Library storage changed", "AbortError");
  const enqueue = <T,>(work: (epoch: number) => Promise<T>) => {
    const epoch = generation;
    const result = tail.then(() => { if (epoch !== generation) throw cancelled(); return work(epoch); });
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
  const split = async (saved: NonNullable<Awaited<ReturnType<LibraryRepository["load"]>>>) => {
    const snapshot = migrateLibrarySnapshot(saved);
    const created: string[] = [];
    const replace = async (analysis: VocalAnalysis | undefined) => {
      if (!isCurrentVocalAnalysis(analysis)) return analysis;
      try { const reference = await store.put(analysis); created.push(reference.cacheKey); return reference; }
      catch { return analysis; }
    };
    // Serial migration bounds allocation to one song, rather than duplicating
    // every curve simultaneously with Promise.all.
    const tracks = [];
    for (const track of snapshot.tracks) {
      const versions = [];
      for (const version of comparisonsOf(track)) versions.push({ ...version, vocalAnalysis: await replace(version.vocalAnalysis) });
      tracks.push(withComparisons({ ...track, vocalAnalysis: await replace(track.vocalAnalysis) }, versions));
    }
    return { snapshot: { ...snapshot, tracks }, created };
  };
  const rollback = (created: string[]) => Promise.allSettled(created.map(key => store.remove(key)));
  return {
    load: () => enqueue(async epoch => {
      const saved = await repository.load(); if (!saved) return null;
      const { snapshot, created } = await split(saved);
      try {
        if (epoch !== generation) throw cancelled();
        if (created.length) await repository.save(snapshot);
      } catch (error) {
        // These keys belong only to this migration and were never published.
        // Never sweep other tabs' pending records or UI-owned job references.
        await rollback(created);
        if (epoch !== generation) throw error;
        return migrateLibrarySnapshot(saved);
      }
      return snapshot;
    }),
    save: snapshot => enqueue(async epoch => {
      const { snapshot: splitSnapshot, created } = await split(snapshot);
      try { if (epoch !== generation) throw cancelled(); await repository.save(splitSnapshot); }
      catch (error) { await rollback(created); throw error; }
    }),
    ...(repository.saveSession ? { saveSession: (session: LibrarySession) => enqueue(async () => { await repository.saveSession!(session); }) } : {}),
    reset() {
      generation++; store.release();
      return enqueue(async () => { await repository.reset(); });
    },
  };
}

/** Curve records share the platform's existing state database, with separate
 * keys. No version upgrade or cross-window schema blocking is required. */
export function indexedVocalStorage(open: () => Promise<IDBDatabase>): VocalStorage {
  const prefix = "vocal:";
  const update = async (work: (store: IDBObjectStore) => void) => {
    const db = await open();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction("state", "readwrite"); work(transaction.objectStore("state"));
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error ?? new Error("Vocal storage was cancelled."));
      });
    } finally { db.close(); }
  };
  return {
    async get(key) {
      const db = await open();
      try {
        return await new Promise((resolve, reject) => {
          const transaction = db.transaction("state"), request = transaction.objectStore("state").get(prefix + key);
          transaction.oncomplete = () => resolve(request.result);
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
        });
      } finally { db.close(); }
    },
    put: (key, value) => update(store => { store.put(value, prefix + key); }),
    remove: key => update(store => { store.delete(prefix + key); }),
  };
}
