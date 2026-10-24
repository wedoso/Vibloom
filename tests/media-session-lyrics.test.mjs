import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../src/platform/mediaSessionLyrics.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { mediaLyricArtist, bindMediaSessionLyrics } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const lines = [{ time: 2, text: ' 第一行歌词 ' }, { time: 5, text: 'Second line' }, { time: 8, text: '' }, { time: 10, text: 'Last line' }];

test('media artist selects the current timed line, clears instrumental gaps/end, and handles seeks', () => {
  for (const [time, artist] of [[0, 'Vibloom'], [1.97, '第一行歌词'], [4, '第一行歌词'], [5.5, 'Second line'], [8, 'Vibloom'], [10, 'Last line'], [12, 'Vibloom'], [-1, 'Vibloom'], [NaN, 'Vibloom']]) {
    assert.equal(mediaLyricArtist(lines, time, 12), artist);
  }
  assert.equal(mediaLyricArtist([], 5, 12), 'Vibloom');
  assert.equal(mediaLyricArtist([{ time: 1, text: 'Earlier' }, { time: 1, text: 'Translation' }], 1, 12), 'Translation', 'same selection as the in-page lyric panel');
});

test('background clock updates only changed artist text, preserves other metadata, and catches up after delayed timers', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const events = new EventTarget(), writes = [];
  let time = 0, artist = 'Vibloom';
  const metadata = { title: 'Real song', album: 'Album', artwork: [{ src: 'cover.png' }], get artist() { return artist; }, set artist(value) { artist = value; writes.push(value); } };
  const updates = bindMediaSessionLyrics(metadata, lines, () => time, 12, true, events);
  t.after(() => updates.dispose());
  assert.deepEqual(writes, []);
  time = 2; t.mock.timers.tick(1000); assert.equal(artist, '第一行歌词');
  updates.refresh(); updates.refresh(); assert.equal(writes.length, 1, 'no redundant platform updates');
  // No React render and no rAF: a delayed timer must jump to the correct line.
  time = 10.5; t.mock.timers.tick(1000); assert.equal(artist, 'Last line');
  time = 5.5; updates.refresh(); assert.equal(artist, 'Second line', 'backwards seek updates immediately');
  time = 8; events.dispatchEvent(new Event('visibilitychange')); assert.equal(artist, 'Vibloom');
  time = 12; t.mock.timers.tick(1000); assert.equal(artist, 'Vibloom');
  assert.equal(metadata.title, 'Real song'); assert.equal(metadata.album, 'Album'); assert.deepEqual(metadata.artwork, [{ src: 'cover.png' }]);
  updates.dispose(); time = 2; t.mock.timers.tick(10000); events.dispatchEvent(new Event('visibilitychange')); updates.refresh();
  assert.equal(artist, 'Vibloom', 'disposed timers/events cannot overwrite a later song');
});

test('paused lyrics stay stable, paused seeks refresh, and removing/switching lyrics clears the previous artist', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const events = new EventTarget(), metadata = { artist: 'Vibloom' };
  let time = 2;
  const paused = bindMediaSessionLyrics(metadata, lines, () => time, 12, false, events);
  assert.equal(metadata.artist, '第一行歌词');
  time = 5.5; t.mock.timers.tick(10000); assert.equal(metadata.artist, '第一行歌词', 'paused mode has no polling');
  paused.refresh(); assert.equal(metadata.artist, 'Second line'); paused.dispose();
  const empty = bindMediaSessionLyrics(metadata, [], () => time, 12, true, events);
  assert.equal(metadata.artist, 'Vibloom'); empty.dispose();
  const next = bindMediaSessionLyrics(metadata, [{ time: 0, text: 'Next song lyric' }], () => 0, 20, false, events);
  assert.equal(metadata.artist, 'Next song lyric'); paused.refresh(); assert.equal(metadata.artist, 'Next song lyric'); next.dispose();
});

test('closely spaced lyric lines are all published without React or animation frames', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const writes = [], fast = Array.from({ length: 8 }, (_, index) => ({ time: 1 + index * .06, text: `Fast ${index}` }));
  let artist = 'Vibloom';
  const metadata = { get artist() { return artist; }, set artist(value) { artist = value; writes.push(value); } };
  const binding = bindMediaSessionLyrics(metadata, fast, () => Date.now() / 1000, 10, true, new EventTarget());
  t.after(() => binding.dispose());
  for (let ms = 0; ms < 1600; ms += 5) t.mock.timers.tick(5);
  assert.deepEqual(writes, fast.map(line => line.text), 'short lines must not be skipped by the minimum timer delay');
});

test('a seek into rapid lyrics re-arms the next boundary instead of waiting for an old intro timer', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const writes = [], fast = Array.from({ length: 5 }, (_, index) => ({ time: 30 + index * .12, text: `After seek ${index}` }));
  let offset = 0, artist = 'Vibloom';
  const metadata = { get artist() { return artist; }, set artist(value) { artist = value; writes.push(value); } };
  const binding = bindMediaSessionLyrics(metadata, fast, () => offset + Date.now() / 1000, 40, true, new EventTarget());
  t.after(() => binding.dispose());
  t.mock.timers.tick(100); offset = 29.9; binding.refresh();
  for (let ms = 0; ms < 600; ms += 5) t.mock.timers.tick(5);
  assert.deepEqual(writes, fast.map(line => line.text), 'a paused visual renderer must not leave lyrics on the pre-seek schedule');
});
