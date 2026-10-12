export const UPDATE_CHECK_INTERVAL = 6 * 60 * 60 * 1000;
const RETAIN_UPDATE = new Set(["downloading", "downloaded"]);

/** One check shared by automatic and manual requests. Pending downloads must
 * not be replaced by another check, and development builds never poll releases. */
export function createUpdateChecks({ enabled, check, status, onError, now = Date.now }) {
  let inFlight, lastAttempt = -Infinity, timer, active = false, notBefore = Infinity;
  const schedule = delay => {
    clearTimeout(timer);
    timer = setTimeout(() => { void request(true); }, delay);
    timer.unref?.();
  };
  const request = (automatic = false) => {
    if (!enabled || RETAIN_UPDATE.has(status())) return Promise.resolve();
    if (inFlight) return inFlight;
    if (automatic && (status() === "available" || now() < notBefore)) return Promise.resolve();
    if (automatic && now() - lastAttempt < UPDATE_CHECK_INTERVAL) {
      schedule(UPDATE_CHECK_INTERVAL - (now() - lastAttempt));
      return Promise.resolve();
    }
    lastAttempt = now();
    if (active) schedule(UPDATE_CHECK_INTERVAL);
    inFlight = Promise.resolve().then(check).catch(onError).finally(() => { inFlight = undefined; });
    return inFlight;
  };
  const stop = () => { clearTimeout(timer); timer = undefined; active = false; notBefore = Infinity; };
  const start = () => {
    stop();
    if (!enabled) return;
    active = true;
    notBefore = now() + 15_000;
    schedule(15_000);
  };
  return { request, start, stop };
}
