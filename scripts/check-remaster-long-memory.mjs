// One realistic 4-minute input; record native high-water and release at job end.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {loadTs} from '../tests/load-ts.mjs';
const {OfflineRepair}=await loadTs('../src/audio/remaster/dsp.ts');
const {WavRender}=await loadTs('../src/audio/remaster/wav.ts');
const {getRepairPreset}=await loadTs('../src/audio/remaster/presets.ts');
const {referenceKernel}=await loadTs('../src/audio/remaster/referenceFft.ts');
assert.equal(typeof globalThis.gc,'function','Run with --expose-gc');
const rate=44100,seconds=240,length=rate*seconds,samples=[];
const gc=async()=>{for(let i=0;i<5;i++){await new Promise(r=>setTimeout(r,20));globalThis.gc();}};
await gc();samples.push({phase:'before input',...process.memoryUsage()});
let maxWasm=0,phase='';
await (async()=>{
 const channels=[new Float32Array(length),new Float32Array(length)];
 let seed=42;
 for(let i=0;i<length;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;const x=.15*Math.sin(2*Math.PI*1000*i/rate)+((seed>>>0)/2**32-.5)*.04;channels[0][i]=x;channels[1][i]=-.5*x;}
 const core=new OfflineRepair(rate,2,length,getRepairPreset('full-safe').settings);core.append(channels);
 const prepared=await core.finish((name,progress)=>{
  const wasm=referenceKernel().memory.buffer.byteLength;maxWasm=Math.max(maxWasm,wasm);
  if(name!==phase){phase=name;samples.push({phase:name,progress,wasmBytes:wasm,...process.memoryUsage()});}
 });
 assert.equal(referenceKernel().memory.buffer.byteLength,2*2**20);
 samples.push({phase:'native repair released',wasmBytes:referenceKernel().memory.buffer.byteLength,...process.memoryUsage()});
 const wav=new WavRender(rate,length,2);wav.append(prepared);prepared.length=0;
 const result=await wav.finish(null,-1,()=>{});assert.equal(result.byteLength,44+length*2*3);
 samples.push({phase:'WAV ready',...process.memoryUsage()});
})();
await gc();samples.push({phase:'job references released',wasmBytes:referenceKernel().memory.buffer.byteLength,...process.memoryUsage()});
assert.ok(maxWasm<=448*2**20,'typical cached path respects the stage budget');
assert.ok(samples.at(-1).arrayBuffers-samples[0].arrayBuffers<1024*1024,'source/output buffers released after scope exits');
await mkdir('outputs/remaster-memory',{recursive:true});
await writeFile('outputs/remaster-memory/long-results.json',JSON.stringify({node:process.versions.node,rate,channels:2,seconds,maxWasmBytes:maxWasm,samples},null,2));
console.log(JSON.stringify({maxWasmMiB:maxWasm/2**20,samples},null,2));
