import type { CompanionId } from "../live2d/models";
import type { LyricLine, LyricTimingLine } from "../lrc";

export type TrackAvailability = "available" | "reconnect" | "missing" | "session";
export type TrackPersistence = "indexed" | "cached";
export type RepeatMode = "off" | "all" | "one";

export type MotionVocalAnalysis = { version: 4; rms: number[]; vowels: number[] };
export type VocalAnalysis = { version: 1; rms: number[] } | { version: 2 | 3; rms: number[]; visemes: number[] } | MotionVocalAnalysis;

/** Old classifier caches remain metadata until explicitly re-prepared. Never
 * interpret their discrete labels as MotionSync's frame-major byte weights. */
export function isCurrentVocalAnalysis(analysis: VocalAnalysis | undefined, duration?: number): analysis is MotionVocalAnalysis {
  return analysis?.version === 4 && Array.isArray(analysis.rms) && Array.isArray(analysis.vowels)
    && (duration === undefined || analysis.rms.length === Math.ceil(duration * 50))
    && analysis.vowels.length === analysis.rms.length * 5
    && analysis.rms.every(value => Number.isFinite(value) && value >= 0 && value <= 1)
    && analysis.vowels.every(value => Number.isInteger(value) && value >= 0 && value <= 255);
}

export type TrackComparison = {
  id?: string;
  slot?: number;
  source?: { id: string; number: number; name: string };
  mastering?: { engineVersion: string; upstream: string; inputIdentity: string; settings: import("../audio/mastering/settings").MasteringSettings; createdAt: number; clippedSamples: number };
  eq?: { engineVersion: string; presetId: string; createdAt: number; clippedSamples: number };
  peaks?: number[];
  cacheKey?: string;
  remaster?: { engineVersion: string; presetId: string; createdAt: number; metrics: import("../audio/remaster/wav").RenderMetrics };
  vocalAnalysis?: VocalAnalysis;
  name: string;
  size: number;
  lastModified: number;
  duration: number;
  availability: TrackAvailability;
  persistence: TrackPersistence;
};

export type LibraryTrack = {
  vocalAnalysis?: VocalAnalysis;
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
  lyricTiming?: LyricTimingLine[];
  lyricMetadata?: string[];
  comparison: TrackComparison | null;
  comparisons?: TrackComparison[];
};

export type LibrarySession = {
  queue: string[];
  history: string[];
  currentTrackId: string;
  playbackAlbumId?: string;
  currentTime: number;
  shuffle: boolean;
  repeat: RepeatMode;
  volume: number;
  cacheEnabled: boolean;
  companionId: CompanionId;
};

export type LibrarySnapshot = {
  version: 3;
  tracks: LibraryTrack[];
  albums: LibraryAlbum[];
  session: LibrarySession;
};

/** Virtual collections reference existing tracks; they never move source files. */
export type LibraryAlbum = {
  id: string;
  name: string;
  trackIds: string[];
  cover?: string;
};

/** Artwork follows playback provenance; browsing another album does not retarget it. */
export function albumForTrack(albums: LibraryAlbum[], trackId: string, preferredId = "") {
  if (!trackId) return undefined;
  return albums.find(album => album.id === preferredId && album.trackIds.includes(trackId))
    ?? albums.find(album => !!album.cover && album.trackIds.includes(trackId));
}

export const TRACK_DRAG_TYPE = "application/x-vibloom-track";

export function addAlbumTracks(album: LibraryAlbum, trackIds: string[]) {
  return { ...album, trackIds: [...new Set([...album.trackIds, ...trackIds])] };
}

/** Move relative to a visible row without disturbing songs hidden by search. */
export function reorderAlbumTrack(album: LibraryAlbum, trackId: string, targetId: string, edge: "before" | "after") {
  if (trackId === targetId || !album.trackIds.includes(trackId) || !album.trackIds.includes(targetId)) return album;
  const trackIds = album.trackIds.filter(id => id !== trackId);
  const position = trackIds.indexOf(targetId) + (edge === "after" ? 1 : 0);
  trackIds.splice(position, 0, trackId);
  return { ...album, trackIds };
}

