import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './load-ts.mjs';
const { SynchronizedAudioEngine } = await loadTs('../src/audio/SynchronizedAudioEngine.ts');
const { AUDIO_RESUME_TIMEOUT_MS } = await loadTs('../src/audio/contextOperation.ts');
const { bindPlaybackRecovery, PLAYBACK_STALL_MS } = await loadTs('../src/platform/playbackRecovery.ts');
const flush = () => new Promise(resolve => setImmediate(resolve));

class FakeContext extends EventTarget {
  state = 'running'; currentTime = 10; destination = {}; starts = []; resumes = 0;
  node() { return { connect() {}, disconnect() {}, gain: { value: 0, cancelScheduledValues() {} } }; }
  createGain() { return this.node(); }
  createAnalyser() { return this.node(); }
  createBufferSource() {
    return { ...this.node(), start: (when, offset) => this.starts.push({ when, offset }), stop() {} };
  }
  async resume() { this.resumes++; this.state = 'running'; }
  async close() { this.state = 'closed'; }
  change(state) { this.state = state; this.dispatchEvent(new Event('statechange')); }
}
const buffer = { duration: 120, length: 100, numberOfChannels: 2 };
function player(context = new FakeContext()) {
  const engine = new SynchronizedAudioEngine(() => context); engine.setBuffer(0, buffer);
  return { engine, context };
}

test('interrupted playback and seeks resume before scheduling; an interruption that persists cannot report success', async () => {
  const { engine, context } = player();
  context.state = 'interrupted';
  assert.equal(await engine.play(0, .025, .9), true);
  assert.equal(context.resumes, 1);
  engine.pause(); context.state = 'interrupted';
  assert.equal(await engine.play(30, .025, .9), true);
  assert.equal(context.resumes, 2); assert.equal(context.starts.at(-1).offset, 30);
  engine.pause(); context.state = 'interrupted'; context.resume = async () => {};
  await assert.rejects(engine.play(45, .025, .9), /interrupted/);
  assert.equal(engine.isPlaying, false); assert.equal(context.starts.length, 2);
  assert.equal(engine.getContext(), null); assert.equal(engine.getBuffer(0), buffer);
  await engine.close();
});

test('a hung resume times out, releases the broken graph and allows a fresh retry without importing again', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const broken = new FakeContext(), fresh = new FakeContext();
  broken.state = 'suspended'; let finish;
  broken.resume = () => new Promise(resolve => { finish = resolve; });
  let creations = 0;
  const engine = new SynchronizedAudioEngine(() => ++creations === 1 ? broken : fresh);
  engine.setBuffer(0, buffer); engine.setBuffer(1, buffer); engine.selectSourceImmediately(1); engine.setOffset(23);
  const pending = assert.rejects(engine.play(23, .025, .7), /Press Play to retry/);
  t.mock.timers.tick(AUDIO_RESUME_TIMEOUT_MS); await pending;
  assert.equal(broken.state, 'closed'); assert.equal(engine.isPlaying, false);
  assert.equal(engine.getTimelineTime(), 23); assert.equal(engine.selectedSource, 1);
  assert.equal(engine.getBuffer(1), buffer);
  assert.equal(await engine.play(23, .025, .7), true);
  assert.equal(creations, 2); assert.equal(fresh.starts.at(-1).offset, 23);
  finish(); await flush(); assert.equal(broken.starts.length, 0);
  assert.equal(engine.getContext(), fresh); assert.equal(engine.isPlaying, true);
  await engine.close();
});

test('pause, external cancellation and close settle a never-resolving resume promptly', async () => {
  for (const cancel of ['pause', 'signal', 'close']) {
    const { engine, context } = player(); context.state = 'suspended';
    context.resume = () => new Promise(() => {});
    const controller = new AbortController();
    const pending = engine.play(0, 0, 1, controller.signal);
    if (cancel === 'signal') controller.abort(); else await engine[cancel]();
    assert.equal(await pending, false); assert.equal(engine.isPlaying, false);
    assert.equal(context.starts.length, 0); await engine.close();
  }
  const { engine, context } = player(); context.state = 'suspended'; context.resume = () => new Promise(() => {});
  const controller = new AbortController(), pending = assert.rejects(engine.ensureGraph(true, .9, controller.signal), { name: 'AbortError' });
  controller.abort(); await pending; await engine.close();
});

