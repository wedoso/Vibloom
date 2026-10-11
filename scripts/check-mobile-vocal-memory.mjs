/* global window */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";

const argument = name => { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; };
const root = process.cwd(), output = path.join(root, "outputs/iphone-vocal-memory"), base = path.join(output, "build");
const model = path.resolve(argument("--model") ?? path.join(output, "htdemucs.onnx"));
const seconds = Number(argument("--seconds") ?? 8);
assert.ok(Number.isFinite(seconds) && seconds > 0 && seconds <= 120);
const modelDirectory = path.resolve(argument("--model-dir") ?? path.join(output, "spleeter"));
const modulePath = argument("--playwright-module") ?? "playwright";
const { chromium, webkit } = await import(path.isAbsolute(modulePath) ? pathToFileURL(modulePath).href : modulePath);
await mkdir(output, { recursive: true });
await writeFile(path.join(output, "index.html"), '<!doctype html><title>Mobile vocal memory regression</title><script type="module" src="./check.ts"></script>');
await writeFile(path.join(output, "check.ts"), `
import { analyzeVocals, analyzeMobileVocals, releaseIdleVocalWorkers } from '../../src/audio/vocals/analyzeVocals';
const NativeWorker=window.Worker, active=new Set<Worker>(), events:any[]=[];
window.Worker=class extends NativeWorker {
 role:string; started=0; kind='';
 constructor(url:any,options:any){super(url,options);this.role=String(url).toLowerCase().includes('separation.worker')?'separator':'motion';active.add(this);events.push({event:'created',role:this.role,active:active.size});this.addEventListener('message',({data})=>{if(['ready','result','error'].includes(data.type))events.push({event:data.type,role:this.role,kind:this.kind,ms:performance.now()-this.started,backend:data.backend,runtime:data.runtime});});}
 postMessage(data:any,transfer:any[]=[]){this.started=performance.now();this.kind=data.type??'shapes';super.postMessage(data,transfer);}
 terminate(){active.delete(this);events.push({event:'released',role:this.role,active:active.size});super.terminate();}
};
const result:any={rounds:[],limitation:'Desktop engines exercise real production inference and storage; this is not an iPhone process-memory or WebGPU stability reproduction.'};
async function run(){try{
 const voice=await new OfflineAudioContext(2,1,44100).decodeAudioData(await(await fetch('/voice.wav')).arrayBuffer());
 const buffer=new AudioBuffer({numberOfChannels:2,length:${seconds}*44100,sampleRate:44100});
 for(let c=0;c<2;c++){const target=buffer.getChannelData(c),source=voice.getChannelData(Math.min(c,voice.numberOfChannels-1));for(let i=0;i<target.length;i+=source.length)target.set(source.subarray(0,Math.min(source.length,target.length-i)),i);}
 let reference:any;
 for(const [name,analyze] of [['mobile-download',analyzeMobileVocals],['mobile-cached',analyzeMobileVocals],...${process.argv.includes('--mobile-only') ? '[]' : "[['desktop',analyzeVocals]]"}] as const){
   events.length=0;const phases:any[]=[],started=performance.now();
   const frames=await analyze(buffer,new AbortController().signal,p=>{phases.push(p);(window as any).__lastVocalPhase={name,...p};});
   if(!reference)reference=frames;
   let rmsMaxAbsDiff=0,vowelDiffCount=0;
   for(let i=0;i<frames.rms.length;i++)rmsMaxAbsDiff=Math.max(rmsMaxAbsDiff,Math.abs(frames.rms[i]-reference.rms[i]));
   for(let i=0;i<frames.vowels.length;i++)if(frames.vowels[i]!==reference.vowels[i])vowelDiffCount++;
   result.rounds.push({name,ms:performance.now()-started,frames:frames.rms.length,vowels:frames.vowels.length,rmsMaxAbsDiff,vowelDiffCount,active:active.size,events:[...events],phases});
   console.log(JSON.stringify(result.rounds.at(-1)));
 }
 releaseIdleVocalWorkers();result.activeAfterRelease=active.size;
 try {
  const models=await(await navigator.storage.getDirectory()).getDirectoryHandle('vibloom-vocal-models');
  result.diskModelBytes=0;
  for(const name of ['vocals','accompaniment']){const file=await models.getFileHandle('93ba771920ade509f8cbd6825b1a90856c797e08-'+name+'.fp16.onnx');result.diskModelBytes+=(await file.getFile()).size;}
 } catch(error){result.diskCacheUnavailable=String(error);}
 result.done=true;
}catch(error){result.error=String(error);}finally{releaseIdleVocalWorkers();(window as any).__mobileMemoryResult=result;}}
void run();
`);
await build({ configFile: path.join(root, "vite.config.ts"), root, logLevel: "warn", build: { outDir: base, rollupOptions: { input: path.join(output, "index.html") }, emptyOutDir: true } });
const mime = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm" };
const serve = async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://test").pathname);
    const file = pathname.startsWith("/models/") ? (pathname.endsWith("htdemucs_embedded.onnx") ? model : path.join(modelDirectory,path.basename(pathname))) : pathname === "/voice.wav" ? path.join(root, "tests/fixtures/vocal-speech.wav")
      : pathname === "/" ? path.join(base, "outputs/iphone-vocal-memory/index.html") : path.resolve(base, `.${pathname}`);
    if (!pathname.startsWith("/models/") && pathname !== "/voice.wav") assert.ok(file.startsWith(`${base}${path.sep}`));
    response.setHeader("Content-Type", mime[path.extname(file)] ?? "application/octet-stream");
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Content-Length", (await stat(file)).size);
    createReadStream(file).pipe(response);
  } catch { response.writeHead(404); response.end(); }
};
const tlsDirectory = await mkdtemp(path.join(tmpdir(), "vibloom-mobile-memory-"));
const keyPath = path.join(tlsDirectory, "key.pem"), certPath = path.join(tlsDirectory, "cert.pem");
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath, "-out", certPath, "-days", "1", "-subj", "/CN=127.0.0.1"], { stdio: "ignore" });
const server = createServer(serve), tlsServer = createHttpsServer({ key: await readFile(keyPath), cert: await readFile(certPath) }, serve);
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
await new Promise(resolve => tlsServer.listen(0, "127.0.0.1", resolve));
try {
  for (const [engine, type] of Object.entries({ chromium, webkit })) {
    if (argument("--engine") && argument("--engine") !== engine) continue;
    const browser = await type.launch({ headless: !process.argv.includes("--headed"), args: engine === "chromium" && process.argv.includes("--headed") ? ["--enable-unsafe-webgpu"] : [] });
    try {
      const context = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await context.newPage(), errors = [], wasmRequests = [];
      let downloads = 0;
      page.on("pageerror", error => errors.push(error.message));
      page.on("request", request => { if (request.url().includes("ort-wasm") && request.url().includes(".wasm")) wasmRequests.push(request.url()); });
      page.on("crash", () => console.error(`${engine}: renderer crashed`));
      page.on("console", message => { if (message.type() === "error") console.error(engine, message.text()); });
      await context.route("https://huggingface.co/**", async route => {
        downloads++;
        await route.continue({ url: `https://127.0.0.1:${tlsServer.address().port}/models/${new URL(route.request().url()).pathname.split("/").at(-1)}` });
      });
      await page.goto(`http://127.0.0.1:${server.address().port}/${argument("--backend") ? `?vocalBackend=${argument("--backend")}` : ""}`);
      await page.waitForFunction(() => window.__mobileMemoryResult, {}, { timeout: 180000 });
      const result = await page.evaluate(() => window.__mobileMemoryResult);
      result.engine = engine; result.errors = errors; result.downloads = downloads; result.wasmRequests = wasmRequests;
      const variant = process.argv.includes("--headed") ? "-gpu" : argument("--backend") ? `-${argument("--backend")}` : "";
      await writeFile(path.join(output, `${engine}${variant}.json`), `${JSON.stringify(result, null, 2)}\n`);
      assert.ok(result.done, result.error); assert.deepEqual(errors, []); assert.equal(result.activeAfterRelease, 0);
      if (engine === "chromium") assert.equal(result.diskModelBytes, 39362041);
      if (result.diskModelBytes === 39362041) {
        assert.equal(downloads, process.argv.includes("--mobile-only") ? 2 : 3);
        assert.ok(!result.rounds[1].phases.some(phase => phase.phase.startsWith("Downloading mobile vocal model")));
      } else assert.ok(downloads <= 5, "storage-unavailable fallback must not repeatedly fetch within a job");
      const referenceBackend = result.rounds[0].events.find(event => event.event === "ready").backend;
      for (const round of result.rounds) {
        assert.equal(round.frames, seconds * 50); assert.equal(round.vowels, seconds * 250);
        const backend = round.events.find(event => event.event === "ready").backend;
        if (round.name.startsWith("mobile")) {
          assert.equal(backend, referenceBackend);assert.equal(round.rmsMaxAbsDiff, 0);assert.equal(round.vowelDiffCount, 0);
        } // Desktop uses a different model; only cached mobile curves must match.
        if (round.name.startsWith("mobile")) {
          assert.equal(round.active, 0);
          if (!argument("--backend")) {
            assert.equal(backend, engine === "webkit" ? "WebGPU" : "WASM CPU", "automatic mobile backend selects GPU or falls back when no adapter is available");
            if (backend === "WASM CPU") assert.ok(round.phases.some(phase => phase.step === "cpu-fallback"));
          }
          if (argument("--backend") === "wasm") {
            assert.equal(round.events.find(event => event.event === "ready").runtime, "wasm-simd");
            assert.ok(wasmRequests.some(url => /ort-wasm-simd-threaded-[^/]+\.wasm/.test(url)), "the CPU test downloads the plain WASM binary");
          }
          const firstSeparation = round.events.findIndex(event => event.role === "separator" && event.kind === "separate" && event.event === "result");
          const motionCreated = round.events.findIndex(event => event.role === "motion" && event.event === "created");
          assert.ok(firstSeparation >= 0 && motionCreated > firstSeparation);
        } else assert.equal(round.active, 2, "desktop keeps its existing warm worker pair");
      }
      console.log(`PASS ${engine}: real inference, storage/cache fallback, curve parity and immediate mobile heap release`);
    } finally { await browser.close(); }
  }
} finally {
  await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => tlsServer.close(resolve))]);
  await rm(tlsDirectory, { recursive: true, force: true });
}
