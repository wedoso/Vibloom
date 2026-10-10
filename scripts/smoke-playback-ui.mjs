import { app } from "electron";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Exercise the real main process and preload using a disposable user profile.
const root = fileURLToPath(new URL("../dist/", import.meta.url));
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm" };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://local").pathname);
    const file = path.resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (!file.startsWith(root)) { response.writeHead(403); response.end(); return; }
    response.setHeader("Content-Type", mime[path.extname(file)] ?? "application/octet-stream");
    response.end(await readFile(file));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
process.env.VIBLOOM_DEV_SERVER_URL = `http://127.0.0.1:${server.address().port}/`;
const profile = await mkdtemp(path.join(tmpdir(), "vibloom-playback-ui-"));
app.setPath("userData", profile);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let exitCode = 0;
const timeout = setTimeout(() => { console.error("Playback UI smoke timed out"); app.exit(1); }, 90000);
app.once("browser-window-created", (_event, window) => {
  window.setOpacity(.01);
  window.webContents.setAudioMuted(true);
  window.webContents.on("console-message", event => { if (event.level === "error") console.error("Renderer:", event.message); });
  window.webContents.once("did-finish-load", () => { void smoke(window); });
});
async function smoke(window) {
  const run = code => window.webContents.executeJavaScript(code, true);
  const wait = async (code, label) => {
    for (let i = 0; i < 150; i++) { if (await run(code)) return; await delay(100); }
    throw new Error(`Timeout: ${label}; native visible=${window.isVisible()}, minimized=${window.isMinimized()}, renderer=${JSON.stringify(await run(`(async()=>({bridge:await window.vibloomWindowState.read(),writes:window.__visualWrites,events:window.__nativeEvents,hidden:document.hidden,status:document.querySelector('.live2d-stage')?.dataset.status}))()`))}`);
  };
  try {
    window.webContents.debugger.attach("1.3");
    await window.webContents.debugger.sendCommand("Page.enable");
    await window.webContents.debugger.sendCommand("Page.addScriptToEvaluateOnNewDocument", { source: `
      window.__visualWrites=0; window.__modelDraws=0; window.__stateWrites=[]; window.__mediaActions={};
      for(const Context of [WebGLRenderingContext,WebGL2RenderingContext])for(const name of ['drawElements','drawArrays']){
        const draw=Context.prototype[name];Context.prototype[name]=function(...args){if(this.canvas===document.querySelector('canvas.live2d-canvas'))window.__modelDraws++;return draw.apply(this,args);};
      }
      const property=CSSStyleDeclaration.prototype.setProperty;
      CSSStyleDeclaration.prototype.setProperty=function(...args){if(args[0].startsWith('--') && this===document.querySelector('.live2d-stage')?.style)window.__visualWrites++;return property.apply(this,args);};
      const put=IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put=function(...args){if(this.name==='state')window.__stateWrites.push(args[1]);return put.apply(this,args);};
      const register=MediaSession.prototype.setActionHandler;
      MediaSession.prototype.setActionHandler=function(action,handler){window.__mediaActions[action]=handler;return register.call(this,action,handler);};
    ` });
    await wait(`document.querySelector('.companion-selector [role=combobox]')?.disabled===false`, "storage ready");
    await delay(500);
    await run(`(async()=>{
      const rate=8000, dir=await (await navigator.storage.getDirectory()).getDirectoryHandle('tracks',{create:true});
      const tracks=[];
      for(const [index,seconds] of [2,20].entries()) {
        const frames=rate*seconds,bytes=new ArrayBuffer(44+frames*2),v=new DataView(bytes);
        const text=(at,s)=>[...s].forEach((c,i)=>v.setUint8(at+i,c.charCodeAt(0)));
        text(0,'RIFF');v.setUint32(4,bytes.byteLength-8,true);text(8,'WAVE');text(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);text(36,'data');v.setUint32(40,frames*2,true);
        for(let i=0;i<frames;i++)v.setInt16(44+i*2,Math.sin(i*2*Math.PI*220/rate)*4000,true);
        const id='ui-smoke-'+index,writer=await(await dir.getFileHandle(id+'.audio',{create:true})).createWritable();await writer.write(bytes);await writer.close();
        tracks.push({id,fingerprint:id,name:'UI smoke '+index+'.wav',relativePath:'UI smoke '+index+'.wav',sourceLabel:'Smoke test',size:bytes.byteLength,lastModified:1,duration:seconds,availability:'available',persistence:'cached',lyricsFileName:'smoke.lrc',lyrics:[{time:0,text:'First line'},{time:1,text:'Second line'}],comparison:null});
      }
      const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('vibloom-library');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      await new Promise((resolve,reject)=>{const tx=db.transaction('state','readwrite');tx.objectStore('state').delete('session');tx.objectStore('state').put({version:3,tracks,albums:[],session:{queue:tracks.map(t=>t.id),history:[],currentTrackId:tracks[0].id,currentTime:.25,shuffle:false,repeat:'one',volume:.4,cacheEnabled:true,companionId:'hong-xi'}},'library');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
    })()`);
    window.hide();
    await window.loadURL(process.env.VIBLOOM_DEV_SERVER_URL);
    await wait(`document.querySelector('.live2d-stage[data-status="ready"]') && document.querySelector('.transport-play')`, "legacy library and hidden model ready");
    await delay(700);
    assert.equal(await run(`window.vibloomWindowState.read()`), false);
    assert.equal(await run(`document.querySelector('[aria-label="Playback position"]').value`), "0.25");
    await run(`window.__nativeEvents=[];window.vibloomWindowState.subscribe(value=>window.__nativeEvents.push(value));window.__visualWrites=0;window.__modelDraws=0; window.__canvas=document.querySelector('canvas.live2d-canvas')`);
    await delay(400);
    assert.equal(await run(`window.__visualWrites`), 0, "initial hidden model does not animate");
    assert.equal(await run(`window.__modelDraws`), 0, "initial hidden model does not render");
    window.show();
    await wait(`window.__modelDraws>10`, "visible model resumes");
    await run(`document.querySelector('.transport-play').click()`);
    await wait(`navigator.mediaSession.playbackState==='playing'`, "playback starts");
    const first = await run(`Number(document.querySelector('[aria-label="Playback position"]').value)`);
    await delay(250);
    assert.ok(await run(`Number(document.querySelector('[aria-label="Playback position"]').value)`) > first, "local playhead follows audio");
    window.hide();
    await delay(700);
    await run(`window.__visualWrites=0;window.__modelDraws=0`);
    await delay(2500);
    assert.equal(await run(`window.__visualWrites`), 0, "hidden playing window has no stage animation");
    assert.equal(await run(`window.__modelDraws`), 0, "hidden playing window has no model render");
    assert.equal(await run(`navigator.mediaSession.playbackState`), "playing", "single-track repeat continues hidden");
    assert.equal(await run(`navigator.mediaSession.metadata.title`), "UI smoke 0");
    await run(`window.__mediaActions.nexttrack()`);
    await wait(`navigator.mediaSession.metadata.title==='UI smoke 1' && navigator.mediaSession.playbackState==='playing'`, "headset next while hidden");
    await delay(700);
    const saved = await run(`(async()=>{const r=indexedDB.open('vibloom-library');const db=await new Promise(resolve=>r.onsuccess=()=>resolve(r.result));try{return await new Promise(resolve=>{const q=db.transaction('state').objectStore('state').get('library');q.onsuccess=()=>resolve(JSON.stringify(q.result.tracks));});}finally{db.close();}})()`);
    await run(`window.__stateWrites=[]`);
    await delay(5500);
    assert.ok(await run(`window.__stateWrites.includes('session')`), "hidden playback checkpoints session");
    assert.equal(await run(`window.__stateWrites.includes('library')`), false, "checkpoint does not serialize song metadata");
    await run(`window.__mediaActions.pause()`);
    await wait(`navigator.mediaSession.playbackState==='paused'`, "headset pause while hidden");
    await delay(500);
    const persisted = await run(`(async()=>{const r=indexedDB.open('vibloom-library');const db=await new Promise(resolve=>r.onsuccess=()=>resolve(r.result));try{return await new Promise(resolve=>{const tx=db.transaction('state'),store=tx.objectStore('state'),a=store.get('library'),b=store.get('session');tx.oncomplete=()=>resolve({tracks:JSON.stringify(a.result.tracks),session:b.result});});}finally{db.close();}})()`);
    assert.equal(persisted.tracks, saved);
    assert.equal(persisted.session.currentTrackId, "ui-smoke-1");
    assert.ok(persisted.session.currentTime > 5);
    assert.equal(persisted.session.volume, .4);
    window.show();
    await wait(`window.__modelDraws>10`, "restored model resumes");
    assert.ok(await run(`window.__canvas===document.querySelector('canvas.live2d-canvas')`), "show keeps the same model canvas");
    // The hidden scheduler still owns automatic next-track behavior.
    await run(`document.querySelector('[aria-label="Repeat one"]').click()`);
    await wait(`document.querySelector('[aria-label="Repeat off"]')`, "repeat off selected");
    await run(`document.querySelector('[aria-label="Repeat off"]').click(); window.__mediaActions.seekto({seekTime:19.5}); window.__mediaActions.play()`);
    window.hide();
    await wait(`navigator.mediaSession.metadata.title==='UI smoke 0' && navigator.mediaSession.playbackState==='playing'`, "automatic queue advance while hidden");
    await run(`window.__mediaActions.pause()`);
    // Restore the separately saved session without changing the old snapshot.
    await run(`(async()=>{const r=indexedDB.open('vibloom-library');const db=await new Promise(resolve=>r.onsuccess=()=>resolve(r.result));await new Promise(resolve=>{const tx=db.transaction('state','readwrite');tx.objectStore('state').put(${JSON.stringify(persisted.session)},'session');tx.oncomplete=resolve;});db.close();})()`);
    await window.loadURL(process.env.VIBLOOM_DEV_SERVER_URL);
    await wait(`document.querySelector('.transport-track strong')?.textContent==='UI smoke 1'`, "separate session restored");
    await wait(`Math.abs(Number(document.querySelector('[aria-label="Playback position"]').value)-${persisted.session.currentTime})<.05`, "saved position restored");
    console.log("PASS actual native visibility bridge, hidden model startup/resume, repeat, headset controls, queue advance, legacy storage, session-only checkpoints and reload");
  } catch (error) { console.error(error); exitCode = 1; }
  finally {
    clearTimeout(timeout);
    server.close();
    window.destroy();
    try { await rm(profile, { recursive: true, force: true, maxRetries: 3 }); }
    finally { app.exit(exitCode); }
  }
}
await import("../desktop/main.mjs");