test('an externally closed context is replaced on the first play request', async () => {
  const old = new FakeContext(), fresh = new FakeContext(); let creations = 0;
  const engine = new SynchronizedAudioEngine(() => ++creations === 1 ? old : fresh);
  engine.setBuffer(0, buffer); await engine.play(7, 0, .9);
  old.state = 'closed';
  assert.equal(await engine.play(7, .025, .9), true);
  assert.equal(engine.getContext(), fresh); assert.equal(engine.selectedSource, 0);
  assert.equal(fresh.starts.at(-1).offset, 7); await engine.close();
});

function observer(t, engine, overrides = {}) {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const page = new EventTarget(); page.visibilityState = 'visible';
  const events = new EventTarget(), calls = [];
  let elapsed = 0, failures = 0;
  const dispose = bindPlaybackRecovery(engine, {
    isBusy: () => false,
    recover: async rebuild => {
      calls.push(rebuild); const position = engine.pause(); if (rebuild) engine.resetGraph();
      return engine.play(position, .025, .9);
    },
    onFailure: () => { failures++; engine.pause(); },
    ...overrides,
  }, page, events, () => elapsed);
  t.after(dispose);
  return { page, events, calls, dispose, get failures() { return failures; }, tick(ms) { elapsed += ms; t.mock.timers.tick(ms); } };
}

test('foreground interruption resumes from the audio position and duplicate lifecycle events coalesce', async t => {
  const { engine, context } = player(); await engine.play(5, 0, .9); context.currentTime += 12;
  const watch = observer(t, engine);
  watch.page.visibilityState = 'hidden'; context.change('interrupted');
  watch.tick(10000); assert.deepEqual(watch.calls, [], 'background playback is not suspended or restarted');
  watch.page.visibilityState = 'visible'; watch.page.dispatchEvent(new Event('visibilitychange'));
  watch.events.dispatchEvent(new Event('pageshow')); context.dispatchEvent(new Event('statechange'));
  await flush(); assert.deepEqual(watch.calls, [false]);
  assert.equal(engine.isPlaying, true); assert.equal(context.starts.at(-1).offset, 17);
  context.currentTime += 2; watch.tick(250); assert.equal(watch.failures, 0);
  context.change('interrupted'); await flush();
  assert.deepEqual(watch.calls, [false, false], 'a later independent interruption can recover again');
  await engine.close();
});

test('pausing while an automatic recovery is pending prevents a late restart', async t => {
  const { engine, context } = player(); await engine.play(5, 0, .9);
  const watch = observer(t, engine); let finish;
  context.resume = () => new Promise(resolve => { finish = resolve; });
  context.change('interrupted'); engine.pause();
  context.state = 'running'; finish(); await flush(); watch.tick(250);
  assert.equal(engine.isPlaying, false); assert.equal(context.starts.length, 1);
  assert.deepEqual(watch.calls, [false]); assert.equal(watch.failures, 0); await engine.close();
});

test('a frozen running clock rebuilds once with PCM/position retained, and a persistently frozen replacement becomes retryable', async t => {
  const contexts = [new FakeContext(), new FakeContext()]; let creations = 0;
  const engine = new SynchronizedAudioEngine(() => contexts[creations++]); engine.setBuffer(0, buffer);
  await engine.play(19, 0, .9);
  const watch = observer(t, engine);
  watch.tick(PLAYBACK_STALL_MS); await flush();
  assert.deepEqual(watch.calls, [true]); assert.equal(creations, 2);
  assert.equal(contexts[1].starts.at(-1).offset, 19); assert.equal(engine.getBuffer(0), buffer);
  // First observation attaches to the replacement; allow a full sampling period.
  watch.tick(250); watch.tick(PLAYBACK_STALL_MS); await flush();
  assert.deepEqual(watch.calls, [true], 'do not repeatedly recreate a failed device');
  assert.equal(watch.failures, 1); assert.equal(engine.isPlaying, false);
  assert.equal(engine.getContext(), null); assert.equal(engine.getTimelineTime(), 19);
  await engine.close();
});

