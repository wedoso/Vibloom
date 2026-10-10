import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './load-ts.mjs';
const { readLibraryVocalBuffer } = await loadTs('../src/audio/vocals/readLibraryVocalBuffer.ts');
const track = { id: 'song', fingerprint: 'file-v1' };
const signal = () => new AbortController().signal;

test('Library reuses an already loaded 44.1 kHz original without reading or decoding', async () => {
  const buffer = { sampleRate: 44100 };
  const result = await readLibraryVocalBuffer(track, async () => { throw new Error('Unexpected file read'); }, signal(), requested => {
    assert.equal(requested, track); return buffer;
  });
  assert.equal(result, buffer);
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(readLibraryVocalBuffer(track, async () => null, cancelled.signal, () => buffer), { name: 'AbortError' });
});

test('a compatible playback buffer arriving during lookup avoids both the file read and decode', async () => {
  let warm = null;
  const buffer = { sampleRate: 44100 };
  const result = await readLibraryVocalBuffer(track, async () => { warm = buffer; return null; }, signal(), () => warm);
  assert.equal(result, buffer);
});

test('a different sample rate or unavailable original keeps the independent 44.1 kHz decode path', async () => {
  const reader = globalThis.FileReader, offline = globalThis.OfflineAudioContext;
  let reads = 0, decodes = 0;
  const decoded = { sampleRate: 44100 };
  globalThis.FileReader = class { readAsArrayBuffer() { reads++; this.result = new ArrayBuffer(8); queueMicrotask(() => this.onload()); } };
  globalThis.OfflineAudioContext = class {
    constructor(channels, frames, rate) { assert.equal(channels, 2); assert.equal(frames, 1); assert.equal(rate, 44100); }
    async decodeAudioData(bytes) { assert.equal(bytes.byteLength, 8); decodes++; return decoded; }
  };
  try {
    for (const candidate of [{ sampleRate: 48000 }, null]) {
      assert.equal(await readLibraryVocalBuffer(track, async () => ({}), signal(), () => candidate), decoded);
    }
    assert.equal(reads, 2); assert.equal(decodes, 2);
    await assert.rejects(readLibraryVocalBuffer(track, async () => null, signal(), () => null), /Reconnect/);
  } finally { globalThis.FileReader = reader; globalThis.OfflineAudioContext = offline; }
});

test('cancelled lookup or native decode never returns a buffer to a vocal task', async () => {
  const reader = globalThis.FileReader, offline = globalThis.OfflineAudioContext;
  const controller = new AbortController();
  await assert.rejects(readLibraryVocalBuffer(track, async () => { controller.abort(); return {}; }, controller.signal), { name: 'AbortError' });
  const decoding = new AbortController();
  globalThis.FileReader = class { readAsArrayBuffer() { this.result = new ArrayBuffer(8); queueMicrotask(() => this.onload()); } };
  globalThis.OfflineAudioContext = class { async decodeAudioData() { decoding.abort(); return { sampleRate: 44100 }; } };
  try { await assert.rejects(readLibraryVocalBuffer(track, async () => ({}), decoding.signal), { name: 'AbortError' }); }
  finally { globalThis.FileReader = reader; globalThis.OfflineAudioContext = offline; }
});
