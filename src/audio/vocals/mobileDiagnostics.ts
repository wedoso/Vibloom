export const MOBILE_VOCAL_DIAGNOSTICS_KEY = "vibloom-mobile-vocal-diagnostics-v1";
type Update = { phase: string; step?: string; runtime?: string };
type Record = Update & {
  model: string; id: string; startedAt: string; updatedAt: string; requestedBackend: string;
  status: "working" | "ready" | "error" | "cancelled";
  userAgent: string; secureContext: boolean; windowGpuApi: boolean; backend?: string; error?: string;
};

/** Keep only stage transitions, with no song/file/audio content. If WebKit
 * kills the page, the last persisted stage survives; an unfinished record is
 * evidence of an interruption, not proof of its cause. Storage is optional. */
export function createMobileVocalTrace(requestedBackend: string, storage?: Pick<Storage, "getItem" | "setItem">) {
  if (!storage) { try { storage = localStorage; } catch { /* Private storage may be unavailable. */ } }
  const startedAt = new Date().toISOString();
  let record: Record = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, startedAt, updatedAt: startedAt,
    model: "Spleeter 2-stems FP16", requestedBackend, status: "working", phase: "Queued for vocal analysis",
    userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
    secureContext: typeof isSecureContext !== "undefined" && isSecureContext,
    windowGpuApi: typeof navigator !== "undefined" && "gpu" in navigator,
  };
  const persist = () => {
    try {
      const previous: unknown = JSON.parse(storage?.getItem(MOBILE_VOCAL_DIAGNOSTICS_KEY) ?? "[]");
      const history = Array.isArray(previous) ? previous.filter(item => item && typeof item === "object" && item.id !== record.id).slice(-3) : [];
      storage?.setItem(MOBILE_VOCAL_DIAGNOSTICS_KEY, JSON.stringify([...history, record]));
    } catch { /* Diagnostics must never block analysis. */ }
  };
  persist();
  return {
    update(update: Update) {
      if (update.phase === record.phase && update.step === record.step && (!update.runtime || update.runtime === record.runtime)) return;
      const backend = update.phase.startsWith("Separating vocals · ") ? update.phase.slice("Separating vocals · ".length) : record.backend;
      record = { ...record, ...update, backend, runtime: update.runtime ?? record.runtime, step: update.step, updatedAt: new Date().toISOString() }; persist();
    },
    finish(error?: unknown, cancelled = false) {
      record = { ...record, status: cancelled ? "cancelled" : error ? "error" : "ready", updatedAt: new Date().toISOString(),
        error: error ? error instanceof Error ? error.message : String(error) : undefined }; persist();
    },
  };
}
