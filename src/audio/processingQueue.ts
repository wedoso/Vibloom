// Share one heavy offline job across remastering and vocal preparation. Waiting
// cancellations settle immediately; active workers are disposed by their owner.
let tail: Promise<unknown> = Promise.resolve();
export function runAudioJob<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  const result = tail.then(() => { signal.throwIfAborted(); return work(); });
  tail = result.catch(() => undefined);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException("Cancelled", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    result.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
