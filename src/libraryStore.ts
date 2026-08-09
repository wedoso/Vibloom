import type { LyricLine } from "./lrc";

export type TrackAvailability = "available" | "reconnect" | "missing" | "session";
export type TrackPersistence = "indexed" | "cached";
export type RepeatMode = "off" | "all" | "one";

export type TrackComparison = {
  name: string;
  size: number;
  lastModified: number;
  duration: number;
  availability: TrackAvailability;
  persistence: TrackPersistence;
};

export type LibraryTrack = {
  id: string;
  fingerprint: string;
  name: string;
  relativePath: string;
  sourceLabel: string;
  size: number;
  lastModified: number;
  duration: number;
  availability: TrackAvailability;
  persistence: TrackPersistence;
  lyricsFileName: string;
  lyrics: LyricLine[];
  comparison: TrackComparison | null;
};

export type LibrarySession = {
  queue: string[];
  history: string[];
  currentTrackId: string;
  currentTime: number;
  shuffle: boolean;
  repeat: RepeatMode;
  volume: number;
  cacheEnabled: boolean;
};

export type LibrarySnapshot = {
  version: 1 | 2;
  tracks: LibraryTrack[];
  session: LibrarySession;
};

const DB_NAME = "vibloom-library";
const DB_VERSION = 1;
const STATE_STORE = "state";
const SNAPSHOT_KEY = "library";
const OPFS_TRACKS_DIR = "tracks";

export const EMPTY_SESSION: LibrarySession = {
  queue: [],
  history: [],
  currentTrackId: "",
  currentTime: 0,
  shuffle: false,
  repeat: "off",
  volume: 0.9,
  cacheEnabled: true,
};

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error("Browser storage is unavailable."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STATE_STORE)) {
        request.result.createObjectStore(STATE_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open browser storage."));
  });
}

export async function loadLibrarySnapshot(): Promise<LibrarySnapshot | null> {
  const database = await openDatabase();
  try {
    return await new Promise<LibrarySnapshot | null>((resolve, reject) => {
      const transaction = database.transaction(STATE_STORE, "readonly");
      const request = transaction.objectStore(STATE_STORE).get(SNAPSHOT_KEY);
      request.onsuccess = () => resolve((request.result as LibrarySnapshot | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error("Could not restore the library."));
    });
  } finally {
    database.close();
  }
}

export async function saveLibrarySnapshot(snapshot: LibrarySnapshot) {
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

export async function deleteLibraryDatabase() {
  await new Promise<void>((resolve, reject) => {
    if (!globalThis.indexedDB) {
      resolve();
      return;
    }
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("Could not reset browser storage."));
    request.onblocked = () => reject(new Error("Close other Vibloom tabs before resetting."));
  });
}

function safeTrackFileName(trackId: string) {
  return `${trackId.replace(/[^a-zA-Z0-9_-]/gu, "_")}.audio`;
}

async function getTracksDirectory(create: boolean) {
  if (!navigator.storage?.getDirectory) throw new Error("Device audio cache is unavailable in this browser mode.");
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(OPFS_TRACKS_DIR, { create });
}

export async function cacheTrackFile(trackId: string, file: Blob) {
  const directory = await getTracksDirectory(true);
  const handle = await directory.getFileHandle(safeTrackFileName(trackId), { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(file);
  } finally {
    await writable.close();
  }
}

export async function getCachedTrackFile(trackId: string): Promise<File | null> {
  try {
    const directory = await getTracksDirectory(false);
    const handle = await directory.getFileHandle(safeTrackFileName(trackId));
    return await handle.getFile();
  } catch (error) {
    if (error instanceof DOMException && ["NotFoundError", "TypeMismatchError"].includes(error.name)) return null;
    return null;
  }
}

export async function removeCachedTrack(trackId: string) {
  try {
    const directory = await getTracksDirectory(false);
    await directory.removeEntry(safeTrackFileName(trackId));
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== "NotFoundError") throw error;
  }
}

export async function clearCachedTracks() {
  if (!navigator.storage?.getDirectory) return;
  const root = await navigator.storage.getDirectory();
  try {
    await root.removeEntry(OPFS_TRACKS_DIR, { recursive: true });
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== "NotFoundError") throw error;
  }
}

export async function readStorageState() {
  const estimate = navigator.storage?.estimate ? await navigator.storage.estimate() : {};
  const persistent = navigator.storage?.persisted ? await navigator.storage.persisted() : false;
  return {
    usage: estimate.usage ?? 0,
    quota: estimate.quota ?? 0,
    persistent,
  };
}

export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return false;
  return navigator.storage.persist();
}

export function normalizeFileName(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}

export function withoutExtension(value: string) {
  return value.replace(/\.[^.]+$/u, "");
}

export function makeTrackFingerprint(file: File, relativePath = "") {
  // Folder pickers prepend a relative directory while multi-file pickers do not.
  // The same file must keep one identity when users switch import methods to reconnect it.
  void relativePath;
  const identity = `${normalizeFileName(file.name)}|${file.size}|${file.lastModified}`;
  let hash = 2166136261;
  for (let index = 0; index < identity.length; index += 1) {
    hash ^= identity.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `track-${(hash >>> 0).toString(36)}-${file.size.toString(36)}`;
}

export function comparisonCacheKey(trackId: string) {
  return `${trackId}--version-b`;
}

export function createShuffleBag(queue: string[], currentTrackId: string, random = Math.random) {
  const bag = queue.filter((trackId) => trackId !== currentTrackId);
  for (let index = bag.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [bag[index], bag[swapIndex]] = [bag[swapIndex], bag[index]];
  }
  return bag;
}
