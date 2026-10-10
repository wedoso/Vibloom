import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString("base64")}`;
const loudnessUrl = moduleUrl(await readFile(new URL("../src/audio/mastering/loudness.ts", import.meta.url), "utf8"));
const { integratedLufs, StreamingIntegratedLufs } = await import(loudnessUrl);
const encoderUrl = moduleUrl(await readFile(new URL("../src/audio/pcm/wavEncoder.ts", import.meta.url), "utf8"));
const { PcmWavEncoder } = await import(encoderUrl);
const { encodeWAV } = await import("./fixtures/suno-upstream/wavEncoder.mjs");
test("streaming LUFS preserves Float32 stages, overlapping sums and gating across arbitrary chunks", () => {
  for (const rate of [44100,48000]) for (const count of [1,2]) for (const length of [1,127,rate*.4,rate*2+127]) {
    let seed=45;
    const channels=Array.from({length:count},()=>Float32Array.from({length},(_,i)=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return .3*Math.sin(i*.037)+.07*((seed>>>0)/2**32-.5); }));
    for (const size of [1,127,65536]) {
      const meter=new StreamingIntegratedLufs(rate,count);
      for(let at=0;at<length;at+=size) meter.append(channels.map(c=>c.subarray(at,at+size)));
      assert.equal(meter.value(),integratedLufs(channels,rate));
    }
    const silent=new StreamingIntegratedLufs(rate,count); silent.append(channels.map(c=>new Float32Array(c.length))); assert.equal(silent.value(),-Infinity);
  }
});
test("chunked PCM encoder matches independent upstream, including the interleaved random stream", () => {
  const random=()=>{let seed=17;return ()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/2**32;};};
  const channels=[Float32Array.from([0,-1,1,1.1,-1.1,.123,-.789]),Float32Array.from([.8,.2,-.2,0,-.9,1,0])];
  const input={length:7,numberOfChannels:2,sampleRate:48000,getChannelData:c=>channels[c]};
  for(const depth of [16,24]) {
    const saved=Math.random; let reference;
    try {Math.random=random();reference=encodeWAV(input,{bitDepth:depth,dither:depth===16});} finally {Math.random=saved;}
    const encoder=new PcmWavEncoder(7,2,48000,depth), rng=random();
    for(let at=0;at<7;at+=3) encoder.append(channels.map(c=>c.subarray(at,at+3)),rng);
    const actual=encoder.finish(); assert.deepEqual(new Uint8Array(actual.bytes),new Uint8Array(reference)); assert.equal(actual.clippedSamples,2);
  }
  const bad=new PcmWavEncoder(1,1,44100,24); assert.throws(()=>bad.finish(),/Incomplete/); assert.throws(()=>bad.append([Float32Array.of(NaN)]),/non-finite/);
});
const pcmSource=(await readFile(new URL("../src/audio/pcm/processPcm.ts",import.meta.url),"utf8")).replace('"./wavEncoder"',JSON.stringify(encoderUrl)).replace('new URL("./pcm.worker.ts", import.meta.url)','"pcm.worker.ts"');
const { PcmWorker, scanPcmPeaks }=await import(moduleUrl(pcmSource));
test("PCM worker releases its pending request and listeners on cancel or transport failure",async()=>{
 const saved=globalThis.Worker, workers=[]; let mode="hold";
 globalThis.Worker=class {
  constructor(){workers.push(this);} terminate(){this.terminated=true;}
  postMessage(){if(mode==="clone")throw new Error("transfer failed");queueMicrotask(()=>{if(mode==="crash")this.onerror({message:"worker failed"});else if(mode==="decode")this.onmessageerror({});else if(mode==="error")this.onmessage({data:{type:"error",message:"encoding failed"}});else if(mode==="ready")this.onmessage({data:{type:"ready"}});});}
 };
 try {
  const abort=new AbortController(),first=new PcmWorker(abort.signal),pending=first.request({}); abort.abort(); await assert.rejects(pending,{name:"AbortError"}); assert.ok(workers[0].terminated);
  for(const failure of ["clone","crash","decode","error"]){mode=failure;const worker=new PcmWorker(new AbortController().signal);await assert.rejects(worker.request({}));assert.ok(workers.at(-1).terminated);worker.dispose();}
  mode="ready";const next=new PcmWorker(new AbortController().signal);assert.equal((await next.request({})).type,"ready");next.dispose();assert.ok(workers.every(w=>w.terminated));
 } finally {if(saved===undefined)delete globalThis.Worker;else globalThis.Worker=saved;}
});
test("peak worker returns only scalars for read-only scans and releases cancelled chunk transfers", async () => {
  const savedWorker=globalThis.Worker, savedSelf=globalThis.self, workers=[], replies=[];
  let active, abortOnReply;
  const scope={postMessage(reply, transfer=[]){
    const cloned=structuredClone(reply,{transfer}); replies.push({reply:cloned,transfers:transfer.length});
    active(cloned); abortOnReply?.abort();
  }};
  globalThis.self=scope;
  const source=(await readFile(new URL("../src/audio/pcm/pcm.worker.ts",import.meta.url),"utf8"))
    .replace('"./wavEncoder"',JSON.stringify(encoderUrl)).replace('"../mastering/loudness"',JSON.stringify(loudnessUrl));
  try {
    await import(moduleUrl(source));
    globalThis.Worker=class {
      constructor(){workers.push(this);} terminate(){this.terminated=true;}
      postMessage(message,transfer=[]){const cloned=structuredClone(message,{transfer});queueMicrotask(()=>{if(!this.terminated){active=data=>this.onmessage?.({data});scope.onmessage({data:cloned});}});}
    };
    const data=new Float32Array(131075).fill(-.8);data[65534]=1.2;data[65535]=.9;data[65536]=.95;data[65537]=.96;
    const original=data.slice(), buffer={length:data.length,numberOfChannels:1,getChannelData:()=>data,copyToChannel:(chunk,_channel,first)=>data.set(chunk,first)};
    const expected=Math.max(...data.subarray(65535,65538));
    assert.equal(await scanPcmPeaks(buffer,new AbortController().signal,undefined,65535,65538),expected);
    assert.deepEqual(data,original);assert.equal(replies.length,3);
    assert.ok(replies.every(({reply,transfers})=>reply.channels===undefined&&transfers===0));
    replies.length=0;
    assert.equal(await scanPcmPeaks(buffer,new AbortController().signal,.7,65535,65538),expected);
    assert.ok(data.every(value=>Math.abs(value)<=Math.fround(.7)));
    assert.ok(replies.every(({reply,transfers})=>reply.channels.length===1&&transfers===1));
    data.set(original);abortOnReply=new AbortController();
    await assert.rejects(scanPcmPeaks(buffer,abortOnReply.signal,.7),{name:"AbortError"});assert.deepEqual(data,original);
    assert.ok(workers.every(worker=>worker.terminated));
  } finally {
    if(savedWorker===undefined)delete globalThis.Worker;else globalThis.Worker=savedWorker;
    if(savedSelf===undefined)delete globalThis.self;else globalThis.self=savedSelf;
  }
});
