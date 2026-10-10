import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './load-ts.mjs';
const { writeAudioBlob } = await loadTs('../src/platform/writeAudioBlob.ts');
const { VocalAnalysisStore, withVocalStorage } = await loadTs('../src/audio/vocals/analysisStore.ts');
const value = { version: 4, rms: [.1], vowels: [0, 0, 255, 0, 0] };
const snapshot = { version: 3, tracks: [{ id: 'A', vocalAnalysis: value }], session: {} };
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture(base) {
  const records = new Map(), store = new VocalAnalysisStore({ get: async key => records.get(key), put: async (key, data) => { records.set(key, data); }, remove: async key => { records.delete(key); } });
  return { records, store, repo: withVocalStorage(base, store) };
}

test('OPFS commits only a complete write; write/close failures abort and retain the original failure', async () => {
  const calls = [], file = new Blob(['new audio']), quota = new DOMException('Full', 'QuotaExceededError');
  await writeAudioBlob({ write: async input => { assert.equal(input, file); calls.push('write'); }, close: async () => { calls.push('close'); }, abort: async () => { calls.push('abort'); } }, file);
  assert.deepEqual(calls, ['write', 'close']);
  for (const phase of ['write', 'close']) {
    calls.length = 0;
    await assert.rejects(writeAudioBlob({ write: async () => { calls.push('write'); if (phase === 'write') throw quota; }, close: async () => { calls.push('close'); throw quota; }, abort: () => { calls.push('abort'); throw new Error('Already closed'); } }, file), error => error === quota);
    assert.deepEqual(calls, phase === 'write' ? ['write', 'abort'] : ['write', 'close', 'abort']);
  }
});

test('failed migration removes only unpublished curves and returns intact inline data', async () => {
  const instance = fixture({ load: async () => snapshot, save: async () => { throw new Error('Quota'); }, reset: async () => {} });
  const protectedRef = await instance.store.put(value), result = await instance.repo.load();
  assert.deepEqual(result.tracks[0].vocalAnalysis, value);
  assert.equal(instance.records.size, 1); assert.ok(instance.records.has(protectedRef.cacheKey));
  assert.equal(snapshot.tracks[0].vocalAnalysis, value);
});

test('failed metadata commit rolls back inline splits; a retry commits once without sweeping a pending job result', async () => {
  let fail = true, saved;
  const instance = fixture({ load: async () => null, save: async input => { if (fail) throw new Error('Interrupted'); saved = input; }, reset: async () => {} });
  const pendingJob = await instance.store.put(value);
  await assert.rejects(instance.repo.save(snapshot), /Interrupted/);
  assert.equal(instance.records.size, 1); assert.ok(instance.records.has(pendingJob.cacheKey));
  fail = false; await instance.repo.save(snapshot);
  assert.equal(instance.records.size, 2); assert.ok(instance.records.has(saved.tracks[0].vocalAnalysis.cacheKey));
});

test('metadata/session operations stay ordered despite delayed writes; a failure does not poison later saves', async () => {
  let finish; const events = [];
  const instance = fixture({ load: async () => null, save: async () => { events.push('begin'); await new Promise(resolve => { finish = resolve; }); events.push('end'); }, saveSession: async () => { events.push('session'); }, reset: async () => {} });
  const save = instance.repo.save({ ...snapshot, tracks: [] }), session = instance.repo.saveSession({});
  await flush(); assert.deepEqual(events, ['begin']); finish(); await Promise.all([save, session]);
  assert.deepEqual(events, ['begin', 'end', 'session']);
});

test('reset invalidates queued old writes and is the final operation after a running commit', async () => {
  let finish; const events = [];
  const instance = fixture({ load: async () => null, save: async () => { events.push('begin'); await new Promise(resolve => { finish = resolve; }); events.push('end'); }, saveSession: async () => { events.push('session'); }, reset: async () => { events.push('reset'); } });
  const running = instance.repo.save({ ...snapshot, tracks: [] }); await flush();
  const old = instance.repo.saveSession({}); const rejected = assert.rejects(old, { name: 'AbortError' });
  const reset = instance.repo.reset(); finish(); await Promise.all([running, rejected, reset]);
  assert.deepEqual(events, ['begin', 'end', 'reset']);
  await instance.repo.saveSession({}); assert.equal(events.at(-1), 'session');
});
