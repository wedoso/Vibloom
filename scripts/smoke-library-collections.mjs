import { app, BrowserWindow, net, protocol } from "electron";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const profile = await mkdtemp(path.join(tmpdir(), "vibloom-collections-"));
const output = path.join(root, "outputs/library-collections-smoke");
app.setPath("userData", profile);
app.on("window-all-closed", () => {});
protocol.registerSchemesAsPrivileged([{ scheme: "vibloom", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let window;
let exitCode = 0;
const timeout = setTimeout(() => app.exit(1), 90000);

async function smoke() {
  try {
    await app.whenReady();
    await mkdir(output, { recursive: true });
    protocol.handle("vibloom", async (request) => {
      const file = path.resolve(root, "dist", `.${new URL(request.url).pathname}`);
      if (!file.startsWith(`${path.join(root, "dist")}${path.sep}`)) return new Response("Not found", { status: 404 });
      return net.fetch(pathToFileURL(file).href);
    });
    window = new BrowserWindow({ width: 1280, height: 900, show: process.env.CI === "true", webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    window.webContents.setAudioMuted(true);
    const run = async (code) => {
      try { return await window.webContents.executeJavaScript(code, true); }
      catch (error) { throw new Error(`Renderer command failed: ${code}`, { cause: error }); }
    };
    const waitFor = async (code, label) => {
      for (let i = 0; i < 150; i++) { if (await run(`(async () => Boolean(await (${code})))()`)) return; await delay(100); }
      throw new Error(`Timed out: ${label}`);
    };
    const click = (selector) => run(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const button = (text) => run(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)}).click()`);
    const inputValue = (selector, value) => run(`(() => {
      const input = document.querySelector(${JSON.stringify(selector)}); input.focus();
      Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('input', {bubbles:true}));
    })()`);
    const summary = async () => {
      await waitFor(`document.querySelector('#import-title')?.textContent === 'Import complete'`, "import complete");
      const counts = await run(`[...document.querySelectorAll('.import-stats strong')].map(el => Number(el.textContent))`);
      await click('[aria-label="Close import summary"]');
      return counts;
    };
    const rows = () => run(`[...document.querySelectorAll('.track-title strong')].map(el => el.textContent)`);
    const albumCard = (name) => `[...document.querySelectorAll('.album-card')].find(b => b.querySelector('strong').textContent === ${JSON.stringify(name)})`;
    const browseAlbums = async () => {
      await waitFor(`document.querySelector('.album-navigation')`, "collection navigation ready");
      await click('.album-navigation > button:nth-child(2)');
      await waitFor(`document.querySelector('.album-cards')`, "album browser opens");
    };
    const selectAlbum = async (name) => {
      if (name === "All songs") { await button("All songs"); return; }
      await browseAlbums(); await waitFor(`${albumCard(name)}`, "album available");
      await run(`${albumCard(name)}.click()`);
    };
    const drop = (files, target = ".library-file-drop-region") => run(`(() => {
      const transfer = new DataTransfer(); ${files}.forEach(file => transfer.items.add(file));
      document.querySelector(${JSON.stringify(target)}).dispatchEvent(new DragEvent('drop', {bubbles:true, cancelable:true, dataTransfer: transfer}));
    })()`);
    await window.loadURL("vibloom://app/index.html");
    await waitFor(`document.querySelector('.companion-selector select')?.disabled === false`, "library storage restored");
    assert.equal(await run(`document.querySelector('.album-collections')`), null, "empty homepage has no collection navigation");
    assert.equal(await run(`document.querySelectorAll('.welcome-import-primary').length`), 1, "empty homepage retains one import entry");
    await delay(150);
    await writeFile(path.join(output, "welcome.png"), (await window.webContents.capturePage()).toPNG());
    console.log("Library ready");
    await run(`(() => {
      const rate = 8000, samples = rate * 10, bytes = new ArrayBuffer(44 + samples * 2), view = new DataView(bytes);
      const text = (offset, value) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
      text(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
      view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true);
      view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, samples * 2, true);
      window.__testAudio = bytes;
      window.__audioFile = (name, lastModified = 1) => new File([window.__testAudio], name, {type: 'audio/wav', lastModified});
      window.__fileEntry = file => ({ name: file.name, isFile: true, isDirectory: false, file: success => setTimeout(() => success(file), 0) });
      window.__directory = (name, batches) => ({ name, isFile: false, isDirectory: true, createReader: () => {
        let batch = 0; return {readEntries: success => setTimeout(() => success(batches[batch++] || []), 0)};
      } });
    })()`);
    await run(`(() => {
      const entry = window.__directory('Collection', [
        [window.__directory('A', [[window.__fileEntry(window.__audioFile('Same.wav', 1)), window.__fileEntry(new File(['[00:00.00]Album A\\n[00:02.00]Next A'], 'Same.lrc'))]])],
        [window.__directory('B', [[window.__fileEntry(window.__audioFile('Same.wav', 2)), window.__fileEntry(new File(['Album B\\nNext B'], 'Same.txt'))]])],
        Array.from({length: 101}, (_, i) => window.__fileEntry(new File(['ignored'], 'notes-' + i + '.md')))
      ]);
      const transfer = new DataTransfer(); transfer.items.add(new File([], 'Collection'));
      const original = DataTransferItem.prototype.webkitGetAsEntry;
      DataTransferItem.prototype.webkitGetAsEntry = function() { return this.getAsFile()?.name === 'Collection' ? entry : original.call(this); };
      try { document.querySelector('.library-welcome').dispatchEvent(new DragEvent('drop', {bubbles:true, cancelable:true, dataTransfer:transfer})); }
      finally { DataTransferItem.prototype.webkitGetAsEntry = original; }
    })()`);
    console.log("Folder dropped");
    assert.deepEqual(await summary(), [2, 2, 0, 101]);
    await waitFor(`document.querySelector('.open-library-button') && !document.documentElement.classList.contains('is-scene-transitioning')`, "player ready");
    await click('.open-library-button');
    await waitFor(`document.querySelectorAll('.track-title').length === 2`, "loaded library opens");
    assert.ok(await run(`document.querySelector('.album-navigation') !== null`), "collection navigation appears in the loaded Library");
    assert.equal(await run(`document.querySelectorAll('[aria-label="Synced lyrics attached"]').length`), 1);
    assert.equal(await run(`document.querySelectorAll('[aria-label="TXT lyrics attached"]').length`), 1);
    // Empty collections are still available within the loaded Library.
    await button("New album"); await inputValue('[aria-label="Album name"]', "First collection"); await button("Create album");
    await waitFor(`document.querySelector('.library-album-heading')?.textContent.includes('First collection')`, "empty album created");
    assert.equal((await rows()).length, 0, "new collection can start empty");
    await selectAlbum("All songs");
    await waitFor(`!document.documentElement.classList.contains('is-scene-transitioning')`, "list transition finished");
    assert.equal(await run(`document.querySelector('.library-drop-hint')`), null, "no permanent uploader in the Library");
    const rect = await run(`(() => {const r=document.querySelector('.library-file-drop-region').getBoundingClientRect();return [r.x,r.y,r.width,r.height];})()`);
    await run(`(() => {
      const transfer=new DataTransfer();transfer.items.add(new File(['lyrics'],'preview.txt'));
      window.__externalTransfer=transfer;
      document.querySelector('.library-list-heading').dispatchEvent(new DragEvent('dragenter',{bubbles:true,cancelable:true,dataTransfer:transfer}));
    })()`);
    assert.equal(await run(`document.querySelector('.library-file-drop-overlay')`), null, "heading is not an upload target");
    await run(`document.querySelector('.library-file-drop-region').dispatchEvent(new DragEvent('dragenter',{bubbles:true,cancelable:true,dataTransfer:window.__externalTransfer}))`);
    await waitFor(`document.querySelector('.library-file-drop-overlay')`, "list shows contextual upload hint");
    assert.deepEqual(await run(`(() => {const r=document.querySelector('.library-file-drop-region').getBoundingClientRect();return [r.x,r.y,r.width,r.height];})()`), rect, "drag feedback does not reflow the list");
    await run(`(() => {
      const rows=document.querySelectorAll('.track-row');
      rows[1].dispatchEvent(new DragEvent('dragenter',{bubbles:true,cancelable:true,dataTransfer:window.__externalTransfer}));
      rows[1].dispatchEvent(new DragEvent('dragleave',{bubbles:true,cancelable:true,relatedTarget:rows[2],dataTransfer:window.__externalTransfer}));
    })()`);
    assert.ok(await run(`Boolean(document.querySelector('.library-file-drop-overlay'))`), "crossing rows keeps the hint visible");
    await delay(150);
    await writeFile(path.join(output, "library-file-drag.png"), (await window.webContents.capturePage()).toPNG());
    await run(`document.querySelector('.library-file-drop-region').dispatchEvent(new DragEvent('dragleave',{bubbles:true,cancelable:true,relatedTarget:document.querySelector('.library-list-heading'),dataTransfer:window.__externalTransfer}))`);
    await waitFor(`!document.querySelector('.library-file-drop-overlay')`, "leaving the list removes the hint");
    await run(`(() => {
      const t=new DataTransfer();t.setData('application/x-vibloom-track','existing-song');
      document.querySelector('.library-file-drop-region').dispatchEvent(new DragEvent('dragenter',{bubbles:true,cancelable:true,dataTransfer:t}));
    })()`);
    assert.equal(await run(`document.querySelector('.library-file-drop-overlay')`), null, "internal song dragging does not show an uploader");
    await run(`document.querySelector('.library-file-drop-region').dispatchEvent(new DragEvent('dragenter',{bubbles:true,cancelable:true,dataTransfer:window.__externalTransfer}))`);
    await waitFor(`document.querySelector('.library-file-drop-overlay')`, "drag entered again");
    await run(`window.dispatchEvent(new Event('blur'))`);
    await waitFor(`!document.querySelector('.library-file-drop-overlay')`, "cancelled drag clears the hint");
    // A long, scrolled list keeps the message inside the visible part of the list.
    await run(`(() => {
      const filler=document.createElement('div');filler.id='scroll-test-filler';filler.style.height='2500px';
      const region=document.querySelector('.library-file-drop-region');region.append(filler);
      document.querySelector('.library-list-panel').scrollTop=1000;
      region.dispatchEvent(new DragEvent('dragenter',{bubbles:true,cancelable:true,dataTransfer:window.__externalTransfer}));
    })()`);
    await waitFor(`document.querySelector('.library-file-drop-overlay')`, "long list hint visible");
    await delay(100);
    assert.ok(await run(`(() => {
      const hint=document.querySelector('.library-file-drop-overlay').getBoundingClientRect();
      const text=document.querySelector('.library-file-drop-overlay h2').getBoundingClientRect();
      const panel=document.querySelector('.library-list-panel').getBoundingClientRect();
      return hint.top >= panel.top-1 && hint.bottom <= panel.bottom+1 && text.top >= panel.top && text.bottom <= panel.bottom;
    })()`), "hint follows the visible viewport of a long list");
    await run(`(() => {window.dispatchEvent(new Event('blur'));document.querySelector('#scroll-test-filler').remove();document.querySelector('.library-list-panel').scrollTop=0;})()`);
    console.log("PASS contextual list-only file hint, stable geometry, nested row crossings, leave/cancel cleanup, internal-drag exclusion and long-list scrolling");
    // This is a real renderer drop onto an already populated Library.
    await drop(`[window.__audioFile('Side song.wav'), new File(['First\\nSecond'], 'Side song.txt')]`);
    assert.deepEqual(await summary(), [1, 1, 0, 0]);
    assert.equal((await rows()).length, 3);
    assert.equal(await run(`document.querySelector('.library-file-drop-overlay')`), null, "drop clears the hint");
    await delay(150);
    await writeFile(path.join(output, "library-all-songs.png"), (await window.webContents.capturePage()).toPNG());
    await drop(`[new File(['[00:00.00]Updated lyric\\n[00:02.00]Second'], 'Side song.lrc')]`);
    assert.deepEqual(await summary(), [0, 1, 0, 0]);
    await drop(`[new File(['Ambiguous lyrics'], 'Same.txt')]`);
    assert.deepEqual(await summary(), [0, 0, 0, 1], "ambiguous basename does not attach to two songs");
    console.log("PASS nested folder batches, populated-library drops, TXT/LRC matching, lyric-only import, and ambiguous-name protection");

    await button("New album");
    await inputValue('[aria-label="Album name"]', "Favorites");
    await click('[aria-label="Include Side song in album"]');
    await run(`(async () => {
      const canvas = document.createElement('canvas'); canvas.width = 900; canvas.height = 900;
      const context = canvas.getContext('2d'); context.fillStyle = '#547f79'; context.fillRect(0, 0, 900, 900);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      const transfer = new DataTransfer(); transfer.items.add(new File([blob], 'cover.png', {type:'image/png'}));
      const input = document.querySelector('[aria-label="Album cover image"]'); input.files = transfer.files; input.dispatchEvent(new Event('change', {bubbles:true}));
    })()`);
    await waitFor(`document.querySelector('.album-cover-preview img') && !document.querySelector('.album-save').disabled`, "cover processed");
    await button("Create album");
    await waitFor(`document.querySelectorAll('.track-title').length === 1`, "album filters songs");
    assert.deepEqual(await rows(), ["Side song"]);
    const savedCover = await run(`document.querySelector('.library-album-heading-cover img').src`);
    assert.ok(savedCover.startsWith("data:image/webp"));
    const coverSize = await run(`(async () => { const image = new Image(); image.src = ${JSON.stringify(savedCover)}; await image.decode(); return [image.width, image.height]; })()`);
    assert.deepEqual(coverSize, [640, 640], "large covers are bounded before local persistence");
    await button("Play all");
    await waitFor(`document.querySelector('[aria-label="Pause"]')`, "album plays");
    await click('[aria-label="Pause"]');
    await run(`document.querySelector('.workspace-rail button[title="Queue"]').click()`);
    await waitFor(`document.querySelectorAll('.queue-list > div').length === 1`, "album playback queue");
    await click('[aria-label="Close queue"]');
    await selectAlbum("All songs");
    // Existing rows have an internal drag type; album assignment never imports a duplicate.
    await run(`(() => {
      const row = document.querySelector('[aria-label="Actions for Same"]').closest('.track-row');
      const transfer = new DataTransfer(); row.dispatchEvent(new DragEvent('dragstart', {bubbles:true, dataTransfer:transfer}));
      window.__internalTransfer = transfer; window.__dragRow = row;
      document.querySelector('.album-navigation > button:nth-child(2)').dispatchEvent(new DragEvent('dragenter', {bubbles:true, cancelable:true, dataTransfer:transfer}));
    })()`);
    await waitFor(`${albumCard("Favorites")}`, "internal drag reveals album targets");
    assert.ok(await run(`window.__dragRow.isConnected`), "showing album targets preserves the native drag source");
    await run(`${albumCard("Favorites")}.dispatchEvent(new DragEvent('drop', {bubbles:true, cancelable:true, dataTransfer:window.__internalTransfer}))`);
    await waitFor(`!document.querySelector('.album-drag-chooser')`, "album targets close after drop");
    await selectAlbum("Favorites");
    await waitFor(`document.querySelectorAll('.track-title').length === 2`, "song dragged into album");
    await drop(`[window.__audioFile('Side song.wav'), new File(['Replacement text\\nSecond'], 'Side song.txt')]`);
    assert.deepEqual(await summary(), [0, 1, 1, 0], "duplicate audio can replace lyrics without duplicating album membership");
    assert.ok(await run(`document.querySelector('.library-album-heading').textContent.includes('2 tracks')`));
    await run(`(() => {
      const entry = window.__directory('AlbumDrop', [[window.__directory('Nested', [[window.__fileEntry(window.__audioFile('New album song.wav')), window.__fileEntry(new File(['Album lyric'], 'New album song.txt'))]])]]);
      const transfer = new DataTransfer(); transfer.items.add(new File([], 'AlbumDrop')); transfer.items.add(new File(['ignored'], 'readme.md'));
      const original = DataTransferItem.prototype.webkitGetAsEntry;
      DataTransferItem.prototype.webkitGetAsEntry = function() { return this.getAsFile()?.name === 'AlbumDrop' ? entry : original.call(this); };
      try { document.querySelector('.library-file-drop-region').dispatchEvent(new DragEvent('drop', {bubbles:true, cancelable:true, dataTransfer:transfer})); }
      finally { DataTransferItem.prototype.webkitGetAsEntry = original; }
    })()`);
    assert.deepEqual(await summary(), [1, 1, 0, 1], "a mixed directory/file drop works in the populated library");
    assert.equal((await rows()).length, 3, "files dropped on an album join its collection");
    await click('[aria-label="Actions for New album song"]'); await button("Remove from album");
    await waitFor(`document.querySelectorAll('.track-title').length === 2`, "song removed from album");
    await selectAlbum("All songs");
    assert.equal((await rows()).length, 4, "removing from an album preserves the library song");
    await selectAlbum("Favorites");
    await waitFor(`!document.documentElement.classList.contains('is-scene-transitioning')`, "stable album layout");
    await delay(150);
    await writeFile(path.join(output, "library-albums.png"), (await window.webContents.capturePage()).toPNG());
    await browseAlbums(); await delay(150);
    await writeFile(path.join(output, "album-browser.png"), (await window.webContents.capturePage()).toPNG());
    await selectAlbum("Favorites");
    await button("Edit album");
    await waitFor(`document.querySelector('.album-editor')`, "album editor visible"); await delay(150);
    await writeFile(path.join(output, "album-editor.png"), (await window.webContents.capturePage()).toPNG());
    await inputValue('[aria-label="Album name"]', "Favorite music"); await button("Save album");
    // Wait for the debounced save and its IndexedDB transaction to complete.
    // A fixed delay can reload before persistence on the software-GPU runner.
    await waitFor(`(async () => {
      const db = await new Promise((resolve, reject) => { const r = indexedDB.open('vibloom-library'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      try {
        const snapshot = await new Promise((resolve, reject) => { const r = db.transaction('state').objectStore('state').get('library'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
        const album = snapshot?.albums?.find(item => item.name === 'Favorite music');
        return album?.cover === ${JSON.stringify(savedCover)} && album.trackIds.length === 2;
      } finally { db.close(); }
    })()`, "renamed album persisted");
    await window.loadURL("vibloom://app/index.html");
    await waitFor(`document.querySelector('.open-library-button')`, "library restored after reload");
    await click('.open-library-button');
    await browseAlbums();
    await waitFor(`${albumCard("Favorite music")}`, "album restored");
    assert.equal(await run(`${albumCard("Favorite music")}.querySelector('img').src`), savedCover);
    await selectAlbum("Favorite music");
    assert.equal((await rows()).length, 2, "album membership survives reload");
    await waitFor(`!document.documentElement.classList.contains('is-scene-transitioning')`, "reload transition finished");
    await window.setSize(440, 760); await delay(250);
    await button("Edit album");
    await waitFor(`document.querySelector('.album-editor')`, "narrow album editor visible"); await delay(150);
    assert.ok(await run(`(() => {const r=document.querySelector('.album-editor').getBoundingClientRect();const f=document.querySelector('.album-editor footer').getBoundingClientRect();return r.right <= innerWidth && r.bottom <= innerHeight && f.bottom <= innerHeight;})()`), "album editor and save controls fit narrow windows");
    await writeFile(path.join(output, "album-editor-narrow.png"), (await window.webContents.capturePage()).toPNG());
    await button("Delete album");
    await selectAlbum("All songs");
    await waitFor(`document.querySelectorAll('.track-title').length === 4`, "deleted album preserves all songs");
    await browseAlbums();
    assert.equal(await run(`document.querySelectorAll('.album-card').length`), 2, "only the selected album is deleted");
    console.log("PASS virtual album creation, cover upload, filtered playback, internal drag, album file imports, removal, rename, persistence, deletion, and narrow layout");
  } catch (error) {
    console.error(error);
    exitCode = 1;
  } finally {
    clearTimeout(timeout);
    window?.destroy();
    try { await rm(profile, { recursive: true, force: true, maxRetries: 3 }); }
    finally { app.exit(exitCode); }
  }
}
void smoke();