test('healthy clocks, paused users, busy loads and natural completion are not restarted; disposal removes wakeups', async t => {
  const { engine, context } = player(); await engine.play(0, 0, .9);
  let busy = true;
  const watch = observer(t, engine, { isBusy: () => busy });
  watch.tick(PLAYBACK_STALL_MS * 2); assert.deepEqual(watch.calls, []);
  busy = false;
  for (let i = 0; i < 4; i++) { context.currentTime += 1; watch.tick(1000); }
  assert.deepEqual(watch.calls, []);
  engine.pause(); context.change('interrupted'); watch.events.dispatchEvent(new Event('pageshow'));
  watch.tick(PLAYBACK_STALL_MS * 2); assert.deepEqual(watch.calls, []);
  context.state = 'running'; await engine.play(119.99, 0, .9);
  watch.tick(PLAYBACK_STALL_MS * 2); assert.deepEqual(watch.calls, [], 'queue owns end-of-track');
  await engine.play(0, 0, .9); watch.dispose(); context.change('interrupted');
  watch.events.dispatchEvent(new Event('pageshow')); watch.tick(PLAYBACK_STALL_MS * 2);
  assert.deepEqual(watch.calls, []); await engine.close();
});

// Exercise the mobile hook's real async transport. Stub unrelated UI/storage
// hooks, while retaining the actual engine, file reader and recovery observer.
globalThis.__mobilePlaybackHooks = {
  useCallback: fn => fn,
  useRef: value => ({ current: value }),
  useEffect: setup => globalThis.__mobilePlaybackFixture.effects.push(setup),
  useState: initial => {
    const fixture = globalThis.__mobilePlaybackFixture, index = fixture.states.length;
    let value = typeof initial === 'function' ? initial() : initial;
    if (index === 2) value = [fixture.track];
    if (index === 4) value = { ...value, currentTrackId: 'song', queue: ['song'], currentTime: 11 };
    if (index === 5) value = true;
    fixture.states.push(value);
    return [value, update => { fixture.states[index] = typeof update === 'function' ? update(fixture.states[index]) : update; }];
  },
};
const { useMobileLibrary } = await loadTs('../src/mobile/useMobileLibrary.ts', source => source
  .replaceAll('import.meta.env.BASE_URL', '"/"')
  .replace(/^import .* from "react";$/m, 'const { useCallback, useRef, useEffect, useState } = globalThis.__mobilePlaybackHooks;')
  .replace(/^import .* from "\.\.\/audio\/SynchronizedAudioEngine";$/m, 'const SynchronizedAudioEngine = class { constructor() { return globalThis.__mobilePlaybackFixture.engine; } };')
  .replace(/^import .* from "\.\.\/comparison\/useComparisonWorkspace";$/m, 'const useComparisonWorkspace = () => ({ reset() {}, clearFiles() {}, preserveCachedFiles() {}, updateCacheStatus() {}, slots: {}, jobs: {} });')
  .replace(/^import .* from "\.\.\/platform\/useMediaSession";$/m, 'const useMediaSession = () => {};')
  .replace(/^import .* from "\.\/platform";$/m, 'const mobilePlatform = {};')
  .replace(/^import .* from "\.\.\/platform\/indexedLibraryRepository";$/m, 'const librarySaveMessage = error => error.message;')
  .replace(/^import .* from "\.\.\/audio\/vocals\/jobStore";$/m, 'const VocalJobStore = class { dispose() {} }; const vocalJobKey = () => "";')
  .replace(/^import .* from "\.\.\/audio\/vocals\/analyzeVocals";$/m, 'const analyzeMobileVocals = () => {}; const releaseIdleMobileVocalWorkers = () => {};')
  .replace(/^import .* from "\.\/useMobileVocals";$/m, 'const useMobileVocals = () => ({});')
);
function mobileFixture(t, contexts = [new FakeContext()]) {
  const reader = globalThis.FileReader;
  globalThis.FileReader = class {
    readAsArrayBuffer() { queueMicrotask(() => { this.result = new ArrayBuffer(8); this.onload?.(); }); }
    abort() { this.onabort?.(); }
  };
  for (const context of contexts) context.decodeAudioData = async () => buffer;
  let creations = 0;
  const engine = new SynchronizedAudioEngine(() => contexts[creations++]);
  const fixture = globalThis.__mobilePlaybackFixture = {
    engine, effects: [], states: [],
    track: { id: 'song', fingerprint: 'song', name: 'Song.wav', duration: 120, comparisons: [], persistence: 'cached', lyrics: [] },
  };
  const library = useMobileLibrary({ audioFiles: { get: async () => ({}) }, repository: {}, storage: {} });
  const cleanup = fixture.effects.find(setup => setup.toString().includes('mounted.current = false'))();
  t.after(() => { cleanup(); globalThis.FileReader = reader; });
  return { library, engine, contexts, fixture, get busy() { return fixture.states[6]; }, get message() { return fixture.states[8]; }, get playing() { return fixture.states[10]; } };
}

