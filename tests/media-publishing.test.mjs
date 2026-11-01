import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './load-ts.mjs';
const { createMediaPositionPublisher } = await loadTs('../src/platform/mediaPositionPublisher.ts');
const { prepareMediaArtwork, MEDIA_ARTWORK_TIMEOUT_MS } = await loadTs('../src/platform/mediaArtwork.ts');
const { bindMediaSessionLyrics } = await loadTs('../src/platform/mediaSessionLyrics.ts');
const flush = () => new Promise(resolve => setImmediate(resolve));
const snapshot = { trackId: 'A', title: 'Song', album: 'Album', duration: 120, isPlaying: true, positionRevision: 0 };
const jpeg = { src: 'data:image/jpeg;base64,AA==', type: 'image/jpeg', sizes: '512x512' };

function positionFixture() {
  let at = 0, time = 0, playbackState = 'none', stateWrites = 0;
  const writes = [], session = { get playbackState() { return playbackState; }, set playbackState(value) { playbackState = value; stateWrites++; }, setPositionState: value => writes.push(value) };
  const publisher = createMediaPositionPublisher(session, () => time, () => at);
  return { publisher, writes, session, get stateWrites() { return stateWrites; }, set(atMs, position) { at = atMs; time = position; } };
}

test('10 Hz UI updates publish position at 1 Hz and do not repeatedly set playbackState', () => {
  const f = positionFixture();
  f.publisher.update(snapshot);
  for (let i = 1; i <= 30; i++) { f.set(i * 100, i / 10); f.publisher.update(snapshot); }
  assert.deepEqual(f.writes.map(item => item.position), [0, 1, 2, 3]); assert.equal(f.stateWrites, 1);
});

test('system lyrics retain the original 10 Hz system-publishing cadence', () => {
  const f = positionFixture(), state = { ...snapshot, systemLyricsActive: true };
  f.publisher.update(state);
  for (let i = 1; i <= 10; i++) { f.set(i * 100, i / 10); f.publisher.update(state); }
  assert.deepEqual(f.writes.map(item => item.position), Array.from({ length: 11 }, (_, index) => index / 10));
  assert.equal(f.stateWrites, 1, 'frequent position writes do not toggle playback state');
});

test('small seeks, pause/resume, identical-title track changes, duration changes and backwards jumps publish immediately', () => {
  const f = positionFixture(); f.publisher.update(snapshot); f.set(100, .12);
  f.publisher.update({ ...snapshot, positionRevision: 1 }); assert.equal(f.writes.at(-1).position, .12);
  f.publisher.update({ ...snapshot, isPlaying: false }); assert.equal(f.session.playbackState, 'paused');
  const count = f.writes.length;
  for (let i = 0; i < 10; i++) f.publisher.update({ ...snapshot, isPlaying: false });
  assert.equal(f.writes.length, count);
  f.set(120, .13); f.publisher.update({ ...snapshot, isPlaying: false }); assert.equal(f.writes.length, count + 1);
  f.publisher.update(snapshot);
  f.publisher.update({ ...snapshot, trackId: 'B' }); assert.equal(f.writes.length, count + 3);
  f.publisher.update({ ...snapshot, trackId: 'B', duration: 100 }); assert.equal(f.writes.at(-1).duration, 100);
  f.set(200, 15); f.publisher.update(snapshot); f.set(210, 2); f.publisher.update(snapshot);
  assert.equal(f.writes.at(-1).position, 2);
});

test('background lyric changes publish the real clock once without replacing metadata or its artwork', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = positionFixture(), metadata = { title: 'Song', artist: 'Vibloom', artwork: [jpeg] }, cover = metadata.artwork;
  f.publisher.update(snapshot); f.set(200, 2);
  const binding = bindMediaSessionLyrics(metadata, [{ time: 2, text: 'Line' }], () => 2, 120, true, new EventTarget(), () => f.publisher.update(snapshot, true));
  t.after(() => binding.dispose());
  assert.equal(metadata.artist, 'Line'); assert.equal(f.writes.at(-1).position, 2);
  const count = f.writes.length; binding.refresh(); binding.refresh();
  assert.equal(f.writes.length, count); assert.equal(metadata.artwork, cover);
});

