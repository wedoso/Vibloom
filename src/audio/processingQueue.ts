// Share one heavy offline job across remastering and vocal preparation. Waiting
// cancellations settle immediately; active workers are disposed by their owner.
let tail: Promise<unknown> = Promise.resolve();
const idleResources = new Map<symbol, () => void>();
/** A job may retain its own warm runtime; other heavy jobs release it before
 * allocating their PCM/scratch buffers. Cleanup never interrupts active work. */
export function registerAudioJobResource(releaseIdle: () => void) {
  const owner = Symbol("audio job resource");
  idleResources.set(owner, releaseIdle);
  return owner;
}
export function runAudioJob<T>(signal: AbortSignal, work: () => Promise<T>, resourceOwner?: symbol): Promise<T> {
  signal.throwIfAborted();
  const result = tail.then(() => {
    signal.throwIfAborted();
    for (const [owner, release] of idleResources) if (owner !== resourceOwner) release();
    return work();
  });
  tail = result.catch(() => undefined);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException("Cancelled", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    result.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
