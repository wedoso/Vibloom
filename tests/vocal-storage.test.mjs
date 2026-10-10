import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './load-ts.mjs';
const { VocalAnalysisStore, compactVocalAnalysis, withVocalStorage } = await loadTs('../src/audio/vocals/analysisStore.ts');
const { isCurrentVocalAnalysis, isVocalAnalysisReady, comparisonsOf, clearVocalReference } = await loadTs('../src/domain/library.ts');
const { buildVocalCurves, sampleVocalCurves } = await loadTs('../src/audio/vocals/articulation.ts');
const data = (frames = 12000) => ({ version: 4, rms: Array.from({ length: frames }, (_, i) => i % 19 === 0 ? 0 : Math.sin(i) ** 2 * .3), vowels: Array.from({ length: frames * 5 }, (_, i) => i % 256) });
const memory = () => {
  const records = new Map(); let reads = 0;
  return { records, get reads() { return reads; }, async get(key) { reads++; return records.get(key); }, async put(key, value) { records.set(key, value); }, async remove(key) { records.delete(key); } };
};
const flush = () => new Promise(resolve => setImmediate(resolve));

test('compact v4 retains exact RMS decimals, byte weights and every sampled mouth pose', () => {
  const original = data(), compact = compactVocalAnalysis(original);
  assert.deepEqual(Array.from(compact.rms), original.rms);
  assert.deepEqual(Array.from(compact.vowels), original.vowels);
  assert.equal(compact.rms.byteLength + compact.vowels.byteLength, 156000);
  const curves = value => buildVocalCurves(Float32Array.from(value.rms), Uint8Array.from(value.vowels));
  const before = curves(original), after = curves(compact);
  assert.deepEqual(after, before);
  for (let time = 0; time < 240; time += .0173) assert.deepEqual(sampleVocalCurves(after, time, .3), sampleVocalCurves(before, time, .3));
});

test('curve validity scans once per immutable identity and still checks duration/shape on every call', () => {
  let scans = 0;
  const value = data(2);
  value.rms = new Proxy(value.rms, { get(target, key) { if (key === 'every') scans++; return Reflect.get(target, key); } });
  for (let i = 0; i < 1000; i++) assert.ok(isCurrentVocalAnalysis(value, .04));
  assert.equal(scans, 1);
  assert.equal(isCurrentVocalAnalysis(value, .06), false);
  assert.ok(isCurrentVocalAnalysis(value, .04));
  for (const broken of [{ version: 4, rms: undefined }, { version: 4, rms: [NaN], vowels: [1,2,3,4,5] }, { version: 4, frames: 2, cacheKey: '' }]) assert.equal(isVocalAnalysisReady(broken, .04), false);
});

test('library writes retain no resident curves; reads deduplicate, evict by bytes and release stale completions', async () => {
  const backend = memory(), store = new VocalAnalysisStore(backend, 26);
  const references = [];
  for (let i = 0; i < 10; i++) references.push(await store.put(data(2)));
  assert.equal(store.residentBytes, 0);
  const [a,b] = await Promise.all([store.get(references[0]), store.get(references[0])]);
  assert.equal(a,b); assert.equal(backend.reads,1); assert.equal(store.residentBytes,26);
  await store.get(references[1]); assert.equal(store.residentBytes,26);
  await store.get(references[0]); assert.equal(backend.reads,3);
  const pending = store.get(references[2]); store.release();
  assert.equal(await pending,null); assert.equal(store.residentBytes,0);
  await store.get(references[2]); assert.equal(store.residentBytes,26);
  await store.remove(references[2].cacheKey); assert.equal(store.residentBytes,0);
  assert.equal(await store.get(references[2]),null);
  const removedRead = store.get(references[3]); await store.remove(references[3].cacheKey);
  assert.equal(await removedRead,null); assert.equal(store.residentBytes,0);
});

test('reset during a durable curve write removes the late record rather than publishing a dangling reference', async () => {
  const backend = memory(); let finish;
  const store = new VocalAnalysisStore({ ...backend, put: async (key,value) => { await new Promise(resolve => { finish = resolve; }); backend.records.set(key,value); } });
  const result = store.put(data(2)); store.release(); finish();
  await assert.rejects(result,{ name:'AbortError' }); assert.equal(backend.records.size,0);
});

