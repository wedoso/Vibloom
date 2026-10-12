/* global document, window, indexedDB, AudioBufferSourceNode, AudioContext */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { seedMobile, snapshot, waveBytes } from './mobile-ui-fixtures.mjs';

const arg = process.argv.indexOf('--playwright-module');
const modulePath = arg < 0 ? 'playwright' : process.argv[arg + 1];
const { chromium, webkit } = await import(path.isAbsolute(modulePath) ? pathToFileURL(modulePath).href : modulePath);
const root = path.resolve('dist'), output = path.resolve('outputs/mobile-album-order');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm' };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://local'), file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
    if (!file.startsWith(root + path.sep)) throw new Error('Invalid path');
    res.setHeader('Content-Type', types[path.extname(file)] ?? 'application/octet-stream'); res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
await mkdir(output, { recursive: true });
const origin = `http://127.0.0.1:${server.address().port}`;
const fixture = snapshot();
fixture.tracks = Array.from({ length: 24 }, (_, i) => ({ ...fixture.tracks[0], id: `song-${i}`, fingerprint: `song-${i}`, name: i === 0 ? 'Common first.wav' : i === 2 ? 'Common second.wav' : `Song ${i}.wav`, comparison: null, comparisons: [] }));
fixture.albums = [{ id: 'album', name: 'Touch sorting', trackIds: fixture.tracks.map(track => track.id) }];
fixture.session = { ...fixture.session, currentTrackId: 'song-0', queue: fixture.albums[0].trackIds, playbackAlbumId: 'album', currentTime: 0 };
const ready = page => page.waitForFunction(() => document.querySelector('.m-content')?.getAttribute('aria-busy') === 'false');
const openAlbum = async page => {
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: 'Albums', exact: true }).click();
  await page.locator('.m-album-open').first().click();
  await page.waitForSelector('.is-album-reorderable');
};
const ids = page => page.locator('.m-song-list [data-song-id]').evaluateAll(rows => rows.map(row => row.dataset.songId));
const stored = page => page.evaluate(async () => {
  const db = await new Promise((resolve, reject) => { const req = indexedDB.open('vibloom-mobile-library', 2); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
  const data = await new Promise(resolve => { const req = db.transaction('state').objectStore('state').get('library'); req.onsuccess = () => resolve(req.result); }); db.close();
  return data.albums[0].trackIds;
});
const saved = async (page, expected) => { for (let i = 0; i < 40; i++) { if (JSON.stringify(await stored(page)) === JSON.stringify(expected)) return; await page.waitForTimeout(50); } assert.deepEqual(await stored(page), expected); };
try {
  for (const [engine, type] of [['chromium', chromium], ['webkit', webkit]].filter(([engine]) => !process.argv.includes('--engine') || engine === process.argv[process.argv.indexOf('--engine') + 1])) {
    const browser = await type.launch({ headless: true });
    try {
      for (const viewport of [{ width: 390, height: 844 }, { width: 852, height: 393 }]) {
        const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
        const page = await context.newPage();
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(() => { window.__starts = 0; const start = AudioBufferSourceNode.prototype.start; AudioBufferSourceNode.prototype.start = function (...args) { if (this.context instanceof AudioContext) window.__starts++; return start.apply(this, args); }; });
        await page.goto(origin + '/?ui=mobile'); await ready(page); await seedMobile(page, fixture, waveBytes()); await page.reload(); await ready(page); await openAlbum(page);
        const cdp = engine === 'chromium' ? await context.newCDPSession(page) : null;
        let point;
        const touch = async (kind, p = point) => {
          if (cdp) await cdp.send('Input.dispatchTouchEvent', { type: kind, touchPoints: kind === 'touchEnd' || kind === 'touchCancel' ? [] : [{ x: p.x, y: p.y, id: 1 }] });
          else await page.evaluate(({ kind, point }) => {
            const target = kind === 'touchStart' ? window.__touchTarget = document.elementFromPoint(point.x, point.y) : window.__touchTarget;
            const touch = { identifier: 1, clientX: point.x, clientY: point.y, target };
            const event = new Event(kind.toLowerCase(), { bubbles: true, cancelable: true });
            Object.defineProperties(event, { touches: { value: kind === 'touchEnd' || kind === 'touchCancel' ? [] : [touch] }, changedTouches: { value: [touch] } });
            target.dispatchEvent(event);
          }, { kind, point: p });
        };
        const position = async id => { const box = await page.locator(`[data-song-id="${id}"] .m-song-main`).boundingBox(); return { x: box.x + box.width * .55, y: box.y + box.height / 2 }; };
        const scrollTop = () => page.evaluate(() => document.querySelector('.m-library-results').scrollTop + document.scrollingElement.scrollTop);
        // Real Chromium touch scrolling cancels the pending hold before it starts.
        point = await position('song-0'); const swipeScroll = await scrollTop(); await touch('touchStart'); await touch('touchMove', { ...point, y: point.y - 35 }); await page.waitForTimeout(40); await touch('touchMove', { ...point, y: point.y - 65 }); await page.waitForTimeout(60); await touch('touchEnd');
        if (cdp) assert.ok(await scrollTop() > swipeScroll + 5, 'ordinary swipe scrolls natively');
        await page.waitForTimeout(470); assert.equal(await page.locator('.m-song-drag-preview').count(), 0); assert.deepEqual(await ids(page), fixture.albums[0].trackIds);
        await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector('.m-library-results').scrollTop = 0; });
        // Move the first song after the second; no play click may follow the drop.
        point = await position('song-0'); const target = await position('song-1'); const starts = await page.evaluate(() => window.__starts);
        await touch('touchStart'); await page.waitForTimeout(490); assert.equal(await page.locator('.m-song-drag-preview').count(), 1);
        await touch('touchMove', { ...target, y: target.y + 15 }); await page.waitForTimeout(50); await touch('touchEnd');
        const expected = ['song-1', 'song-0', 'song-2', ...fixture.albums[0].trackIds.slice(3)]; assert.deepEqual(await ids(page), expected); await saved(page, expected);
        assert.equal(await page.evaluate(() => window.__starts), starts, 'drop never starts/restarts audio');
        // Cancellation clears previews and never persists an incomplete move.
        point = await position('song-1'); await touch('touchStart'); await page.waitForTimeout(490); await touch('touchMove', { ...point, y: point.y + 100 }); await touch('touchCancel');
        assert.deepEqual(await ids(page), expected); assert.equal(await page.locator('.m-song-drag-preview').count(), 0);
        // Dragging near the bottom scrolls the correct portrait/landscape pane.
        point = await position('song-1'); await touch('touchStart'); await page.waitForTimeout(490);
        const bottom = await page.locator('.m-playback-footer').evaluate(el => el.getBoundingClientRect().top);
        const beforeScroll = await scrollTop(); await touch('touchMove', { ...point, y: bottom - 12 }); await page.waitForTimeout(700);
        assert.ok(await scrollTop() > beforeScroll + 30, 'edge drag auto-scrolls'); await touch('touchCancel');
        await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector('.m-library-results').scrollTop = 0; });
        // Filtering only changes the moved song; hidden album members survive.
        await page.locator('.m-search input').fill('Common'); await page.waitForTimeout(80);
        point = await position('song-2'); const filteredTarget = await position('song-0'); await touch('touchStart'); await page.waitForTimeout(490); await touch('touchMove', { ...filteredTarget, y: filteredTarget.y - 15 }); await touch('touchEnd');
        const filteredOrder = ['song-1', 'song-2', 'song-0', ...fixture.albums[0].trackIds.slice(3)];
        await page.locator('.m-search input').fill(''); assert.deepEqual(await ids(page), filteredOrder); await saved(page, filteredOrder);
        await page.reload(); await ready(page); await openAlbum(page); assert.deepEqual(await ids(page), filteredOrder);
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(output, `${engine}-${viewport.width}.png`) });
        assert.deepEqual(errors, []); console.log(`PASS ${engine} ${viewport.width}x${viewport.height}: hold, scroll cancellation, drop without playback, cancellation, auto-scroll, filtered order and persistence${cdp ? ' (native touch)' : ' (synthetic touch events)'}`);
        await context.close();
      }
    } finally { await browser.close(); }
  }
} finally { await new Promise(resolve => server.close(resolve)); }
