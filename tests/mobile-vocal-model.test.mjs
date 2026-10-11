import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "./load-ts.mjs";
const { mobileModelSource, objectSource } = await loadTs("../src/audio/vocals/mobileModel.ts");
const url = "https://example.test/revision/model.onnx";

test("mobile streams weights to disk, reuses complete files and invalidates interrupted writes", async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator"), originalCaches = globalThis.caches, originalFetch = globalThis.fetch;
  let disk = new Uint8Array(), open = false, downloads = 0, incomplete = false, writes = [], saved;
  const file = {
    async getFile() { assert.equal(open, false); return new Blob([disk]); },
    async createSyncAccessHandle() {
      assert.equal(open, false); open = true;
      return {
        truncate(size) { disk = disk.slice(0, size); },
        write(chunk, { at }) { assert.ok(open); assert.ok(chunk.length <= 2); const bytes = new Uint8Array(at + chunk.length); bytes.set(disk); bytes.set(chunk, at); disk = bytes; writes.push(chunk.length); return chunk.length; },
        flush() {}, close() { assert.ok(open); open = false; },
      };
    },
  };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { storage: { async getDirectory() { return { async getDirectoryHandle() { return { async getFileHandle() { return file; } }; } }; } } } });
  globalThis.caches = { async open() { return { async match() { return saved; } }; } };
  globalThis.fetch = async () => {
    downloads++;
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2])); if (!incomplete) { controller.enqueue(new Uint8Array([3, 4])); controller.enqueue(new Uint8Array([5, 6])); } controller.close(); } }));
  };
  try {
    const progress = [], source = await mobileModelSource(url, 6, value => progress.push(value));
    assert.deepEqual(writes, [2, 2, 2]); assert.deepEqual(progress, [1 / 3, 2 / 3, 1]);
    assert.equal(open, false); assert.equal(downloads, 1);
    const nativeFetch = originalFetch;
    assert.deepEqual(new Uint8Array(await (await nativeFetch(source.url)).arrayBuffer()), new Uint8Array([1, 2, 3, 4, 5, 6]));
    source.release(); await assert.rejects(nativeFetch(source.url));
    const cached = await mobileModelSource(url, 6, () => assert.fail("complete disk models need no download"));
    assert.equal(downloads, 1); cached.release();
    disk = new Uint8Array([9]); incomplete = true;
    await assert.rejects(mobileModelSource(url, 6, () => {}), /incomplete/);
    assert.equal(open, false); assert.equal(disk.length, 0, "failed writes cannot leave a valid-sized file");
    incomplete = false;
    const retry = await mobileModelSource(url, 6, () => {}); assert.equal(downloads, 3); retry.release();
    disk = new Uint8Array(); writes = [];
    saved = new Response(new ReadableStream({ start(controller) { for (const chunk of [[1, 2], [3, 4], [5, 6]]) controller.enqueue(new Uint8Array(chunk)); controller.close(); } }));
    const migrated = await mobileModelSource(url, 6, () => assert.fail("migration must not report a network download"));
    assert.equal(downloads, 3); assert.deepEqual(writes, [2, 2, 2]); migrated.release();
    disk = new Uint8Array();
    globalThis.caches = { async open() { return { async match() { throw new Error("cache read denied"); } }; } };
    const deniedCache = await mobileModelSource(url, 6, () => {});
    assert.equal(downloads, 4, "a failed optional cache read cannot block inference"); deniedCache.release();
  } finally {
    Object.defineProperty(globalThis, "navigator", originalNavigator); globalThis.caches = originalCaches; globalThis.fetch = originalFetch;
  }
});

test("mobile model loading falls back when private storage is unavailable and rejects truncated models", async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator"), originalCaches = globalThis.caches, originalFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { storage: { async getDirectory() { throw new Error("private storage unavailable"); } } } });
  globalThis.caches = { async open() { throw new Error("cache unavailable"); } };
  globalThis.fetch = async () => new Response(new Uint8Array([1, 2, 3]));
  try {
    const source = await mobileModelSource(url, 3, () => {});
    assert.deepEqual(new Uint8Array(await (await originalFetch(source.url)).arrayBuffer()), new Uint8Array([1, 2, 3])); source.release();
    const reuse = objectSource(structuredClone(source.blob));
    globalThis.fetch = () => assert.fail("worker rotation must reuse the model Blob even without disk/cache storage");
    assert.deepEqual(new Uint8Array(await (await originalFetch(reuse.url)).arrayBuffer()), new Uint8Array([1, 2, 3]));
    reuse.release();
    globalThis.fetch = async () => new Response(new Uint8Array([1, 2, 3]));
    await assert.rejects(mobileModelSource(url, 4, () => {}), /incomplete/);
    await assert.rejects(mobileModelSource(url, 2, () => {}), /unexpected size/);
  } finally {
    Object.defineProperty(globalThis, "navigator", originalNavigator); globalThis.caches = originalCaches; globalThis.fetch = originalFetch;
  }
});
