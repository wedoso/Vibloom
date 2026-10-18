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
function hookFixture(t) {
  const originals = new Map(['navigator', 'MediaMetadata', 'document', 'window', 'Audio'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const page = new EventTarget(), events = new EventTarget(); page.visibilityState = 'visible';
  events.setInterval = (...args) => setInterval(...args); events.clearInterval = value => clearInterval(value);
  const positionWrites = [], metadataWrites = [], requests = [];
  const session = { metadata: null, playbackState: 'none', setActionHandler() {}, setPositionState: value => positionWrites.push(value) };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaSession: session } });
  globalThis.document = page; globalThis.window = events;
  globalThis.MediaMetadata = class { constructor(details) { Object.assign(this, details); this.artwork ??= []; metadataWrites.push(this); } };
  globalThis.Audio = class extends EventTarget { paused = true; async play() { this.paused = false; } pause() { this.paused = true; } removeAttribute() {} load() {} };
  const f = globalThis.__mediaPublishingFixture = {
    refs: [], effects: [], pending: [], cursor: 0,
    prepare: (src, signal) => new Promise((resolve, reject) => requests.push({ src, signal, resolve, reject })),
  };
  let time = 0;
  const controls = { getTime: () => time, play() {}, pause() {}, next() {}, previous() {}, seek() {}, onError() {} };
  t.after(() => { for (const effect of f.effects) effect?.cleanup?.(); for (const [name, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  return { session, requests, metadataWrites, positionWrites, events, setTime(value) { time = value; }, render(state, position = 0) { time = position; f.cursor = 0; useMediaSession({ enabled: true, position, ...snapshot, ...state }, controls); for (const effect of f.pending.splice(0)) effect(); } };
}

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
