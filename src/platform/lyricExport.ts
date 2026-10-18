import { serializeLrc, serializeTxt } from "../lrc";
import type { LibraryTrack } from "../domain/library";
export function lyricExport(track: LibraryTrack, format: "lrc" | "txt") {
  const lines = track.lyricTiming ?? track.lyrics;
  if (!lines.length) throw new Error("Attach lyrics before exporting.");
  return {
    text: format === "txt" ? serializeTxt(lines) : serializeLrc(lines, track.lyricMetadata),
    filename: (track.lyricsFileName || track.name).replace(/\.[^.]+$/u, "") + `.${format}`,
  };
}
export function downloadTrackLyrics(track: LibraryTrack, format: "lrc" | "txt") {
  const { text, filename } = lyricExport(track, format);
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
