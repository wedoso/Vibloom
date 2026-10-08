/** Terminate the worker on success, cancellation or failure. Only copied PCM
 * crosses the worker boundary; the audible AudioBuffer is never transferred. */
export async function measureLoudness(buffer: AudioBuffer, signal: AbortSignal, target?: number): Promise<number> {
  signal.throwIfAborted();
  const worker = new Worker(new URL("./loudness.worker.ts", import.meta.url), { type: "module" });
  try {
    const channels = Array.from({length:buffer.numberOfChannels},(_,c)=>buffer.getChannelData(c).slice());
    return await new Promise<number>((resolve,reject) => {
      const cleanup = () => signal.removeEventListener("abort",abort);
      const abort = () => { cleanup(); reject(signal.reason ?? new DOMException("Cancelled","AbortError")); };
      signal.addEventListener("abort",abort,{once:true});
      worker.onerror = event => { cleanup(); reject(new Error(event.message)); };
      worker.onmessage = (event: MessageEvent<{error?:string;lufs:number;channels?:Float32Array[]}>) => {
        cleanup(); if(event.data.error) { reject(new Error(event.data.error)); return; }
        if(event.data.channels) event.data.channels.forEach((data,c)=>buffer.copyToChannel(data as Float32Array<ArrayBuffer>,c));
        resolve(event.data.lufs);
      };
      worker.postMessage({ channels,rate:buffer.sampleRate,target },channels.map(c=>c.buffer));
    });
  } finally { worker.onmessage = null; worker.onerror = null; worker.terminate(); }
}
