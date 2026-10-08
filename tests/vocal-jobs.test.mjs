import assert from 'node:assert/strict';
import test from 'node:test';
import {loadTs} from './load-ts.mjs';
const {VocalJobStore,vocalJobKey}=await loadTs('../src/audio/vocals/jobStore.ts', source => source.replace(/import \{ analyzeVocals \} from [^;]+;/, 'const analyzeVocals = null;'));
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('Library and Player share one task, live progress, cancellation, retry and source identity',async()=>{
 let calls=0,finish,progress,signal,saves=0;
 const store=new VocalJobStore((_source,s,p)=>{calls++;signal=s;progress=p;return new Promise(resolve=>{finish=resolve;});});
 let library=0,player=0;
 const a=store.subscribe(()=>library++),b=store.subscribe(()=>player++);
 const track={id:'song',fingerprint:'file-a',comparison:{name:'B',size:10,lastModified:1}};
 const key=vocalJobKey(track);
 store.prepare(key,{},()=>saves++);store.prepare(key,{},()=>saves++);
 assert.equal(calls,1);assert.equal(store.getSnapshot()[key].status,'queued');
 progress({phase:'Separating vocals',progress:.42});
 assert.equal(store.getSnapshot()[key].progress,.42);assert.equal(library,player);
 store.cancel(key);assert.ok(signal.aborted);assert.equal(store.getSnapshot()[key].status,"idle");
 finish({rms:Float32Array.of(.1),vowels:Uint8Array.of(0,0,255,0,0)});await flush();assert.equal(saves,0);
 store.prepare(key,{},()=>saves++);assert.equal(calls,2);
 finish({rms:Float32Array.of(.1),vowels:Uint8Array.of(0,0,255,0,0)});await flush();
 assert.equal(saves,1);assert.equal(store.getSnapshot()[key].status,'ready');
 assert.equal(store.getSnapshot()[key].analysis.version,4);
 assert.deepEqual(store.getSnapshot()[key].analysis.vowels,[0,0,255,0,0]);
 store.prepare(key,{},()=>saves++);assert.equal(calls,2);
 assert.notEqual(key,vocalJobKey(track,1));
 assert.notEqual(vocalJobKey(track,1),vocalJobKey({...track,comparison:{...track.comparison,lastModified:2}},1));
 a();b();store.dispose();
});
test('failure is shared and retryable without poisoning another source',async()=>{
 const store=new VocalJobStore(async()=>{throw new Error('fixture failure');});
 store.prepare('A',{},()=>{});await flush();
 assert.equal(store.getSnapshot().A.status,'error');assert.equal(store.getSnapshot().A.error,'fixture failure');
 store.cancel('A');assert.equal(store.getSnapshot().A.status,"idle");
});
test('replacing B forgets its analysis and aborts pending work without late publication',async()=>{
 const tasks=[],saves=[];
 const store=new VocalJobStore((source,signal,progress)=>new Promise(resolve=>tasks.push({source,signal,progress,resolve})));
 store.prepare('A',{},()=>saves.push('A'));
 store.prepare('old B',{},()=>saves.push('old B'));
 store.forget('old B');
 assert.ok(tasks[1].signal.aborted);
 assert.equal(store.getSnapshot()['old B'],undefined);
 await assert.rejects(tasks[1].source(),{name:'AbortError'});
 tasks[1].progress({phase:'Late progress',progress:.8});
 tasks[1].resolve({rms:Float32Array.of(.1),vowels:Uint8Array.of(0,0,255,0,0)});
 tasks[0].resolve({rms:Float32Array.of(.1),vowels:Uint8Array.of(0,0,255,0,0)});
 await flush();
 assert.deepEqual(saves,['A']);
 assert.equal(store.getSnapshot().A.status,'ready');
 assert.equal(store.getSnapshot()['old B'],undefined);
 store.forget('A');assert.deepEqual(store.getSnapshot(),{});
 store.dispose();
});
test('reset cancels every task, discards records and supports a fresh task',async()=>{
 const tasks=[];let saves=0;
 const store=new VocalJobStore((_source,signal,progress)=>new Promise(resolve=>tasks.push({signal,progress,resolve})));
 store.prepare('A',{},()=>saves++);store.prepare('B',{},()=>saves++);
 store.reset();assert.deepEqual(store.getSnapshot(),{});
 for(const task of tasks){
  assert.ok(task.signal.aborted);task.progress({phase:'Late progress',progress:.8});
  task.resolve({rms:Float32Array.of(.1),vowels:Uint8Array.of(0,0,255,0,0)});
 }
 await flush();assert.equal(saves,0);assert.deepEqual(store.getSnapshot(),{});
 store.prepare('A',{},()=>saves++);
 tasks[2].resolve({rms:Float32Array.of(.1),vowels:Uint8Array.of(0,0,255,0,0)});
 await flush();assert.equal(saves,1);assert.equal(store.getSnapshot().A.status,'ready');
 store.dispose();assert.deepEqual(store.getSnapshot(),{});
});
