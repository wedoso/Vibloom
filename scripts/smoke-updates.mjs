import { app, BrowserWindow, net, protocol } from "electron";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { releaseNotesForTag } from "./write-release-notes.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const { version: installedVersion } = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const installedNotes = releaseNotesForTag(await readFile(path.join(root, "CHANGELOG.md"), "utf8"), `v${installedVersion}`);
const installedBullet = installedNotes.split("\n").find(line => line.startsWith("- "))?.slice(2)
  .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1").replace(/\*\*|`/gu, "");
assert.ok(installedBullet, "installed release has a feature bullet");
const profile = await mkdtemp(path.join(tmpdir(), "vibloom-updates-"));
const output = path.join(root, "outputs/update-smoke");
app.setPath("userData", profile);
app.on("window-all-closed", () => {});
protocol.registerSchemesAsPrivileged([{ scheme: "vibloom", privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true,
} }]);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let window;
async function smoke() {
  const timer = setTimeout(() => { console.error("Update smoke test timed out"); app.exit(1); }, 90000);
  try {
    await app.whenReady(); await mkdir(output, { recursive: true });
    protocol.handle("vibloom", async request => {
      const url = new URL(request.url), file = path.resolve(root, "dist", `.${url.pathname}`);
      if (!file.startsWith(`${path.join(root, "dist")}${path.sep}`)) return new Response("Not found", { status: 404 });
      if (url.pathname === "/index.html" && url.searchParams.has("desktop")) {
        const response = await net.fetch(pathToFileURL(file).href);
        const html = (await response.text()).replace("<head>", `<head><script>
          window.__desktopVersion = '2.0.0';
          window.vibloomUpdates = {
            subscribe: listener => { window.__desktopEmit = listener; return () => {}; },
            check: async () => window.__desktopEmit({status:'available',currentVersion:${JSON.stringify(installedVersion)},availableVersion:window.__desktopVersion}),
            download: async () => window.__desktopEmit({status:'downloading',currentVersion:${JSON.stringify(installedVersion)},availableVersion:window.__desktopVersion,progress:42}),
            install: async () => { window.__installed = true; },
            openReleases: async version => { window.__openedVersion = version; }
          };
        </script>`);
        return new Response(html, { headers: { "Content-Type": "text/html" } });
      }
      return net.fetch(pathToFileURL(file).href);
    });
    window = new BrowserWindow({ width: 1100, height: 850, useContentSize: true, show: process.env.CI === "true",
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    window.webContents.on("console-message", event => {
      if (event.level === "error" || event.level === 3) console.error(event.message);
    });
    const run = code => window.webContents.executeJavaScript(code, true);
    const click = selector => run(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const waitFor = async (condition, label) => {
      for (let i = 0; i < 120; i++) { if (await run(condition)) return; await delay(100); }
      throw new Error(`Timed out: ${label}`);
    };
    const capture = async name => {
      await waitFor(`document.querySelector('.update-dialog').getAnimations().every(animation => animation.playState === 'finished')`, "update dialog entrance finished");
      await writeFile(path.join(output, `${name}.png`), (await window.webContents.capturePage()).toPNG());
    };
    const stubFetch = async mode => run(`(() => {
      const original = window.__originalFetch ??= window.fetch;
      window.fetch = (url, ...args) => String(url).includes('api.github.com/repos/wedoso/Vibloom/releases/')
        ? ${mode === "failure" ? "Promise.resolve(new Response('Rate limited',{status:403}))" : `Promise.resolve(new Response(JSON.stringify({tag_name:${mode === "current" ? "document.querySelector('.brand-version').textContent.trim().split(' ')[0]" : "'v2.0.0'"}, body:${(mode === "empty" || mode === "current") ? "''" : "window.__notes"}}),{status:200}))`}
        : original(url, ...args);
      window.__notes = '## Features\\n- **In-app release notes** with version details.\\n- Consistent controls across both companions.\\n\\n## Fixes\\n' + Array.from({length:25},(_,i)=>'- Improvement '+(i+1)+' keeps the listening room responsive.').join('\\n') + '\\n\\n<img src=x onerror="window.__unsafe=true">';
    })()`);
    await window.loadURL("vibloom://app/index.html");
    await waitFor(`document.querySelector('.brand-version') && document.querySelector('.live2d-stage[data-status="ready"]')`, "web ready");
    await stubFetch("current"); await click('.brand-version');
    await waitFor(`document.querySelector('.update-orb.is-current')`, "current version");
    assert.ok(await run(`document.querySelector('.update-notes').textContent.includes(${JSON.stringify(installedBullet)})`), "installed changelog bundled");
    await capture("current-hong-xi");
    await click('[aria-label="Close update window"]');
    await stubFetch("failure"); await click('.brand-version');
    await waitFor(`document.querySelector('.update-orb.is-error')`, "offline version check");
    assert.ok(await run(`document.querySelector('.update-notes').textContent.includes(${JSON.stringify(installedBullet)})`), "offline installed notes remain readable");
    await click('[aria-label="Close update window"]');
    await stubFetch("available"); await click('.brand-version');
    await waitFor(`document.querySelector('.update-orb.is-available') && document.querySelector('.update-notes li')`, "web new release");
    assert.equal(await run(`document.querySelectorAll('.update-notes img').length`), 0);
    assert.equal(await run(`Boolean(window.__unsafe)`), false);
    assert.ok(await run(`document.querySelector('.update-notes-content').scrollHeight > document.querySelector('.update-notes-content').clientHeight`), "long notes scroll");
    await capture("available-hong-xi");
    const geometry = () => run(`['.update-dialog','.update-notes','.update-actions'].map(selector=>{const r=document.querySelector(selector).getBoundingClientRect();return [r.x,r.y,r.width,r.height]})`);
    const before = await geometry();
    await run(`(() => {const select=document.querySelector('[aria-label="Music companion"]');const value='hiyori';select.click();document.querySelector('[role=option][data-value="'+value+'"]').click();})()`);
    await waitFor(`document.querySelector('.live2d-stage[data-companion="hiyori"][data-status="ready"]')`, "Hiyori ready");
    assert.deepEqual(await geometry(), before, "update notes geometry is identical across companion themes");
    await capture("available-hiyori");
    window.setContentSize(390, 640); await capture("available-mobile");
    window.setContentSize(640, 360); await delay(350);
    assert.ok(await run(`(() => {const r=document.querySelector('.update-dialog').getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight;})()`), "short viewport contains dialog");
    await run(`document.querySelector('.update-dialog').scrollTop=10000`);
    assert.ok(await run(`document.querySelector('.update-actions').getBoundingClientRect().bottom <= innerHeight`), "actions reachable in short viewport");
    await click('[aria-label="Close update window"]');
    window.setContentSize(1100, 850);
    await window.loadURL("vibloom://app/index.html?desktop=1");
    await waitFor(`typeof window.__desktopEmit === 'function'`, "desktop subscribed");
    await stubFetch("available"); await click('.brand-version');
    await waitFor(`document.querySelector('.update-notes li')`, "desktop offered-version notes");
    await click('.update-notes-link');
    assert.equal(await run(`window.__openedVersion`), "2.0.0", "release link targets exact offered version");
    await click('.update-actions .is-primary');
    await waitFor(`document.querySelector('.update-orb.is-downloading')`, "desktop download");
    assert.ok(await run(`document.querySelector('.update-notes').textContent.includes('In-app release notes')`));
    await run(`window.__desktopEmit({status:'downloaded',currentVersion:${JSON.stringify(installedVersion)},availableVersion:'2.0.0'})`);
    await waitFor(`document.querySelector('.update-orb.is-downloaded')`, "desktop downloaded");
    assert.ok(await run(`document.querySelector('.update-notes').textContent.includes('In-app release notes')`));
    await capture("desktop-downloaded"); await click('.update-actions .is-primary');
    assert.equal(await run(`window.__installed`), true);
    await click('[aria-label="Close update window"]');
    await run(`window.__desktopVersion='2.0.1'`); await stubFetch("failure"); await click('.brand-version');
    await waitFor(`document.querySelector('.update-notes').textContent.includes('could not be loaded')`, "notes failure");
    assert.equal(await run(`document.querySelector('.update-actions .is-primary').textContent.trim()`), "Download update", "notes failure does not block download");
    assert.ok(!(await run(`document.querySelector('.update-notes').textContent.includes('In-app release notes')`)), "previous version notes cleared");
    await click('[aria-label="Close update window"]');
    await run(`window.__desktopVersion='2.0.0'`); await stubFetch("empty"); await click('.brand-version');
    await waitFor(`document.querySelector('.update-notes').textContent.includes('No release notes')`, "empty notes");
    console.log(`PASS current/offline, exact-version web/desktop notes, safe text, theme geometry, scrolling, download/install and notes failures; screenshots: ${output}`);
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { clearTimeout(timer); window?.destroy(); await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {}); app.exit(process.exitCode || 0); }
}
void smoke();
