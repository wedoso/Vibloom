export type PlaybackIssue = "missing_file" | "read_failed" | "decode_failed" | "resume_timeout" | "resume_failed" | "clock_stalled" | "media_control";
export type PlaybackPhase = "idle" | "preparing" | "recovering" | "playing" | "paused" | "error";
export type PlaybackStage = "resume" | "read" | "decode" | "start";
const descriptions: Record<PlaybackIssue, { title: string; detail: string; action: "retry" | "reconnect" }> = {
  missing_file: { title: "Source file is unavailable", detail: "The song is no longer in this device's cache. Import its original file again to reconnect it.", action: "reconnect" },
  read_failed: { title: "The file could not be read", detail: "Check that the source file is still available on this device. Retry, or import the file again.", action: "reconnect" },
  decode_failed: { title: "The audio could not be decoded", detail: "This browser could not decode the file. Try another copy or a supported audio format, then import it again.", action: "reconnect" },
  resume_timeout: { title: "The audio device did not respond", detail: "Restoring audio took too long. Retry playback to reconnect the audio device without reloading the app.", action: "retry" },
  resume_failed: { title: "Audio playback was interrupted", detail: "The browser could not restore audio. Check your audio output and retry playback.", action: "retry" },
  clock_stalled: { title: "Playback stopped advancing", detail: "Audio did not recover after an automatic restart. Retry playback to create a fresh audio connection.", action: "retry" },
  media_control: { title: "System playback control needs attention", detail: "The browser could not complete a lock-screen or headset action. Try the player's Play button.", action: "retry" },
};
export const playbackIssueDetails = (issue: PlaybackIssue) => descriptions[issue];
export function playbackIssueFor(error: unknown, stage: PlaybackStage): PlaybackIssue {
  if (error instanceof Error && error.name === "TimeoutError") return "resume_timeout";
  return stage === "decode" ? "decode_failed" : stage === "read" ? "read_failed" : "resume_failed";
}
export class PlaybackDiagnostics {
  private snapshot: { phase: PlaybackPhase; issue: PlaybackIssue | null; stage?: PlaybackStage; events: { at: string; phase: PlaybackPhase; issue: PlaybackIssue | null; stage?: PlaybackStage }[] } = { phase: "idle", issue: null, events: [] };
  private listeners = new Set<() => void>();
  read = () => this.snapshot;
  subscribe = (notify: () => void) => { this.listeners.add(notify); return () => { this.listeners.delete(notify); }; };
  record(phase: PlaybackPhase, issue: PlaybackIssue | null = null, stage?: PlaybackStage) {
    if (phase === this.snapshot.phase && issue === this.snapshot.issue && stage === this.snapshot.stage) return;
    const event = { at: new Date().toISOString(), phase, issue, ...(stage ? { stage } : {}) };
    this.snapshot = { phase, issue, stage, events: [...this.snapshot.events, event].slice(-24) };
    for (const notify of this.listeners) notify();
  }
  report(version: string, context: { state: string; currentTime: number } | null, online: boolean) {
    // Deliberate allowlist: no raw exception text, track IDs, filenames, paths,
    // lyrics, artwork, audio or browser identifiers enter the shared report.
    return JSON.stringify({ version, online, audio: context ? { state: context.state, time: Math.round(context.currentTime * 100) / 100 } : null, ...this.snapshot }, null, 2);
  }
}