function artworkFixture(t, decode = async () => {}) {
  const originalImage = globalThis.Image, originalDocument = globalThis.document;
  const images = [], draws = [];
  const canvas = { width: 0, height: 0, getContext: () => ({ fillRect() {}, drawImage: (...args) => draws.push(args) }), toDataURL: (type, quality) => { assert.equal(type, 'image/jpeg'); assert.equal(quality, .82); return jpeg.src; } };
  globalThis.Image = class {
    naturalWidth = 4000; naturalHeight = 2000;
    constructor() { images.push(this); }
    decode() { return decode(this); }
    removeAttribute() { this.src = ''; }
  };
  globalThis.document = { createElement: type => { assert.equal(type, 'canvas'); return canvas; } };
  t.after(() => { globalThis.Image = originalImage; globalThis.document = originalDocument; });
  return { images, draws, canvas };
}

test('large rectangular originals produce a decoded 512-square JPEG with correct MIME and contained image', async t => {
  const f = artworkFixture(t);
  assert.deepEqual(await prepareMediaArtwork('data:image/png;base64,ORIGINAL', new AbortController().signal), jpeg);
  assert.equal(f.canvas.width, 512); assert.equal(f.canvas.height, 512);
  assert.deepEqual(f.draws[0].slice(1), [0, 128, 512, 256]);
  assert.equal(f.images.length, 2, 'verify the generated JPEG before publication');
  assert.ok(f.images.every(image => image.src === ''), 'release decode resources');
});

test('hung/cancelled/invalid artwork never publishes and a later valid cover can be prepared', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let mode = 'hung';
  const f = artworkFixture(t, async image => { if (mode === 'hung') return new Promise(() => {}); if (mode === 'invalid') throw new Error('Unsupported image'); image.naturalWidth = image.naturalHeight = 512; });
  const pending = assert.rejects(prepareMediaArtwork('large', new AbortController().signal), /timed out/);
  t.mock.timers.tick(MEDIA_ARTWORK_TIMEOUT_MS); await pending;
  const controller = new AbortController(), cancelled = assert.rejects(prepareMediaArtwork('cancelled', controller.signal), { name: 'AbortError' });
  controller.abort(); await cancelled;
  mode = 'invalid'; await assert.rejects(prepareMediaArtwork('bad', new AbortController().signal), /Unsupported/);
  assert.equal(f.draws.length, 0);
  mode = 'valid'; assert.deepEqual(await prepareMediaArtwork('good', new AbortController().signal), jpeg);
});

