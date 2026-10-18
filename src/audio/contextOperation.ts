export const AUDIO_RESUME_TIMEOUT_MS = 4000;

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