export type StoredLibrarySnapshot = {
  version: 1 | 2 | 3;
  tracks: LibraryTrack[];
  albums?: LibraryAlbum[];
  session: Omit<LibrarySession, "cacheEnabled" | "companionId"> & Partial<Pick<LibrarySession, "cacheEnabled" | "companionId">>;
};

export const EMPTY_SESSION: LibrarySession = {
  queue: [],
  history: [],
  currentTrackId: "",
  playbackAlbumId: "",
  currentTime: 0,
  shuffle: false,
  repeat: "off",
  volume: 0.9,
  cacheEnabled: true,
  companionId: "hong-xi",
};

export function migrateLibrarySnapshot(snapshot: StoredLibrarySnapshot): LibrarySnapshot {
  const trackIds = new Set(snapshot.tracks.map((track) => track.id));
  return {
    version: 3,
    tracks: snapshot.tracks.map((track) => withComparisons(track, comparisonsOf(track))),
    albums: (snapshot.albums ?? []).map((album) => ({
      ...album,
      trackIds: [...new Set(album.trackIds)].filter((id) => trackIds.has(id)),
    })),
    session: {
      ...EMPTY_SESSION,
      ...snapshot.session,
      playbackAlbumId: typeof snapshot.session.playbackAlbumId === "string" ? snapshot.session.playbackAlbumId : "",
      companionId: snapshot.session.companionId === "hiyori" || snapshot.session.companionId === "hong-xi"
        ? snapshot.session.companionId
        : EMPTY_SESSION.companionId,
      cacheEnabled: snapshot.version >= 2 ? (snapshot.session.cacheEnabled ?? true) : true,
    },
  };
}

/** Preserve legacy B and its cache key; slots are stable after removals. */
export function comparisonsOf(track: LibraryTrack): TrackComparison[] {
  const source = track.comparisons ?? (track.comparison ? [{ ...track.comparison, slot: 1, id: "legacy-b" }] : []);
  const used = new Set<number>();
  return source.filter(item => {
    if (!Number.isInteger(item.slot) || item.slot! < 1 || item.slot! > 8 || used.has(item.slot!)) return false;
    used.add(item.slot!); return true;
  }).map(item => ({ ...item, id: item.id ?? `legacy-${item.slot}`, cacheKey: item.cacheKey ?? (item.slot === 1 ? `${track.id}--version-b` : `${track.id}--version-${item.slot! + 1}`) })).sort((a, b) => a.slot! - b.slot!);
}
export function withComparisons(track: LibraryTrack, comparisons: TrackComparison[]): LibraryTrack {
  return { ...track, comparisons, comparison: comparisons.find(item => item.slot === 1) ?? null };
}

export function normalizeFileName(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}

export function withoutExtension(value: string) {
  return value.replace(/\.[^.]+$/u, "");
}

/** Prefer lyrics beside the audio; flat imports may match only unambiguous names. */
export function matchLyricFile<T extends { name: string; relativePath: string }>(
  track: { name: string; relativePath: string }, files: T[], peers: { name: string; relativePath: string }[],
): T | undefined {
  const stem = (name: string) => withoutExtension(normalizeFileName(name));
  const pathStem = (path: string) => withoutExtension(normalizeFileName(path));
  const candidates = files.filter((file) => stem(file.name) === stem(track.name));
  const preferLrc = (matches: T[]) => matches.find((file) => /\.lrc$/iu.test(file.name)) ?? matches[0];
  const exact = candidates.filter((file) => pathStem(file.relativePath) === pathStem(track.relativePath));
  if (exact.length) return preferLrc(exact);
  const directories = new Set(candidates.map((file) => pathStem(file.relativePath)));
  if (directories.size !== 1 || peers.filter((peer) => stem(peer.name) === stem(track.name)).length !== 1) return;
  return preferLrc(candidates);
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

export function comparisonCacheKey(trackId: string, comparison?: TrackComparison | null) {
  return comparison?.cacheKey ?? `${trackId}--version-b`;
}

export function createShuffleBag(queue: string[], currentTrackId: string, random = Math.random) {
  const bag = queue.filter((trackId) => trackId !== currentTrackId);
  for (let index = bag.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [bag[index], bag[swapIndex]] = [bag[swapIndex], bag[index]];
  }
  return bag;
}
