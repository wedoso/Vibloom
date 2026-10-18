import type { SynchronizedAudioEngine } from "../audio/SynchronizedAudioEngine";

// A short frozen clock can be an output-route handoff. Rebuilding after only
// 1.5 seconds can tear down a wireless route while it is still connecting.
export const PLAYBACK_STALL_MS = 5000;
type Options = {
  isBusy: () => boolean;
  recover: (rebuild: boolean) => Promise<boolean>;
  onFailure: () => void;
};

/** Watch the actual audio clock, independently of React's playing flag. Never
 * suspend healthy background music or restart a player that the user paused. */
export function bindPlaybackRecovery(engine: SynchronizedAudioEngine, options: Options, page: Document = document, windowEvents: EventTarget = window, now: () => number = () => performance.now()) {
  let disposed = false, recovering = false, attempted = false;
  let observed: AudioContext | null = null;
  let clock = 0, checkedAt = now();
  const sample = () => { clock = observed?.currentTime ?? 0; checkedAt = now(); };
  const recover = (rebuild: boolean) => {
    if (recovering || disposed) return;
    if (attempted) {
      engine.resetGraph(); options.onFailure(); sample(); attempted = false;
      return;
    }
    attempted = true; recovering = true;
    void options.recover(rebuild).catch(() => {
      if (!disposed) options.onFailure();
    }).finally(() => { recovering = false; sample(); });
  };
  const check = () => {
    if (disposed) return;
    const context = engine.getContext();
    if (context !== observed) {
      observed?.removeEventListener("statechange", check);
      observed = context;
      observed?.addEventListener("statechange", check);
      sample();
    }
    if (recovering || options.isBusy()) { sample(); return; }
    if (!engine.isPlaying) { attempted = false; sample(); return; }
    if (page.visibilityState !== "visible" || !context) { sample(); return; }
    // Leave natural track completion to the queue controller.
    if (engine.getTimelineTime() >= engine.getMaxDuration() - .03) { sample(); return; }
    if (context.state !== "running") { recover(context.state === "closed"); return; }
    if (context.currentTime > clock + .01) { attempted = false; sample(); return; }
    if (now() - checkedAt >= PLAYBACK_STALL_MS) recover(true);
  };
  const wake = () => { sample(); check(); };
  page.addEventListener("visibilitychange", wake);
  windowEvents.addEventListener("pageshow", wake);
  const timer = setInterval(check, 250);
  check();
  return () => {
    disposed = true; clearInterval(timer);
    observed?.removeEventListener("statechange", check);
    page.removeEventListener("visibilitychange", wake);
    windowEvents.removeEventListener("pageshow", wake);
  };
}
