import { app, BrowserWindow, net, protocol } from "electron";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const profile = await mkdtemp(path.join(tmpdir(), "vibloom-lyrics-"));
const output = path.join(root, "outputs/lyrics-timing-smoke");
app.setPath("userData", profile);
app.on("window-all-closed", () => {}); // Exit only after cleanup, preserving test failures.
protocol.registerSchemesAsPrivileged([{ scheme: "vibloom", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let window;
let exitCode = 0;
const timeout = setTimeout(() => app.exit(1), 90000);
async function smoke() {
  try {
    await app.whenReady();
    await mkdir(output, { recursive: true });
    protocol.handle("vibloom", (request) => {
      const file = path.resolve(root, "dist", `.${new URL(request.url).pathname}`);
      if (!file.startsWith(`${path.join(root, "dist")}${path.sep}`)) return new Response("Not found", { status: 404 });
      return net.fetch(pathToFileURL(file).href);
    });
    window = new BrowserWindow({ width: 1280, height: 900, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    window.webContents.setAudioMuted(true);
    const run = async (code) => {
      try { return await window.webContents.executeJavaScript(code, true); }
      catch (error) { throw new Error(`Renderer command failed: ${code}`, { cause: error }); }
    };
    const waitFor = async (code, label) => {
      for (let i = 0; i < 150; i++) { if (await run(code)) return; await delay(100); }
      throw new Error(`Timed out: ${label}`);
    };
    const click = (selector) => run(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const button = (text) => run(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)}).click()`);
    const key = (code, key) => run(`(document.activeElement?.closest('.lyric-timing-editor') ? document.activeElement : document.querySelector('.lyric-timing-editor')).dispatchEvent(new KeyboardEvent('keydown', {code: ${JSON.stringify(code)}, key: ${JSON.stringify(key)}, bubbles: true, cancelable: true}))`);
    const seek = async (value) => {
      await run(`(() => { const input = document.querySelector('[aria-label="Timestamp playback position"]'); input.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${value}); input.dispatchEvent(new Event('input', {bubbles:true})); })()`);
      await waitFor(`Number(document.querySelector('[aria-label="Timestamp playback position"]').value) === ${value}`, "seek applied");
    };
    await window.loadURL("vibloom://app/index.html");
    await waitFor(`document.querySelector('input[type="file"][multiple]')`, "app ready");
    await delay(500);
    await run(`(() => {
      const rate = 8000, samples = rate * 10, bytes = new ArrayBuffer(44 + samples * 2), view = new DataView(bytes);
      const text = (offset, value) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
      text(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
      view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true);
      view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, samples * 2, true);
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], 'Timing test.wav', {type:'audio/wav', lastModified:1}));
      transfer.items.add(new File([bytes], 'Next song.wav', {type:'audio/wav', lastModified:1}));
      transfer.items.add(new File(['第一行\\n\\nSecond line\\r\\n最後の行'], 'Timing test.txt', {type:'text/plain'}));
      const input = document.querySelector('input[type="file"][multiple]'); input.files = transfer.files; input.dispatchEvent(new Event('change', {bubbles:true}));
    })()`);
    await waitFor(`document.querySelector('#import-title')?.textContent === 'Import complete'`, "import complete");
    await click('[aria-label="Close import summary"]');
    // Open from the library menu, including loading a different track for timing.
    await waitFor(`!document.documentElement.classList.contains('is-scene-transitioning')`, "scene ready");
    await run(`document.querySelector('.open-library-button')?.click()`);
    await waitFor(`document.querySelector('[aria-label="Actions for Timing test"]')`, "library ready");
    await click('[aria-label="Actions for Timing test"]');
    await button("Timestamp lyrics");
    await waitFor(`document.querySelectorAll('.lyric-timing-lines button').length === 3`, "TXT editor opens");
    assert.equal(await run(`document.querySelector('.lyric-timing-download').disabled`), true);
    await seek(0); await key("Space", " "); await delay(250); await key("KeyT", "t");
    assert.notEqual(await run(`document.querySelector('.lyric-timing-lines time').textContent`), "00:00.00", "stamp reads live audio clock");
    await key("Space", " "); await key("KeyZ", "z");
    await seek(0); await key("KeyT", "t");
    await seek(2.34); await key("KeyT", "t");
    await key("KeyZ", "z");
    assert.equal(await run(`document.querySelectorAll('.lyric-timing-lines time')[1].textContent`), "--:--.--");
    await key("KeyT", "t");
    await delay(500);
    await click('[aria-label="Close timestamp editor"]');
    await window.loadURL("vibloom://app/index.html");
    await waitFor(`document.querySelector('[aria-label="Actions for Timing test"]') || document.querySelector('.open-library-button')`, "restored");
    await run(`document.querySelector('.open-library-button')?.click()`);
    await waitFor(`document.querySelector('[aria-label="Actions for Timing test"]')`, "restored library");
    await click('[aria-label="Actions for Timing test"]'); await button("Timestamp lyrics");
    await waitFor(`document.querySelector('.lyric-timing-editor')`, "draft reopened");
    assert.equal(await run(`document.querySelectorAll('.lyric-timing-lines time')[1].textContent`), "00:02.34", "draft survives reload");
    await seek(1); await key("KeyT", "t");
    assert.equal(await run(`document.querySelector('.lyric-timing-download').disabled`), true, "out of order timestamps blocked");
    await click('.lyric-timing-lines button:last-child'); await seek(4.56); await key("KeyT", "t");
    await button("Reset"); await key("KeyZ", "z");
    assert.equal(await run(`document.querySelector('.lyric-timing-download').disabled`), false, "reset can be undone");
    await waitFor(`!document.documentElement.classList.contains("is-scene-transitioning")`, "transition finished");
    await writeFile(path.join(output, "editor.png"), (await window.webContents.capturePage()).toPNG());
    await button("Save synced lyrics");
    await waitFor(`!document.querySelector('.lyric-timing-editor')`, "saving closes editor");
    await click('[aria-label="Actions for Timing test"]'); await button("Edit timing");
    await waitFor(`document.querySelector('.lyric-timing-editor')`, "saved timestamps can be edited again");
    const downloaded = new Promise((resolve, reject) => {
      window.webContents.session.once("will-download", (_event, item) => {
        item.setSavePath(path.join(output, item.getFilename()));
        item.once("done", (_event, state) => state === "completed" ? resolve(item.getSavePath()) : reject(new Error(state)));
      });
    });
    await click('.lyric-timing-download');
    const file = await downloaded;
    assert.equal(await readFile(file, "utf8"), "[00:00.00]第一行\n[00:02.34]Second line\n[00:04.56]最後の行\n");
    await seek(9.8); await key("Space", " ");
    await delay(1000);
    assert.equal(await run(`document.querySelector('.transport-track strong').textContent`), "Timing test", "end of song stays on edited track");
    assert.ok(await run(`document.querySelector('[aria-label="Play timing playback"]')`), "playback stopped");
    await window.setSize(440, 760); await delay(200);
    assert.ok(await run(`document.querySelector('.lyric-timing-editor').getBoundingClientRect().right <= innerWidth`));
    await writeFile(path.join(output, "editor-narrow.png"), (await window.webContents.capturePage()).toPNG());
    await click('[aria-label="Close timestamp editor"]');
    await run(`document.querySelector('[aria-label="Actions for Timing test"]').click()`);
    await button("Open in player / compare");
    await waitFor(`document.querySelector('.library-lyrics-list')`, "saved synced lyrics visible");
    await waitFor(`!document.documentElement.classList.contains("is-scene-transitioning")`, "player visible");
    await run(`void (document.querySelector('input[accept=".lrc,.txt,text/plain"]').click = () => {})`);
    await button("Replace");
    await run(`(() => { const input = document.querySelector('input[accept=".lrc,.txt,text/plain"]'); const data = new DataTransfer(); data.items.add(new File(['New line\\nAnother line'], 'replacement.txt', {type:'text/plain'})); input.files = data.files; input.dispatchEvent(new Event('change', {bubbles:true})); })()`);
    await waitFor(`document.querySelector('.lyrics-plain')?.textContent.includes('2 lines')`, "manual TXT attachment replaces synced lyrics");
    await button("Timestamp lyrics");
    await waitFor(`document.querySelectorAll('.lyric-timing-lines button').length === 2`, "new draft ready");
    assert.equal(await run(`document.querySelector('.lyric-timing-lines time').textContent`), "--:--.--", "replacement clears old timestamps");
    await click('[aria-label="Close timestamp editor"]');
    // Directly imported LRC (without any TXT timing draft) can be adjusted.
    await button("Replace");
    const originalLrc = "[ti:Existing song]\n[ar:Artist]\n[offset:100]\n[00:01.123]原文\n[00:01.123]Translation\n[00:03.00]Next\n[00:06.00]\n";
    await run(`(() => { const input = document.querySelector('input[accept=".lrc,.txt,text/plain"]'); const data = new DataTransfer(); data.items.add(new File([${JSON.stringify(originalLrc)}], 'existing.lrc', {type:'text/plain'})); input.files = data.files; input.dispatchEvent(new Event('change', {bubbles:true})); })()`);
    await waitFor(`document.querySelector('.library-lyrics-label')?.textContent.includes('Edit timing')`, "imported LRC edit entry");
    await button("Edit timing");
    await waitFor(`document.querySelectorAll('.lyric-timing-lines button').length === 3`, "existing timestamps loaded");
    assert.equal(await run(`document.querySelector('.lyric-timing-lines time').textContent`), "00:01.223");
    const inputValue = (label, value) => run(`(() => { const input = document.querySelector('[aria-label="' + ${JSON.stringify(label)} + '"]'); input.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await inputValue("All lines offset (seconds)", "-2"); await button("Shift all");
    assert.ok(await run(`document.querySelector('.lyric-timing-hint').textContent.includes('before 00:00')`));
    assert.equal(await run(`document.querySelector('.lyric-timing-lines time').textContent`), "00:01.223", "invalid offset leaves draft unchanged");
    await inputValue("All lines offset (seconds)", "0.5"); await button("Shift all");
    assert.equal(await run(`document.querySelector('.lyric-timing-lines time').textContent`), "00:01.723");
    await inputValue("Line 1 time (seconds)", "1.125"); await button("Set time");
    await button("+0.1 s");
    assert.equal(await run(`document.querySelector('.lyric-timing-lines time').textContent`), "00:01.225");
    await button("Undo");
    assert.equal(await run(`document.querySelector('.lyric-timing-lines time').textContent`), "00:01.125");
    await button("Seek to line");
    assert.equal(await run(`Number(document.querySelector('[aria-label="Timestamp playback position"]').value)`), 1.125);
    const lrcDownload = new Promise((resolve, reject) => {
      window.webContents.session.once("will-download", (_event, item) => {
        item.setSavePath(path.join(output, item.getFilename()));
        item.once("done", (_event, state) => state === "completed" ? resolve(item.getSavePath()) : reject(new Error(state)));
      });
    });
    await click('.lyric-timing-download');
    assert.equal(await readFile(await lrcDownload, "utf8"), "[ti:Existing song]\n[ar:Artist]\n[00:01.125]原文\n[00:01.125]Translation\n[00:03.60]Next\n[00:06.60]\n");
    await writeFile(path.join(output, "existing-lrc-editor.png"), (await window.webContents.capturePage()).toPNG());
    await click('[aria-label="Close timestamp editor"]');
    await delay(500);
    await window.loadURL("vibloom://app/index.html");
    await waitFor(`document.querySelector('.open-library-button')`, "reloaded player");
    await button("Edit timing");
    await waitFor(`document.querySelector('.lyric-timing-lines time')?.textContent === '00:01.125'`, "LRC edits persist");
    await button("Save synced lyrics");
    await waitFor(`!document.querySelector('.lyric-timing-editor')`, "saved LRC");
    await button("Remove");
    await waitFor(`document.querySelector('.library-lyrics-empty')?.textContent.includes('No matched lyrics')`, "lyrics removed");
    console.log("PASS LRC editing, metadata/translation preservation, TXT import, playback timestamps, undo/reset, persistence, order validation, LRC download, end-of-track isolation, and narrow layout");
  } catch (error) {
    console.error(error);
    exitCode = 1;
  } finally {
    clearTimeout(timeout);
    window?.destroy();
    try {
      await rm(profile, { recursive: true, force: true, maxRetries: 3 });
    } finally {
      app.exit(exitCode);
    }
  }
}
void smoke();
