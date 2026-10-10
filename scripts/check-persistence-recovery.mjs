/* global window, document, indexedDB, IDBObjectStore, FileSystemWritableFileStream, navigator, HTMLInputElement */
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i+1]; };
const modulePath = arg('--playwright-module') ?? 'playwright';
const { chromium, webkit } = await import(path.isAbsolute(modulePath) ? pathToFileURL(modulePath).href : modulePath);
const origin = arg('--url') ?? 'http://127.0.0.1:5190/';
const results = [];
for (const [engine, type] of Object.entries({ chromium, webkit })) {
  const browser = await type.launch({ headless: true });
  try {
    const context = await browser.newContext(), a = await context.newPage(), b = await context.newPage();
    const errors = []; a.on('pageerror', error => errors.push(error.message)); b.on('pageerror', error => errors.push(error.message));
    for (const [file, exported, name] of [
      ['/src/platform/browserLibraryPlatform.ts', 'browserLibraryPlatform', 'vibloom-library'],
      ['/src/mobile/platform.ts', 'mobilePlatform', 'vibloom-mobile-library'],
    ]) {
      for (const page of [a, b]) {
        await page.goto(new URL('/vibloom-icon.png', origin).href);
        await page.evaluate(async ({ file, exported, name }) => {
          window.__p = (await import(file))[exported]; window.__name = name;
          window.__read = async () => {
            const request = indexedDB.open(name), db = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
            try { return await new Promise((resolve, reject) => { const tx = db.transaction('state'), store = tx.objectStore('state'), library = store.get('library'), session = store.get('session'), keys = store.getAllKeys(); tx.oncomplete = () => resolve({ library: library.result, session: session.result, curves: keys.result.filter(key => String(key).startsWith('vocal:')) }); tx.onabort = () => reject(tx.error); }); }
            finally { db.close(); }
          };
          window.__seed = async () => {
            const request = indexedDB.open(name), db = await new Promise(resolve => { request.onsuccess = () => resolve(request.result); });
            try { await new Promise((resolve, reject) => { const tx = db.transaction('state', 'readwrite'), store = tx.objectStore('state'); store.clear(); store.put({ version: 3, tracks: [{ id: 'song', fingerprint: 'file', name: 'Legacy', duration: .04, vocalAnalysis: { version: 4, rms: [.1, .2], vowels: [0, 0, 255, 0, 0, 0, 255, 0, 0, 0] } }], albums: [], session: { queue: ['song'], history: [], currentTrackId: 'song', currentTime: 0, volume: .4, cacheEnabled: true, companionId: 'hong-xi', repeat: 'off', shuffle: false } }, 'library'); tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); }); }
            finally { db.close(); }
          };
        }, { file, exported, name });
      }
      await a.evaluate(async () => { await window.__p.repository.reset(); await window.__seed(); window.__snapshot = await window.__p.repository.load(); });
      await b.evaluate(async () => { window.__snapshot = await window.__p.repository.load(); });
      const noOp = await a.evaluate(async () => {
        const keys = [], put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function(value, key) { keys.push(key); return put.call(this, value, key); };
        try { await window.__p.repository.save({ ...window.__snapshot, tracks: structuredClone(window.__snapshot.tracks), session: { ...window.__snapshot.session, currentTime: 2 } }); }
        finally { IDBObjectStore.prototype.put = put; }
        return keys;
      });
      assert.deepEqual(noOp, ['session']);
      await b.evaluate(async () => { await window.__p.repository.saveSession(window.__snapshot.session); });
      await a.evaluate(async () => { window.__snapshot.tracks[0].name = 'Winner'; await window.__p.repository.save(window.__snapshot); });
      const stale = await b.evaluate(async () => {
        const failures = [];
        for (const save of [() => window.__p.repository.save(window.__snapshot), () => window.__p.repository.saveSession({ ...window.__snapshot.session, currentTime: 99 })]) {
          try { await save(); failures.push('unexpected success'); } catch (error) { failures.push(error.name); }
        }
        const saved = await window.__read(); return { failures, name: saved.library.tracks[0].name, time: saved.session.currentTime };
      });
      assert.deepEqual(stale, { failures: ['LibraryConflictError', 'LibraryConflictError'], name: 'Winner', time: 0 });
      await b.evaluate(async () => { await window.__p.repository.reset(); });
      const reset = await a.evaluate(async () => {
        const failures = [];
        for (const save of [() => window.__p.repository.save(window.__snapshot), () => window.__p.repository.saveSession(window.__snapshot.session)]) {
          try { await save(); failures.push('unexpected success'); } catch (error) { failures.push(error.name); }
        }
        const saved = await window.__read(), empty = await window.__p.repository.load();
        await window.__p.repository.save({ ...window.__snapshot, tracks: [] });
        return { failures, absent: !saved.library && !saved.session && saved.curves.length === 0, empty, recovered: (await window.__read()).library.tracks.length };
      });
      assert.deepEqual(reset, { failures: ['LibraryConflictError', 'LibraryConflictError'], absent: true, empty: null, recovered: 0 });

      // A synchronous failure midway through commit must abort earlier puts.
      const quota = await a.evaluate(async () => {
        const before = await window.__read(), put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function(value, key) { if (this.name === 'state' && key === 'session') throw new DOMException('Injected full storage', 'QuotaExceededError'); return put.call(this, value, key); };
        let failure;
        try { await window.__p.repository.save({ ...before.library, tracks: [{ id: 'new', vocalAnalysis: { version: 4, rms: [.1], vowels: [0, 0, 255, 0, 0] } }] }); }
        catch (error) { failure = error.name; }
        finally { IDBObjectStore.prototype.put = put; }
        const after = await window.__read();
        await window.__p.repository.save({ ...before.library, tracks: [{ id: 'retry' }] });
        return { failure, unchanged: JSON.stringify(before) === JSON.stringify(after), retried: (await window.__read()).library.tracks[0].id };
      });
      assert.deepEqual(quota, { failure: 'QuotaExceededError', unchanged: true, retried: 'retry' });

      const interruption = await a.evaluate(async () => {
        const before = await window.__read(), put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function(value, key) { const request = put.call(this, value, key); if (this.name === 'state' && key === 'library') request.onsuccess = () => request.transaction.abort(); return request; };
        let rejected = false;
        try { await window.__p.repository.save({ ...before.library, tracks: [{ id: 'aborted', vocalAnalysis: { version: 4, rms: [.1], vowels: [0, 0, 255, 0, 0] } }] }); }
        catch { rejected = true; }
        finally { IDBObjectStore.prototype.put = put; }
        return { rejected, unchanged: JSON.stringify(before) === JSON.stringify(await window.__read()) };
      });
      assert.deepEqual(interruption, { rejected: true, unchanged: true });

      // Pause A after its own curve write; B migrates and edits the same legacy
      // snapshot. A's late migration must neither overwrite B nor delete B's key.
      await a.evaluate(async () => {
        await window.__seed();
        const store = window.__p.vocalAnalyses, put = store.put.bind(store); window.__originalPut = put;
        store.put = async input => { const result = await put(input); window.__pendingKey = result.cacheKey; await new Promise(resolve => { window.__release = resolve; }); return result; };
        window.__migration = window.__p.repository.load();
      });
      await a.waitForFunction(() => !!window.__release);
      await b.evaluate(async () => { const snapshot = await window.__p.repository.load(); snapshot.tracks[0].name = 'Concurrent edit'; await window.__p.repository.save(snapshot); });
      const migration = await a.evaluate(async () => {
        window.__release(); const result = await window.__migration; window.__p.vocalAnalyses.put = window.__originalPut;
        const saved = await window.__read();
        return { name: saved.library.tracks[0].name, curves: saved.curves.length, ownRolledBack: !saved.curves.includes('vocal:' + window.__pendingKey), inlineRecovery: !!result.tracks[0].vocalAnalysis.rms };
      });
      assert.deepEqual(migration, { name: 'Concurrent edit', curves: 1, ownRolledBack: true, inlineRecovery: true });

      if (engine === 'chromium' && exported === 'browserLibraryPlatform') {
        const opfs = await a.evaluate(async () => {
          const files = window.__p.audioFiles, key = 'atomic-write-test'; await files.put(key, new Blob(['original audio']));
          const write = FileSystemWritableFileStream.prototype.write;
          FileSystemWritableFileStream.prototype.write = async function() { await write.call(this, new Blob(['partial'])); throw new DOMException('Injected full storage', 'QuotaExceededError'); };
          let failure;
          try { await files.put(key, new Blob(['replacement audio'])); } catch (error) { failure = error.name; }
          finally { FileSystemWritableFileStream.prototype.write = write; }
          return { failure, text: await (await files.get(key)).text() };
        });
        assert.deepEqual(opfs, { failure: 'QuotaExceededError', text: 'original audio' });
      }
      if (exported === 'mobilePlatform') {
        const fallback = await a.evaluate(async () => {
          const key = 'fallback-test', request = indexedDB.open(window.__name), db = await new Promise(resolve => { request.onsuccess = () => resolve(request.result); });
          await new Promise(resolve => { const tx = db.transaction('audio', 'readwrite'); tx.objectStore('audio').put({ bytes: new TextEncoder().encode('old audio').buffer, type: 'audio/wav' }, key); tx.oncomplete = resolve; }); db.close();
          const descriptor = Object.getOwnPropertyDescriptor(navigator.storage, 'getDirectory'), remove = IDBObjectStore.prototype.delete;
          const directory = { getFileHandle: async () => ({ createWritable: async () => ({ write: async () => {}, close: async () => {}, abort: async () => {} }) }), removeEntry: async () => {} };
          Object.defineProperty(navigator.storage, 'getDirectory', { configurable: true, value: async () => ({ getDirectoryHandle: async () => directory }) });
          IDBObjectStore.prototype.delete = function(value) { if (this.name === 'audio' && value === key) throw new DOMException('Injected delete failure', 'QuotaExceededError'); return remove.call(this, value); };
          try { await window.__p.audioFiles.put(key, new Blob(['new audio'], { type: 'audio/wav' })); return await (await window.__p.audioFiles.get(key)).text(); }
          finally { IDBObjectStore.prototype.delete = remove; if (descriptor) Object.defineProperty(navigator.storage, 'getDirectory', descriptor); else delete navigator.storage.getDirectory; }
        });
        assert.equal(fallback, 'new audio');
      }
      // The existing status area must show the conflict through the real
      // desktop/mobile autosave effects, rather than silently losing changes.
      await b.evaluate(async () => {
        const snapshot = await window.__p.repository.load();
        snapshot.tracks = snapshot.tracks.map(track => ({ ...track, relativePath: 'test.wav', sourceLabel: 'Test', size: 1, lastModified: 1, persistence: 'indexed', availability: 'reconnect', lyrics: [], lyricsFileName: '', comparison: null, comparisons: [] }));
        await window.__p.repository.save(snapshot);
      });
      await a.goto(new URL(exported === 'mobilePlatform' ? '/?ui=mobile' : '/?ui=desktop', origin).href);
      await a.waitForSelector('.live2d-stage[data-status="ready"]');
      await a.waitForTimeout(800);
      await b.evaluate(async () => { const snapshot = await window.__p.repository.load(); snapshot.tracks[0].name = 'Newer window edit'; await window.__p.repository.save(snapshot); });
      await a.evaluate(mobile => {
        const input = document.querySelector(mobile ? '[aria-label="Player volume"]' : '[aria-label="Volume"]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '.27');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, exported === 'mobilePlatform');
      await a.waitForFunction(() => document.body.innerText.includes('Your library changed in another window. Reload before saving more changes.'));
      assert.deepEqual(errors, []);
      results.push({ engine, database: name, stale, reset, quota, interruption, migration });
      console.log(`PASS ${engine} ${name}: two-window conflict/reset protection, atomic quota/interruption recovery, migration rollback, audio write recovery`);
    }
    await context.close();
  } finally { await browser.close(); }
}
await mkdir('outputs/persistence-recovery', { recursive: true });
await writeFile('outputs/persistence-recovery/report.json', JSON.stringify(results, null, 2));