globalThis.__mediaPublishingHooks = {
  useRef: initial => { const f = globalThis.__mediaPublishingFixture, index = f.cursor++; return f.refs[index] ??= { current: initial }; },
  useEffect: (setup, deps) => {
    const f = globalThis.__mediaPublishingFixture, index = f.cursor++, old = f.effects[index];
    if (!deps || !old || deps.some((value, i) => !Object.is(value, old.deps[i]))) f.pending.push(() => { old?.cleanup?.(); f.effects[index] = { deps, cleanup: setup() }; });
  },
};
const { useMediaSession } = await loadTs('../src/platform/useMediaSession.ts', source => source
  .replace(/^import .* from "react";$/m, 'const { useRef, useEffect } = globalThis.__mediaPublishingHooks;')
  .replace(/^import .* from "\.\/mediaArtwork";$/m, 'const prepareMediaArtwork = (src, signal) => globalThis.__mediaPublishingFixture.prepare(src, signal);')
);
function hookFixture(t, userAgent = 'Mozilla/5.0 AppleWebKit/537.36 Chrome/140.0 Safari/537.36', rejectCarrier = false) {
  const originals = new Map(['navigator', 'MediaMetadata', 'document', 'window', 'Audio'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const page = new EventTarget(), events = new EventTarget(); page.visibilityState = 'visible';
  events.setInterval = (...args) => setInterval(...args); events.clearInterval = value => clearInterval(value);
  const positionWrites = [], metadataWrites = [], requests = [], handlers = new Map();
  const session = { metadata: null, playbackState: 'none', setActionHandler: (action, handler) => handlers.set(action, handler), setPositionState: value => positionWrites.push(value) };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaSession: session, userAgent, audioSession: { type: 'playback' } } });
  globalThis.document = page; globalThis.window = events;
  // These hooks verify calls into the browser API, not iOS Now Playing delivery.
  globalThis.MediaMetadata = class { constructor(details) { Object.assign(this, details); this.artwork ??= []; metadataWrites.push(this); } };
  const audios = [];
  globalThis.Audio = class extends EventTarget { constructor(...args) { super(); this.args = args; audios.push(this); } paused = true; playCalls = 0; loadCalls = 0; removed = false; async play() { this.playCalls++; if (rejectCarrier) throw new DOMException('Media output denied', 'NotAllowedError'); this.paused = false; } pause() { this.paused = true; } removeAttribute() {} load() { this.loadCalls++; } remove() { this.removed = true; } };
  const f = globalThis.__mediaPublishingFixture = {
    refs: [], effects: [], pending: [], cursor: 0,
    prepare: (src, signal) => new Promise((resolve, reject) => requests.push({ src, signal, resolve, reject })),
  };
  let time = 0, advancing = true, errors = 0;
  const controls = { getTime: () => time, isAdvancing: () => advancing, play() {}, pause() {}, next() {}, previous() {}, seek() {}, onError() { errors++; } };
  t.after(() => { for (const effect of f.effects) effect?.cleanup?.(); for (const [name, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  return { session, requests, metadataWrites, positionWrites, events, audios, handlers, controls, get errors() { return errors; }, setAdvancing(value) { advancing = value; }, setTime(value) { time = value; }, render(state, position = 0) { time = position; f.cursor = 0; useMediaSession({ enabled: true, position, ...snapshot, ...state }, controls); for (const effect of f.pending.splice(0)) effect(); } };
}

test('WebKit uses an empty metadata observer that never starts a competing audio route or ten-second timeline', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const f = hookFixture(t, 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148', true);
  f.render({ duration: 180 }, 35);
  await flush(); assert.equal(f.errors, 0, 'a rejected auxiliary HTML play cannot falsely report a system control failure');
  assert.equal(f.audios.length, 1);
  const observer = f.audios[0];
  assert.deepEqual(observer.args, []); assert.equal(observer.preload, 'none');
  assert.equal(observer.playCalls, 0); assert.equal(observer.loadCalls, 0); assert.equal(observer.paused, true);
  assert.equal(f.positionWrites.at(-1).duration, 180); assert.equal(f.positionWrites.at(-1).position, 35);
  f.setTime(45); t.mock.timers.tick(10000);
  assert.equal(f.positionWrites.at(-1).position, 45, 'system progress follows music beyond the former carrier loop');
  f.render({ isPlaying: false, duration: 180 }, 45);
  assert.equal(f.session.playbackState, 'paused'); assert.equal(f.audios.length, 1);
  assert.equal(observer.playCalls, 0);
  f.render({ enabled: false, isPlaying: false }, 45);
  assert.equal(observer.removed, true);
});

test('a rejected silent carrier reproduces the system-control failure while the music position is already advancing', async t => {
  const f = hookFixture(t, 'Mozilla/5.0 AppleWebKit/537.36 Chrome/140.0 Safari/537.36', true);
  f.render({}, 35); await flush();
  assert.equal(f.audios.length, 1); assert.equal(f.errors, 1);
  assert.equal(f.session.playbackState, 'playing'); assert.equal(f.positionWrites.at(-1).position, 35);
});

test('system lyric boundaries push their position without playing a silent carrier or replacing metadata', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const f = hookFixture(t, 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148', true);
  const lyrics = [{ time: 0, text: 'Beginning' }, { time: 1, text: 'Line one' }, { time: 1.2, text: 'Line two' }];
  f.render({ lyrics });
  const metadata = f.session.metadata;
  f.setTime(1); t.mock.timers.tick(100);
  assert.equal(metadata.artist, 'Line one'); assert.equal(f.positionWrites.at(-1).position, 1);
  f.setTime(1.2); t.mock.timers.tick(100);
  assert.equal(metadata.artist, 'Line two'); assert.equal(f.positionWrites.at(-1).position, 1.2);
  assert.equal(f.session.metadata, metadata);
  assert.equal(f.audios[0].playCalls, 0); assert.equal(f.audios[0].loadCalls, 0);
  assert.deepEqual(f.audios[0].args, []);
});

test('system playback holds during wireless output startup and resumes from the heard clock without a React render', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const f = hookFixture(t);
  f.setAdvancing(false); f.render({}, 20);
  assert.equal(f.session.playbackState, 'paused'); assert.equal(f.positionWrites.at(-1).position, 20);
  const count = f.positionWrites.length;
  t.mock.timers.tick(2000); assert.equal(f.positionWrites.length, count, 'do not publish a fictional advancing position');
  f.setAdvancing(true); f.setTime(20.5); t.mock.timers.tick(1000);
  assert.equal(f.session.playbackState, 'playing'); assert.equal(f.positionWrites.at(-1).position, 20.5);
  f.setAdvancing(false); t.mock.timers.tick(1000);
  assert.equal(f.session.playbackState, 'paused', 'an interrupted output does not keep declaring playback');
});

test('late old cover cannot replace a new song; successful artwork preserves the current lyric and is reused within an album', async t => {
  const f = hookFixture(t), lyrics = [{ time: 0, text: 'First' }, { time: 2, text: 'Second' }];
  f.render({ artwork: 'cover-A', lyrics }); const old = f.session.metadata;
  f.render({ trackId: 'B', title: 'Other', artwork: 'cover-B', lyrics }, 2);
  assert.equal(f.requests[0].signal.aborted, true);
  f.requests[0].resolve({ ...jpeg, src: 'old' }); await flush(); assert.deepEqual(f.session.metadata.artwork, []);
  f.requests[1].resolve(jpeg); await flush();
  const metadata = f.session.metadata;
  assert.notEqual(metadata, old); assert.equal(metadata.artist, 'Second'); assert.deepEqual(metadata.artwork, [jpeg]);
  f.render({ trackId: 'B', title: 'Other', artwork: 'cover-B', lyrics }, 2.1);
  assert.equal(f.session.metadata, metadata); assert.equal(f.requests.length, 2);
  f.render({ trackId: 'C', title: 'Third', artwork: 'cover-B', lyrics }, 3);
  assert.deepEqual(f.session.metadata.artwork, [jpeg]); assert.equal(f.requests.length, 2, 'same album does not decode again');
  f.render({ trackId: 'C', title: 'Third', artwork: 'cover-B', lyrics: undefined }, 3);
  assert.equal(f.session.metadata.artist, 'Vibloom', 'removing lyrics clears the old artist without touching artwork');
  assert.deepEqual(f.session.metadata.artwork, [jpeg]);
});

test('hook polls the true audio clock in background, forces tiny seeks and disposes timers and stale artwork work', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const f = hookFixture(t);
  f.render({ artwork: 'cover' }); const first = f.session.metadata;
  f.render({ artwork: 'cover', positionRevision: 1 }, .01);
  assert.equal(f.positionWrites.at(-1).position, .01); assert.equal(f.session.metadata, first);
  f.render({ artwork: 'cover', positionRevision: 1 }, .02);
  const count = f.positionWrites.length;
  f.setTime(1.02); t.mock.timers.tick(1000);
  assert.equal(f.positionWrites.length, count + 1); assert.equal(f.positionWrites.at(-1).position, 1.02, 'timer reads audio clock without React rendering');
  f.events.dispatchEvent(new Event('pageshow')); assert.equal(f.positionWrites.length, count + 2);
  f.render({ enabled: false, artwork: 'cover' }, .02);
  const cleared = f.positionWrites.length;
  assert.equal(f.requests[0].signal.aborted, true);
  t.mock.timers.tick(5000); f.requests[0].resolve(jpeg); await flush();
  assert.equal(f.positionWrites.length, cleared); assert.equal(f.session.metadata, null);
});

test('artwork failure keeps playback and lyrics usable and never publishes the original upload', async t => {
  const f = hookFixture(t), lyrics = [{ time: 0, text: 'Still playing' }];
  f.render({ artwork: 'large-original', lyrics });
  const metadata = f.session.metadata;
  f.requests[0].reject(new Error('Unsupported image')); await flush();
  assert.equal(f.session.playbackState, 'playing'); assert.equal(f.session.metadata, metadata);
  assert.equal(metadata.artist, 'Still playing'); assert.deepEqual(metadata.artwork, []);
  f.render({ artwork: 'next-cover', lyrics });
  f.requests[1].resolve(jpeg); await flush(); assert.deepEqual(f.session.metadata.artwork, [jpeg]);
});

test('turning system lyrics off immediately clears only artist, stops lyric timers, and re-enabling catches up', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const f=hookFixture(t),lyrics=[{time:0,text:'First'},{time:2,text:'Second'}];
  f.render({artwork:'cover',lyrics});f.requests[0].resolve(jpeg);await flush();
  const metadata=f.session.metadata,artwork=metadata.artwork;
  f.render({artwork:'cover',lyrics,systemLyricsEnabled:false},.1);
  assert.equal(f.session.metadata,metadata);assert.equal(metadata.artist,'Vibloom');assert.equal(metadata.artwork,artwork);
  assert.equal(f.session.playbackState,'playing');
  f.setTime(3);t.mock.timers.tick(3000);assert.equal(metadata.artist,'Vibloom');
  f.render({artwork:'cover',lyrics,systemLyricsEnabled:true},3);
  assert.equal(f.session.metadata,metadata);assert.equal(metadata.artist,'Second');assert.equal(metadata.artwork,artwork);
});

