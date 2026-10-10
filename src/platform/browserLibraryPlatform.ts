import type { LibraryPlatform } from "./libraryPlatform";
import { indexedLibraryRepository } from "./indexedLibraryRepository";
import { writeAudioBlob } from "./writeAudioBlob";
import { indexedVocalStorage, VocalAnalysisStore, withVocalStorage } from "../audio/vocals/analysisStore";

const DB_NAME = "vibloom-library";
const DB_VERSION = 1;
const STATE_STORE = "state";
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
  await writeAudioBlob(writable, file);
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

const vocalAnalyses = new VocalAnalysisStore(indexedVocalStorage(openDatabase));
export const browserLibraryPlatform: LibraryPlatform = {
  runtime: "web",
  vocalAnalyses,
  repository: withVocalStorage(indexedLibraryRepository(openDatabase), vocalAnalyses),
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
