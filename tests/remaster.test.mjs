import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './load-ts.mjs';
const { FFT } = await loadTs('../src/audio/remaster/fft.ts');
const { OfflineRepair } = await loadTs('../src/audio/remaster/dsp.ts');
const { REPAIR_PRESETS, getRepairPreset, validateRepairInput } = await loadTs('../src/audio/remaster/presets.ts');
const { WavRender } = await loadTs('../src/audio/remaster/wav.ts');
const { IntegratedLoudness } = await loadTs('../src/audio/remaster/loudness.ts');
const { runAudioJob } = await loadTs('../src/audio/processingQueue.ts');
const rate = 48000;
async function repair(input, settings, chunk = 96000, sampleRate = rate) {
  const core = new OfflineRepair(sampleRate, input.length, input[0].length, settings), output = input.map(x => new Float32Array(x.length));
  for (let i = 0; i < input[0].length; i += chunk) core.append(input.map(x => x.subarray(i, Math.min(x.length, i + chunk))));
  const result = await core.finish();
  result.forEach((x, c) => output[c].set(x));

  return output;
}
const sine = (length, hz = 1000, amplitude = .1) => Float32Array.from({ length }, (_, i) => amplitude * Math.sin(2 * Math.PI * hz * i / rate));
const rms = x => Math.sqrt(x.reduce((a,b) => a + b*b,0) / x.length);
function noise(length) { let state = 42; return Float32Array.from({ length }, () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return ((state >>> 0) / 2**32 - .5) * .15; }); }
test('FFT round trip and zero-delay STFT preserve low-band samples, edges, short input and stereo', async () => {
  const fft = new FFT(2048), data = sine(2048); fft.real.set(data); fft.transform(); fft.transform(true);
  assert.ok(fft.real.every((x,i) => Math.abs(x-data[i]) < 1e-12));
  for (const length of [1, 511, 1024, 2048, 96001]) {
    const left = sine(length); left[0] = .1; left[length-1] = -.1;
    const right = Float32Array.from(left, x => x * -.5);
    const output = await repair([left,right], { ...getRepairPreset('default').settings, enhance: false, tonalRepair: 0 }, 733);
    assert.ok(output[0].every((x,i) => Math.abs(x-left[i]) < .001), `low band length ${length}`);
    assert.ok(output[1].every((x,i) => Math.abs(x + output[0][i] * .5) < 1e-7));
  }
});
test('recipes are independent, deterministic across chunk boundaries, finite at supported sample rates', async () => {
  assert.equal(REPAIR_PRESETS.length,17); assert.equal(new Set(REPAIR_PRESETS.map(x=>x.id)).size,17);
  const input = noise(rate + 17);
  for (const p of REPAIR_PRESETS) {
    const a = await repair([input],p.settings,96000), b = await repair([input],p.settings,431);
    assert.deepEqual(a,b,p.id); assert.ok(a[0].every(Number.isFinite));
  }
  for (const sampleRate of [8000,44100,96000]) assert.ok((await repair([noise(4097)],getRepairPreset('full-strong').settings,817,sampleRate))[0].every(Number.isFinite));
  assert.throws(()=>validateRepairInput(rate,rate*60*13,1)); assert.throws(()=>validateRepairInput(96000,96000*60*12,2));
  assert.throws(()=>validateRepairInput(rate,4096,6)); validateRepairInput(rate,rate*60*5,2);
});
test('denoise reduces a steady noise bed; persistent whistle is reduced after detector settles', async () => {
  const input = noise(rate*3), settings = getRepairPreset('strong-denoise').settings;
  const output = (await repair([input],settings))[0];
  assert.ok(rms(output.subarray(rate)) < rms(input.subarray(rate)) * .92);
  const whistle = sine(rate*3,3500,.08), whine = (await repair([whistle],getRepairPreset('whine').settings))[0];
  assert.ok(rms(whine.subarray(rate*2)) < rms(whistle.subarray(rate*2)) * .9);
});
test('shimmer inpainting reduces an outlier in noisy high frequencies and preserves the low band', async () => {
  const input=noise(rate*3);
  for(let i=0;i<input.length;i++) input[i]+=.015*Math.sin(2*Math.PI*6000*i/rate)+.04*Math.sin(2*Math.PI*1000*i/rate);
  const output=(await repair([input],{...getRepairPreset('aggressive').settings,enhance:false,tonalRepair:0}))[0];
  const amplitude=(data,hz)=>{let a=0,b=0;for(let i=rate;i<data.length;i++){a+=data[i]*Math.sin(2*Math.PI*hz*i/rate);b+=data[i]*Math.cos(2*Math.PI*hz*i/rate);}return Math.hypot(a,b);};
  assert.ok(amplitude(output,6000)/amplitude(input,6000)<.95);
  assert.ok(Math.abs(amplitude(output,1000)/amplitude(input,1000)-1)<.001);
  const tonal=sine(rate*2,6000,.1), protectedTone=(await repair([tonal],{...getRepairPreset('default').settings,enhance:false,tonalRepair:0}))[0];
  assert.ok(rms(protectedTone)>rms(tonal)*.99,'tonal material is protected by the noise gate');
});
test('K-weighted gated loudness agrees with 1 kHz mono/stereo reference and ignores silence', () => {
  for (const channels of [1,2]) {
    const meter = new IntegratedLoudness(rate,channels), pcm = new Float32Array(rate*2*channels);
    for(let i=0;i<rate*2;i++) for(let c=0;c<channels;c++) pcm[i*channels+c]=.1*Math.sin(2*Math.PI*1000*i/rate);
    for(let i=0;i<rate*2;i++) meter.sample(pcm,i);
    assert.ok(Math.abs(meter.value() - (-23.004 + (channels===2?3.0103:0))) < .08, `${channels}: ${meter.value()}`);
  }
  assert.equal(new IntegratedLoudness(rate,1).value(),null);
});
test('WAV is 24-bit PCM with correct lengths and odd-byte padding, delivery keeps stereo limiting linked', async () => {
  for(const length of [1,513,rate]) {
    const wav = new WavRender(rate,length,1); wav.append([sine(length)]);
    const result = await wav.finish(null,-1,()=>{}), view = new DataView(result.buffer);
    assert.equal(view.getUint16(34,true),24); assert.equal(view.getUint32(40,true),length*3);
    assert.equal(result.byteLength,44+length*3+(length*3)%2); assert.equal(view.getUint32(4,true),result.byteLength-8);
  }
  const data=sine(rate*2,11000,.95), wav=new WavRender(rate,data.length,2);
  wav.append([data,Float32Array.from(data,x=>x*-.5)]);
  const result=await wav.finish(-10,-1,()=>{});
  assert.ok(result.metrics.samplePeakDb < 0); assert.ok(result.metrics.truePeakDb < 0);
  assert.ok(Number.isFinite(result.metrics.outputLufs));
  const view=new DataView(result.buffer);
  const sample=offset=> { const n=view.getUint8(offset)|view.getUint8(offset+1)<<8|view.getUint8(offset+2)<<16; return n&0x800000 ? n-0x1000000:n; };
  for(let i=0;i<data.length;i+=31) assert.ok(Math.abs(sample(44+i*6)*-.5-sample(47+i*6)) <= 1);
});
test('shared processing gate serializes jobs, queued cancellation settles immediately and failure does not poison retry', async () => {
  let release; const order=[];
  const first=runAudioJob(new AbortController().signal,()=>new Promise(resolve=> {order.push('first');release=resolve;}));
  await new Promise(resolve=>setImmediate(resolve));
  const controller=new AbortController(); const waiting=runAudioJob(controller.signal,async()=>{order.push('cancelled');}); controller.abort();
  await assert.rejects(waiting,{name:'AbortError'});
  const third=runAudioJob(new AbortController().signal,async()=>{order.push('third');throw new Error('fixture');});
  release(); await first; await assert.rejects(third,/fixture/);
  await runAudioJob(new AbortController().signal,async()=>order.push('fourth'));
  assert.deepEqual(order,['first','third','fourth']);
});

