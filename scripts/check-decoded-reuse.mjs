/* global window, document, FileReader, AudioBufferSourceNode */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { snapshot, waveBytes } from './mobile-ui-fixtures.mjs';
const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i+1]; };
const modulePath = arg('--playwright-module') ?? 'playwright';
const { chromium, webkit } = await import(path.isAbsolute(modulePath) ? pathToFileURL(modulePath).href : modulePath);
const origin = arg('--url') ?? 'http://127.0.0.1:5190/';
const results = [], wave = waveBytes();
for (const [engine, type] of Object.entries({ chromium, webkit })) {
  if (arg('--engine') && arg('--engine') !== engine) continue;
  for (const rate of arg('--rate') ? [Number(arg('--rate'))] : [44100, 48000]) {
    const browser = await type.launch({ headless: true });
    try {
      const page = await browser.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(rate => {
        const Context = window.AudioContext, Offline = window.OfflineAudioContext;
        const read = FileReader.prototype.readAsArrayBuffer, start = AudioBufferSourceNode.prototype.start;
        window.__decodes = 0; window.__reads = 0; window.__starts = 0;
        const observe = (context, playback) => {
          const decode = context.decodeAudioData;
          context.decodeAudioData = (...args) => { window.__decodes++; return decode.apply(context, args).then(buffer => { if (playback) window.__playingBuffer = buffer; return buffer; }); };
        };
        window.AudioContext = class extends Context { constructor(options) { super({ ...options, sampleRate: rate }); observe(this, true); } };
        window.OfflineAudioContext = class extends Offline { constructor(...args) { super(...args); observe(this, false); } };
        FileReader.prototype.readAsArrayBuffer = function(...args) { window.__reads++; return read.apply(this, args); };
        AudioBufferSourceNode.prototype.start = function(...args) { if (this.context instanceof Context) window.__starts++; return start.apply(this, args); };
      }, rate);
      if (engine === 'webkit') {
        // This automation build cannot write desktop OPFS; provide the real
        // WAV File at the store boundary, retaining production decode and UI.
        await page.route('**/src/platform/browserLibraryPlatform.ts*', async route => {
          const response = await route.fetch(), body = await response.text();
          await route.fulfill({ response, body: body + `\nconst __bytes=Uint8Array.from(atob(${JSON.stringify(wave.toString('base64'))}),c=>c.charCodeAt(0));browserLibraryPlatform.audioFiles.get=async key=>new File([__bytes],key+'.wav',{type:'audio/wav'});` });
        });
      }
      await page.goto(new URL('/vibloom-icon.png', origin).href);
      const library = snapshot();
      library.tracks = library.tracks.slice(0, 2).map(track => ({ ...track, vocalAnalysis: undefined, comparison: null, comparisons: [] }));
      library.session.currentTrackId = ''; library.session.queue = library.tracks.map(track => track.id);
      await page.evaluate(async ({ library, bytes, writeAudio }) => {
        const { browserLibraryPlatform: p } = await import('/src/platform/browserLibraryPlatform.ts');
        await p.repository.reset();
        if (writeAudio) for (const track of library.tracks) await p.audioFiles.put(track.id, new Blob([new Uint8Array(bytes)], { type: 'audio/wav' }));
        await p.repository.save(library);
      }, { library, bytes: [...wave], writeAudio: engine !== 'webkit' });
      await page.goto(new URL('/?ui=desktop', origin).href);
      await page.waitForSelector('.live2d-stage[data-status="ready"]');
      await page.locator('button[title="Library"]').click();
      const songs = page.locator('.track-index');
      await songs.nth(0).click(); await page.waitForFunction(() => window.__starts > 0 && window.__playingBuffer).catch(async error => {
        console.error(engine, rate, await page.evaluate(() => ({ decodes: window.__decodes, reads: window.__reads, starts: window.__starts, body: document.body.innerText.slice(-1800) }))); throw error;
      });
      const initial = await page.evaluate(() => ({ decodes: window.__decodes, reads: window.__reads, rate: window.__playingBuffer.sampleRate }));
      assert.equal(initial.rate, rate);
      assert.equal(initial.decodes, 1);
      for (let repeat = 0; repeat < 5; repeat++) {
        const starts = await page.evaluate(() => window.__starts);
        await songs.nth(0).click(); await page.waitForFunction(starts => window.__starts > starts, starts);
      }
      const repeated = await page.evaluate(() => ({ decodes: window.__decodes, reads: window.__reads }));
      assert.equal(repeated.decodes, initial.decodes); assert.equal(repeated.reads, initial.reads);
      const input = await page.evaluate(async () => {
        const { readLibraryVocalBuffer } = await import('/src/audio/vocals/readLibraryVocalBuffer.ts');
        const url = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/platform/browserLibraryPlatform.ts').name;
        const { browserLibraryPlatform: p } = await import(url), track = (await p.repository.load()).tracks[0], source = window.__playingBuffer;
        const resolve = () => p.audioFiles.get(track.id), signal = new AbortController().signal;
        const at = performance.now(), baseline = await readLibraryVocalBuffer(track, resolve, signal);
        const baselineMs = performance.now() - at, before = window.__decodes, beforeReads = window.__reads;
        const warmAt = performance.now(), result = await readLibraryVocalBuffer(track, resolve, signal, () => source);
        const readMs = performance.now() - warmAt;
        let differences = baseline.length === result.length && baseline.numberOfChannels === result.numberOfChannels ? 0 : 1;
        if (!differences) for (let channel = 0; channel < baseline.numberOfChannels; channel++) {
          const a = baseline.getChannelData(channel), b = result.getChannelData(channel);
          for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) differences++;
        }
        return { baselineMs, readMs, reused: result === source, additionalDecodes: window.__decodes - before, additionalReads: window.__reads - beforeReads, differences };
      });
      assert.equal(input.differences, 0); assert.equal(input.reused, rate === 44100);
      assert.equal(input.additionalDecodes, rate === 44100 ? 0 : 1); assert.equal(input.additionalReads, rate === 44100 ? 0 : 1);
      // Selecting a different song must still read/decode its own source.
      const before = await page.evaluate(() => window.__decodes);
      await songs.nth(1).click(); await page.waitForFunction(() => document.querySelector('.track-row.is-active')?.dataset.trackId === 'fixture-1');
      assert.equal(await page.evaluate(() => window.__decodes), before + 1); assert.deepEqual(errors, []);
      results.push({ engine, rate, initial, repeated, input });
      console.log(`PASS ${engine} ${rate} Hz: five re-selections add zero reads/decodes; vocal input exact, compatible reuse/incompatible fallback; new song decoded`);
      await page.close();
    } finally { await browser.close(); }
  }
}
await mkdir('outputs/decoded-reuse', { recursive: true });
await writeFile('outputs/decoded-reuse/report.json', JSON.stringify(results, null, 2));
