import type { LibraryPlatform } from "../platform/libraryPlatform";
import type { LibrarySnapshot, StoredLibrarySnapshot } from "../domain/library";

export const MOBILE_DATABASE = "vibloom-mobile-library";
export const MOBILE_AUDIO_DIRECTORY = "vibloom-mobile-tracks";

async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(MOBILE_DATABASE, 2);
    request.onupgradeneeded = () => {
      for (const store of ["state", "audio"]) if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Mobile library storage is unavailable."));
  });
}

async function readSnapshot(): Promise<StoredLibrarySnapshot | null> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("state").objectStore("state").get("library");
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

async function writeSnapshot(snapshot: LibrarySnapshot) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("state", "readwrite");
      transaction.objectStore("state").put(snapshot, "library");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error("Could not save this mobile library."));
    });
  } finally { db.close(); }
}

async function directory(create = false) {
  if (!navigator.storage?.getDirectory) throw new Error("Audio caching is unavailable. You can still listen this session.");
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(MOBILE_AUDIO_DIRECTORY, { create });
}
const fileName = (key: string) => `${key.replace(/[^a-zA-Z0-9_-]/gu, "_")}.audio`;

// Older Safari can expose OPFS without asynchronous writable handles.
// IndexedDB byte records also avoid File-backed Blob persistence failures in WebKit.
async function cachedBlob(key: string): Promise<Blob | null> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("audio").objectStore("audio").get(key);
      request.onsuccess = () => {
        const value = request.result as Blob | { bytes: ArrayBuffer; type: string } | undefined;
        resolve(value instanceof Blob ? value : value?.bytes ? new Blob([value.bytes], { type: value.type }) : null);
      };
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}
async function updateBlobs(update: (store: IDBObjectStore) => void) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("audio", "readwrite"); update(transaction.objectStore("audio"));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

export const mobilePlatform: LibraryPlatform = {
  runtime: "web",
  repository: {
    load: readSnapshot,
    save: writeSnapshot,
    async reset() {
      const db = await database();
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = db.transaction("state", "readwrite");
          transaction.objectStore("state").clear();
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
        });
      } finally { db.close(); }
    },
  },
  audioFiles: {
    async get(key) {
      // A successful fallback write may leave an inaccessible OPFS entry behind.
      try { const blob = await cachedBlob(key); if (blob) return new File([blob], fileName(key), { type: blob.type }); } catch { /* Try OPFS independently. */ }
      try { const file = await (await (await directory()).getFileHandle(fileName(key))).getFile(); return file.size ? file : null; }
      catch { return null; }
    },
    async put(key, file) {
      try {
        const handle = await (await directory(true)).getFileHandle(fileName(key), { create: true });
        if (typeof handle.createWritable !== "function") throw new Error("Writable OPFS is unavailable.");
        const writer = await handle.createWritable();
        try { await writer.write(file); await writer.close(); }
        catch (error) { await writer.abort().catch(() => undefined); throw error; }
        await updateBlobs(store => store.delete(key)).catch(() => undefined);
      } catch {
        const cached = { bytes: await file.arrayBuffer(), type: file.type };
        await updateBlobs(store => store.put(cached, key));
        // Prefer the new fallback Blob to a stale/empty OPFS entry.
        try { await (await directory()).removeEntry(fileName(key)); } catch { /* Missing/disabled OPFS. */ }
      }
    },
    async remove(key) {
      await updateBlobs(store => store.delete(key));
      if (typeof navigator.storage?.getDirectory === "function") {
        try { await (await directory()).removeEntry(fileName(key)); }
        catch (error) { if (!(error instanceof DOMException) || error.name !== "NotFoundError") throw error; }
      }
    },
    async clear() {
      await updateBlobs(store => store.clear());
      if (!navigator.storage?.getDirectory) return;
      const root = await navigator.storage.getDirectory();
      try { await root.removeEntry(MOBILE_AUDIO_DIRECTORY, { recursive: true }); }
      catch (error) { if (!(error instanceof DOMException) || error.name !== "NotFoundError") throw error; }
    },
  },
  storage: {
    async readState() {
      const estimate = await navigator.storage?.estimate?.() ?? {};
      return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0, persistent: await navigator.storage?.persisted?.() ?? false };
    },
    requestPersistence: async () => await navigator.storage?.persist?.() ?? false,
  },
};
