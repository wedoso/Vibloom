import type { LibrarySnapshot, StoredLibrarySnapshot } from "../domain/library";
import type { LibraryPlatform } from "./libraryPlatform";

const DB_NAME = "vibloom-library";
const DB_VERSION = 1;
const STATE_STORE = "state";
const SNAPSHOT_KEY = "library";
const OPFS_TRACKS_DIR = "tracks";

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error("Device storage is unavailable."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STATE_STORE)) {
        request.result.createObjectStore(STATE_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open device storage."));
  });
}

async function loadSnapshot(): Promise<StoredLibrarySnapshot | null> {
  const database = await openDatabase();
  try {
    return await new Promise<StoredLibrarySnapshot | null>((resolve, reject) => {
      const transaction = database.transaction(STATE_STORE, "readonly");
      const request = transaction.objectStore(STATE_STORE).get(SNAPSHOT_KEY);
      request.onsuccess = () => resolve((request.result as StoredLibrarySnapshot | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error("Could not restore the library."));
    });
  } finally {
    database.close();
  }
}

async function saveSnapshot(snapshot: LibrarySnapshot) {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STATE_STORE, "readwrite");
      transaction.objectStore(STATE_STORE).put(snapshot, SNAPSHOT_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not save the library."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Saving the library was cancelled."));
    });
  } finally {
    database.close();
  }
}

async function resetDatabase() {
  await new Promise<void>((resolve, reject) => {
    if (!globalThis.indexedDB) {
      resolve();
      return;
    }
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("Could not reset device storage."));
    request.onblocked = () => reject(new Error("Close other Vibloom windows before resetting."));
  });
}

function safeTrackFileName(trackId: string) {
  return `${trackId.replace(/[^a-zA-Z0-9_-]/gu, "_")}.audio`;
}

async function getTracksDirectory(create: boolean) {
  if (!navigator.storage?.getDirectory) throw new Error("Device audio cache is unavailable in this mode.");
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(OPFS_TRACKS_DIR, { create });
}

async function putAudioFile(key: string, file: Blob) {
  const directory = await getTracksDirectory(true);
  const handle = await directory.getFileHandle(safeTrackFileName(key), { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(file);
  } finally {
    await writable.close();
  }
}

async function getAudioFile(key: string): Promise<File | null> {
  try {
    const directory = await getTracksDirectory(false);
    const handle = await directory.getFileHandle(safeTrackFileName(key));
    return await handle.getFile();
  } catch {
    return null;
  }
}

async function removeAudioFile(key: string) {
  try {
    const directory = await getTracksDirectory(false);
    await directory.removeEntry(safeTrackFileName(key));
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== "NotFoundError") throw error;
  }
}

async function clearAudioFiles() {
  if (!navigator.storage?.getDirectory) return;
  const root = await navigator.storage.getDirectory();
  try {
    await root.removeEntry(OPFS_TRACKS_DIR, { recursive: true });
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== "NotFoundError") throw error;
  }
}

export const browserLibraryPlatform: LibraryPlatform = {
  runtime: "web",
  repository: {
    load: loadSnapshot,
    save: saveSnapshot,
    reset: resetDatabase,
  },
  audioFiles: {
    get: getAudioFile,
    put: putAudioFile,
    remove: removeAudioFile,
    clear: clearAudioFiles,
  },
  storage: {
    async readState() {
      const estimate = navigator.storage?.estimate ? await navigator.storage.estimate() : {};
      const persistent = navigator.storage?.persisted ? await navigator.storage.persisted() : false;
      return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0, persistent };
    },
    async requestPersistence() {
      if (!navigator.storage?.persist) return false;
      return navigator.storage.persist();
    },
  },
};
