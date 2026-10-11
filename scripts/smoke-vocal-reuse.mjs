import { app, BrowserWindow, net, protocol } from "electron";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "outputs/vocal-worker-perf");
const argument = name => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
const modelDirectory = path.resolve(root, argument("--model-dir") ?? ".cache/spleeter");
const profile = await mkdtemp(path.join(tmpdir(), "vibloom-vocal-reuse-"));
app.setPath("userData", profile);
app.on("window-all-closed", () => {});
protocol.registerSchemesAsPrivileged([{ scheme: "vibloom", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let window, exitCode = 0;
async function smoke() {
  const timeout = setTimeout(() => { console.error("Vocal reuse smoke timed out"); app.exit(1); }, 300000);
  try {
    await app.whenReady();
    await mkdir(output, { recursive: true });
    await writeFile(path.join(output, "index.html"), '<!doctype html><title>Vocal worker reuse test</title><pre id="state">Loading</pre><script type="module" src="./benchmark.ts"></script>');
    await writeFile(path.join(output, "benchmark.ts"), `
import { analyzeVocals as desktop, analyzeMobileVocals as mobile } from '../../src/audio/vocals/analyzeVocals';
const modelBase='https://huggingface.co/csukuangfj/sherpa-onnx-spleeter-2stems-fp16/resolve/93ba771920ade509f8cbd6825b1a90856c797e08';
const NativeWorker=window.Worker, active=new Set<Worker>(); let measures:any[]=[];
window.Worker=class extends NativeWorker {
 role:string; started=0; requestType='';
 constructor(url:any, options:any){super(url,options);active.add(this);this.role=String(url).includes('separation.worker')?'spleeter':'motionsync';this.addEventListener('message',({data})=>{if(['ready','result','error'].includes(data.type)) measures.push({role:this.role,type:this.requestType,ms:performance.now()-this.started,backend:data.backend,error:data.message});});}
 postMessage(message:any, transfer:any[]=[]){this.started=performance.now();this.requestType=message.type??'classify';super.postMessage(message,transfer);}
 terminate(){active.delete(this);super.terminate();}
};
(window as any).__activeWorkers=()=>active.size;
const clipSeconds=Number(new URL(location.href).searchParams.get('seconds')??24);
const results:any={userAgent:navigator.userAgent,clipSeconds,rounds:[],scope:'Shared Spleeter and MotionSync. Downloads and fixture decode excluded. Desktop/mobile entry points, three jobs each, cached weights and fresh inference heaps.'};
async function run(){try{
 const cache=await caches.open('vibloom-demucs-v1');for(const name of ['vocals','accompaniment'])await cache.put(modelBase+'/'+name+'.fp16.onnx',new Response(await(await fetch('./models/'+name+'.fp16.onnx')).arrayBuffer()));
 const voice=await new OfflineAudioContext(2,1,44100).decodeAudioData(await(await fetch('./voice.wav')).arrayBuffer());
 const buffer=new AudioBuffer({numberOfChannels:2,length:clipSeconds*44100,sampleRate:44100});
 for(let c=0;c<2;c++){const target=buffer.getChannelData(c),source=voice.getChannelData(Math.min(c,voice.numberOfChannels-1));for(let at=0;at<target.length;at+=source.length)target.set(source.subarray(0,Math.min(source.length,target.length-at)),at);}
 let reference:any=null;
 for(const [variant,analyze] of [['desktop',desktop],['mobile',mobile]] as const){
  for(let round=1;round<=3;round++){
   measures=[];const start=performance.now();
   const frames=await analyze(buffer,new AbortController().signal,p=>{document.querySelector('#state')!.textContent=JSON.stringify({variant,round,...p});});
   const totalMs=performance.now()-start;if(!reference)reference=frames;
   let rmsMaxAbsDiff=0,vowelDiffCount=0;
   for(let i=0;i<frames.rms.length;i++)rmsMaxAbsDiff=Math.max(rmsMaxAbsDiff,Math.abs(frames.rms[i]-reference.rms[i]));
   for(let i=0;i<frames.vowels.length;i++)if(frames.vowels[i]!==reference.vowels[i])vowelDiffCount++;
   const result={variant,round,totalMs,frames:frames.rms.length,vowels:frames.vowels.length,rmsMaxAbsDiff,vowelDiffCount,activeWorkers:active.size,measures:[...measures]};
   results.rounds.push(result);console.log(JSON.stringify(result));(window as any).__reuseResults=results;
  }
 }
 results.afterJobsWorkers=active.size;results.done=true;
}catch(error){results.error=String(error);}finally{(window as any).__reuseResults=results;document.querySelector('#state')!.textContent=JSON.stringify(results,null,2);}}
void run();
`);
    const base = path.join(output, "build");
    await build({ configFile: path.join(root, "vite.config.ts"), root, logLevel: "warn", build: { outDir: base, rollupOptions: { input: path.join(output, "index.html") }, emptyOutDir: true } });
    if (process.argv.includes("--build-only")) { console.log("Vocal reuse harness built"); return; }
    protocol.handle("vibloom", request => {
      const pathname = new URL(request.url).pathname;
      const file = pathname.startsWith("/models/") ? path.join(modelDirectory,path.basename(pathname)) : pathname === "/voice.wav" ? path.join(root, "tests/fixtures/vocal-speech.wav")
        : pathname === "/index.html" ? path.join(base, "outputs/vocal-worker-perf/index.html") : path.resolve(base, `.${pathname}`);
      return net.fetch(pathToFileURL(file).href);
    });
    window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    window.webContents.on("console-message", event => { if (event.level === "error") console.error(event.message); });
    await window.loadURL("vibloom://app/index.html");
    let result;
    const memory = [];
    for (let i = 0; i < 600; i++) {
      await delay(250);
      result = await window.webContents.executeJavaScript("window.__reuseResults ?? null");
      if (i % 4 === 0) memory.push({ seconds: i / 4, rounds: result?.rounds.length ?? 0, processes: app.getAppMetrics().filter(p => p.type === "Tab" || p.type === "GPU").map(p => ({ type: p.type, memory: p.memory })) });
      if (result?.done || result?.error) break;
    }
    assert.ok(result?.done, result?.error ?? "benchmark did not finish");
    result.versions = process.versions; result.memory = memory;
    await writeFile(path.join(output, "electron.json"), `${JSON.stringify(result, null, 2)}\n`);
    for (const round of result.rounds) {
      assert.equal(round.frames, Math.ceil(result.clipSeconds * 50)); assert.equal(round.vowels, round.frames * 5);
      assert.equal(round.rmsMaxAbsDiff, 0, "cold/warm RMS output must match");
      assert.equal(round.vowelDiffCount, 0, "cold/warm shapes must match");
    }
    assert.ok(result.rounds.every(r => r.activeWorkers === 0), "each job releases all inference workers");
    assert.ok(result.rounds.every(r => r.measures.some(m => m.type === "init")), "cached weights still use fresh heaps");
    assert.equal(result.afterJobsWorkers, 0);
    console.log("PASS shared desktop/mobile raw outputs, cached weights, GPU rotation and immediate worker release");
    console.log(JSON.stringify(result.rounds.map(({ variant, round, totalMs, measures }) => ({ variant, round, totalMs, initMs: measures.filter(m => m.type === "init").reduce((sum, m) => sum + m.ms, 0) }))));
  } catch (error) { console.error(error); exitCode = 1; }
  finally {
    clearTimeout(timeout); window?.destroy();
    try { await rm(profile, { recursive: true, force: true, maxRetries: 3 }); }
    finally { app.exit(exitCode); }
  }
}
void smoke();
