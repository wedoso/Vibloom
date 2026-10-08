// Serial compiled-Worker timings. Invoked by benchmark-remaster.py after a build.
import { app, BrowserWindow, net, protocol } from 'electron';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),output=path.resolve(process.argv[2]??path.join(root,'outputs/remaster-speed'));
const profile=await mkdtemp(path.join(tmpdir(),'vibloom-speed-'));
app.setPath('userData',profile);app.on('window-all-closed',()=>{});
protocol.registerSchemesAsPrivileged([{scheme:'vibloom',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true}}]);
let window,exitCode=0;
const timer=setTimeout(()=>app.exit(1),300000);
async function benchmark(){
try {
 await app.whenReady();
 protocol.handle('vibloom',request=>{
  const pathname=new URL(request.url).pathname;
  if(pathname==='/index.html')return new Response('<!doctype html><title>Remaster speed</title>',{headers:{'content-type':'text/html'}});
  const base=pathname.startsWith('/input/')?output:path.join(root,'dist');
  const file=path.resolve(base,`.${pathname}`);
  if(!file.startsWith(base+path.sep))return new Response('Not found',{status:404});
  return net.fetch(pathToFileURL(file).href);
 });
 window=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 await window.loadURL('vibloom://app/index.html');
 const asset=(await readdir(path.join(root,'dist/assets'))).find(name=>/^remaster.worker-.*\.js$/.test(name));
 const manifest=JSON.parse(await readFile(path.join(output,'manifest.json'),'utf8')),fixtures=manifest.fixtures;
 const rows=[];
 for(const fixture of fixtures){
  const metrics=await window.webContents.executeJavaScript(`(async()=>{
   const fixture=${JSON.stringify(fixture)};
   const input=new Float32Array(await (await fetch('/'+fixture.pcm)).arrayBuffer());
   const worker=new Worker('/assets/'+${JSON.stringify(asset)},{type:'module'});
   let offset=0;
   return await new Promise((resolve,reject)=>{
    worker.onerror=()=>reject(new Error('Worker failed'));
    worker.onmessage=({data})=>{
     if(data.type==='ready'||data.type==='next'){
      const end=Math.min(fixture.frames,offset+fixture.rate*2);
      const channels=Array.from({length:fixture.channels},(_,c)=>Float32Array.from({length:end-offset},(_,i)=>input[(offset+i)*fixture.channels+c]));offset=end;
      worker.postMessage({type:'chunk',channels,final:end===fixture.frames},channels.map(x=>x.buffer));
     }else if(data.type==='result')resolve({...data.metrics,byteLength:data.byteLength});
     else if(data.type==='error')reject(new Error(data.message));
    };
    worker.postMessage({type:'init',rate:fixture.rate,length:fixture.frames,channels:fixture.channels,presetId:${JSON.stringify(manifest.preset)}});
   }).finally(()=>worker.terminate());
  })()`,true);
  rows.push({fixture:fixture.id,...metrics});console.log('WORKER',fixture.id,JSON.stringify(metrics));
 }
 await writeFile(path.join(output,'worker-results.json'),JSON.stringify({electron:process.versions.electron,node:process.versions.node,rows},null,2));

}catch(error){console.error(error);exitCode=1;}finally{clearTimeout(timer);window?.destroy();await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100}).catch(()=>{});app.exit(exitCode);}

}
void benchmark();