test('worker transport bounds PCM copies, keeps A owned by playback, and terminates on abort/error/retry', async () => {
  const { renderRemaster } = await loadTs('../src/audio/remaster/renderRemaster.ts', source => source.replace('new URL("./remaster.worker.ts", import.meta.url)', '"remaster.worker.ts"'));
  const original = globalThis.Worker, workers=[];
  let mode='normal';
  class Worker {
    constructor(){workers.push(this);this.lengths=[];}
    terminate(){this.terminated=true;}
    postMessage(data,transfer){
      if(data.type==='init'){if(mode==='throw')throw new DOMException('Send failed','DataCloneError'); if(mode==='hold')return; if(mode==='fail'){queueMicrotask(()=>this.onerror());return;} queueMicrotask(()=>this.onmessage({data:{type:'ready'}}));return;}
      this.lengths.push(data.channels[0].length);
      assert.ok(data.channels.every(x=>x.length<=rate*2));
      assert.notEqual(data.channels[0].buffer,pcm.buffer);
      structuredClone(data.channels,{transfer});
      queueMicrotask(()=>this.onmessage({data:data.final?{type:'result',buffer:new ArrayBuffer(44),byteLength:44,metrics:{elapsedMs:1}}:{type:'next',progress:.5}}));
    }
  }
  const pcm=sine(rate*5), source={sampleRate:rate,length:pcm.length,numberOfChannels:1,getChannelData:()=>pcm};
  globalThis.Worker=Worker;
  try {
    const output=await renderRemaster(source,'default',new AbortController().signal,()=>{});
    assert.equal(output.blob.size,44);assert.equal(pcm.length,rate*5);assert.deepEqual(workers[0].lengths,[rate*2,rate*2,rate]);assert.ok(workers[0].terminated);
    mode='hold';const cancel=new AbortController(), aborted=renderRemaster(source,'default',cancel.signal,()=>{});
    await new Promise(resolve=>setImmediate(resolve));cancel.abort();await assert.rejects(aborted,{name:'AbortError'});assert.ok(workers[1].terminated);
    mode='fail';await assert.rejects(renderRemaster(source,'default',new AbortController().signal,()=>{}),/worker could not run/);assert.ok(workers[2].terminated);
    mode='normal';await renderRemaster(source,'default',new AbortController().signal,()=>{});assert.ok(workers[3].terminated);
    mode='throw';await assert.rejects(renderRemaster(source,'default',new AbortController().signal,()=>{}),/Send failed/);
    assert.ok(workers[4].terminated);assert.equal(workers[4].onmessage,null);
    mode='normal';await renderRemaster(source,'default',new AbortController().signal,()=>{});assert.ok(workers[5].terminated);
  } finally {globalThis.Worker=original;}
});

