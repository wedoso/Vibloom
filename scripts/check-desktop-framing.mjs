/* global WheelEvent */
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const args=process.argv,moduleArg=args.indexOf('--playwright-module'),urlArg=args.indexOf('--url'),baselineArg=args.indexOf('--baseline');
const modulePath=moduleArg<0?'playwright':args[moduleArg+1];
const {chromium,webkit}=await import(path.isAbsolute(modulePath)?pathToFileURL(modulePath).href:modulePath);
const origin=urlArg<0?'http://127.0.0.1:5190/':args[urlArg+1],baselineRef=baselineArg<0?'a9658f5':args[baselineArg+1];
import {execFileSync} from 'node:child_process';import {writeFile} from 'node:fs/promises';import assert from 'node:assert/strict';
const root='outputs/mobile-ui';
const original=execFileSync('git',['show',baselineRef+':src/Live2DStage.tsx'],{encoding:'utf8'}).replaceAll('from "./','from "/src/');
await writeFile(root+'/baseline-stage.tsx',original);
await writeFile(root+'/desktop-framing-harness.html','<html><head><script src="/live2d/live2dcubismcore.min.js"></script></head><body><div id="root"></div><script type="module" src="/outputs/mobile-ui/desktop-framing-harness.tsx"></script></body></html>');
await writeFile(root+'/desktop-framing-harness.tsx',`import React,{useRef,useState} from 'react';import {createRoot} from 'react-dom/client';import '/src/index.css';import {EMPTY_AUDIO_VISUAL} from '/src/audioVisual';import {SILENT_VOCAL_POSE} from '/src/audio/vocals/envelope';const p=new URLSearchParams(location.search);const {default:Stage}=await import(/* @vite-ignore */p.has('baseline')?'/outputs/mobile-ui/baseline-stage.tsx':'/src/Live2DStage.tsx');function Harness(){const visual=useRef({...EMPTY_AUDIO_VISUAL}),vocal=useRef(SILENT_VOCAL_POSE),[focus,setFocus]=useState(false);return <><button onClick={()=>setFocus(!focus)}>Test focus</button><div style={{height:600,width:800,position:'relative'}}><Stage companionId={p.get('theme')} variant="player" featuresRef={visual} vocalLevelRef={vocal} focusMode={focus} trackLabel="Regression check" activeSource={0} isComparing={false} isPlaying={false}/></div></>};createRoot(document.getElementById('root')).render(<Harness/>);`);
const results=[];
for(const [engine,driver] of Object.entries({chromium,webkit})){
 const browser=await driver.launch();const context=await browser.newContext({viewport:{width:1280,height:900}});
 for(const theme of ['hong-xi','hiyori']){const frames=[];
  for(const baseline of [true,false]){const page=await context.newPage();await page.goto(new URL(`${root}/desktop-framing-harness.html?theme=${theme}${baseline?'&baseline':''}`,origin).href);await page.waitForSelector('.live2d-stage[data-status=ready]');const values=[];
   for(const mode of ['portrait','wide','zoom','focus']){if(mode==='wide')await page.getByRole('button',{name:'Wide full-body framing',exact:true}).click();if(mode==='zoom'){for(let i=0;i<45;i++){await page.locator('.live2d-host').evaluate(e=>e.dispatchEvent(new WheelEvent('wheel',{deltaY:-80,cancelable:true})));await page.waitForTimeout(60);}}if(mode==='focus')await page.getByRole('button',{name:'Test focus',exact:true}).click();await page.waitForTimeout(1600);values.push(await page.locator('.live2d-stage').evaluate(e=>Object.fromEntries(['--camera-zoom','--stage-model-top','--stage-model-height','--camera-rig-y'].map(k=>[k,parseFloat(e.style.getPropertyValue(k))]))));}
   frames.push(values);await page.close();
  }
  for(let i=0;i<frames[0].length;i++)for(const k of Object.keys(frames[0][i]))assert.ok(Math.abs(frames[0][i][k]-frames[1][i][k])<1,`${engine} ${theme} frame ${i} ${k}`);
  results.push({engine,theme,before:frames[0],after:frames[1],passed:true});
 }
 await browser.close();console.log(engine+' desktop framing matches prior commit');
}
await writeFile(root+'/desktop-framing-results.json',JSON.stringify({status:'passed',results},null,2));