test('rapid background lyrics immediately publish their position and preserve metadata and cover', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 0 });
  t.mock.method(performance, 'now', () => Date.now());
  const f = hookFixture(t), lyrics = Array.from({ length: 8 }, (_, index) => ({ time: 1 + index * .06, text: `Rapid ${index}` }));
  f.render({ artwork: 'cover', lyrics });
  f.requests[0].resolve(jpeg); await flush();
  const metadata = f.session.metadata, cover = metadata.artwork, writes = [];
  let artist = metadata.artist;
  Object.defineProperty(metadata, 'artist', { get: () => artist, set(value) { artist = value; writes.push(value); } });
  const before = f.positionWrites.length;
  // No renders after setup: the same path is used while the page is hidden.
  for (let ms = 0; ms < 1600; ms += 5) { f.setTime((ms + 5) / 1000); t.mock.timers.tick(5); }
  assert.deepEqual(writes, lyrics.map(line => line.text));
  assert.ok(f.positionWrites.length - before >= lyrics.length, 'lyric changes must not wait behind progress throttling');
  assert.equal(f.session.metadata, metadata);
  assert.equal(metadata.artwork, cover);
  assert.equal(f.session.playbackState, 'playing');
});

test('hidden system-lyric playback publishes at 10 Hz without a React render, then returns to 1 Hz when disabled', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 0 });
  t.mock.method(performance, 'now', () => Date.now());
  const f = hookFixture(t), lyrics = [{ time: 0, text: 'Long lyric' }, { time: 30, text: 'Later' }];
  globalThis.document.visibilityState = 'hidden';
  f.render({ lyrics });
  const metadata = f.session.metadata, before = f.positionWrites.length;
  for (let i = 1; i <= 10; i++) { f.setTime(i / 10); t.mock.timers.tick(100); }
  assert.equal(f.positionWrites.length - before, 10, 'native publishing keeps the v1.13 cadence when visual updates are suspended');
  assert.equal(f.session.metadata, metadata);
  f.render({ lyrics, systemLyricsEnabled: false }, 1);
  const disabled = f.positionWrites.length;
  for (let i = 1; i <= 10; i++) { f.setTime(1 + i / 10); t.mock.timers.tick(100); }
  assert.equal(f.positionWrites.length - disabled, 1);
  assert.equal(f.session.metadata, metadata);
  assert.equal(metadata.artist, 'Vibloom');
});

