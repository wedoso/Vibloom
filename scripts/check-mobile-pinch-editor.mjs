/* global document, PointerEvent, getComputedStyle, innerWidth, window */
import { waveBytes } from './mobile-ui-fixtures.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const packageArg=process.argv.indexOf('--playwright-module');
const modulePath=packageArg>=0?process.argv[packageArg+1]:'playwright';
const {chromium,webkit}=await import(path.isAbsolute(modulePath)?pathToFileURL(modulePath).href:modulePath);
const urlArg=process.argv.indexOf('--url');
const origin=urlArg>=0?process.argv[urlArg+1]:'http://127.0.0.1:5190/';
import assert from 'node:assert/strict';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
const root=path.join(process.cwd(),'outputs/mobile-ui'), cases=[], flows=[];
await mkdir(root,{recursive:true});
await writeFile(root+'/compact-editor.wav',waveBytes());
await writeFile(root+'/compact-editor.lrc','[ar:Vibloom test]\n[00:00.00]He-ya he-ya, 山河回响\n[00:03.00]He-ya he-ya, 万方同唱\n[00:06.00]风从窗边经过，歌声留在这里。\n[00:09.00]A long lyric line, 山河与歌声 — wrapping without changing its weight.\n');
for (const [engine,type] of Object.entries({chromium,webkit})) {
 const browser=await type.launch({headless:true}); const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await page.goto(new URL('?ui=mobile',origin).href);
 await page.waitForFunction(()=>document.querySelector('.m-content')?.getAttribute('aria-busy')==='false');
 await page.locator('[data-picker="files"]').setInputFiles([root+'/compact-editor.wav',root+'/compact-editor.lrc']);
 await page.getByRole('button',{name:'Continue to library',exact:true}).click();
 await page.waitForSelector('.live2d-stage[data-status="ready"]');
 await page.getByRole('button',{name:'Play',exact:true}).click();
 await page.getByRole('button',{name:'Pause',exact:true}).click();
 const zoom=()=>page.locator('.live2d-stage').evaluate(e=>Number(e.style.getPropertyValue('--camera-zoom')));
 const pointer=async(type,id,x,kind='touch')=>page.locator('.live2d-canvas').evaluate((e,a)=>e.dispatchEvent(new PointerEvent(a.type,{pointerId:a.id,pointerType:a.kind,clientX:a.x,clientY:150,bubbles:true,cancelable:true})),{type:'pointer'+type,id,x,kind});
 await page.waitForTimeout(1000); const initial=await zoom();
 await pointer('down',1,100); await pointer('move',1,250); await pointer('up',1,250); await page.waitForTimeout(100);
 assert.ok(Math.abs(await zoom()-initial)<.03,'one finger must not zoom');
 await pointer('down',1,100); await pointer('down',2,200); await pointer('move',2,250); await pointer('up',1,100); await pointer('up',2,250);
 await page.waitForFunction(t=>Math.abs(Number(document.querySelector('.live2d-stage').style.getPropertyValue('--camera-zoom'))-t)<.025,Math.min(4,initial*1.5),{timeout:15000});
 const enlarged=await zoom(); assert.ok(enlarged>initial*1.4);
 await page.waitForFunction(()=>document.querySelector('.m-pinch-readout').hidden,{timeout:4000});
 await pointer('down',1,100); await pointer('down',2,300); await pointer('move',2,110); await pointer('up',1,100); await pointer('up',2,110);
 await page.waitForFunction(()=>Math.abs(Number(document.querySelector('.live2d-stage').style.getPropertyValue('--camera-zoom'))-.78)<.025,{timeout:15000});
 await pointer('down',1,100); await pointer('down',2,110); await pointer('move',2,300); await pointer('up',1,100); await pointer('up',2,300);
 await page.waitForFunction(()=>Math.abs(Number(document.querySelector('.live2d-stage').style.getPropertyValue('--camera-zoom'))-4)<.025,{timeout:15000});
 await pointer('down',1,100); await pointer('down',2,200); await pointer('down',3,250); await pointer('move',2,130); for(const i of [1,2,3]) await pointer('up',i,100);
 await page.waitForTimeout(250); assert.ok(await zoom()>3.9,'third finger blocks zoom');
 await page.getByRole('button',{name:'Camera controls',exact:true}).click(); await page.getByRole('button',{name:'Portrait camera',exact:true}).click(); await page.waitForTimeout(1200); assert.ok(await zoom()<4,'preset restores camera');
 assert.equal(await page.locator('.live2d-canvas').evaluate(e=>getComputedStyle(e).touchAction),'none');
 if(engine==='chromium') {
  const cdp=await page.context().newCDPSession(page), rect=await page.locator('.m-room-orbit').boundingBox();
  const x=rect.x+rect.width/2,y=rect.y+rect.height/2,current=await zoom();
  const fingers=(spread)=>[{x:x-spread,y,id:1},{x:x+spread,y,id:2}];
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:fingers(30)});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:fingers(45)});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.waitForFunction(t=>Math.abs(Number(document.querySelector('.live2d-stage').style.getPropertyValue('--camera-zoom'))-t)<.025,Math.min(4,current*1.5),{timeout:15000});
  assert.equal(await page.evaluate(()=>window.visualViewport.scale),1,'pinch must not zoom the page');
 }
 const open=async()=>{await page.getByRole('button',{name:'Listening options',exact:true}).click(); await page.getByRole('dialog').getByRole('button',{name:'Lyrics',exact:true}).click(); await page.getByRole('button',{name:'Edit lyric timing',exact:true}).click();};
 await open(); const dialog=page.getByRole('dialog'); assert.equal(await dialog.locator('textarea').count(),0);
 await dialog.getByRole('button',{name:'Edit lyric line 1',exact:true}).click(); await dialog.getByRole('textbox',{name:'Lyric line 1',exact:true}).fill('修改歌词 · compact editor');
 await dialog.getByRole('button',{name:'Done editing line',exact:true}).click();
 await dialog.getByRole('button',{name:'More lyric actions',exact:true}).click(); await dialog.getByRole('button',{name:'Undo last edit',exact:true}).click();
 assert.match(await dialog.getByRole('button',{name:'Select lyric line 1',exact:true}).textContent(),/He-ya/);
 await dialog.getByRole('button',{name:'Edit lyric line 1',exact:true}).click(); await dialog.getByRole('textbox',{name:'Lyric line 1',exact:true}).fill('修改歌词 · compact editor');
 await dialog.getByRole('button',{name:'Save lyrics',exact:true}).click(); await open();
 assert.equal(await page.locator('.m-playback-footer').count(),1,'save and reopen never duplicate transport');
 assert.match(await dialog.getByRole('button',{name:'Select lyric line 1',exact:true}).textContent(),/修改歌词/);
 await dialog.getByRole('button',{name:'Select lyric line 2',exact:true}).click();
 await dialog.getByRole('slider',{name:'Playback position',exact:true}).fill('4'); await page.waitForTimeout(250);
 await dialog.getByRole('button',{name:'Stamp line 2 and select next',exact:true}).click();
 assert.equal(await dialog.getByRole('button',{name:'Select lyric line 3',exact:true}).getAttribute('aria-pressed'),'true');
 assert.match(await dialog.getByRole('button',{name:'Select lyric line 2',exact:true}).textContent(),/00:04/);
 await page.keyboard.press('Escape'); assert.ok(await dialog.isVisible()); await dialog.getByRole('button',{name:'Keep editing',exact:true}).click();
 await dialog.getByRole('button',{name:'More lyric actions',exact:true}).click(); await dialog.getByRole('button',{name:'Add line',exact:true}).click(); assert.equal(await dialog.locator('textarea').count(),1);
 await dialog.getByRole('button',{name:'Save lyrics',exact:true}).click(); assert.ok(await dialog.getByRole('alert').isVisible());
 await dialog.getByRole('button',{name:'More lyric actions',exact:true}).click(); await dialog.getByRole('button',{name:'Undo last edit',exact:true}).click();
 await dialog.getByRole('button',{name:'Select lyric line 3',exact:true}).click();
 await dialog.getByRole('button',{name:'Play lyric preview',exact:true}).click();
 await page.waitForTimeout(150); await dialog.getByRole('button',{name:'Stamp line 3 and select next',exact:true}).click();
 assert.ok(await dialog.getByRole('button',{name:'Pause lyric preview',exact:true}).isVisible(),'stamping preserves playing state');
 await dialog.getByRole('button',{name:'Pause lyric preview',exact:true}).click();
 await dialog.getByRole('button',{name:'More lyric actions',exact:true}).click(); await dialog.getByRole('button',{name:'Undo last edit',exact:true}).click();
 await dialog.getByRole('button',{name:'Edit lyric line 1',exact:true}).click(); await dialog.getByRole('spinbutton',{name:'Time for line 1 in seconds',exact:true}).fill('20');
 await dialog.getByRole('button',{name:'Save lyrics',exact:true}).click(); assert.ok(await dialog.getByRole('alert').isVisible(),'time order validation');
 await dialog.getByRole('button',{name:'More lyric actions',exact:true}).click(); await dialog.getByRole('button',{name:'Undo last edit',exact:true}).click();
 await dialog.getByRole('button',{name:'Edit lyric line 4',exact:true}).click(); await dialog.getByRole('button',{name:'Delete lyric line 4',exact:true}).click(); assert.equal(await dialog.locator('.m-lyrics-editor-row').count(),3);
 await dialog.getByRole('button',{name:'More lyric actions',exact:true}).click(); await dialog.getByRole('button',{name:'Undo last edit',exact:true}).click(); assert.equal(await dialog.locator('.m-lyrics-editor-row').count(),4);
 await dialog.getByRole('button',{name:'More lyric actions',exact:true}).click(); const download=page.waitForEvent('download'); await dialog.getByRole('button',{name:'Export LRC',exact:true}).click();
 const downloaded=await download; const exported=await readFile(await downloaded.path(),'utf8'); assert.match(exported,/\[ar:Vibloom test\]/); assert.match(exported,/修改歌词/);
 for(const theme of ['hong-xi','hiyori']) {
  if(theme==='hiyori') {await page.setViewportSize({width:390,height:844}); await dialog.getByRole('button',{name:'Close panel',exact:true}).click(); await dialog.getByRole('button',{name:'Discard',exact:true}).click(); await page.getByRole('button',{name:'Open navigation',exact:true}).click(); await page.getByRole('button',{name:'Music companion',exact:true}).click(); await dialog.getByRole('button',{name:/Hiyori/}).click(); await dialog.getByRole('button',{name:'Close panel',exact:true}).click(); await open();}
  for(const [width,height] of [[320,568],[360,800],[390,844],[430,932],[768,1024],[844,390],[390,400]]) {
   await page.setViewportSize({width,height});
   for(const state of ['list','edit','actions']) {
    if(state==='edit') await dialog.getByRole('button',{name:'Edit lyric line 3',exact:true}).click();
    if(state==='actions') {await dialog.getByRole('button',{name:'Done editing line',exact:true}).click(); await dialog.getByRole('button',{name:'More lyric actions',exact:true}).click();}
    await page.waitForTimeout(300);
    const geometry=await dialog.evaluate(e=>{const r=e.getBoundingClientRect(),buttons=[...e.querySelectorAll('.m-lyrics-editor-controls button')].map(b=>{const x=b.getBoundingClientRect(); return {x:x.x,y:x.y,w:x.width,h:x.height,right:x.right,bottom:x.bottom};}); return {horizontal:document.documentElement.scrollWidth>innerWidth,dialog:{top:r.top,bottom:r.bottom,right:r.right},buttons,fields:e.querySelectorAll('textarea').length};});
    assert.ok(!geometry.horizontal,JSON.stringify(geometry)); assert.ok(geometry.dialog.top>=-1&&geometry.dialog.bottom<=height+1&&geometry.dialog.right<=width+1,JSON.stringify(geometry)); assert.ok(geometry.buttons.every(b=>b.w>=44&&b.h>=44&&b.bottom<=height+1&&b.right<=width+1),JSON.stringify(geometry));
    const screenshot=`compact-editor-${engine}-${theme}-${width}x${height}-${state}.png`; await page.screenshot({path:root+'/'+screenshot}); cases.push({engine,theme,width,height,state,...geometry,screenshot});
    if(state==='actions') await dialog.getByRole('button',{name:'More lyric actions',exact:true}).click();
   }
  }
 }
 flows.push({engine,status:'passed',pinch:{initial,enlarged,limits:[.78,4],oneFinger:true,thirdFinger:true,presetReset:true,eventSource:engine==='chromium'?'synthetic PointerEvents and trusted CDP touch on real Live2D':'synthetic touch PointerEvents on real Live2D'},editor:{save:true,undo:true,stampNext:true,unsavedEscape:true,untimedValidation:true,orderValidation:true,deleteUndo:true,exportMetadata:true,stampKeepsPlaying:true}});
 await browser.close(); console.log(engine+' passed');
}
await writeFile(root+'/pinch-editor-results.json',JSON.stringify({status:'passed',cases,flows},null,2)); console.log(cases.length+' layout cases passed');
