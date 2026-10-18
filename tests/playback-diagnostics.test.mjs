import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './load-ts.mjs';
const { PlaybackDiagnostics, playbackIssueFor, playbackIssueDetails } = await loadTs('../src/platform/playbackDiagnostics.ts');
const { lyricExport } = await loadTs('../src/platform/lyricExport.ts');
const { migrateLibrarySnapshot, EMPTY_SESSION } = await loadTs('../src/domain/library.ts');
test('playback diagnostics distinguish source/read/decode/device errors and retain a bounded private history', () => {
  const diagnostics = new PlaybackDiagnostics();let updates=0;const unsubscribe=diagnostics.subscribe(()=>updates++);
  diagnostics.record('preparing',null,'read');diagnostics.record('preparing',null,'read');assert.equal(updates,1);
  assert.equal(playbackIssueFor(new DOMException('secret song name','TimeoutError'),'resume'),'resume_timeout');
  assert.equal(playbackIssueFor(new Error('/private/song.mp3'),'decode'),'decode_failed');
  assert.equal(playbackIssueFor(new Error('secret lyrics'),'read'),'read_failed');
  diagnostics.record('error','missing_file');assert.equal(playbackIssueDetails(diagnostics.read().issue).action,'reconnect');
  for(let i=0;i<40;i++)diagnostics.record(i%2?'playing':'paused');
  assert.equal(diagnostics.read().events.length,24);
  const report=diagnostics.report('1.0',{state:'interrupted',currentTime:12.345},false);
  assert.equal(JSON.parse(report).audio.time,12.35);assert.doesNotMatch(report,/secret|private|mp3/);
  diagnostics.record('error','resume_failed');diagnostics.record('playing');assert.equal(diagnostics.read().issue,null);
  unsubscribe();const previous=updates;diagnostics.record('paused');assert.equal(updates,previous);
});
test('system lyric preference defaults to existing behavior and survives migration explicitly off', () => {
  const snapshot={version:3,tracks:[],albums:[],session:{...EMPTY_SESSION,systemLyricsEnabled:undefined}};
  assert.equal(migrateLibrarySnapshot(snapshot).session.systemLyricsEnabled,true);
  snapshot.session.systemLyricsEnabled=false;assert.equal(migrateLibrarySnapshot(snapshot).session.systemLyricsEnabled,false);
});
test('direct lyric exports do not load audio or mutate lyrics and refuse untimed LRC', () => {
  const track={name:'Song.mp3',lyricsFileName:'歌词.lrc',lyrics:[{time:1,text:'原文\nTranslation'}],lyricMetadata:['[ti:Song]']};
  const before=JSON.stringify(track);assert.deepEqual(lyricExport(track,'txt'),{text:'原文\nTranslation\n',filename:'歌词.txt'});
  assert.equal(lyricExport(track,'lrc').text,'[ti:Song]\n[00:01.00]原文\n[00:01.00]Translation\n');assert.equal(JSON.stringify(track),before);
  track.lyricTiming=[{time:null,text:'Draft'}];assert.equal(lyricExport(track,'txt').text,'Draft\n');assert.throws(()=>lyricExport(track,'lrc'),/Timestamp/);
});
