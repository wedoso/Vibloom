/* global indexedDB, IDBObjectStore, window, document, CSSStyleDeclaration, navigator */
import assert from "node:assert/strict";
import path from "node:path";
import { seedMobile, snapshot, waveBytes } from "./mobile-ui-fixtures.mjs";
import { pathToFileURL } from "node:url";
const packageArg = process.argv.indexOf("--playwright-module");
const modulePath = packageArg >= 0 ? process.argv[packageArg + 1] : "playwright";
const { chromium, webkit } = await import(path.isAbsolute(modulePath) ? pathToFileURL(modulePath).href : modulePath);
const urlArg = process.argv.indexOf("--url");
const origin = urlArg >= 0 ? process.argv[urlArg + 1] : "http://127.0.0.1:5190/";
for (const [engine, type] of Object.entries({ chromium, webkit })) {
  const browser = await type.launch({ headless: true });
  try {
    // The otherwise empty page lets storage run without the app's save effects.
    const page = await browser.newPage();
    await page.goto(new URL("/vibloom-icon.png", origin).href);
    for (const [file, exported, name, version] of [
      ["/src/platform/browserLibraryPlatform.ts", "browserLibraryPlatform", "vibloom-library", 1],
      ["/src/mobile/platform.ts", "mobilePlatform", "vibloom-mobile-library", 2],
    ]) {
      const result = await page.evaluate(async ({ file, exported, name, version }) => {
        const { repository } = (await import(file))[exported];
        const session = { queue: ["song"], history: [], currentTrackId: "song", currentTime: 2, shuffle: false, repeat: "off", volume: .4, cacheEnabled: true, companionId: "hong-xi" };
        const tracks = [{ id: "song", name: "Legacy song", vocalAnalysis: { version: 4, rms: Array(3000).fill(.1), vowels: Array(15000).fill(.2) } }];
        const legacy = { version: 3, tracks, albums: [], session };
        const r = indexedDB.open(name, version);
        r.onupgradeneeded = () => { for (const store of name.includes("mobile") ? ["state", "audio"] : ["state"]) if (!r.result.objectStoreNames.contains(store)) r.result.createObjectStore(store); };
        const db = await new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
        await new Promise(resolve => { const tx = db.transaction("state", "readwrite"); tx.objectStore("state").put(legacy, "library"); tx.oncomplete = resolve; }); db.close();
        const old = await repository.load();
        const writes = [], put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (value, key) { if (this.name === "state") writes.push(key); return put.call(this, value, key); };
        try { await repository.saveSession({ ...session, currentTime: 12.5, volume: .7 }); }
        finally { IDBObjectStore.prototype.put = put; }
        const resumed = await repository.load();
        const audio = await indexedDB.databases();
        await repository.save({ ...resumed, tracks: [...resumed.tracks, { id: "new", name: "Added song" }], session: { ...resumed.session, currentTime: 14 } });
        const updated = await repository.load();
        await repository.reset();
        const empty = await repository.load();
        return { legacy: old.session.currentTime, resumed: resumed.session, analysis: JSON.stringify(resumed.tracks) === JSON.stringify(tracks), writes, updated: { count: updated.tracks.length, position: updated.session.currentTime }, empty, database: audio.some(db => db.name === name) };
      }, { file, exported, name, version });
      assert.equal(result.legacy, 2);
      assert.equal(result.resumed.currentTime, 12.5);
      assert.equal(result.resumed.volume, .7);
      assert.ok(result.analysis);
      assert.deepEqual(result.writes, ["session"]);
      assert.deepEqual(result.updated, { count: 2, position: 14 });
      assert.equal(result.empty, null);
      assert.ok(result.database);
      console.log(`PASS ${engine} ${name}: legacy restore, session-only write, intact analysis, metadata save and reset`);
    }
    await page.goto(new URL("/?ui=mobile", origin).href);
    await page.waitForFunction(() => document.querySelector('.m-content')?.getAttribute('aria-busy') === 'false');
    await seedMobile(page, snapshot(), waveBytes());
    await page.reload();
    await page.waitForSelector('.live2d-stage[data-status="ready"]');
    await page.evaluate(() => {
      window.__stageWrites = 0;
      window.__stageCanvas = document.querySelector('canvas.live2d-canvas');
      const property = CSSStyleDeclaration.prototype.setProperty;
      CSSStyleDeclaration.prototype.setProperty = function (...args) {
        if (this === document.querySelector('.live2d-stage')?.style) window.__stageWrites++;
        return property.apply(this, args);
      };
    });
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Library', exact: true }).click();
    await page.waitForTimeout(700);
    await page.evaluate(() => { window.__stageWrites = 0; });
    await page.waitForTimeout(700);
    assert.equal(await page.evaluate(() => window.__stageWrites), 0, 'mobile Library pauses the hidden stage');
    assert.equal(await page.evaluate(() => navigator.mediaSession.playbackState), 'playing');
    await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Player', exact: true }).click();
    await page.waitForFunction(() => window.__stageWrites > 10);
    assert.ok(await page.evaluate(() => window.__stageCanvas === document.querySelector('canvas.live2d-canvas')));
    console.log(`PASS ${engine} mobile Library suspends its stage, keeps audio playing and resumes the same canvas`);
  } finally { await browser.close(); }
}
