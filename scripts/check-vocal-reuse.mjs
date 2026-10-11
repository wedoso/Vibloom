/* global window */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
const argument = name => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
const modulePath = argument("--playwright-module") ?? "playwright";
const { chromium, webkit } = await import(path.isAbsolute(modulePath) ? pathToFileURL(modulePath).href : modulePath);
// Run smoke-vocal-reuse.mjs first to bundle the same production analysis harness.
const root = process.cwd(), output = path.join(root, "outputs/vocal-worker-perf"), base = path.join(output, "build");
const seconds = Number(argument("--seconds") ?? 4);
assert.ok(Number.isInteger(seconds) && seconds >= 4 && seconds <= 24);
const modelDirectory = path.resolve(argument("--model-dir") ?? ".cache/spleeter");
const mime = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm" };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://test").pathname);
    if (pathname.startsWith("/models/")) { response.setHeader("Content-Type", "application/octet-stream"); createReadStream(path.join(modelDirectory, path.basename(pathname))).pipe(response); return; }
    const file = pathname === "/voice.wav" ? path.join(root, "tests/fixtures/vocal-speech.wav")
      : pathname === "/" ? path.join(base, "outputs/vocal-worker-perf/index.html") : path.resolve(base, `.${pathname}`);
    if (pathname !== "/voice.wav") assert.ok(file.startsWith(`${base}${path.sep}`));
    response.setHeader("Content-Type", mime[path.extname(file)] ?? "application/octet-stream");
    response.end(await readFile(file));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
await mkdir(output, { recursive: true });
try {
  for (const [engine, type] of Object.entries({ chromium, webkit })) {
    const browser = await type.launch({ headless: true });
    try {
      const page = await browser.newPage(), errors = [];
      page.on("pageerror", error => errors.push(error.message));
      page.on("console", message => { if (message.type() === "log" && message.text().startsWith('{"variant"')) console.log(engine, message.text()); });
      await page.goto(`http://127.0.0.1:${server.address().port}/?seconds=${seconds}`);
      await page.waitForFunction(() => window.__reuseResults?.done || window.__reuseResults?.error, {}, { timeout: 180000 });
      const result = await page.evaluate(() => window.__reuseResults);
      result.engine = engine; result.errors = errors;
      await writeFile(path.join(output, `${engine}.json`), `${JSON.stringify(result, null, 2)}\n`);
      assert.equal(result.error, undefined);
      assert.deepEqual(errors, []);
      assert.equal(result.rounds.length, 6);
      for (const round of result.rounds) {
        assert.equal(round.frames, seconds * 50); assert.equal(round.vowels, seconds * 250);
        assert.equal(round.rmsMaxAbsDiff, 0); assert.equal(round.vowelDiffCount, 0);
      }
      assert.ok(result.rounds.every(round => round.activeWorkers === 0));
      assert.ok(result.rounds.every(round => round.measures.some(measure => measure.type === "init")));
      assert.equal(result.afterJobsWorkers, 0);
      console.log(`PASS ${engine} real desktop/mobile parity, cached weights and immediate worker release`);
    } finally { await browser.close(); }
  }
} finally { await new Promise(resolve => server.close(resolve)); }
