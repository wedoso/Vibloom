type ModelSource = { url: string; blob: Blob; release: () => void };
type SyncFile = { write: (bytes: Uint8Array, options: { at: number }) => number; truncate: (size: number) => void; flush: () => void; close: () => void };
type WorkerFile = FileSystemFileHandle & { createSyncAccessHandle?: () => Promise<SyncFile> };

/** A disk-backed URL lets ORT release the fetched model bytes before creating
 * its session. Passing an ArrayBuffer keeps another full model alive through
 * graph initialization, in addition to the copy in the WASM heap. */
export async function mobileModelSource(url: string, size: number, progress: (value: number) => void): Promise<ModelSource> {
  let file: WorkerFile | undefined;
  let cache: Cache | undefined;
  let sync: SyncFile | undefined;
  let writable: FileSystemWritableFileStream | undefined;
  try {
    const directory = await navigator.storage.getDirectory();
    const models = await directory.getDirectoryHandle("vibloom-vocal-models", { create: true });
    // The pinned revision is part of the key, so future weights cannot reuse it.
    const name = `${url.split("/").at(-2)}-${url.split("/").at(-1)}`;
    file = await models.getFileHandle(name, { create: true });
    const existing = await file.getFile();
    if (existing.size === size) return objectSource(existing);
    if (file.createSyncAccessHandle) sync = await file.createSyncAccessHandle();
    else writable = await file.createWritable();
    if (sync) sync.truncate(0);
  } catch {
    try { sync?.close(); } catch { /* Storage is optional. */ }
    sync = undefined; writable = undefined; file = undefined;
  }
  try { cache = await caches.open("vibloom-demucs-v1"); } catch { /* Private storage can be unavailable. */ }
  try {
    let cached: Response | undefined;
    try { cached = await cache?.match(url); } catch { cache = undefined; }
    const response = cached ?? await fetch(url, { credentials: "omit" });
    if (!response.ok || !response.body) throw new Error("Could not load the vocal model. Check your connection and retry.");
    const reader = response.body.getReader();
    let length = 0, lastProgress = -1;
    const next = async () => {
      const result = await reader.read();
      if (!result.done) {
        length += result.value.byteLength;
        if (length > size) throw new Error("The vocal model has an unexpected size. Please retry.");
        const fraction = length / size;
        if (!cached && fraction - lastProgress >= .01) { lastProgress = fraction; progress(fraction); }
      } else if (length !== size) throw new Error("The vocal model is incomplete. Please retry.");
      return result;
    };
    try {
      if (file && (sync || writable)) {
        while (true) {
          const { value, done } = await next();
          if (done) break;
          if (sync) {
            const written = sync.write(value, { at: length - value.byteLength });
            if (written !== value.byteLength) throw new Error("Could not save the vocal model. Free some storage and retry.");
          } else await writable!.write(value as Uint8Array<ArrayBuffer>);
        }
        if (sync) { sync.flush(); sync.close(); sync = undefined; }
        else { await writable!.close(); writable = undefined; }
        return objectSource(await file.getFile());
      }
      // If OPFS is unavailable, stream into the browser's Blob implementation;
      // do not retain JS download chunks or concatenate another model buffer.
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try { const { value, done } = await next(); if (done) controller.close(); else controller.enqueue(value); }
          catch (error) { controller.error(error); }
        },
        cancel: reason => reader.cancel(reason),
      });
      const blob = await new Response(stream).blob();
      if (!cached) { try { await cache?.put(url, new Response(blob)); } catch { /* Analysis can continue without a cache. */ } }
      return objectSource(blob);
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  } finally {
    // Incomplete files are never accepted on retry. Close handles also on a
    // network/storage error; terminating the worker releases them on cancel.
    if (sync) { try { sync.truncate(0); } finally { sync.close(); } }
    if (writable) await writable.abort().catch(() => undefined);
  }
}

export function objectSource(blob: Blob): ModelSource {
  const url = URL.createObjectURL(blob);
  return { url, blob, release: () => URL.revokeObjectURL(url) };
}
