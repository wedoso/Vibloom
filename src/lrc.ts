export type LyricLine = {
  time: number;
  text: string;
};

export type LyricTimingLine = { text: string; time: number | null };

export function parseLyricsFile(source: string, fileName: string) {
  const parsed = parseLrc(source);
  if (parsed.lines.length) return { lyrics: parsed.lines, lyricTiming: undefined };
  if (!/\.txt$/iu.test(fileName)) throw new Error("No timestamped LRC lyrics");
  const lyricTiming: LyricTimingLine[] = source.replace(/^\uFEFF/u, "").split(/\r\n|\r|\n/u)
    .map((text) => text.trim()).filter(Boolean).map((text) => ({ text, time: null }));
  if (!lyricTiming.length) throw new Error("Empty lyrics");
  return { lyrics: [] as LyricLine[], lyricTiming };
}

export function formatLrcTime(time: number) {
  const hundredths = Math.round(Math.max(0, time) * 100);
  return `${String(Math.floor(hundredths / 6000)).padStart(2, "0")}:${String(Math.floor(hundredths / 100) % 60).padStart(2, "0")}.${String(hundredths % 100).padStart(2, "0")}`;
}

export function validateLyricTiming(lines: LyricTimingLine[]) {
  if (!lines.length || lines.some((line) => line.time === null)) return "Timestamp every line before saving or downloading.";
  let previous = -1;
  for (const line of lines) {
    const time = line.time as number;
    if (!Number.isFinite(time) || time < 0) return "Timestamps must be valid, non-negative times.";
    if (time < previous) return "Timestamps must follow the lyric order. Select a line to correct its time.";
    previous = time;
  }
  return "";
}

export function serializeLrc(lines: LyricTimingLine[]) {
  const error = validateLyricTiming(lines);
  if (error) throw new Error(error);
  return lines.map((line) => `[${formatLrcTime(line.time as number)}]${line.text}`).join("\n") + "\n";
}

export type ParsedLrc = {
  lines: LyricLine[];
  title: string;
  artist: string;
};

const TIMESTAMP = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/gu;
const METADATA = /^\[(ar|artist|ti|title|offset):([^\]]*)\]$/iu;

function fractionToSeconds(value = "") {
  if (!value) return 0;
  return Number(value.padEnd(3, "0").slice(0, 3)) / 1000;
}

export function parseLrc(source: string): ParsedLrc {
  let offsetMilliseconds = 0;
  let title = "";
  let artist = "";
  const pending: LyricLine[] = [];

  for (const rawLine of source.replace(/^\uFEFF/u, "").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) continue;

    const metadata = line.match(METADATA);
    if (metadata) {
      const key = metadata[1].toLowerCase();
      const value = metadata[2].trim();
      if (key === "offset") offsetMilliseconds = Number(value) || 0;
      else if (key === "ti" || key === "title") title = value;
      else if (key === "ar" || key === "artist") artist = value;
      continue;
    }

    const timestamps = [...line.matchAll(TIMESTAMP)];
    if (!timestamps.length) continue;
    const text = line.replace(TIMESTAMP, "").trim();
    if (!text) continue;

    for (const timestamp of timestamps) {
      const minutes = Number(timestamp[1]);
      const seconds = Number(timestamp[2]);
      const fraction = fractionToSeconds(timestamp[3]);
      pending.push({ time: minutes * 60 + seconds + fraction, text });
    }
  }

  const grouped = new Map<number, string[]>();
  for (const line of pending) {
    const adjustedTime = Math.max(0, line.time + offsetMilliseconds / 1000);
    const key = Math.round(adjustedTime * 1000) / 1000;
    const texts = grouped.get(key) ?? [];
    if (!texts.includes(line.text)) texts.push(line.text);
    grouped.set(key, texts);
  }

  const lines = [...grouped.entries()]
    .sort(([a], [b]) => a - b)
    .map(([time, texts]) => ({ time, text: texts.join("\n") }));

  return { lines, title, artist };
}

export function decodeLrc(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(buffer);
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(buffer);
  }
  return new TextDecoder("utf-8").decode(buffer);
}
