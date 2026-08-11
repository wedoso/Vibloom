import type { LyricLine } from "../lrc";

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
  version: 2;
  tracks: LibraryTrack[];
  session: LibrarySession;
};

export type StoredLibrarySnapshot = LibrarySnapshot | {
  version: 1;
  tracks: LibraryTrack[];
  session: Omit<LibrarySession, "cacheEnabled"> & { cacheEnabled?: boolean };
};

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

export function migrateLibrarySnapshot(snapshot: StoredLibrarySnapshot): LibrarySnapshot {
  return {
    version: 2,
    tracks: snapshot.tracks.map((track) => ({ ...track, comparison: track.comparison ?? null })),
    session: {
      ...EMPTY_SESSION,
      ...snapshot.session,
      cacheEnabled: snapshot.version >= 2 ? (snapshot.session.cacheEnabled ?? true) : true,
    },
  };
}

export function normalizeFileName(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}

export function withoutExtension(value: string) {
  return value.replace(/\.[^.]+$/u, "");
}

export function makeTrackFingerprint(file: Pick<File, "name" | "size" | "lastModified">, relativePath = "") {
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
