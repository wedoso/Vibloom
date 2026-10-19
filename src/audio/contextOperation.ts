// Route changes (including AirPlay) can outlast a normal local-device resume.
// Keep the wait cancellable, but allow the output route time to become running.
export const AUDIO_RESUME_TIMEOUT_MS = 12000;

/** Native audio promises can remain pending after an iOS interruption. The
 * caller must be able to cancel its wait independently of that native promise. */
export function waitForAudioOperation(operation: () => Promise<void>, signals: AbortSignal[]) {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const signal of signals) signal.removeEventListener("abort", abort);
      if (error !== undefined) reject(error); else resolve();
    };
    const abort = () => finish(new DOMException("Playback cancelled", "AbortError"));
    const timer = setTimeout(() => finish(new DOMException("Audio could not resume. Press Play to retry.", "TimeoutError")), AUDIO_RESUME_TIMEOUT_MS);
    if (signals.some(signal => signal.aborted)) { abort(); return; }
    for (const signal of signals) signal.addEventListener("abort", abort, { once: true });
    // Invoke immediately, while the original Play/seek tap still has activation.
    try { operation().then(() => finish(), finish); } catch (error) { finish(error); }
  });
}

export async function resumeAudioContext(context: AudioContext, signals: AbortSignal[]) {
  let cleanup = () => {};
  try {
    await waitForAudioOperation(() => new Promise<void>((resolve, reject) => {
      const check = () => {
        if (context.state === "running") resolve();
        else if (context.state === "closed") reject(new Error("The audio connection closed."));
      };
      context.addEventListener("statechange", check);
      cleanup = () => context.removeEventListener("statechange", check);
      // Call in the original tap. A resolved resume promise alone does not
      // mean a route that is still 'interrupted' is ready to schedule music.
      void context.resume().then(check, reject);
      check();
    }), signals);
  } finally { cleanup(); }
}
