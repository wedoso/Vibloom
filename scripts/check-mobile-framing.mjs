/* global document, getComputedStyle, innerWidth, WheelEvent */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {snapshot,seedMobile,waveBytes} from './mobile-ui-fixtures.mjs';
const args=process.argv, moduleArg=args.indexOf('--playwright-module'),urlArg=args.indexOf('--url');
const modulePath=moduleArg<0?'playwright':args[moduleArg+1];
const {chromium,webkit}=await import(path.isAbsolute(modulePath)?pathToFileURL(modulePath).href:modulePath);
const origin=urlArg<0?'http://127.0.0.1:5190/':args[urlArg+1];
const root='outputs/mobile-ui',cases=[];await mkdir(root,{recursive:true});
for(const [engine,driver] of Object.entries({chromium,webkit})){
 const browser=await driver.launch();const page=await browser.newPage({viewport:{width:440,height:798},isMobile:true,hasTouch:true});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(new URL('?ui=mobile',origin).href);await page.waitForSelector('.m-content[aria-busy=false]');
 for(const theme of ['hong-xi','hiyori']){
  await seedMobile(page,snapshot(theme),waveBytes());await page.reload();await page.waitForSelector('.live2d-stage[data-status=ready]');
  for(const [width,height] of [[320,568],[390,844],[440,798],[768,1024],[956,376]]){
   await page.setViewportSize({width,height});await page.getByRole('button',{name:'Camera controls',exact:true}).click();await page.getByRole('button',{name:'Portrait camera',exact:true}).click();
   await page.waitForTimeout(1600);
   const normal=await page.locator('.live2d-stage').evaluate(e=>({top:parseFloat(e.style.getPropertyValue('--stage-model-top')),zoom:parseFloat(e.style.getPropertyValue('--camera-zoom')),height:parseFloat(e.style.getPropertyValue('--stage-model-height'))}));
   assert.ok(Math.abs(normal.top-12)<1,'normal portrait framing is unchanged');
   // Force the real reactive circle to its loudest state without changing audio.
   await page.addStyleTag({content:'.mobile-app .stage-music-disc{transform:translate(-50%,-50%) scale(1.24)!important;opacity:.48!important;transition:none!important}'});
   const geometry=()=>page.evaluate(()=>{const disc=document.querySelector('.stage-music-disc'),viewport=disc.parentElement,stage=document.querySelector('.live2d-stage'),s=getComputedStyle(disc),v=getComputedStyle(viewport),r=disc.getBoundingClientRect(),b=viewport.getBoundingClientRect();return {horizontal:document.documentElement.scrollWidth>innerWidth,circle:r.toJSON(),viewport:b.toJSON(),left:s.left,top:s.top,width:disc.offsetWidth,overflow:v.overflow,mask:v.maskImage,modelTop:parseFloat(stage.style.getPropertyValue('--stage-model-top')),modelHeight:parseFloat(stage.style.getPropertyValue('--stage-model-height')),zoom:parseFloat(stage.style.getPropertyValue('--camera-zoom')),pointerEvents:v.pointerEvents};});
   const before=await geometry();assert.equal(before.horizontal,false);assert.equal(before.pointerEvents,'none');
   if(width<height){assert.equal(before.overflow,'visible');assert.equal(before.mask,'none');
    // Verify pixels above the old clipping boundary when the circle crosses it.
    if(before.circle.top<before.viewport.top-10){const clip={x:Math.round(before.circle.x+before.circle.width/2),y:Math.max(0,Math.round(before.viewport.top-8)),width:3,height:3};
     const painted=await page.screenshot({clip});await page.locator('.stage-music-disc').evaluate(e=>e.style.visibility='hidden');const hidden=await page.screenshot({clip});await page.locator('.stage-music-disc').evaluate(e=>e.style.removeProperty('visibility'));
     assert.notDeepEqual(painted,hidden,'circle must visibly paint above its former container');
    }
   }
   for(let n=0;n<35;n++){await page.locator('.live2d-host').evaluate(e=>e.dispatchEvent(new WheelEvent('wheel',{deltaY:-80,cancelable:true})));await page.waitForTimeout(80);}
   await page.waitForFunction(()=>Number(document.querySelector('.live2d-stage').style.getPropertyValue('--camera-zoom'))>3.98);await page.waitForTimeout(600);
   const after=await geometry();assert.equal(after.horizontal,false);assert.ok(after.modelTop<=normal.top+1);if(normal.zoom<3.95)assert.ok(after.modelTop<normal.top-1,'zoom lifts the upper body');
   assert.ok(Math.abs(after.circle.x-before.circle.x)<1&&Math.abs(after.circle.y-before.circle.y)<1,'zoom never moves the background circle');
   const file=`framing-${engine}-${theme}-${width}x${height}.png`;await page.screenshot({path:root+'/'+file});
   const camera=page.getByRole('button',{name:'Camera controls',exact:true});await camera.click();assert.ok(await page.getByRole('button',{name:'Wide camera',exact:true}).isVisible());await page.getByRole('button',{name:'Wide camera',exact:true}).click();await page.waitForTimeout(1300);
   const top=await page.locator('.live2d-stage').evaluate(e=>parseFloat(e.style.getPropertyValue('--stage-model-top')));assert.ok(Math.abs(top-12)<1,'wide camera releases zoom offset');
   cases.push({engine,theme,width,height,normal,maximum:after,screenshot:file,paintAboveStage:width<height&&before.circle.top<before.viewport.top-10});
  }
 }
 assert.deepEqual(errors,[]);await browser.close();console.log(engine+' framing passed');
}
await writeFile(root+'/framing-results.json',JSON.stringify({status:'passed',cases},null,2));console.log(cases.length+' framing cases passed');
