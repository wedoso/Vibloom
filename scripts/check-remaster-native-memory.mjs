// Large native allocations, fault unwind and repeated lifecycle checks.
// Run with node --expose-gc scripts/check-remaster-native-memory.mjs.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { loadTs } from '../tests/load-ts.mjs';
const {initializeReferenceFft,referenceKernel,releaseSpectralMemory}=await loadTs('../src/audio/remaster/referenceFft.ts');
const {NativePeaks}=await loadTs('../src/audio/remaster/nativePeaks.ts');
const {nativeSpectralRepair}=await loadTs('../src/audio/remaster/nativeRepair.ts');
const {nativeLimiter}=await loadTs('../src/audio/remaster/nativeLimiter.ts');
const {getRepairPreset,validateRepairInput}=await loadTs('../src/audio/remaster/presets.ts');
const output='outputs/remaster-memory';await mkdir(output,{recursive:true});
assert.equal(typeof globalThis.gc,'function','Run node with --expose-gc');
await initializeReferenceFft();const samples=[];
const settle=async()=>{for(let i=0;i<5;i++){await new Promise(resolve=>setTimeout(resolve,20));globalThis.gc();}};
const measure=async label=>{await settle();const row={label,wasmMiB:referenceKernel().memory.buffer.byteLength/2**20,...process.memoryUsage()};samples.push(row);console.log(JSON.stringify(row));return row;};
await measure('initialized');
// Native boundary creation: maximum allowed PCM, every supported rate/channel edge.
for(const rate of [8000,96000])for(const channels of [1,2]){
 const length=Math.min(rate*720,Math.floor(128*2**20/4/channels));validateRepairInput(rate,length,channels);
 await (async()=>{
  const k=referenceKernel(),ctx=k.repair_create(rate,channels,length);
  try {
   const p=new Float64Array(k.memory.buffer,k.repair_buffer(ctx,0),32);p.set([5100,7200,200,8,.6,0,0,120,400,-18,3,50,0,6,8,600,31,0,1,.5]);
   k.repair_init(ctx);
   // Allocate both output banks. Initial input has zero values; no full song work.
   k.repair_begin(ctx,0);k.repair_end(ctx);k.repair_begin(ctx,1);
   assert.ok(k.memory.buffer.byteLength<=512*2**20);
   console.log('BOUNDARY',rate,channels,length,'wasmMiB',k.memory.buffer.byteLength/2**20);
  }finally{k.repair_destroy(ctx);releaseSpectralMemory();}
 })();
 assert.ok((await measure(`boundary ${rate}/${channels}`)).wasmMiB<=64);
}
// Use the same Node runtime for repeated large stages; no Worker termination masks leaks.
for(let round=0;round<4;round++){
 await (async()=>{
  const input=[new Float32Array(44100*240),new Float32Array(44100*240)];input[0][100]=.1;
  const old=new WeakRef(referenceKernel());
  const peaks=new NativePeaks(input,44100);peaks.dispose();assert.equal(peaks.k,null);
  await settle();assert.equal(old.deref(),undefined,'disposed peak analyzer must not retain the old heap');
 })();
 await measure(`peaks ${round}`);
 await (async()=>{
  const input=[new Float32Array(44100*240),new Float32Array(44100*240)];input[0][100]=.1;
  await assert.rejects(nativeSpectralRepair(input,44100,getRepairPreset('full-safe').settings,[0,0],()=>{throw new Error('Injected stage failure');}),/Injected stage failure/);
 })();
 assert.ok((await measure(`spectral fault ${round}`)).wasmMiB<=64);
 await (async()=>{
  const pcm=new Float32Array(44100*240*2),kernel=new Float32Array(81);kernel[40]=1;
  await assert.rejects(nativeLimiter(pcm,44100,2,-1,kernel,()=>{throw new Error('Injected limiter failure');}),/Injected limiter failure/);
 })();
 assert.ok((await measure(`limiter fault ${round}`)).wasmMiB<=64);
}
const last=samples.at(-1),first=samples.find(x=>x.label==='limiter fault 0');
assert.ok(last.arrayBuffers-first.arrayBuffers<4*2**20,'retained buffers must plateau after GC');
assert.ok(last.heapUsed-first.heapUsed<4*2**20,'retained JS heap must plateau after GC');
await writeFile(output+'/native-results.json',JSON.stringify({node:process.versions.node,samples},null,2));
console.log('PASS maximum allocation boundaries, disposed heap weak reference, error unwinding and repeated native stages');
