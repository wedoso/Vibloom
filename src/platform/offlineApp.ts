export type OfflineState = { phase: "unavailable" | "preparing" | "ready" | "error"; online: boolean; update: boolean };
let state: OfflineState = { phase: "unavailable", online: typeof navigator === "undefined" || navigator.onLine, update: false };
const listeners = new Set<() => void>();
let registration: ServiceWorkerRegistration | undefined, starting: Promise<void> | undefined;
let reloadRequested = false, bound = false;
const publish = (patch: Partial<OfflineState>) => { state = { ...state, ...patch }; for (const notify of listeners) notify(); };
export const subscribeOffline = (notify: () => void) => { listeners.add(notify); return () => { listeners.delete(notify); }; };
export const readOffline = () => state;
async function checkReady(worker: ServiceWorker) {
  const ready = await new Promise<boolean>(resolve => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); resolve(false); }, 10000);
    channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data?.ready === true); };
    worker.postMessage({ type: "OFFLINE_STATUS" }, [channel.port2]);
  });
  publish({ phase: ready ? "ready" : "error", update: !!registration?.waiting });
}
export function startOfflineApp() {
  if (starting) return starting;
  if (import.meta.env.DEV || !/^https?:$/u.test(location.protocol) || !navigator.serviceWorker || !window.isSecureContext || /Electron\//u.test(navigator.userAgent)) return Promise.resolve();
  if (!bound) {
    bound = true;
    window.addEventListener("online", () => publish({ online: true }));
    window.addEventListener("offline", () => publish({ online: false }));
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloadRequested) { location.reload(); return; }
      if (navigator.serviceWorker.controller) void checkReady(navigator.serviceWorker.controller);
    });
  }
  publish({ phase: "preparing", online: navigator.onLine });
  starting = (async () => {
    try {
      const root = new URL(import.meta.env.BASE_URL, document.baseURI);
      // A cold offline launch must not depend on fetching sw.js again. Inspect
      // the already-installed worker before attempting registration/update.
      const installed = await navigator.serviceWorker.getRegistration(root.href);
      if (installed?.active) {
        registration = installed; await checkReady(installed.active);
        if (!navigator.onLine) return;
      }
      registration = await navigator.serviceWorker.register(new URL("sw.js", root), { scope: root.href, updateViaCache: "none" });
      const observe = () => {
        const worker = registration?.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state === "activated") void checkReady(worker);
          if (worker.state === "installed" && registration?.waiting) publish({ update: true });
          if (worker.state === "redundant" && !registration?.active) publish({ phase: "error" });
        });
      };
      registration.addEventListener("updatefound", observe); observe();
      if (registration.active) await checkReady(registration.active);
      if (registration.waiting) publish({ update: true });
    } catch { if (state.phase !== "ready") publish({ phase: "error" }); }
    finally { starting = undefined; }
  })();
  return starting;
}
export function applyOfflineUpdate() {
  if (!registration?.waiting) return;
  reloadRequested = true; registration.waiting.postMessage({ type: "ACTIVATE_UPDATE" });
}
export async function retryOfflineApp() {
  // A deleted/evicted cache requires a fresh install of the same worker.
  if (state.phase === "error" && registration) { await registration.unregister(); registration = undefined; }
  return startOfflineApp();
}
