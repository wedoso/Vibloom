// Real browser workers and native resamplers; isolated profile, no user library.
import { app, BrowserWindow } from "electron";
import { build } from "vite";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url)), output = path.join(root, "outputs/pcm-performance"), dir = path.join(root, ".cache/pcm-performance");
const argument = name => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
const profile = await mkdtemp(path.join(tmpdir(), "vibloom-pcm-"));
app.setPath("userData", profile); app.on("window-all-closed", () => {});
let window, server, exitCode = 0;
async function main() {
  try {
    await app.whenReady(); await mkdir(dir, { recursive: true }); await mkdir(output, { recursive: true });
    await writeFile(path.join(dir, "index.html"), '<script type="module" src="./check.ts"></script>');
    await writeFile(path.join(dir, "check.ts"), `
import {encodeEqWav} from '../../src/audio/eq/renderEq';
import {scanPcmPeaks} from '../../src/audio/pcm/processPcm';
import {measureLoudness} from '../../src/audio/mastering/measure';
import {integratedLufs,normalizationGain} from '../../src/audio/mastering/loudness';
import {limitTruePeaks,resampleMastering} from '../../src/audio/mastering/renderMastering';
import {encodeWAV} from '../../tests/fixtures/suno-upstream/wavEncoder.mjs';
const signal=new AbortController().signal, NativeWorker=Worker, workers=new Set<Worker>();
let seedWorkers=false, maxTransfer=0;
const seedCode="let seed=17;Math.random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/2**32;};";
window.Worker=class extends NativeWorker {
 constructor(url:any,options:any){let wrapper:string|undefined;if(seedWorkers)wrapper=URL.createObjectURL(new Blob(['import '+JSON.stringify(String(url))+';'+seedCode],{type:'text/javascript'}));super(wrapper??url,options);workers.add(this);if(wrapper)this.addEventListener('message',()=>URL.revokeObjectURL(wrapper!),{once:true});}
 postMessage(message:any,transfer:any[]=[]){maxTransfer=Math.max(maxTransfer,transfer.reduce((n,b)=>n+b.byteLength,0));super.postMessage(message,transfer);}
 terminate(){workers.delete(this);super.terminate();}
};
function fixture(rate:number,channels:number,length:number,kind='music'){
 const b=new AudioBuffer({sampleRate:rate,numberOfChannels:channels,length});
 for(let c=0;c<channels;c++){let seed=123+c;const d=b.getChannelData(c);for(let i=0;i<length;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;const noise=(seed>>>0)/2**32-.5;
 d[i]=kind==='quiet'?.04*Math.sin(i*.147):kind==='edges'?(i%Math.ceil(rate*16/128)/128<.5?1.3:0):.8*Math.sin(i*.731+c)+.3*Math.sin(i*.137)+.2*noise;}}
 return b;
}
function equal(x:any,y:any,label:string){if(x.length!==y.length)throw new Error(label+' length');for(let i=0;i<x.length;i++)if(x[i]!==y[i])throw new Error(label+' at '+i+': '+x[i]+' vs '+y[i]);}
async function originalPeaks(b:AudioBuffer,ceiling:number){const up=await resampleMastering(b,b.sampleRate*4,signal);let peak=0;
 for(let c=0;c<up.numberOfChannels;c++){const d=up.getChannelData(c);for(let at=0;at<d.length;at+=262144){for(let i=at;i<Math.min(d.length,at+262144);i++)peak=Math.max(peak,Math.abs(d[i]));await new Promise(r=>setTimeout(r,0));}}if(peak<=ceiling)return b;
 for(let c=0;c<up.numberOfChannels;c++){const d=up.getChannelData(c);for(let at=0;at<d.length;at+=65536){for(let i=at;i<Math.min(d.length,at+65536);i++){if(d[i]>ceiling)d[i]=ceiling;else if(d[i]<-ceiling)d[i]=-ceiling;}await new Promise(r=>setTimeout(r,0));}}
 const down=await resampleMastering(up,b.sampleRate,signal);
 for(let c=0;c<down.numberOfChannels;c++){const d=down.getChannelData(c);for(let at=0;at<d.length;at+=65536){for(let i=at;i<Math.min(d.length,at+65536);i++){if(d[i]>ceiling)d[i]=ceiling;else if(d[i]<-ceiling)d[i]=-ceiling;}await new Promise(r=>setTimeout(r,0));}}return down;
}
async function timed(work:()=>Promise<any>){let delay=0,at=performance.now();const timer=setInterval(()=>{const now=performance.now();delay=Math.max(delay,now-at-4);at=now;},4);const start=performance.now();try{await work();await new Promise(r=>setTimeout(r,8));return {ms:performance.now()-start,maxTimerDelayMs:delay};}finally{clearInterval(timer);}}
(window as any).check=async()=>{
 const result:any={userAgent:navigator.userAgent,encodingCases:0,peakCases:0,loudnessCases:0,maxTransferBytes:0,workersAfter:0};
 for(const rate of [44100,48000])for(const channels of [1,2])for(const length of [1,127,65537,131201])for(const depth of [16,24]){
  const b=fixture(rate,channels,length),saved=Array.from({length:channels},(_,c)=>b.getChannelData(c).slice());
  let seed=17;const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/2**32;};
  const old=Math.random;Math.random=random;const reference=encodeWAV(b,{bitDepth:depth,dither:depth===16});Math.random=old;
  seedWorkers=depth===16;const actual=await encodeEqWav(b,signal,undefined,depth);seedWorkers=false;
  equal(new Uint8Array(actual.bytes),new Uint8Array(reference),'worker WAV '+rate+'/'+channels+'/'+length+'/'+depth);
  for(let c=0;c<channels;c++)equal(b.getChannelData(c),saved[c],'source intact');result.encodingCases++;
 }
 for(const rate of [44100,48000])for(const channels of [1,2])for(const length of [1,127,65537,131201]){
  const b=fixture(rate,channels,length),saved=Array.from({length:channels},(_,c)=>b.getChannelData(c).slice()),lufs=integratedLufs(saved,rate);
  if(await measureLoudness(b,signal)!==lufs)throw new Error('streaming LUFS');
  if(await measureLoudness(b,signal,-14)!==lufs)throw new Error('normalizing LUFS');
  const gain=normalizationGain(lufs,-14);
  for(let c=0;c<channels;c++){for(let i=0;i<saved[c].length;i++)saved[c][i]*=gain;equal(b.getChannelData(c),saved[c],'normalization PCM');}result.loudnessCases++;
 }
 for(const rate of [44100,48000])for(const channels of [1,2])for(const kind of ['quiet','music','edges']){
  const b=fixture(rate,channels,Math.ceil(rate*.25)+127,kind),reference=await originalPeaks(b,.7),actual=await limitTruePeaks(b,.7,signal);
  for(let c=0;c<channels;c++)equal(actual.getChannelData(c),reference.getChannelData(c),'whole-buffer peaks '+rate+'/'+channels+'/'+kind);
  if(kind==='quiet' && actual!==b)throw new Error('quiet original not reused');result.shortPeakCases=(result.shortPeakCases??0)+1;
 }
 // Peak/clamp parity independent of the WebKit long native-resampling oracle.
 for(const channels of [1,2])for(const length of [1,127,65537,131201,48000*4])for(const ceiling of [undefined,.7]){
  const b=fixture(48000,channels,length),saved=Array.from({length:channels},(_,c)=>b.getChannelData(c).slice());let peak=0;
  for(const data of saved)for(let i=0;i<data.length;i++){const value=data[i];peak=Math.max(peak,Math.abs(value));if(ceiling!==undefined){if(value>ceiling)data[i]=ceiling;else if(value< -ceiling)data[i]=-ceiling;}}
  if(await scanPcmPeaks(b,signal,ceiling)!==peak)throw new Error('worker peak mismatch');
  for(let c=0;c<channels;c++)equal(b.getChannelData(c),saved[c],'worker clamp PCM');result.scanCases=(result.scanCases??0)+1;
 }
 peaks: for(const rate of [44100,48000])for(const channels of [1,2])for(const kind of ['quiet','music','edges','two-windows']){
  const length=Math.ceil(rate*16/128)*128*(kind==='two-windows'?2:1)+8193;
  const reference=await originalPeaks(fixture(rate,channels,length,kind),.7),saved=Array.from({length:channels},(_,c)=>reference.getChannelData(c).slice());
  if(!/(?:Chrome|Chromium)\\//.test(navigator.userAgent)) {
   const again=await originalPeaks(fixture(rate,channels,length,kind),.7);
   try {for(let c=0;c<channels;c++)equal(again.getChannelData(c),saved[c],'legacy native resampler repeat');}
   catch(error:any) {result.legacyPeakOracleLimitation=String(error);break peaks;}
  }
  const actual=await limitTruePeaks(fixture(rate,channels,length,kind),.7,signal);
  try {for(let c=0;c<channels;c++)equal(actual.getChannelData(c),saved[c],'windowed 4x '+rate+'/'+channels+'/'+kind);}
  catch(error:any) {
   if(/(?:Chrome|Chromium)\\//.test(navigator.userAgent))throw error;
   // Never suppress an optimized-only mismatch: reproduce a discrepancy in
   // the untouched legacy path before classifying this as an oracle failure.
   const repeated=await originalPeaks(fixture(rate,channels,length,kind),.7);
   let unstable=false;for(let c=0;c<channels;c++){try{equal(repeated.getChannelData(c),saved[c],'legacy native resampler after mismatch');}catch{unstable=true;}}
   if(!unstable)throw error;result.legacyPeakOracleLimitation=String(error)+'; untouched legacy rerun also differs';break peaks;
  }
  result.peakCases++;
 }
 const bad=fixture(48000,2,100);bad.getChannelData(1)[45]=NaN;let failed=false;try{await encodeEqWav(bad,signal);}catch{failed=true;}if(!failed)throw new Error('nonfinite accepted');
 const b=fixture(48000,2,48000*60),saved=b.getChannelData(0).slice(),abort=new AbortController();
 failed=false;try{await encodeEqWav(b,abort.signal,()=>abort.abort());}catch(e:any){failed=e.name==='AbortError';}if(!failed)throw new Error('cancel did not reject');
 const cancelled=new AbortController();cancelled.abort();failed=false;try{await scanPcmPeaks(b,cancelled.signal);}catch(e:any){failed=e.name==='AbortError';}if(!failed)throw new Error('cancelled scan started');
 failed=false;try{await limitTruePeaks(b,.7,cancelled.signal);}catch(e:any){failed=e.name==='AbortError';}if(!failed)throw new Error('cancelled resampling started');
 result.worker=await timed(()=>encodeEqWav(b,signal));
 result.mainThread=await timed(()=>new Promise(resolve=>{encodeWAV(b,{bitDepth:24,dither:false});resolve(null);}));
 equal(b.getChannelData(0),saved,'long source intact');
 result.maxTransferBytes=maxTransfer;result.workersAfter=workers.size;
 if(workers.size!==0)throw new Error('leaked workers');if(maxTransfer>65536*2*4)throw new Error('whole-song PCM copied');return result;
};
(window as any).long=async()=>{
 const b=fixture(48000,2,48000*240),start=performance.now(),reference=await originalPeaks(b,.7),baselineMs=performance.now()-start;
 const at=performance.now(),actual=await limitTruePeaks(b,.7,signal),optimizedMs=performance.now()-at;
 for(let c=0;c<2;c++)equal(actual.getChannelData(c),reference.getChannelData(c),'four-minute true peaks');
 const block=Math.ceil(48000*16/128)*128,context=4096;
 return {seconds:240,rate:48000,channels:2,baselineMs,optimizedMs,exactPCM:true,baselineUpsampledBytes:b.length*4*2*4,windowUpsampledBytes:(block+context*2)*4*2*4,extraFullRateOutputBytes:b.length*2*4,workersAfter:workers.size,scope:'ArrayBuffer sizes bound the resampling scratch, not OS RSS or native context internals.'};
};`);
    await build({ configFile: false, root: dir, base: "./", logLevel: "error", build: { outDir: "dist", emptyOutDir: true } });
    window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    await window.loadFile(path.join(dir, "dist/index.html"));
    const native = await window.webContents.executeJavaScript("window.check()", true); assert.equal(native.workersAfter, 0);
    await writeFile(path.join(output, "electron.json"), JSON.stringify(native, null, 2)); console.log("PASS electron", JSON.stringify(native));
    if (process.argv.includes("--long")) { const result = await window.webContents.executeJavaScript("window.long()", true); await writeFile(path.join(output, "long.json"), JSON.stringify(result, null, 2)); console.log("PASS long", JSON.stringify(result)); }
    window.destroy(); window = null;
    const modulePath = argument("--playwright-module");
    if (modulePath) {
      const { chromium, webkit } = await import(pathToFileURL(modulePath).href);
      server = createServer(async (req, res) => { try { const pathname = new URL(req.url, "http://test").pathname; const file = path.resolve(dir, "dist", `.${pathname === "/" ? "/index.html" : pathname}`); assert.ok(file.startsWith(path.join(dir, "dist") + path.sep)); res.setHeader("Content-Type", file.endsWith(".html") ? "text/html" : "text/javascript"); res.end(await readFile(file)); } catch { res.writeHead(404); res.end(); } });
      await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
      for (const [name, engine] of Object.entries({ chromium, webkit })) {
        const browser = await engine.launch({ headless: true });
        try { const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}`); const result = await page.evaluate(() => window.check()); await writeFile(path.join(output, name + ".json"), JSON.stringify(result, null, 2)); console.log("PASS", name, JSON.stringify(result)); }
        finally { await browser.close(); }
      }
    }
  } catch (error) { console.error(error); exitCode = 1; }
  finally { window?.destroy(); if (server) await new Promise(resolve => server.close(resolve)); await rm(profile, { recursive: true, force: true, maxRetries: 5 }); app.exit(exitCode); }
}
void main();
