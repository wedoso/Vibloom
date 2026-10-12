export type MediaLyric = { time: number; text: string };
const DEFAULT_ARTIST = "Vibloom";

function lyricIndex(lines: readonly MediaLyric[], time: number) {
  let low = 0, high = lines.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (lines[middle].time <= time + .03) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}

export function mediaLyricArtist(lines: readonly MediaLyric[], time: number, duration: number) {
  if (!Number.isFinite(time) || time < 0 || duration > 0 && time >= duration) return DEFAULT_ARTIST;
  return lines[lyricIndex(lines, time)]?.text.trim() || DEFAULT_ARTIST;
}

/** Publish one lyric at a time through the existing Now Playing artist field.
 * This is metadata, not a Bluetooth lyrics protocol. Poll the audio clock even
 * when visual rendering is suspended; only write when the lyric changes. */
export function bindMediaSessionLyrics(metadata: Pick<MediaMetadata, "artist">, lines: readonly MediaLyric[], getTime: () => number, duration: number, playing: boolean, events: EventTarget = document) {
  let timer: ReturnType<typeof setTimeout> | undefined, disposed = false;
  const refresh = () => {
    if (disposed) return;
    const time = getTime();
    const artist = mediaLyricArtist(lines, time, duration);
    if (metadata.artist !== artist) metadata.artist = artist;
  };
  const tick = () => {
    if (disposed) return;
    refresh();
    if (!playing || !lines.length) return;
    const time = getTime(), next = lines[lyricIndex(lines, time) + 1]?.time ?? duration;
    // Timers can be delayed in the background. Re-read the real audio clock
    // instead of advancing a lyric counter; bound foreground checks to 1 Hz
    // except near a known boundary.
    const delay = Number.isFinite(time) && next > time ? Math.min(1000, Math.max(100, (next - time - .03) * 1000)) : 1000;
    timer = setTimeout(tick, delay);
  };
  const wake = () => { clearTimeout(timer); tick(); };
  events.addEventListener("visibilitychange", wake);
  tick();
  return {
    refresh,
    dispose() { disposed = true; clearTimeout(timer); events.removeEventListener("visibilitychange", wake); },
  };
}
