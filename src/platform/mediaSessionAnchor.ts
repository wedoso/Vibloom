// Chromium releases Web Audio's ambient media session when sound stops. A paused
// HTML media element retains a resumable session for headset / OS play commands.
// This silent carrier never carries the music: A/B still uses one AudioContext.
export function createMediaSessionAnchor(onPlay: () => void, onPause: () => void, onError: () => void) {
  const sampleRate = 8000;
  const samples = sampleRate * 10;
  const bytes = new ArrayBuffer(44 + samples);
  const view = new DataView(bytes);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, "RIFF"); view.setUint32(4, 36 + samples, true); text(8, "WAVE"); text(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate, true);
  view.setUint16(32, 1, true); view.setUint16(34, 8, true);
  text(36, "data"); view.setUint32(40, samples, true);
  new Uint8Array(bytes, 44).fill(128); // Unsigned 8-bit PCM silence.
  const url = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
  const audio = new Audio(url);
  audio.loop = true;
  audio.preload = "auto";
  let playing = false;
  let disposed = false;
  let request = 0;
  const handlePlay = () => { if (!playing && !audio.paused) onPlay(); };
  const handlePause = () => { if (playing && audio.paused) onPause(); };
  audio.addEventListener("play", handlePlay);
  audio.addEventListener("pause", handlePause);
  return {
    setPlaying(next: boolean) {
      playing = next;
      const current = ++request;
      if (next) {
        void audio.play().catch(() => { if (!disposed && playing && current === request) onError(); });
      } else audio.pause();
    },
    dispose() {
      disposed = true;
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      URL.revokeObjectURL(url);
    },
  };
}