test('mobile preparation clears busy and paused UI on timeout; the next tap plays retained audio', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const broken = new FakeContext(), fresh = new FakeContext(); broken.state = 'suspended';
  broken.resume = () => new Promise(() => {});
  const mobile = mobileFixture(t, [broken, fresh]);
  await mobile.library.load('song', false, 11);
  const pending = mobile.library.load('song', true, 11);
  assert.equal(mobile.busy, 'Preparing audio…');
  t.mock.timers.tick(AUDIO_RESUME_TIMEOUT_MS);
  assert.equal(await pending, false); assert.equal(mobile.busy, ''); assert.equal(mobile.playing, false);
  assert.match(mobile.message, /Press Play to retry/);
  assert.equal(await mobile.library.load('song', true, 11), true);
  assert.equal(mobile.busy, ''); assert.equal(mobile.playing, true); assert.equal(fresh.starts.at(-1).offset, 11);
});

test('mobile seek restores interrupted audio and handles failed restoration without leaving playing/busy set', async t => {
  const mobile = mobileFixture(t), context = mobile.contexts[0];
  await mobile.library.load('song', true, 11);
  context.state = 'interrupted'; await mobile.library.seek(33);
  assert.equal(context.resumes, 1); assert.equal(context.starts.at(-1).offset, 33);
  assert.equal(mobile.playing, true); assert.equal(mobile.busy, '');
  context.state = 'interrupted'; context.resume = async () => { throw new Error('Audio device unavailable'); };
  await mobile.library.seek(44);
  assert.equal(mobile.playing, false); assert.equal(mobile.busy, '');
  assert.equal(mobile.engine.getContext(), null); assert.equal(mobile.engine.getBuffer(0), buffer);
  assert.match(mobile.message, /Audio device unavailable/);
});

test('mobile pause or a superseding load cancels preparation without stale playback, error or busy updates', async t => {
  const mobile = mobileFixture(t), context = mobile.contexts[0];
  await mobile.library.load('song', false, 11);
  context.state = 'suspended'; let finish;
  context.resume = () => new Promise(resolve => { finish = resolve; });
  const pending = mobile.library.load('song', true, 11);
  mobile.library.pause(); assert.equal(await pending, false);
  assert.equal(mobile.busy, ''); assert.equal(mobile.playing, false); assert.equal(mobile.message, '');
  context.state = 'running'; finish(); await flush(); assert.equal(context.starts.length, 0);
  context.state = 'suspended';
  const older = mobile.library.load('song', true, 11);
  context.state = 'running'; const newer = mobile.library.load('song', true, 22);
  assert.equal(await older, false); assert.equal(await newer, true);
  finish(); await flush(); assert.equal(context.starts.length, 1); assert.equal(context.starts[0].offset, 22);
  assert.equal(mobile.busy, ''); assert.equal(mobile.playing, true);
});

test('a failed audio source start after a playing seek becomes paused at the requested position and records a retryable fault', async t => {
  const mobile=mobileFixture(t),context=mobile.contexts[0];
  await mobile.library.load('song',true,11);
  context.createBufferSource=()=>({connect(){},disconnect(){},start(){throw new Error('Device start failed');},stop(){}});
  await mobile.library.seek(25);
  assert.equal(mobile.engine.isPlaying,false);assert.equal(mobile.playing,false);assert.equal(mobile.busy,'');
  assert.equal(mobile.engine.getTimelineTime(),25);
  assert.equal(mobile.library.playbackDiagnostics.read().issue,'resume_failed');
});

test('mobile source and decode failures expose different actions without recording raw error messages', async t => {
  const mobile=mobileFixture(t),context=mobile.contexts[0];
  mobile.library.platform.audioFiles.get=async()=>null;
  assert.equal(await mobile.library.load('song',true,0),false);
  assert.equal(mobile.library.playbackDiagnostics.read().issue,'missing_file');
  mobile.library.platform.audioFiles.get=async()=>({});context.decodeAudioData=async()=>{throw new Error('private filename.wav');};
  assert.equal(await mobile.library.load('song',true,0),false);
  assert.equal(mobile.library.playbackDiagnostics.read().issue,'decode_failed');
  assert.doesNotMatch(mobile.library.playbackDiagnostics.report('1.0',context,true),/private|filename|song/);
});
