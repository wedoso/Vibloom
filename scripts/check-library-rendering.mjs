/* global indexedDB, window, getComputedStyle, document */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { snapshot, seedMobile, waveBytes } from "./mobile-ui-fixtures.mjs";
const argument = name => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
const modulePath = argument("--playwright-module") ?? "playwright";
const { chromium, webkit } = await import(path.isAbsolute(modulePath) ? pathToFileURL(modulePath).href : modulePath);
const root = process.cwd(), base = path.join(root, "dist"), output = path.join(root, "outputs/library-rendering");
const mime = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm", ".png": "image/png", ".jpg": "image/jpeg" };
const server = createServer(async (req, res) => { try { const name = new URL(req.url, "http://test").pathname; const file = path.resolve(base, `.${name === "/" ? "/index.html" : decodeURIComponent(name)}`); assert.ok(file.startsWith(base + path.sep)); res.setHeader("Content-Type", mime[path.extname(file)] ?? "application/octet-stream"); res.end(await readFile(file)); } catch { res.writeHead(404); res.end(); } });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); await mkdir(output, { recursive: true });
const results = [];
try {
  for (const [engine, type] of Object.entries({ chromium, webkit })) {
    const browser = await type.launch({ headless: true });
    try {
      for (const mobile of [false, true]) {
        const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, hasTouch: mobile, isMobile: mobile });
        const errors = []; page.on("pageerror", error => errors.push(error.message));
        const url = `http://127.0.0.1:${server.address().port}/?ui=${mobile ? "mobile" : "desktop"}`;
        await page.goto(url); await page.waitForTimeout(500);
        const fixture = snapshot(); const template = fixture.tracks[4];
        fixture.tracks = Array.from({ length: 320 }, (_, i) => ({ ...template, id: "render-" + i, fingerprint: "render-" + i, name: `Render track ${String(i).padStart(4, "0")}.wav`, relativePath: "Test", lyrics: [], comparisons: [], comparison: null, duration: 1, availability: "reconnect", persistence: "indexed" }));
        fixture.albums = []; fixture.session.queue = []; fixture.session.currentTrackId = ""; fixture.session.playbackAlbumId = "";
        if (mobile) await seedMobile(page, fixture, waveBytes(1));
        else await page.evaluate(async fixture => {
          const request = indexedDB.open("vibloom-library", 1);
          const db = await new Promise((resolve, reject) => { request.onupgradeneeded = () => request.result.createObjectStore("state"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
          await new Promise((resolve, reject) => { const tx = db.transaction("state", "readwrite"); tx.objectStore("state").put(fixture, "library"); tx.objectStore("state").delete("session"); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); db.close();
        }, fixture);
        await page.reload();
        if (mobile) { await page.waitForFunction(() => document.querySelector(".m-content")?.getAttribute("aria-busy") === "false"); await page.getByRole("button", { name: "Open navigation", exact: true }).click(); await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Library", exact: true }).click(); }
        else await page.locator('button[title="Library"]').click();
        const rows = page.locator(mobile ? ".m-song-row" : ".track-row[data-track-id]");
        await rows.last().waitFor(); assert.equal(await rows.count(), 320); assert.equal(await page.locator(".library-render-group").count(), 10);
        assert.ok(await page.evaluate(() => window.find("Render track 0319")), "native find includes offscreen rows");
        const options = rows.last().getByRole("button", { name: `${mobile ? "Options" : "Actions"} for Render track 0319`, exact: true });
        await options.focus(); await page.waitForTimeout(100);
        assert.equal(await options.evaluate(button => getComputedStyle(button.closest(".library-render-group")).contentVisibility), "visible");
        const rect = await options.boundingBox(); assert.ok(rect.y >= 0 && rect.y < (mobile ? 844 : 1000), "keyboard focus scrolls the row into view");
        await options.click(); const close = page.getByRole("button", { name: "Close panel", exact: true });
        if (mobile) await close.click(); else await page.keyboard.press("Escape");
        const search = page.locator('input[type="search"]'); await search.fill("0319"); assert.equal(await rows.count(), 1); assert.equal(await page.locator(".library-render-group").count(), 0); await search.fill(""); assert.equal(await rows.count(), 320);
        if (mobile) {
          await page.setViewportSize({ width: 844, height: 390 }); await rows.last().getByRole("button", { name: "Options for Render track 0319", exact: true }).focus();
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1); assert.equal(overflow, false);
        }
        assert.deepEqual(errors, []); const result = { engine, mobile, tracks: 320, groups: 10, rowElements: await rows.evaluateAll(rows => rows.reduce((n, row) => n + row.querySelectorAll("*").length + 1, 0)), nativeFind: true, keyboardFocus: true, lastRowMenu: true, search: true, errors }; results.push(result); console.log("PASS", JSON.stringify(result)); await page.close();
      }
    } finally { await browser.close(); }
  }
  await writeFile(path.join(output, "report.json"), JSON.stringify(results, null, 2));
} finally { await new Promise(resolve => server.close(resolve)); }
