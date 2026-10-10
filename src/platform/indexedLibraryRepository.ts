import type { LibraryRepository } from "./libraryPlatform";
import type { LibrarySession, LibrarySnapshot, StoredLibrarySnapshot } from "../domain/library";

export class LibraryConflictError extends Error {
  constructor() {
    super("Your library changed in another window. Reload before saving more changes.");
    this.name = "LibraryConflictError";
  }
}
export const librarySaveMessage = (error: unknown, fallback: string) => error instanceof LibraryConflictError ? error.message : fallback;

function metadataSignature(snapshot: StoredLibrarySnapshot | LibrarySnapshot) {
  // Keep no-op detection bounded and independent of mutable caller objects.
  // Full legacy curves and unusually large metadata use the normal commit.
  try {
    if (snapshot.tracks.some(track => [track.vocalAnalysis, track.comparison?.vocalAnalysis, ...(track.comparisons ?? []).map(item => item.vocalAnalysis)].some(analysis => analysis && "rms" in analysis))) return null;
    const signature = JSON.stringify([snapshot.tracks, snapshot.albums ?? []]);
    return signature.length <= 512 * 1024 ? signature : null;
  } catch { return null; }
}

/** Compare and commit in one IndexedDB transaction. Stale windows may keep
 * listening, but cannot overwrite newer metadata or resurrect a reset library. */
export function indexedLibraryRepository(open: () => Promise<IDBDatabase>): LibraryRepository {
  let revision: string | null | undefined;
  let metadata: string | null = null;
  const revisionKey = "libraryRevision";
  const write = async (work: (store: IDBObjectStore) => void, reset = false) => {
    const db = await open(), expected = revision, next = crypto.randomUUID();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction("state", "readwrite"), store = transaction.objectStore("state");
        let failure: unknown;
        transaction.oncomplete = () => { if (reset) revision = next; resolve(); };
        transaction.onerror = () => { failure ??= transaction.error; };
        transaction.onabort = () => reject(failure ?? transaction.error ?? new Error("Saving the library was cancelled."));
        const apply = () => {
          try { work(store); if (reset) store.put(next, revisionKey); }
          catch (error) { failure = error; transaction.abort(); }
        };
        if (reset) { apply(); return; }
        const current = store.get(revisionKey), library = expected === undefined ? store.get("library") : null;
        current.onsuccess = () => {
          const check = () => {
            if ((current.result ?? null) !== (expected ?? null) || expected === undefined && library?.result) {
              failure = new LibraryConflictError(); transaction.abort(); return;
            }
            apply();
          };
          if (library && library.readyState !== "done") library.onsuccess = check; else check();
        };
      });
    } finally { db.close(); }
  };
  return {
    async load() {
      const db = await open();
      try {
        return await new Promise<StoredLibrarySnapshot | null>((resolve, reject) => {
          const transaction = db.transaction("state"), store = transaction.objectStore("state");
          const library = store.get("library"), session = store.get("session"), version = store.get(revisionKey);
          transaction.oncomplete = () => {
            revision = version.result ?? null;
            metadata = library.result ? metadataSignature(library.result) : null;
            resolve(library.result ? { ...library.result, session: session.result ?? library.result.session } : null);
          };
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error ?? new Error("Restoring the library was cancelled."));
        });
      } finally { db.close(); }
    },
    async save(snapshot: LibrarySnapshot) {
      // Restoration and duration updates may publish equal metadata with new
      // object identities. Do not create a cross-window conflict for a no-op.
      const signature = metadataSignature(snapshot);
      if (signature !== null && signature === metadata) {
        await write(store => { store.put(snapshot.session, "session"); });
        return;
      }
      const next = crypto.randomUUID();
      await write(store => { store.put(snapshot, "library"); store.put(snapshot.session, "session"); store.put(next, revisionKey); });
      revision = next; metadata = signature;
    },
    saveSession: (session: LibrarySession) => write(store => { store.put(session, "session"); }),
    async reset() { await write(store => { store.clear(); }, true); metadata = null; },
  };
}