test('a lyric boundary immediately wakes system position publication inside the heartbeat interval', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 0 });
  t.mock.method(performance, 'now', () => Date.now());
  const f = hookFixture(t), lyrics = [{ time: 0, text: 'First' }, { time: .08, text: 'Second' }];
  f.render({ lyrics });
  const metadata = f.session.metadata, before = f.positionWrites.length;
  f.setTime(.08); t.mock.timers.tick(50);
  assert.equal(metadata.artist, 'Second');
  assert.equal(f.positionWrites.length, before + 1);
  assert.equal(f.positionWrites.at(-1).position, .08, 'artist assignment alone is not sufficient for this regression');
  assert.equal(f.session.metadata, metadata);
});

test('the background heartbeat catches up lyrics when the boundary callback has not run', t => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 0 });
  t.mock.method(performance, 'now', () => Date.now());
  // Leave the lyric timeout pending: only the independent heartbeat runs.
  t.mock.method(globalThis, 'setTimeout', () => 0);
  const f = hookFixture(t), lyrics = [{ time: 0, text: 'First' }, { time: 1, text: 'Missed' }, { time: 2, text: 'Current' }];
  f.render({ lyrics });
  const metadata = f.session.metadata;
  f.setTime(2.1); const before = f.positionWrites.length;
  t.mock.timers.tick(100);
  assert.equal(metadata.artist, 'Current', 'publish the heard line instead of replaying missed lines');
  assert.equal(f.positionWrites.at(-1).position, 2.1);
  assert.equal(f.positionWrites.length, before + 1, 'the lyric and heartbeat share one progress publication');
  assert.equal(f.session.metadata, metadata);
});

