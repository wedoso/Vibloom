/* global window, document */
import assert from "node:assert/strict";
import { build } from "vite";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
const at = process.argv.indexOf("--playwright-module");
const { chromium, webkit } = await import(at < 0 ? "playwright" : pathToFileURL(path.resolve(process.argv[at + 1])).href);
const root = path.resolve(".cache/vocal-playback-state"), output = path.resolve("outputs/vocal-playback-state");
await mkdir(root, { recursive: true }); await mkdir(output, { recursive: true });
await writeFile(path.join(root, "index.html"), '<div id="root"></div><script type="module" src="./check.tsx"></script>');
await writeFile(path.join(root, "check.tsx"), `
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { useState } from 'react';
import { useVocalPlaybackState } from '../../src/audio/vocals/useVocalPlayback';
import { VocalAnalysisStore } from '../../src/audio/vocals/analysisStore';
const w=window as any, records=new Map(), missing=(ref:any)=>{w.missing.push(ref.cacheKey);};
w.reads=0;w.failures=0;w.delay=0;w.broken=false;w.missing=[];
const storage=new VocalAnalysisStore({
 async get(key:string){w.reads++;const delay=w.delay;if(delay)await new Promise(r=>setTimeout(r,delay));if(w.broken || w.failures-->0)throw new Error('Temporary read failure');return records.get(key);},
 async put(key:string,value:any){records.set(key,value);},async remove(key:string){records.delete(key);}
});
w.seed=async()=>{w.ref=await storage.put({version:4,rms:new Float64Array(100).fill(.3),vowels:Uint8Array.from({length:500},(_,i)=>[200,20,30,10,10][i%5])});};
w.release=()=>storage.release();
function App(){
 const [props,change]=useState<any>({analysis:undefined,duration:2,enabled:false});w.change=(patch:any)=>flushSync(()=>change((old:any)=>({...old,...patch})));
 const state=useVocalPlaybackState(props.analysis,props.duration,props.enabled,storage,missing);w.retry=state.retry;
 const pose=state.sample(.5,.8);
 return <output id="state" data-ready={state.ready} data-loading={state.loading} data-error={state.error??''} data-open={pose.open}/>;
}
flushSync(()=>createRoot(document.getElementById('root')!).render(<App/>));
`);
await build({ configFile: false, root, base: "./", logLevel: "error", esbuild: { jsx: "automatic" }, build: { outDir: "dist", emptyOutDir: true } });
const base = path.join(root, "dist"), results = [];
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, "http://test").pathname, file = path.resolve(base, `.${pathname === "/" ? "/index.html" : pathname}`);
    assert.ok(file.startsWith(base + path.sep)); res.setHeader("Content-Type", file.endsWith(".html") ? "text/html" : "text/javascript"); res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
try {
  for (const [name, engine] of Object.entries({ chromium, webkit })) {
    const browser = await engine.launch({ headless: true });
    try {
      const page = await browser.newPage(), errors = []; page.on("pageerror", error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/`); await page.waitForFunction(() => !!window.change);
      await page.evaluate(async () => { await window.seed(); window.failures=2;window.change({analysis:window.ref,enabled:true}); });
      await page.waitForFunction(() => document.querySelector("#state").dataset.loading === "true");
      await page.waitForFunction(() => Number(document.querySelector("#state").dataset.open) > .25);
      assert.equal(await page.evaluate(() => window.reads), 3, "temporary failures recover automatically without toggling");
      for (let i=0;i<30;i++) {
        await page.evaluate(() => window.change({analysis:{...window.ref}}));
        assert.ok(await page.locator("#state").evaluate(el => Number(el.dataset.open) > .25), "same durable reference never loses loaded curves");
      }
      assert.equal(await page.evaluate(() => window.reads), 3, "metadata identity changes do not reread curves");
      await page.evaluate(() => window.change({enabled:false}));
      assert.equal(await page.locator("#state").evaluate(el => Number(el.dataset.open)), 0);
      await page.evaluate(() => window.change({enabled:true}));
      await page.waitForFunction(() => Number(document.querySelector("#state").dataset.open) > .25);
      assert.equal(await page.evaluate(() => window.reads), 3, "reenabling retains the usable loaded curve");
      await page.evaluate(async () => { window.change({enabled:false});window.release();await window.seed();window.broken=true;window.change({analysis:window.ref,enabled:true}); });
      await page.waitForFunction(() => !!document.querySelector("#state").dataset.error);
      assert.equal(await page.evaluate(() => window.reads), 7, "automatic retry is bounded");
      assert.equal(await page.locator("#state").evaluate(el => el.dataset.ready), "false");
      await page.evaluate(() => { window.broken=false;window.retry(); });
      await page.waitForFunction(() => Number(document.querySelector("#state").dataset.open) > .25);
      await page.evaluate(() => { window.change({enabled:false});window.release();window.delay=250;window.change({analysis:{...window.ref,cacheKey:'late-missing'},enabled:true});window.change({analysis:{...window.ref}}); });
      await page.waitForFunction(() => Number(document.querySelector("#state").dataset.open) > .25);
      await page.waitForTimeout(350); assert.deepEqual(await page.evaluate(() => window.missing), [], "late missing result never clears newly selected source");
      assert.deepEqual(errors, []);
      const result={engine:name,automaticRecovery:true,stableReference:true,boundedRetry:true,explicitRetry:true,staleReadIgnored:true,errors};results.push(result);console.log("PASS",JSON.stringify(result));
    } finally { await browser.close(); }
  }
  await writeFile(path.join(output, "report.json"), JSON.stringify(results, null, 2));
} finally { await new Promise(resolve => server.close(resolve)); }