test('fixed Python full-chain golden references stay within 60 dB waveform tolerance', async () => {
  const { readFile } = await import('node:fs/promises');
  const { gunzipSync } = await import('node:zlib');
  const { createHash } = await import('node:crypto');
  const golden = JSON.parse(gunzipSync(await readFile(new URL('./fixtures/remaster-reference.json.gz', import.meta.url))).toString());
  assert.equal(golden.upstream,'fea2cca81da613ec8a3aca4962a359e060eab9d9');
  for (const fixture of golden.fixtures) {
    const bytes=Buffer.from(fixture.input,'base64');
    assert.equal(createHash('sha256').update(bytes).digest('hex'),fixture.sha256);
    const pcm=new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length));
    const input=Array.from({length:fixture.channels},(_,c)=>Float32Array.from({length:fixture.frames},(_,i)=>pcm[i*fixture.channels+c]));
    for (const expected of fixture.expected) {
      const settings=getRepairPreset(expected.preset).settings;
      const output=await repair(input,settings,7919,fixture.rate), wav=new WavRender(fixture.rate,fixture.frames,fixture.channels);
      wav.append(output);const result=await wav.finish(settings.targetLufs,settings.ceilingDb,()=>{}), view=new DataView(result.buffer);
      const value=(i,c)=>{const offset=44+(i*fixture.channels+c)*3;let n=view.getUint8(offset)|view.getUint8(offset+1)<<8|view.getUint8(offset+2)<<16;if(n&0x800000)n-=0x1000000;return n/8388608;};
      const referenceBytes=Buffer.from(expected.pcm,'base64');
      const reference=new Float32Array(referenceBytes.buffer.slice(referenceBytes.byteOffset,referenceBytes.byteOffset+referenceBytes.length));
      let refPower=0, residual=0, sum=0;
      fixture.indices.forEach((frame,i)=>{for(let c=0;c<fixture.channels;c++){const a=reference[i*fixture.channels+c],b=value(frame,c);refPower+=a*a;residual+=(a-b)**2;}});
      const snr=residual===0?Infinity:10*Math.log10(refPower/residual);
      assert.ok(snr>=golden.criteria.snr_db,`${fixture.id}/${expected.preset}: ${snr} dB`);
      for(let i=0;i<fixture.frames;i++)for(let c=0;c<fixture.channels;c++)sum+=value(i,c)**2;
      const delta=20*Math.log10(Math.sqrt(sum/(fixture.frames*fixture.channels))/expected.rms);
      assert.ok(Math.abs(delta)<.01,`${fixture.id}/${expected.preset}: ${delta} dB RMS difference`);
    }
  }
});

test('NumPy seed-zero PCG64 uses frequency-major rows without an F×T random map', async () => {
  const { Pcg64 }=await loadTs('../src/audio/remaster/numerics.ts');
  const expected=[.6369616873214543,.2697867137638703,.04097352393619469,.016527635528529094,.8132702392002724];
  const generator=new Pcg64();assert.deepEqual(expected.map(()=>generator.uniform()),expected);
  const skipped=new Pcg64();skipped.advance(4);assert.equal(skipped.uniform(),expected[4]);
});

test('native magnitude cache and bounded recomputation produce identical samples', async () => {
  const { nativeSpectralRepair } = await loadTs('../src/audio/remaster/nativeRepair.ts');
  const { initializeReferenceFft } = await loadTs('../src/audio/remaster/referenceFft.ts');
  await initializeReferenceFft();
  const input=noise(rate*2+17);
  for(const id of ['full-strong','crickets']) {
    const settings={...getRepairPreset(id).settings,enhance:false};
    const cached=await nativeSpectralRepair([input.slice()],rate,settings,[0],()=>{},192*1024*1024);
    const recomputed=await nativeSpectralRepair([input.slice()],rate,settings,[0],()=>{},0);
    assert.deepEqual(cached,recomputed,id);
  }
});


test('tonal allocation budget rejects dense matching and oversized family grids before allocation', async () => {
  const { checkTonalAllocation } = await loadTs('../src/audio/remaster/tonal.ts');
  checkTonalAllocation(1000,1000,1_000_000);
  assert.throws(()=>checkTonalAllocation(1001,1000,1_000_000),/memory budget/);
  assert.throws(()=>checkTonalAllocation(64,40000,2_000_000),/memory budget/);
});
