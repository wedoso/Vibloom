import {app,BrowserWindow} from 'electron';
import {build} from 'vite';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),dir=path.join(root,'.cache/mastering-consistency'),profile=await mkdtemp(path.join(tmpdir(),'vibloom-mastering-'));
app.setPath('userData',profile);app.on('window-all-closed',()=>{});let window,exitCode=0;
async function main(){try{
 await mkdir(dir,{recursive:true});await writeFile(path.join(dir,'index.html'),'<script type="module" src="/check.ts"></script>');
 await writeFile(path.join(dir,'check.ts'),`
import {applyMastering} from '../../src/audio/mastering/renderMastering';
import {createMasteringChain} from '../../src/audio/mastering/chain';
import {integratedLufs} from '../../src/audio/mastering/loudness';
import {encodeEqWav} from '../../src/audio/eq/renderEq';
import {upstreamMastering,upstreamPreview,measureLUFS} from '../../tests/fixtures/suno-upstream/mastering.mjs';
import {encodeWAV} from '../../tests/fixtures/suno-upstream/wavEncoder.mjs';
const signal=new AbortController().signal;
function settings(mask,norm,peak,rate){return {mode:'mastering',presetId:'custom',gains:[1,-2,1,-1,2],inputGain:0,cleanLowEnd:!!(mask&1),cutMud:!!(mask&2),addAir:!!(mask&4),tameHarsh:!!(mask&8),glueCompression:!!(mask&16),centerBass:!!(mask&32),stereoWidth:125,normalizeLoudness:norm,targetLufs:-14,truePeakLimit:peak,truePeakCeiling:-1,sampleRate:rate,bitDepth:24};}
function upstream(s){return {...s,eqLow:s.gains[0],eqLowMid:s.gains[1],eqMid:s.gains[2],eqHighMid:s.gains[3],eqHigh:s.gains[4]};}
function input(rate,channels,length,kind='music'){const b=new AudioBuffer({length,numberOfChannels:channels,sampleRate:rate});for(let c=0;c<channels;c++){let seed=123+c;const d=b.getChannelData(c);for(let i=0;i<length;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;d[i]=kind==='silence'?0:kind==='impulse'?(i===0?(c?-1:1):0):kind==='peak'?.98*Math.sin(2*Math.PI*rate*.225*i/rate+.6):(.22*Math.sin(i*2*Math.PI*80/rate+c)+.19*Math.sin(i*2*Math.PI*997/rate)+.13*Math.sin(i*2*Math.PI*6000/rate+c)+.1*((seed>>>0)/2**32-.5))*(.5+.5*Math.sin(i/rate*20)**2);}}return b;}
function equal(a,b,label){const x=new Uint8Array(a),y=new Uint8Array(b);if(x.length!==y.length)throw new Error(label+' length');for(let i=0;i<x.length;i++)if(x[i]!==y[i])throw new Error(label+' byte '+i+': '+x[i]+' vs '+y[i]);}
const random=()=>{let seed=17;return()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/2**32;};};
window.check=async()=>{
 const started=performance.now();let cases=0,encodingCases=0,previewCases=0;
 const compare=async(b,s,label)=>{const reference=await upstreamMastering(b,upstream(s)),actual=await applyMastering(b,s,signal);for(let c=0;c<actual.numberOfChannels;c++)equal(actual.getChannelData(c).buffer,reference.getChannelData(c).buffer,'PCM '+label);const bytes=(await encodeEqWav(actual,signal,undefined,24)).bytes;equal(bytes,encodeWAV(reference,{bitDepth:24,dither:false}),'WAV24 '+label);cases++;};
 for(const rate of [44100,48000])for(const channels of [1,2]){
  const b=input(rate,channels,Math.floor(rate*.45));
  const actualLufs=integratedLufs(Array.from({length:channels},(_,c)=>b.getChannelData(c)),rate),refLufs=measureLUFS(b).integratedLUFS;
  if(actualLufs!==refLufs)throw new Error('LUFS differs '+actualLufs+' vs '+refLufs);
  for(let mask=0;mask<64;mask++)for(const norm of [false,true])for(const peak of [false,true])await compare(b,settings(mask,norm,peak,rate),rate+'/'+channels+'/'+mask+'/'+norm+'/'+peak);
 }
 for(const rate of [44100,48000])for(const channels of [1,2])for(const kind of ['silence','impulse','peak','music'])for(const length of [1,127,Math.floor(rate*.65)]){
  const b=input(rate,channels,length,kind),s=settings(63,true,true,rate===48000?44100:48000);s.inputGain=12;s.stereoWidth=200;s.targetLufs=-6;s.truePeakCeiling=-6;s.gains=[12,-12,12,-12,12];await compare(b,s,'edge '+rate+'/'+channels+'/'+kind+'/'+length);
 }
 for(const width of [0,100,200])for(const gain of [-12,12]){const s=settings(63,true,true,48000);s.stereoWidth=width;s.inputGain=gain;s.targetLufs=-20;s.truePeakCeiling=0;await compare(input(44100,2,22050),s,'boundary '+width+'/'+gain);}
 // Independent oracle for the upstream realtime graph, distinct from export.
 for(const rate of [44100,48000])for(const channels of [1,2])for(let mask=0;mask<64;mask++)for(const flags of [0,1,2,3]){
  const b=input(rate,channels,Math.floor(rate*.45)),s=settings(mask,!!(flags&1),!!(flags&2),rate),normGain=1.73;
  const reference=await upstreamPreview(b,upstream(s),normGain),ctx=new OfflineAudioContext(channels,b.length,rate),source=ctx.createBufferSource(),chain=createMasteringChain(ctx,s,true,normGain);source.buffer=b;source.connect(chain.input);chain.output.connect(ctx.destination);source.start();const actual=await ctx.startRendering();source.disconnect();source.buffer=null;chain.dispose();
  for(let c=0;c<channels;c++)equal(actual.getChannelData(c).buffer,reference.getChannelData(c).buffer,'preview '+rate+'/'+channels+'/'+mask+'/'+flags);previewCases++;
 }
 for(const depth of [16,24])for(const kind of ['silence','peak','music']){
  const b=input(48000,2,4097,kind),saved=Math.random;Math.random=random();const reference=encodeWAV(b,{bitDepth:depth,dither:depth===16});Math.random=saved;
  const actual=await encodeEqWav(b,signal,undefined,depth,random());equal(actual.bytes,reference,'PCM'+depth+' fixed dither '+kind);encodingCases++;
 }
 return {cases,previewCases,encodingCases,booleanCombinations:64,normalizeTruePeakCombinations:4,pcm:'bit-identical Float32',wav24:'byte-identical',wav16:'byte-identical with equal TPDF random stream',lufs:'exact',elapsedMs:performance.now()-started,userAgent:navigator.userAgent};
};`);
 await build({configFile:false,root:dir,base:'./',logLevel:'error',build:{outDir:'dist',emptyOutDir:true}});
 await app.whenReady();window=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 await window.loadFile(path.join(dir,'dist/index.html'));const result=await window.webContents.executeJavaScript('window.check()',true);
 await mkdir(path.join(root,'outputs/mastering-consistency'),{recursive:true});await writeFile(path.join(root,'outputs/mastering-consistency/report.json'),JSON.stringify({upstream:'862a0aa7a686be3bc7e420d108f4e3e4e050bb1f',...result},null,2)+'\n');console.log(JSON.stringify(result,null,2));
}catch(error){console.error(error);exitCode=1;}finally{window?.destroy();await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100}).catch(()=>{});app.exit(exitCode);}}
void main();
