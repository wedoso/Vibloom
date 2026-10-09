/* global document, window, indexedDB, Live2DCubismCore, HTMLInputElement, AudioBufferSourceNode, AudioContext */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { createReadStream } from 'node:fs';
import { readFile, mkdir, writeFile, stat, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { snapshot, seedMobile, waveBytes } from './mobile-ui-fixtures.mjs';
const argument=name=>{const index=process.argv.indexOf(name);return index>=0?process.argv[index+1]:null};
const module=argument('--playwright-module')??'playwright';
const {chromium,webkit}=await import(path.isAbsolute(module)?pathToFileURL(module).href:module);
const model=path.resolve(argument('--model')??'outputs/vocal-lip-sync/htdemucs.onnx');
const output=path.resolve('outputs/mobile-ui');await mkdir(output,{recursive:true});
const voice=await readFile('tests/fixtures/vocal-speech.wav'),modelSize=(await stat(model)).size;
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.png':'image/png'};
const serve=async(req,res)=>{try{
 const url=new URL(req.url,'http://test');
 if(url.pathname==='/__model.onnx'){
  res.setHeader('Content-Type','application/octet-stream');res.setHeader('Content-Length',modelSize);res.setHeader('Access-Control-Allow-Origin','*');
  const stream=createReadStream(model,{highWaterMark:1024*1024});res.on('close',()=>stream.destroy());
  for await(const chunk of stream){if(res.destroyed)break;res.write(chunk);await new Promise(resolve=>setTimeout(resolve,10))}res.end();return;
 }
 const base=path.resolve('dist'),file=path.resolve(base,'.'+(url.pathname==='/'?'/index.html':url.pathname));assert.ok(file.startsWith(base+path.sep));res.setHeader('Content-Type',mime[path.extname(file)]??'application/octet-stream');res.end(await readFile(file));
}catch{if(!res.destroyed){if(!res.headersSent)res.writeHead(404);res.end()}}};
const tlsDirectory=await mkdtemp(path.join(tmpdir(),'vibloom-mobile-vocals-'));const keyPath=path.join(tlsDirectory,'key.pem'),certPath=path.join(tlsDirectory,'cert.pem');
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',keyPath,'-out',certPath,'-days','1','-subj','/CN=127.0.0.1'],{stdio:'ignore'});
const server=createServer(serve),tlsServer=createHttpsServer({key:await readFile(keyPath),cert:await readFile(certPath)},serve);
await new Promise(resolve=>tlsServer.listen(0,'127.0.0.1',resolve));const modelOrigin=`https://127.0.0.1:${tlsServer.address().port}`;
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
const results={modelBytes:modelSize,engines:[],errors:[],limitations:['Browser engines and mobile viewports, not physical iPhones. The pinned real Demucs weights are served from the local test cache.']};
const close=async page=>{if(await page.locator('dialog[open]').count())await page.getByRole('button',{name:'Close panel',exact:true}).click()};
const vocals=async page=>{await close(page);await page.getByRole('button',{name:'Listening options',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Vocal lip sync',exact:true}).click()};
const range=async(page,time)=>page.locator('[aria-label="Playback position"]').evaluate((input,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,String(value));input.dispatchEvent(new Event('input',{bubbles:true}))},time);
const choose=async(page,name)=>{await close(page);await page.getByRole('button',{name:'Open navigation',exact:true}).click();await page.getByRole('button',{name:'Music companion',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:new RegExp(name,'i')}).click();await close(page);await page.waitForSelector(`.live2d-stage[data-companion="${name==='Hiyori'?'hiyori':'hong-xi'}"][data-status="ready"]`)};
let code=0;
try{for(const [name,engine] of Object.entries({chromium,webkit})){
 const browser=await engine.launch(name==='chromium'?{args:['--disable-features=WebGPU']}:{});const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,ignoreHTTPSErrors:true});
 let modelRequests=0;await context.route('https://huggingface.co/**',route=>{modelRequests++;return modelRequests===2?route.abort('failed'):route.continue({url:modelOrigin+'/__model.onnx'})});
 await context.addInitScript(()=>{window.__audioStarts=0;const start=AudioBufferSourceNode.prototype.start;AudioBufferSourceNode.prototype.start=function(...args){if(this.context instanceof AudioContext)window.__audioStarts++;return start.apply(this,args)}});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(origin+'/?ui=mobile');const fixture=snapshot();fixture.tracks=fixture.tracks.slice(0,1);fixture.tracks[0].name='Voice with actual syllables.wav';fixture.tracks[0].duration=4;fixture.tracks[0].comparisons=fixture.tracks[0].comparisons.slice(0,1);fixture.tracks[0].comparisons[0].name='Silent comparison.wav';fixture.tracks[0].comparisons[0].duration=4;fixture.tracks[0].comparison=fixture.tracks[0].comparisons[0];fixture.session.currentTime=0;fixture.session.queue=[fixture.tracks[0].id];fixture.session.repeat='one';await seedMobile(page,fixture,voice);
  const silence=waveBytes(4);silence.fill(0,44);await page.evaluate(async bytes=>{const db=await new Promise(resolve=>{const req=indexedDB.open('vibloom-mobile-library',2);req.onsuccess=()=>resolve(req.result)});await new Promise(resolve=>{const tx=db.transaction('audio','readwrite');tx.objectStore('audio').put({bytes:new Uint8Array(bytes).buffer,type:'audio/wav'},'fixture-version-0');tx.oncomplete=resolve});db.close()},[...silence]);
  await page.reload();await page.waitForSelector('.live2d-stage[data-status="ready"]');
  await page.evaluate(()=>{
   const create=Live2DCubismCore.Model.fromMoc;
   Live2DCubismCore.Model.fromMoc=function(...args){const model=create.apply(this,args),update=model.update;const mouth=model.parameters.ids.indexOf('ParamMouthOpenY'),form=model.parameters.ids.indexOf('ParamMouthForm');window.__mouth={open:[],forms:[],index:mouth};model.update=function(...args){window.__mouth.open.push(model.parameters.values[mouth]);window.__mouth.forms.push(model.parameters.values[form]);if(window.__mouth.open.length>180)window.__mouth.open.shift();if(window.__mouth.forms.length>180)window.__mouth.forms.shift();return update.apply(this,args)};return model};
   window.__ticks=0;window.__heartbeat=setInterval(()=>window.__ticks++,50);
  });
  await choose(page,'Hiyori');await page.getByRole('button',{name:'Play',exact:true}).click();await vocals(page);
  await page.getByRole('button',{name:'Prepare lip sync track A',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-vocal-track="A"]')?.textContent.includes('Downloading vocal model'),{},{timeout:60000});
  assert.equal(await page.locator('.m-stage-vocals').getAttribute('aria-busy'),'true','stage icon shows preparing state');await page.screenshot({path:path.join(output,`${name}-vocal-downloading.jpg`)});
  await page.getByRole('button',{name:'Cancel preparation track A',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Prepare lip sync track A',exact:true}).count(),1);assert.ok((await page.title()).startsWith('Playing'));
  await page.getByRole('button',{name:'Prepare lip sync track A',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-vocal-track="A"]')?.dataset.vocalStatus==='error',{},{timeout:60000});assert.equal(await page.getByRole('button',{name:'Retry preparation track A',exact:true}).count(),1);await page.screenshot({path:path.join(output,`${name}-vocal-retry.jpg`)});await page.getByRole('button',{name:'Retry preparation track A',exact:true}).click();console.log(name,'real Demucs + MotionSync preparation started');
  await page.waitForFunction(()=>['ready','error'].includes(document.querySelector('[data-vocal-track="A"]')?.dataset.vocalStatus),{},{timeout:240000});
  assert.equal(await page.locator('[data-vocal-track="A"]').getAttribute('data-vocal-status'),'ready',await page.locator('[data-vocal-track="A"]').innerText());assert.equal(await page.getByRole('button',{name:'Disable lip sync track A',exact:true}).getAttribute('aria-pressed'),'true');assert.equal(await page.locator('.m-stage-vocals').getAttribute('aria-pressed'),'true','stage mic shows ready/enabled state');assert.ok((await page.title()).startsWith('Playing'),'analysis does not pause playback');assert.ok(await page.evaluate(()=>window.__ticks)>20,'worker leaves UI responsive');
  await page.getByRole('button',{name:'Prepare lip sync track B',exact:true}).click();await page.waitForFunction(()=>['ready','error'].includes(document.querySelector('[data-vocal-track="B"]')?.dataset.vocalStatus),{},{timeout:240000});assert.equal(await page.locator('[data-vocal-track="B"]').getAttribute('data-vocal-status'),'ready',await page.locator('[data-vocal-track="B"]').innerText());
  const modelChecks=[];
  for(const companion of ['Hong Xi','Hiyori']){
   await choose(page,companion);await range(page,.2);await page.evaluate(()=>{window.__mouth.open=[];window.__mouth.forms=[]});await page.waitForTimeout(1600);const pose=await page.evaluate(()=>window.__mouth);assert.ok(Math.max(...pose.open)-Math.min(...pose.open)>.15,companion+' actual mouth opens with syllables');assert.ok(Math.max(...pose.forms)-Math.min(...pose.forms)>.1,companion+' actual vowel shape changes');
   await vocals(page);const starts=await page.evaluate(()=>window.__audioStarts);await page.getByRole('button',{name:'Disable lip sync track A',exact:true}).click();assert.equal(await page.locator('.m-stage-vocals').getAttribute('aria-pressed'),'false','stage mic shows disabled state');await page.waitForTimeout(300);await page.evaluate(()=>window.__mouth.open=[]);await page.waitForTimeout(250);const disabled=await page.evaluate(()=>window.__mouth.open);assert.ok(disabled.every(value=>value<.02),'disabled closes actual mouth');assert.equal(await page.evaluate(()=>window.__audioStarts),starts,'lip toggle never restarts audio');await page.getByRole('button',{name:'Enable lip sync track A',exact:true}).click();await close(page);
   await page.getByRole('button',{name:'Listen to track B',exact:true}).click();await page.waitForTimeout(300);await page.evaluate(()=>window.__mouth.open=[]);await page.waitForTimeout(400);assert.ok((await page.evaluate(()=>window.__mouth.open)).every(value=>value<.02),'silent audible source closes actual mouth');
   await page.getByRole('button',{name:'Listen to track A',exact:true}).click();await range(page,.2);await page.waitForTimeout(600);assert.ok(await page.evaluate(()=>Math.max(...window.__mouth.open))>.15,'switch back follows source voice');
   await page.getByRole('button',{name:'Pause',exact:true}).click();await page.waitForTimeout(300);await page.evaluate(()=>window.__mouth.open=[]);await page.waitForTimeout(200);assert.ok((await page.evaluate(()=>window.__mouth.open)).every(value=>value<.02),'pause closes mouth');await page.getByRole('button',{name:'Play',exact:true}).click();
   modelChecks.push({companion,openRange:Math.max(...pose.open)-Math.min(...pose.open),formRange:Math.max(...pose.forms)-Math.min(...pose.forms)});
  }
  await vocals(page);await page.getByRole('button',{name:'Disable lip sync track A',exact:true}).click();await page.waitForTimeout(500);const requestsBeforeReload=modelRequests;await page.reload();await page.waitForSelector('.live2d-stage[data-status="ready"]');await vocals(page);assert.equal(await page.getByRole('button',{name:'Enable lip sync track A',exact:true}).count(),1,'disabled preference and analysis persist');assert.equal(modelRequests,requestsBeforeReload,'reload never downloads or reprocesses');
  await page.getByRole('button',{name:'Enable lip sync track A',exact:true}).click();
  for(const [width,height] of [[320,568],[390,844],[844,390]]){await page.setViewportSize({width,height});await page.waitForTimeout(300);const bounds=await page.getByRole('dialog').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width+.5);assert.ok(bounds.y>=0&&bounds.y+bounds.height<=height+.5);await page.screenshot({path:path.join(output,`${name}-${width}x${height}-vocal-ready.jpg`)})}
  assert.deepEqual(errors,[]);results.engines.push({engine:name,status:'passed',modelRequests,modelChecks,checks:['real WASM Demucs and MotionSync workers','download/cancel/network error/retry','playback continues and UI responsive','voice/silent source preparation','actual Cubism open + vowel shape, both companions','pause and disabled close mouth','source switch + direct seeking','analysis and disabled preference survive reload','small portrait/landscape panel bounds']});console.log(name,'mobile lips passed');
 }catch(error){code=1;results.errors.push({engine:name,error:error.stack});console.error(name,error);await page.screenshot({path:path.join(output,`failure-mobile-vocals-${name}.png`)}).catch(()=>{});}
 finally{await browser.close()}
}}finally{results.status=code?'failed':'passed';await writeFile(path.join(output,'mobile-vocals-results.json'),JSON.stringify(results,null,2));server.close();tlsServer.close();await rm(tlsDirectory,{recursive:true,force:true})}
console.log(JSON.stringify({status:results.status,engines:results.engines.length,errors:results.errors.length}));process.exitCode=code;
