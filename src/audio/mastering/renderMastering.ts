import { createMasteringChain, configureLimiter } from "./chain";
import { snapshotSettings, type MasteringSettings } from "./settings";
import { measureLoudness } from "./measure";
import { encodeEqWav } from "../eq/renderEq";
import { validateRepairInput } from "../remaster/presets";
import type { RemasterProgress } from "../remaster/renderRemaster";

async function renderPass(buffer: AudioBuffer, rate: number, length: number, signal: AbortSignal, connect: (context: OfflineAudioContext, source: AudioBufferSourceNode) => () => void) {
  signal.throwIfAborted(); const context = new OfflineAudioContext(buffer.numberOfChannels,length,rate), source = context.createBufferSource(); source.buffer=buffer;
  const dispose = connect(context,source), abort = () => { try { source.stop(); } catch { /* Already ended. */ } };
  signal.addEventListener("abort",abort,{once:true});
  try { source.start(); const result = await context.startRendering(); signal.throwIfAborted(); return result; }
  finally { signal.removeEventListener("abort",abort); source.disconnect(); source.buffer=null; dispose(); }
}
export async function resampleMastering(buffer: AudioBuffer, rate: number, signal: AbortSignal) {
  if(buffer.sampleRate===rate) return buffer;
  return renderPass(buffer,rate,Math.max(1,Math.round(buffer.length*rate/buffer.sampleRate)),signal,(ctx,source)=>{source.connect(ctx.destination);return ()=>{};});
}
async function clampBuffer(buffer: AudioBuffer, ceiling: number, signal: AbortSignal) {
  for(let c=0;c<buffer.numberOfChannels;c++) {
    const data=buffer.getChannelData(c);
    for(let start=0;start<data.length;start+=65536) {
      signal.throwIfAborted(); const end=Math.min(data.length,start+65536);
      for(let i=start;i<end;i++) { if(data[i]>ceiling) data[i]=ceiling; else if(data[i]<-ceiling) data[i]=-ceiling; }
      await new Promise<void>(resolve=>setTimeout(resolve,0));
    }
  }
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
    let up: AudioBuffer | null=await resampleMastering(rendered,rate*4,signal); const ceiling=Math.pow(10,s.truePeakCeiling/20);
    let peak=0;
    for(let c=0;c<up.numberOfChannels;c++) { const data=up.getChannelData(c); for(let start=0;start<data.length;start+=262144) { signal.throwIfAborted();for(let i=start;i<Math.min(data.length,start+262144);i++) peak=Math.max(peak,Math.abs(data[i])); await new Promise<void>(resolve=>setTimeout(resolve,0)); } }
    if(peak>ceiling) { await clampBuffer(up,ceiling,signal); rendered=await resampleMastering(up,rate,signal); up=null; await clampBuffer(rendered,ceiling,signal); }
    up=null;
  }
  progress({phase:"Audio rendered",progress:.8}); return rendered;
}
export async function renderMasteringNow(source: ()=>Promise<AudioBuffer>, settings: MasteringSettings, signal: AbortSignal, progress:(p:RemasterProgress)=>void) {
  const s=snapshotSettings(settings), rendered=await applyMastering(await source(),s,signal,progress);
  const encoded=await encodeEqWav(rendered,signal,progress,s.mode==="eq"?24:s.bitDepth);
  signal.throwIfAborted(); return {blob:new Blob([encoded.bytes],{type:"audio/wav"}),clippedSamples:encoded.clippedSamples};
}
