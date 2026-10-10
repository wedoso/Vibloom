import { createMasteringChain, configureLimiter } from "./chain";
import { snapshotSettings, type MasteringSettings } from "./settings";
import { measureLoudness } from "./measure";
import { encodeEqWav } from "../eq/renderEq";
import { scanPcmPeaks } from "../pcm/processPcm";
import { validateRepairInput } from "../remaster/presets";
import type { RemasterProgress } from "../remaster/renderRemaster";

async function renderPass(buffer: AudioBuffer, rate: number, length: number, signal: AbortSignal, connect: (context: OfflineAudioContext, source: AudioBufferSourceNode) => () => void, offset = 0) {
  signal.throwIfAborted(); const context = new OfflineAudioContext(buffer.numberOfChannels,length,rate), source = context.createBufferSource(); source.buffer=buffer;
  const dispose = connect(context,source), abort = () => { try { source.stop(); } catch { /* Already ended. */ } };
  signal.addEventListener("abort",abort,{once:true});
  try { source.start(0, offset); const result = await context.startRendering(); signal.throwIfAborted(); return result; }
  finally { signal.removeEventListener("abort",abort); source.disconnect(); source.buffer=null; dispose(); }
}
export async function resampleMastering(buffer: AudioBuffer, rate: number, signal: AbortSignal) {
  if(buffer.sampleRate===rate) return buffer;
  return renderPass(buffer,rate,Math.max(1,Math.round(buffer.length*rate/buffer.sampleRate)),signal,(ctx,source)=>{source.connect(ctx.destination);return ()=>{};});
}
async function clampBuffer(buffer: AudioBuffer, ceiling: number, signal: AbortSignal) {
  // Preserve WebKit's original writes to the native resampler's channel views.
  // Its long-buffer resampling oracle is not stable enough to validate a change
  // to that write-back path. Read-only peak scanning can still use the worker.
  if (!/(?:Chrome|Chromium)\//.test(navigator.userAgent)) {
    for(let c=0;c<buffer.numberOfChannels;c++) {
      const data=buffer.getChannelData(c);
      for(let first=0;first<data.length;first+=65536) {
        signal.throwIfAborted();
        for(let i=first;i<Math.min(data.length,first+65536);i++) { if(data[i]>ceiling)data[i]=ceiling;else if(data[i]<-ceiling)data[i]=-ceiling; }
        await new Promise<void>(resolve=>setTimeout(resolve,0));
      }
    }
    return;
  }
  await scanPcmPeaks(buffer, signal, ceiling);
}
/** Window boundaries align to Web Audio render quanta, with source context on
 * both sides. The native resamplers and clipping order remain unchanged. */
export async function limitTruePeaks(buffer: AudioBuffer, ceiling: number, signal: AbortSignal) {
  signal.throwIfAborted();
  const rate = buffer.sampleRate, block = Math.ceil(rate * 16 / 128) * 128, context = 4096;
  // Windowed parity is verified on Chromium. Other engines retain the upstream
  // whole-buffer native resampling/write-back path. All engines scan peaks in
  // the worker; Chromium combines scanning/clipping before downsampling.
  const chromium = /(?:Chrome|Chromium)\//.test(navigator.userAgent);
  if (buffer.length <= block || !chromium) {
    let up: AudioBuffer | null = await resampleMastering(buffer, rate * 4, signal);
    const peak = await scanPcmPeaks(up, signal, chromium ? ceiling : undefined);
    if (!(peak > ceiling)) return buffer;
    if (!chromium) await clampBuffer(up, ceiling, signal);
    const result = await resampleMastering(up, rate, signal); up = null;
    await clampBuffer(result, ceiling, signal); return result;
  }
  const result = new AudioBuffer({ length: buffer.length, numberOfChannels: buffer.numberOfChannels, sampleRate: rate });
  let peak = 0;
  for (let first = 0; first < buffer.length; first += block) {
    signal.throwIfAborted();
    const end = Math.min(buffer.length, first + block), from = Math.max(0, first - context), to = Math.min(buffer.length, end + context);
    const up = await renderPass(buffer, rate * 4, (to - from) * 4, signal, (ctx, source) => { source.connect(ctx.destination); return () => {}; }, from / rate);
    peak = Math.max(peak, await scanPcmPeaks(up, signal, ceiling, (first - from) * 4, (end - from) * 4));
    const down = await resampleMastering(up, rate, signal);
    for (let c = 0; c < buffer.numberOfChannels; c++) result.copyToChannel(down.getChannelData(c).subarray(first - from, end - from), c, first);
  }
  if (!(peak > ceiling)) return buffer;
  await clampBuffer(result, ceiling, signal); return result;
}
export async function applyMastering(buffer: AudioBuffer, settings: MasteringSettings, signal: AbortSignal, progress: (p: RemasterProgress)=>void = ()=>{}) {
  const s=snapshotSettings(settings); validateRepairInput(buffer.sampleRate,buffer.length,buffer.numberOfChannels);
  const rate=s.mode==="eq"?buffer.sampleRate:s.sampleRate;
  validateRepairInput(rate,Math.ceil(buffer.length*rate/buffer.sampleRate),buffer.numberOfChannels);
  progress({phase:s.mode==="eq"?"Rendering EQ":"Rendering tone, dynamics & stereo",progress:.1});
  let rendered=await renderPass(buffer,rate,Math.ceil(buffer.length*rate/buffer.sampleRate),signal,(context,source)=>{const chain=createMasteringChain(context,s);source.connect(chain.input);chain.output.connect(context.destination);return chain.dispose;});
  if(s.mode==="mastering"&&s.normalizeLoudness) { progress({phase:"Measuring processed loudness",progress:.35}); await measureLoudness(rendered,signal,s.targetLufs); }
  if(s.mode==="mastering"&&s.truePeakLimit) {
    progress({phase:"Limiting final peaks",progress:.5});
    rendered=await renderPass(rendered,rate,rendered.length,signal,(context,source)=>{const limiter=context.createDynamicsCompressor();configureLimiter(limiter,s.truePeakCeiling);source.connect(limiter).connect(context.destination);return ()=>limiter.disconnect();});
    progress({phase:"Checking 4× true peaks",progress:.65});
    rendered = await limitTruePeaks(rendered, Math.pow(10,s.truePeakCeiling/20), signal);
  }
  progress({phase:"Audio rendered",progress:.8}); return rendered;
}
export async function renderMasteringNow(source: ()=>Promise<AudioBuffer>, settings: MasteringSettings, signal: AbortSignal, progress:(p:RemasterProgress)=>void) {
  const s=snapshotSettings(settings), rendered=await applyMastering(await source(),s,signal,progress);
  const encoded=await encodeEqWav(rendered,signal,progress,s.mode==="eq"?24:s.bitDepth);
  signal.throwIfAborted(); return {blob:new Blob([encoded.bytes],{type:"audio/wav"}),clippedSamples:encoded.clippedSamples};
}