test('legacy originals and comparison curves migrate to independent records, survive restart, and session saves write no curves', async () => {
  const backend = memory(), store = new VocalAnalysisStore(backend);
  const legacy = data(2), old = { version:3, rms:[.1], visemes:[2] };
  let snapshot = { version:2, tracks:[{ id:'song', fingerprint:'file', duration:.04, vocalAnalysis:legacy, comparison:{ name:'B', duration:.04, vocalAnalysis:legacy } }, { id:'old', vocalAnalysis:old }], session:{} }, saves=0, sessions=0;
  const base = { async load(){return snapshot;}, async save(value){snapshot=value;saves++;}, async saveSession(){sessions++;}, async reset(){snapshot=null;backend.records.clear();} };
  const repo = withVocalStorage(base,store), loaded = await repo.load();
  assert.equal(saves,1); assert.equal(backend.records.size,2); assert.equal(store.residentBytes,0);
  assert.ok(isVocalAnalysisReady(loaded.tracks[0].vocalAnalysis,.04));
  assert.equal('rms' in loaded.tracks[0].vocalAnalysis,false);
  const original = await store.get(loaded.tracks[0].vocalAnalysis), comparison = await store.get(comparisonsOf(loaded.tracks[0])[0].vocalAnalysis);
  assert.deepEqual(Array.from(original.rms),legacy.rms); assert.deepEqual(original,comparison);
  assert.deepEqual(loaded.tracks[1].vocalAnalysis,old);
  await repo.saveSession({}); assert.equal(sessions,1); assert.equal(backend.records.size,2);
  await repo.load(); assert.equal(backend.records.size,2); assert.equal(saves,1);
  await repo.reset(); assert.equal(await repo.load(),null); assert.equal(store.residentBytes,0);
});

test('storage and metadata failures keep legacy data readable; missing or mismatched curve records are rejected', async () => {
  const legacy = { version:3, tracks:[{id:'song', vocalAnalysis:data(2)}], session:{} };
  const backend = memory(), store = new VocalAnalysisStore({ ...backend, put:async()=>{throw new Error('Quota');} });
  const repo = withVocalStorage({async load(){return legacy;},async save(){throw new Error('Quota');},async reset(){}},store);
  assert.deepEqual((await repo.load()).tracks[0].vocalAnalysis,legacy.tracks[0].vocalAnalysis);
  const available = new VocalAnalysisStore(backend), reference = await available.put(data(2));
  assert.equal(await available.get({...reference,frames:3}),null);
  assert.equal(await available.get({...reference,cacheKey:'missing'}),null);
  const failedCommit = withVocalStorage({async load(){return legacy;},async save(){throw new Error('Commit failed');},async reset(){}},available);
  assert.ok(isVocalAnalysisReady((await failedCommit.load()).tracks[0].vocalAnalysis));
  assert.ok(isCurrentVocalAnalysis(legacy.tracks[0].vocalAnalysis),'old durable snapshot was not mutated');
});

test('missing curve recovery clears only the affected reference and preserves tracks, comparison identities and legacy data', () => {
  const missing={version:4,frames:2,cacheKey:'missing'}, valid={version:4,frames:2,cacheKey:'valid'};
  const tracks=[{id:'A',vocalAnalysis:missing,comparisons:[{id:'B',slot:1,vocalAnalysis:valid,name:'B.wav'}]}, {id:'C',vocalAnalysis:{version:3,rms:[.1],visemes:[2]}}];
  const cleared=clearVocalReference(tracks,'missing');
  assert.equal(cleared[0].vocalAnalysis,undefined);assert.equal(comparisonsOf(cleared[0])[0].vocalAnalysis,valid);
  assert.equal(cleared[1],tracks[1]);assert.equal(clearVocalReference(cleared,'missing'),cleared);
});

test('cancelling during curve persistence deletes only that result and emits no late ready state', async () => {
  const { VocalJobStore } = await loadTs('../src/audio/vocals/jobStore.ts', source => source.replace(/import \{ analyzeVocals \} from [^;]+;/,'const analyzeVocals=null;'));
  const backend=memory();let finish;
  const storage=new VocalAnalysisStore({...backend,put:async(key,value)=>{await new Promise(resolve=>{finish=resolve;});backend.records.set(key,value);}});
  const jobs=new VocalJobStore(async()=>({rms:Float32Array.of(.1),vowels:Uint8Array.of(1,2,3,4,5)}),storage);
  let saves=0;jobs.prepare('song',{},()=>saves++);await flush();jobs.cancel('song');finish();await flush();
  assert.equal(saves,0);assert.equal(backend.records.size,0);assert.equal(jobs.getSnapshot().song.status,'idle');
  jobs.dispose();
});

test('vocal progress retains backend and completed phases after a brief MotionSync stage', async () => {
  const { VocalJobStore } = await loadTs('../src/audio/vocals/jobStore.ts', source => source.replace(/import \{ analyzeVocals \} from [^;]+;/,'const analyzeVocals=null;'));
  const store = new VocalJobStore(async (_source,_signal,progress) => {
    progress({phase:'Separating vocals · WebGPU',progress:.5});
    progress({phase:'Analyzing mouth shapes · MotionSync',progress:.99});
    return {rms:Float32Array.of(.2),vowels:Uint8Array.of(100,40,20,10,5)};
  });
  store.prepare('song',{},()=>{});await flush();
  const job=store.getSnapshot().song;
  assert.equal(job.status,'ready');assert.equal(job.progress,1);assert.equal(job.backend,'WebGPU');
  assert.ok(job.phases.includes('Analyzing mouth shapes · MotionSync'));
  assert.equal(job.phases.at(-1),'Vocals ready');
  await flush();assert.equal(store.getSnapshot().song,job,'completion does not disappear after task cleanup');
  store.cancel('song');assert.equal(store.getSnapshot().song.backend,undefined);
  store.dispose();
});