test('a seek revision refreshes lyrics even when the visual position has not changed', t => {
  const f = hookFixture(t), lyrics = [{ time: 0, text: 'First' }, { time: 2, text: 'After seek' }];
  f.render({ lyrics, isPlaying: false });
  const metadata = f.session.metadata;
  f.render({ lyrics, isPlaying: false, positionRevision: 1, position: 0 }, 2.1);
  assert.equal(metadata.artist, 'After seek');
  assert.equal(f.session.metadata, metadata);
  assert.equal(f.positionWrites.at(-1).position, 2.1);
});

test('completed system seeks publish lyrics and position without a React render, including small paused seeks', async t => {
  const f = hookFixture(t), lyrics = [{ time: 0, text: 'First' }, { time: 2, text: 'After seek' }];
  f.render({ lyrics, isPlaying: false });
  const metadata = f.session.metadata;
  let complete;
  f.controls.seek = target => new Promise(resolve => { complete = () => { f.setTime(target); resolve(); }; });
  const before = f.positionWrites.length;
  f.handlers.get('seekto')({ seekTime: 2.1 });
  assert.equal(metadata.artist, 'First', 'do not publish the target before the audio seek completes');
  complete(); await flush();
  assert.equal(metadata.artist, 'After seek');
  assert.equal(f.positionWrites.at(-1).position, 2.1);
  assert.equal(f.positionWrites.length, before + 1, 'one publication for the changed lyric and completed seek');
  f.handlers.get('seekto')({ seekTime: 2.102 }); complete(); await flush();
  assert.equal(f.positionWrites.at(-1).position, 2.102, 'an explicit tiny seek bypasses the paused-position threshold');
  assert.equal(f.session.metadata, metadata);
  assert.equal(f.errors, 0);
});

test('a completed system seek cannot republish after the media session is disabled', async t => {
  const f = hookFixture(t), lyrics = [{ time: 0, text: 'First' }];
  f.render({ lyrics, isPlaying: false });
  let complete;
  f.controls.seek = () => new Promise(resolve => { complete = resolve; });
  f.handlers.get('seekto')({ seekTime: 2 });
  f.render({ enabled: false, lyrics, isPlaying: false });
  const before = f.positionWrites.length;
  complete(); await flush();
  assert.equal(f.positionWrites.length, before);
  assert.equal(f.session.metadata, null);
});
