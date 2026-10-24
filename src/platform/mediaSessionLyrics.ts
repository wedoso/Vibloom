export type MediaLyric = { time: number; text: string };
const DEFAULT_ARTIST = "Vibloom";
const MAX_LYRIC_CHECK_MS = 100;
const MIN_LYRIC_CHECK_MS = 10;

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
export function bindMediaSessionLyrics(metadata: Pick<MediaMetadata, "artist">, lines: readonly MediaLyric[], getTime: () => number, duration: number, playing: boolean, events: EventTarget = document, onChange: () => void = () => {}) {
  let timer: ReturnType<typeof setTimeout> | undefined, disposed = false;
  const refresh = () => {
    if (disposed) return;
    clearTimeout(timer);
    const time = getTime();
    const artist = mediaLyricArtist(lines, time, duration);
    if (metadata.artist !== artist) { metadata.artist = artist; onChange(); }
    if (!playing || !lines.length) return;
    const next = lines[lyricIndex(lines, time) + 1]?.time ?? duration;
    // Timers can be delayed in the background. Re-read the real audio clock
    // instead of replaying stale lines. Schedule short lines at their boundary,
    // and re-arm after every seek/refresh rather than keeping the old deadline.
    // Clock checks are independent of the 1 Hz native progress publisher;
    // unchanged lyric text still causes no metadata writes.
    const delay = Number.isFinite(time) && next > time
      ? Math.min(MAX_LYRIC_CHECK_MS, Math.max(MIN_LYRIC_CHECK_MS, (next - time - .03) * 1000))
      : MAX_LYRIC_CHECK_MS;
    timer = setTimeout(refresh, delay);
  };
  const wake = () => refresh();
  events.addEventListener("visibilitychange", wake);
  refresh();
  return {
    refresh,
    dispose() { disposed = true; clearTimeout(timer); events.removeEventListener("visibilitychange", wake); },
  };
}
