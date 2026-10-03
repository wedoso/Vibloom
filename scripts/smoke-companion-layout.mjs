import { app, BrowserWindow, net, protocol } from "electron";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const profile = await mkdtemp(path.join(tmpdir(), "vibloom-layout-"));
const output = path.join(root, "outputs/companion-layout");
const reportOnly = process.argv.includes("--report-only");
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
app.setPath("userData", profile);
app.on("window-all-closed", () => {});
protocol.registerSchemesAsPrivileged([{ scheme: "vibloom", privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true,
} }]);

// Measure actual CSS pixels, including hit targets and text that can reflow.
const selectors = [
  ".library-header", ".brand", ".brand-home", ".brand-mark", ".brand-copy", ".brand-copy strong", ".brand-version",
  ".library-header-actions", ".companion-selector", ".privacy-chip", ".library-welcome", ".library-welcome-copy",
  ".library-welcome-copy h1", ".library-welcome-copy > p", ".welcome-import-surface", ".library-stage",
  ".unified-shell", ".workspace-rail", ".workspace-surface", ".player-console", ".console-heading", ".console-heading h1",
  ".engine-status", ".comparison-deck", ".waveform-card", ".precision-waveform", ".solo-track-context", ".console-lower",
  ".library-lyrics", ".persistent-stage-panel", ".now-listening-heading", ".persistent-stage-canvas", ".live2d-host",
  ".stage-source-indicator", ".camera-capsule", ".camera-hint", ".vocal-lip-sync", ".focus-exit-control",
  ".library-list-heading", ".library-list-heading h1", ".library-list-toolbar", ".track-table", ".track-row",
  ".library-transport", ".transport-track", ".transport-center", ".transport-buttons", ".transport-progress", ".transport-secondary",
  ".side-sheet", ".side-sheet h2", ".queue-list", ".storage-actions", ".import-summary", ".import-summary h2",
  ".confirm-dialog", ".confirm-dialog h2", ".update-backdrop", ".update-dialog", ".update-dialog h2",
  "button", "button :is(svg, span, strong, small)", ".transport-disc svg", "select", "input:not([type=file])",
];
let window;
async function smoke() {
  const timer = setTimeout(() => { console.error("Layout audit timed out"); app.exit(1); }, 240000);
  const comparisons = [];
  try {
    await app.whenReady();
    await mkdir(output, { recursive: true });
    protocol.handle("vibloom", request => {
      const file = path.resolve(root, "dist", `.${new URL(request.url).pathname}`);
      if (!file.startsWith(`${path.join(root, "dist")}${path.sep}`)) return new Response("Not found", { status: 404 });
      return net.fetch(pathToFileURL(file).href);
    });
    window = new BrowserWindow({ width: 1440, height: 1000, useContentSize: true, show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    window.webContents.setAudioMuted(true);
    window.webContents.on("console-message", event => {
      if (event.level === "error" || event.level === 3) console.error(event.message);
    });
    const run = code => window.webContents.executeJavaScript(code, true);
    const waitFor = async (condition, label) => {
      for (let i = 0; i < 160; i++) {
        if (await run(condition)) return;
        await delay(100);
      }
      throw new Error(`Timed out: ${label}`);
    };
    const click = selector => run(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const settled = async id => {
      await waitFor(`document.querySelector('.live2d-stage[data-companion="${id}"][data-status="ready"]')
        && !document.documentElement.classList.contains('is-scene-transitioning')
        && getComputedStyle(document.querySelector('.live2d-host')).opacity === '1'`, `${id} settled`);
      await delay(350);
    };
    const select = async id => {
      await run(`(() => { const select = document.querySelector('[aria-label="Music companion"]');
        select.value = ${JSON.stringify(id)}; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    };
    const snapshot = () => run(`(() => {
      const bounds = {};
      for (const selector of ${JSON.stringify(selectors)}) {
        [...document.querySelectorAll(selector)].forEach((element, index) => {
          const r = element.getBoundingClientRect(), style = getComputedStyle(element);
          if (!r.width || !r.height || style.visibility === 'hidden' || style.display === 'none') return;
          // Closed sheets remain mounted for their exit animation.
          if (element.closest('.side-sheet-backdrop') && !element.closest('.side-sheet-backdrop').classList.contains('is-open')) return;
          bounds[selector + ':' + index] = { x: r.x, y: r.y, width: r.width, height: r.height };
        });
      }
      return { bounds, viewport: [innerWidth, innerHeight], overflow: document.documentElement.scrollWidth - innerWidth,
        position: document.querySelector('[aria-label="Playback position"]')?.value,
        camera: [...document.querySelectorAll('.camera-capsule button.is-active')].map(button => button.getAttribute('aria-label') || button.title) };
    })()`);
    const difference = (before, after) => {
      const changes = [];
      for (const key of new Set([...Object.keys(before.bounds), ...Object.keys(after.bounds)])) {
        const a = before.bounds[key], b = after.bounds[key];
        if (!a || !b) { changes.push({ element: key, missing: !a ? "before" : "after" }); continue; }
        const delta = Object.fromEntries(Object.keys(a).map(axis => [axis, +(b[axis] - a[axis]).toFixed(3)]).filter(([, value]) => Math.abs(value) > .5));
        if (Object.keys(delta).length) changes.push({ element: key, delta });
      }
      return changes;
    };
    const compare = async label => {
      await select("hong-xi"); await settled("hong-xi");
      const before = await snapshot();
      await writeFile(path.join(output, `${label}-hong-xi.png`), (await window.webContents.capturePage()).toPNG());
      await select("hiyori");
      const during = await snapshot();
      await settled("hiyori");
      const after = await snapshot();
      await writeFile(path.join(output, `${label}-hiyori.png`), (await window.webContents.capturePage()).toPNG());
      // Check the reverse direction as well, including the fade-out interval.
      await select("hong-xi"); const returning = await snapshot(); await settled("hong-xi");
      const restored = await snapshot();
      const result = { label, before, after, changes: difference(before, after),
        switchingChanges: difference(before, during), returningChanges: difference(before, returning), restoredChanges: difference(before, restored) };
      comparisons.push(result);
      console.log(`${label}: ${result.changes.length} settled / ${result.switchingChanges.length} switching / ${result.returningChanges.length} returning / ${result.restoredChanges.length} restored differences`);
      for (const change of result.changes.slice(0, 6)) console.log(JSON.stringify(change));
    };
    const resize = async (width, height) => { window.setContentSize(width, height); await delay(450); };
    const sizes = [[1440, 1000], [1024, 768], [390, 844]];
    await window.loadURL("vibloom://app/index.html");
    await settled("hong-xi");
    // Keep the update overlay deterministic and independent of GitHub releases.
    await run(`(() => {
      const originalFetch = window.fetch;
      window.fetch = (input, ...args) => String(input).includes('api.github.com/repos/wedoso/Vibloom/releases/latest')
        ? Promise.resolve(new Response(JSON.stringify({ tag_name: document.querySelector('.brand-version').textContent.trim() }), { status: 200 }))
        : originalFetch(input, ...args);
    })()`);
    for (const [width, height] of sizes) { await resize(width, height); await compare(`welcome-${width}`); }
    await resize(1440, 1000);
    await run(`(() => {
      window.__layoutWav = name => {
        const rate = 8000, samples = rate * 30, bytes = new ArrayBuffer(44 + samples * 2), view = new DataView(bytes);
        const text = (offset, value) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
        text(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
        view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
        view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
        text(36, 'data'); view.setUint32(40, samples * 2, true);
        return new File([bytes], name, { type: 'audio/wav', lastModified: 1 });
      };
      const transfer = new DataTransfer(); transfer.items.add(window.__layoutWav('Layout test.wav')); transfer.items.add(window.__layoutWav('Queue test.wav'));
      transfer.items.add(new File(['[00:00.00]Same room, same controls\\n[00:05.00]Together with the music'], 'Layout test.lrc', { type: 'text/plain' }));
      const input = document.querySelector('input[type=file][multiple]'); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await waitFor(`document.querySelector('#import-title')?.textContent === 'Import complete'`, "import complete");
    await compare("import-1440");
    await click('[aria-label="Close import summary"]'); await settled("hong-xi");
    await waitFor(`document.querySelector('.transport-play') && !document.querySelector('.transport-play').disabled`, "transport ready");
    if (await run(`Boolean(document.querySelector('[aria-label="Pause"]'))`)) await click('[aria-label="Pause"]');
    for (const [width, height] of sizes) { await resize(width, height); await compare(`player-solo-${width}`); }
    await resize(1440, 1000);
    await run(`(() => { const transfer = new DataTransfer(); transfer.items.add(window.__layoutWav('Mix B.wav'));
      const input = document.querySelector('input[type=file]:not([multiple]):not([accept^=".lrc"])'); input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await waitFor(`document.querySelector('.transport-ab-switch .source-b')`, "comparison ready");
    for (const [width, height] of sizes) { await resize(width, height); await compare(`player-ab-${width}`); }
    await resize(1440, 1000);
    await click('[aria-label="Wide full-body framing"]'); await delay(1300);
    await compare("player-wide-1440");
    await click('[aria-label="Focus mode (F)"]'); await settled("hong-xi");
    for (const [width, height] of sizes) { await resize(width, height); await compare(`focus-${width}`); }
    await click('[aria-label="Exit focus mode (F or Escape)"]'); await settled("hong-xi");
    await resize(1440, 1000); await click('button[title="Library"]'); await settled("hong-xi");
    for (const [width, height] of sizes) { await resize(width, height); await compare(`library-${width}`); }
    for (const [width, height] of [sizes[0], sizes[2]]) {
      await resize(width, height);
      await click('button[title="Queue"]'); await delay(650); await compare(`queue-${width}`); await click('[aria-label="Close queue"]');
      await click('[aria-label="Local storage"]'); await delay(650); await compare(`storage-${width}`);
      await click('.storage-actions .is-destructive'); await delay(350); await compare(`confirm-${width}`);
      await click('.confirm-dialog button:not(.confirm-destructive)'); await click('[aria-label="Close storage"]'); await delay(650);
      await click('.brand-version'); await waitFor(`document.querySelector('.update-orb.is-current')`, "update ready"); await delay(350);
      await compare(`update-${width}`); await click('[aria-label="Close update window"]');
    }
    await writeFile(path.join(output, "report.json"), JSON.stringify(comparisons, null, 2));
    const fields = ["changes", "switchingChanges", "returningChanges", "restoredChanges"];
    const report = [
      "# Companion layout audit", "",
      "Compares Hong Xi and Hiyori at the same viewport and playback state. Bounds include text, panels, controls and their icons. Differences below 0.5 CSS pixels are tolerated.", "",
      "| Scenario | Settled | Switching | Returning | Restored | Horizontal overflow (px) |",
      "| --- | ---: | ---: | ---: | ---: | ---: |",
      ...comparisons.map(result => `| ${result.label} | ${fields.map(field => result[field].length).join(" | ")} | ${Math.max(result.before.overflow, result.after.overflow)} |`),
      "", "## Screenshot comparisons", "",
      ...["welcome-1440", "player-ab-1440", "player-ab-390", "library-1440", "queue-1440", "update-390"].map(label =>
        `- ${label}: [Hong Xi](${path.join(output, `${label}-hong-xi.png`)}) · [Hiyori](${path.join(output, `${label}-hiyori.png`)})`),
      "", `[Raw measurements](${path.join(output, "report.json")})`, "",
    ].join("\n");
    await writeFile(path.join(output, "report.md"), report);
    if (!reportOnly) {
      for (const result of comparisons) {
        for (const field of fields) assert.deepEqual(result[field], [], `${result.label}: ${field}`);
        assert.ok(result.before.overflow <= 1 && result.after.overflow <= 1, `${result.label}: horizontal overflow`);
        assert.equal(result.before.position, result.after.position, `${result.label}: paused playhead preserved`);
        assert.deepEqual(result.before.camera, result.after.camera, `${result.label}: camera selection preserved`);
      }
    }
    console.log(`Layout audit: ${comparisons.length} scenarios; report and screenshots: ${output}`);
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally {
    clearTimeout(timer); window?.destroy();
    await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
    app.exit(process.exitCode || 0);
  }
}
void smoke();
