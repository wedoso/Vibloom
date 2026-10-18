import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './load-ts.mjs';
const { parseLyricsFile, serializeLrc, serializeTxt } = await loadTs('../src/lrc.ts');

test('TXT exports LRC text without timing or metadata, retaining translations, repeated verses and blank cues', () => {
  const source = '[ti:Song]\n[ar:Artist]\n[offset:250]\n[00:01.123]原文\n[00:01.123]Translation\n[00:03.00][00:05.00]Refrain\n[00:07.00]\n';
  const parsed = parseLyricsFile(source, 'song.lrc');
  const before = JSON.stringify(parsed);
  assert.equal(serializeTxt(parsed.lyrics), '原文\nTranslation\nRefrain\nRefrain\n\n');
  assert.equal(JSON.stringify(parsed), before, 'export does not change the stored lyrics or timing');
  const lrc = serializeLrc(parsed.lyrics, parsed.lyricMetadata);
  assert.match(lrc, /^\[ti:Song\]\n\[ar:Artist\]\n\[00:01.373\]原文\n\[00:01.373\]Translation/);
  assert.match(lrc, /\[00:07.25\]\n$/);
});

test('TXT exports untimed and partially timed drafts without requiring valid LRC timestamps', () => {
  const lines = [{ text: '第一行', time: null }, { text: 'Second\nTranslation', time: 2 }, { text: '', time: null }];
  assert.equal(serializeTxt(lines), '第一行\nSecond\nTranslation\n\n');
  assert.throws(() => serializeLrc(lines), /Timestamp every line/);
  assert.equal(serializeTxt([]), '');
});

test('TXT preserves lyric punctuation and timestamp-looking literal text', () => {
  assert.equal(serializeTxt([{ text: '[Chorus] 演唱：歌手 🎵' }, { text: 'Meet at 01:23 [tonight]' }]), '[Chorus] 演唱：歌手 🎵\nMeet at 01:23 [tonight]\n');
});
