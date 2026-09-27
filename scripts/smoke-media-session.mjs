import { app, BrowserWindow, net, protocol } from "electron";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const profile = await mkdtemp(path.join(tmpdir(), "vibloom-media-"));
const output = path.join(root, "outputs/media-session-smoke");
app.setPath("userData", profile);
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
    const run = (code) => window.webContents.executeJavaScript(code, true);
    const waitFor = async (code, label) => {
      for (let i = 0; i < 150; i++) { if (await run(code)) return; await delay(100); }
      throw new Error(`Timed out: ${label}`);
    };
    const click = (selector) => run(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await window.loadURL("vibloom://app/index.html");
    await waitFor(`document.querySelector('input[type="file"][multiple]')`, "app ready");
    await delay(500);
    await run(`(() => {
      const original = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
      window.__mediaHandlers = new Map();
      navigator.mediaSession.setActionHandler = (action, handler) => { window.__mediaHandlers.set(action, handler); return original(action, handler); };
      const OriginalAudio = window.Audio;
      window.Audio = function(...args) { const audio = new OriginalAudio(...args); window.__mediaAnchor = audio; return audio; };
      window.__sourceStarts = [];
      const start = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function(when, offset) { window.__sourceStarts.push({when, offset}); return start.call(this, when, offset); };
    })()`);
    await run(`(() => {
      const rate = 8000, samples = rate * 10, bytes = new ArrayBuffer(44 + samples * 2), view = new DataView(bytes);
      const text = (offset, value) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
      text(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
      view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true);
      view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, samples * 2, true);
      for (let i = 0; i < samples; i++) view.setInt16(44 + i * 2, Math.sin(i * 220 * 2 * Math.PI / rate) * 1000, true);
      window.__mediaTestAudio = new File([bytes], 'Version B.wav', {type:'audio/wav'});
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], 'Timing test.wav', {type:'audio/wav', lastModified:1}));
      transfer.items.add(new File([bytes], 'Next song.wav', {type:'audio/wav', lastModified:1}));
      transfer.items.add(new File(['第一行\\n\\nSecond line\\r\\n最後の行'], 'Timing test.txt', {type:'text/plain'}));
      const input = document.querySelector('input[type="file"][multiple]'); input.files = transfer.files; input.dispatchEvent(new Event('change', {bubbles:true}));
    })()`);
    await waitFor(`document.querySelector('#import-title')?.textContent === 'Import complete'`, "import complete");
    await click('[aria-label="Close import summary"]');
    await waitFor(`document.querySelector('.transport-play') && navigator.mediaSession.metadata?.title`, "system metadata ready");
    await click('.transport-play');
    await waitFor(`navigator.mediaSession.playbackState === 'playing' && Number(document.querySelector('[aria-label="Playback position"]').value) > 0.2`, "playing state published");
    await run(`(() => { const data = new DataTransfer(); data.items.add(window.__mediaTestAudio); const input = document.querySelector('input[type="file"]:not([multiple]):not([accept^=".lrc"])'); input.files = data.files; input.dispatchEvent(new Event('change', {bubbles:true})); })()`);
    await waitFor(`document.querySelector('.transport-ab-switch .source-b')`, "comparison ready");
    await click('.transport-ab-switch .source-b');
    await waitFor(`navigator.mediaSession.metadata.title === 'Version B'`, "audible version metadata");
    const command = (action, details = {}) => run(`window.__mediaHandlers.get(${JSON.stringify(action)})(${JSON.stringify({action, ...details})})`);
    const position = () => run(`Number(document.querySelector('[aria-label="Playback position"]').value)`);
    await command("pause");
    await waitFor(`navigator.mediaSession.playbackState === 'paused' && document.querySelector('.transport-play[aria-label="Play"]')`, "headset pauses UI and system state");
    await waitFor(`window.__mediaAnchor?.paused`, "native media carrier pauses");
    const pausedAt = await position();
    await command("pause"); await delay(1500);
    assert.equal(await position(), pausedAt, "repeated pause never resumes and preserves position");
    await run(`window.__sourceStarts = []`);
    await command("play");
    await waitFor(`navigator.mediaSession.playbackState === 'playing'`, "headset resumes");
    const starts = await run(`window.__sourceStarts`);
    assert.equal(starts.length, 2);
    assert.equal(starts[0].when, starts[1].when, "both versions resume on one audio clock");
    assert.equal(starts[0].offset, starts[1].offset);
    assert.ok(Math.abs(starts[0].offset - pausedAt) < 0.05, "resume from paused position");
    await command("play"); await delay(200);
    assert.equal(await run(`window.__sourceStarts.length`), 2, "repeated play does not restart sources");
    await command("pause"); await command("seekto", {seekTime: 4.25});
    await waitFor(`Number(document.querySelector('[aria-label="Playback position"]').value) === 4.25`, "system seeking uses shared transport");
    await run(`window.__mediaHandlers.get('play')({action:'play'}); window.__mediaHandlers.get('pause')({action:'pause'});`);
    await delay(200);
    assert.equal(await run(`navigator.mediaSession.playbackState`), "paused", "rapid play/pause stays paused");
    assert.equal(await position(), 4.25);
    await run(`window.__mediaAnchor.play()`);
    await waitFor(`navigator.mediaSession.playbackState === 'playing'`, "native media element resume reaches audio engine");
    await run(`window.__mediaAnchor.pause()`);
    await waitFor(`navigator.mediaSession.playbackState === 'paused'`, "native media element pause reaches audio engine");
    // Hidden macOS windows keep the same registered headset controls.
    window.hide();
    await command("play"); await delay(200); await command("pause");
    assert.ok(await position() > 4.25, "hidden window resumes and pauses");
    console.log("PASS system metadata, headset pause/resume, repeated commands, A/B synchronization, seeking, rapid cancellation and hidden-window control");
  } catch (error) {
    console.error(error);
    exitCode = 1;
  } finally {
    clearTimeout(timeout);
    window?.destroy();
    await rm(profile, { recursive: true, force: true });
    app.exit(exitCode);
  }
}
void smoke();
