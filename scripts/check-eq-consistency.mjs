// Independent oracle: pinned, unmodified upstream node setup, presets and encoder.
import { app, BrowserWindow } from 'electron';
import { build } from 'vite';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = path.join(root, '.cache/eq-consistency');
const profile = await mkdtemp(path.join(tmpdir(), 'vibloom-eq-'));
app.setPath('userData', profile); app.on('window-all-closed', () => {});
let window, exitCode = 0;
async function main() { try {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'index.html'), '<script type="module" src="/check.ts"></script>');
  await writeFile(path.join(directory, 'check.ts'), `
import {applyEq, encodeEqWav} from '../../src/audio/eq/renderEq';
import {configureEQNodes, eqPresets} from '../../tests/fixtures/eq-upstream/eq.mjs';
import {encodeWAV} from '../../tests/fixtures/eq-upstream/wavEncoder.mjs';
const names=['eqLow','eqLowMid','eqMid','eqHighMid','eqHigh'];
const bands=['low','lowMid','mid','highMid','high'];
async function upstream(buffer,id) {
 const context=new OfflineAudioContext(buffer.numberOfChannels,buffer.length,buffer.sampleRate);
 const nodes=Object.fromEntries(names.map(name=>[name,context.createBiquadFilter()]));
 configureEQNodes(nodes);
 names.forEach((name,i)=>nodes[name].gain.value=eqPresets[id][bands[i]]);
 const source=context.createBufferSource();source.buffer=buffer;source.connect(nodes.eqLow);
 names.forEach((name,i)=>nodes[name].connect(nodes[names[i+1]]??context.destination));
 source.start();const output=await context.startRendering();source.disconnect();source.buffer=null;
 names.forEach(name=>nodes[name].disconnect());return output;
}
function compare(a,b,label){if(a.byteLength!==b.byteLength)throw new Error(label+' length');const x=new Uint8Array(a),y=new Uint8Array(b);for(let i=0;i<x.length;i++)if(x[i]!==y[i])throw new Error(label+' byte '+i+': '+x[i]+' != '+y[i]);}
window.check=async()=>{
 let cases=0,maxSampleDifference=0;const started=performance.now();
 for(const rate of [8000,44100,48000,96000])for(const channels of [1,2])for(const length of [1,127,8193,rate])for(const id of Object.keys(eqPresets)){
  const input=new AudioBuffer({numberOfChannels:channels,length,sampleRate:rate});
  for(let c=0;c<channels;c++){let seed=123+c;const data=input.getChannelData(c);for(let i=0;i<length;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;data[i]=i<2?(c?-1:1):.8*Math.sin(i*2*Math.PI*997/rate)+.15*((seed>>>0)/2**32-.5);}}
  const reference=await upstream(input,id),actual=await applyEq(input,id,new AbortController().signal);
  for(let c=0;c<channels;c++){const a=actual.getChannelData(c),b=reference.getChannelData(c);compare(a.buffer,b.buffer,'PCM '+id+'/'+rate+'/'+channels+'/'+length);for(let i=0;i<length;i++)maxSampleDifference=Math.max(maxSampleDifference,Math.abs(a[i]-b[i]));}
  const encoded=await encodeEqWav(actual,new AbortController().signal);compare(encoded.bytes,encodeWAV(reference,{bitDepth:24,dither:false}),'WAV '+id+'/'+rate+'/'+channels+'/'+length);cases++;
 }
 // Measure actual steady-state tone response independently of the upstream oracle.
 const responseDb={};
 for(const id of Object.keys(eqPresets)){
  responseDb[id]=[];
  for(const frequency of [80,250,1000,4000,12000]){
   const input=new AudioBuffer({numberOfChannels:1,length:48000,sampleRate:48000});
   const data=input.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=.1*Math.sin(i*2*Math.PI*frequency/48000);
   const output=await applyEq(input,id,new AbortController().signal);const samples=output.getChannelData(0);
   let before=0,after=0;for(let i=24000;i<48000;i++){before+=data[i]*data[i];after+=samples[i]*samples[i];}
   responseDb[id].push(Number((10*Math.log10(after/before)).toFixed(3)));
  }
 }
 if(responseDb.bass[0]<3 || responseDb.bright[4]<2 || responseDb.warm[4]>-1 || responseDb.vocal[2]<1)throw new Error('EQ tonal changes are not applied');
 for(const [a,values] of Object.entries(responseDb))for(const [b,other] of Object.entries(responseDb))if(a!==b&&Math.max(...values.map((gain,i)=>Math.abs(gain-other[i])))<.5)throw new Error('Indistinguishable presets '+a+'/'+b);
 // Explicit clipping/rounding boundary cases and flat silence.
 const boundaries=new AudioBuffer({numberOfChannels:1,length:11,sampleRate:48000});boundaries.copyToChannel(Float32Array.of(-2,-1,-.5,-1/16777214,0,1/16777214,.5,1,2,NaN,Infinity),0);
 const invalid=new AbortController();let rejects=false;try{await encodeEqWav(boundaries,invalid.signal);}catch{rejects=true;}if(!rejects)throw new Error('Non-finite input accepted');
 boundaries.copyToChannel(Float32Array.of(-2,-1,-.5,-1/16777214,0,1/16777214,.5,1,2,0,0),0);
 const rounded=await encodeEqWav(boundaries,invalid.signal);compare(rounded.bytes,encodeWAV(boundaries,{bitDepth:24,dither:false}),'encoding boundaries');if(rounded.clippedSamples!==2)throw new Error('Clipping count');
 const silent=new AudioBuffer({numberOfChannels:2,length:257,sampleRate:48000});for(const id of Object.keys(eqPresets)){const actual=await applyEq(silent,id,invalid.signal);if(actual.getChannelData(0).some(x=>x!==0))throw new Error('Non-zero silence');}
 return {cases,pcm:'bit-identical Float32',wav:'byte-identical PCM24',maxSampleDifference,responseFrequencies:[80,250,1000,4000,12000],responseDb,boundaryEncoding:true,silence:true,elapsedMs:performance.now()-started,userAgent:navigator.userAgent};
};`);
  await build({ configFile: false, root: directory, base: './', logLevel: 'error', build: { outDir: 'dist', emptyOutDir: true } });
  await app.whenReady();
  window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  await window.loadFile(path.join(directory, 'dist/index.html'));
  const result = await window.webContents.executeJavaScript('window.check()', true);
  assert.equal(result.cases,192);assert.equal(result.maxSampleDifference,0);
  await mkdir(path.join(root,'outputs/eq-consistency'),{recursive:true});
  await writeFile(path.join(root,'outputs/eq-consistency/report.json'),JSON.stringify({upstream:'862a0aa7a686be3bc7e420d108f4e3e4e050bb1f',...result},null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
} catch(error) {console.error(error);exitCode=1;} finally {window?.destroy();await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100}).catch(()=>{});app.exit(exitCode);}
}
void main();
