import type { LibraryTrack } from "../../domain/library";
import { readAudioFile } from "../audioFiles";

export async function readLibraryVocalBuffer(track: LibraryTrack, resolve: (track: LibraryTrack) => Promise<File | null>, signal: AbortSignal, readLoaded?: (track: LibraryTrack) => AudioBuffer | null) {
  signal.throwIfAborted();
  // Library's existing input is decoded at 44.1 kHz. Reuse only that
  // exact rate; reusing 48 kHz would change resampling and mouth results.
  const warm = readLoaded?.(track);
  if (warm?.sampleRate === 44100) return warm;
  const file = await resolve(track);
  signal.throwIfAborted();
  const nowLoaded = readLoaded?.(track);
  if (nowLoaded?.sampleRate === 44100) return nowLoaded;
  if (!file) throw new Error("Reconnect this audio file and retry.");
  const bytes = await readAudioFile(file, () => {}, signal);
  signal.throwIfAborted();
  const buffer = await new OfflineAudioContext(2, 1, 44100).decodeAudioData(bytes);
  signal.throwIfAborted();
  return buffer;
}
