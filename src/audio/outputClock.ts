type OutputContext = {
  state: string; currentTime: number; baseLatency?: number; outputLatency?: number;
  getOutputTimestamp?: () => AudioTimestamp;
};
const latency = (value: number | undefined) => value !== undefined && Number.isFinite(value) && value > 0 ? value : 0;

/** Rendering can lead wireless speakers by seconds. Keep this presentation
 * clock separate from the render clock used to schedule and crossfade audio.
 * Browsers do not expose every receiver's buffering, so this is an estimate. */
export function audioOutputTime(context: OutputContext, now = performance.now()) {
  try {
    const stamp = context.getOutputTimestamp?.(), output = stamp?.contextTime, at = stamp?.performanceTime;
    if (output !== undefined && Number.isFinite(output) && output >= 0
      && at !== undefined && Number.isFinite(at) && at > 0 && at <= now) {
      const elapsed = context.state === "running" ? (now - at) / 1000 : 0;
      return Math.max(0, Math.min(context.currentTime, output + elapsed));
    }
  } catch { /* Some output routes do not support timestamps. */ }
  return Math.max(0, context.currentTime - latency(context.baseLatency) - latency(context.outputLatency));
}
