import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './load-ts.mjs';
const { comparisonsOf, withComparisons, migrateLibrarySnapshot } = await loadTs('../src/domain/library.ts');
const { SynchronizedAudioEngine, DECODED_BUFFER_BUDGET } = await loadTs('../src/audio/SynchronizedAudioEngine.ts');

test('legacy B migrates without losing cache, remaster or vocal analysis; numbered slots remain stable', () => {
 const legacy={name:'old.wav',cacheKey:'custom-key',duration:12,persistence:'cached',availability:'available',remaster:{presetId:'full-safe'},vocalAnalysis:{version:4,rms:[.1],vowels:[1,2,3,4,5]}};
 const snapshot=migrateLibrarySnapshot({version:2,tracks:[{id:'root',comparison:legacy}],session:{}});
 assert.equal(snapshot.version,3);const [b]=comparisonsOf(snapshot.tracks[0]);assert.equal(b.slot,1);assert.equal(b.cacheKey,'custom-key');assert.deepEqual(b.vocalAnalysis,legacy.vocalAnalysis);assert.deepEqual(b.remaster,legacy.remaster);
 const root=withComparisons(snapshot.tracks[0],[b,{...legacy,id:'eq-9',slot:8,source:{id:b.id,number:2,name:b.name},eq:{presetId:'warm'}}]);
 const removed=withComparisons(root,comparisonsOf(root).filter(v=>v.slot!==1));assert.equal(removed.comparison,null);assert.equal(comparisonsOf(removed)[0].slot,8);assert.equal(comparisonsOf(removed)[0].source.number,2);
 const normalized=comparisonsOf({...root,comparisons:[...root.comparisons,{...b,slot:0},{...b,slot:9},{...b,slot:8}]});assert.deepEqual(normalized.map(v=>v.slot),[1,8]);
 assert.equal(comparisonsOf({id:'root',comparison:{name:'B'}})[0].cacheKey,'root--version-b');
});

test('nine long-track PCM slots evict by recency while retaining original, audible source and timeline metadata', () => {
 const engine=new SynchronizedAudioEngine();const duration=180,length=48000*duration;
 const buffers=Array.from({length:9},()=>({duration,length,numberOfChannels:2}));
 buffers.forEach((buffer,i)=>engine.setBuffer(i,buffer));engine.selectSourceImmediately(8);engine.getBuffer(5);
 const retained=engine.trimDecodedBuffers();assert.ok(retained<=DECODED_BUFFER_BUDGET);assert.equal(retained,3*length*2*4);
 assert.equal(engine.getBuffer(0),buffers[0]);assert.equal(engine.getBuffer(8),buffers[8]);assert.equal(engine.getBuffer(5),buffers[5]);assert.equal(engine.getBuffer(1),null);assert.equal(engine.getMaxDuration(),duration);
 engine.setDuration(1,220);assert.equal(engine.getMaxDuration(),220,'eviction preserves durations even when PCM is cold');
 assert.throws(()=>engine.setBuffer(9,buffers[0]),/between 1 and 9/);assert.throws(()=>engine.selectSourceImmediately(-1),/between 1 and 9/);
 engine.clearBuffers();assert.equal(engine.getMaxDuration(),0);assert.ok(Array.from({length:9},(_,i)=>engine.getBuffer(i)).every(x=>x===null));
});

test('rapid switches keep every unfinished fade alive, reuse aligned sources and trim PCM only after audio ends', async () => {
 const nodes=[], holds=[];
 const context={currentTime:10,state:'running',destination:{},createAnalyser:()=>({connect(){},disconnect(){}}),createGain:()=>({connect(){},disconnect(){},gain:{value:0,cancelScheduledValues(){},cancelAndHoldAtTime(t){holds.push(t);},setValueAtTime(v){this.value=v;},linearRampToValueAtTime(v){this.value=v;}}}),createBufferSource:()=>{const node={buffer:null,stops:[],disconnected:false,connect(){},disconnect(){this.disconnected=true;},start(when,offset){this.startAt=when;this.offset=offset;},stop(at){this.stops.push(at);}};nodes.push(node);return node;}};
 const engine=new SynchronizedAudioEngine(()=>context),length=48000*240,buffer=()=>({duration:240,length,numberOfChannels:2});
 for(let index=0;index<4;index++)engine.setBuffer(index,buffer());
 await engine.play(0,.025,.9);context.currentTime=11;
 engine.selectSource(1,.018);const firstStop=nodes[0].stops.at(-1);
 context.currentTime+=.005;engine.selectSource(2,.018);
 assert.ok(nodes[0].stops.at(-1)>firstStop,'an older interrupted fade receives the new end time');
 assert.equal(holds.length,18,'both transitions hold native gain automation');
 const before=nodes.length;context.currentTime+=.005;engine.selectSource(1,.018);
 assert.equal(nodes.length,before,'returning during a fade does not disconnect/restart its source');
 assert.ok(nodes[1].stops.at(-1)>context.currentTime+50,'returning cancels the old scheduled fade stop');
 const pcm=length*2*4;assert.equal(engine.trimDecodedBuffers(),3*pcm,'fading PCM is temporarily protected beyond the steady-state budget');
 assert.ok(engine.getBuffer(2));assert.equal(engine.getBuffer(3),null);
 context.currentTime+=.1;nodes[0].onended();nodes[2].onended();
 assert.equal(engine.getBuffer(2),null,'native end callbacks immediately retry LRU eviction');
 assert.ok(engine.getBuffer(0));assert.ok(engine.getBuffer(1));assert.ok(nodes[2].disconnected);assert.equal(nodes[2].buffer,null);
});

test('preview is local to one source, preserves the user selection and timeline, bypasses fully and disposes nodes', async()=>{
 const all=[], sources=[];
 const param=()=>({value:0,cancelScheduledValues(){},setValueAtTime(v){this.value=v;},linearRampToValueAtTime(v){this.value=v;}});
 const node=()=>{const n={connections:[],disconnects:0,connect(next){this.connections.push(next);return next;},disconnect(){this.connections=[];this.disconnects++;},gain:param(),frequency:param(),Q:param(),threshold:param(),knee:param(),ratio:param(),attack:param(),release:param()};all.push(n);return n;};
 const context={currentTime:10,state:'running',destination:{},createAnalyser:node,createGain:node,createBiquadFilter:node,createDynamicsCompressor:node,createWaveShaper:node,createChannelSplitter:node,createChannelMerger:node,createBufferSource:()=>{const n=Object.assign(node(),{buffer:null,start(){},stop(){}});sources.push(n);return n;},close:async()=>{context.state='closed';}};
 const engine=new SynchronizedAudioEngine(()=>context),buffer={duration:240,length:48000*240,numberOfChannels:2};engine.setBuffer(0,buffer);engine.setBuffer(1,{...buffer});await engine.play(5,.025,.9);context.currentTime=11;
 const {initialSettings}=await loadTs('../src/audio/mastering/settings.ts'),settings={...initialSettings(),presetId:'bass',gains:[6,3,0,-1,-2]};
 const time=engine.getTimelineTime(),original=sources[0];const before=all.length;
 assert.ok(engine.beginPreview(1,settings));assert.equal(engine.selectedSource,0);assert.equal(engine.audibleSource,1);assert.equal(engine.previewSource,1);assert.equal(engine.getTimelineTime(),time);assert.ok(engine.isPlaying);
 const preview=sources.at(-1);assert.notEqual(preview.connections[0],engine.getAnalyser(1));assert.equal(original.connections[0],engine.getAnalyser(0),'the original source never runs through the preview filters');
 const dry=preview.connections[1]; engine.bypassPreview(true);assert.equal(dry.gain.value,1);engine.bypassPreview(false);assert.equal(dry.gain.value,0);
 engine.updatePreview({...settings,gains:[-2,-1,2,3,1]});assert.equal(engine.selectedSource,0);assert.equal(engine.getTimelineTime(),time);
 const owned=all.slice(before).filter(n=>n!==preview);engine.endPreview();assert.equal(engine.audibleSource,0);assert.equal(engine.selectedSource,0);assert.equal(engine.previewSource,null);assert.equal(preview.connections[0],engine.getAnalyser(1));assert.ok(owned.every(n=>n.disconnects>0),'every processing node releases its graph connections');
 engine.pause();const starts=sources.length;engine.beginPreview(1,settings);assert.equal(sources.length,starts,'preview never starts paused playback');assert.equal(engine.isPlaying,false);engine.endPreview();assert.equal(engine.audibleSource,0);assert.equal(engine.isPlaying,false);
 await engine.close();assert.ok(all.every(n=>n.connections.length===0));
});


test('mastering submission owns its settings snapshot and rejects unsafe numeric or mode values', async()=>{
 const {initialSettings,snapshotSettings,upstreamDefaults}=await loadTs('../src/audio/mastering/settings.ts');
 const draft=initialSettings(),snapshot=snapshotSettings(draft);draft.gains[0]=12;draft.truePeakLimit=true;
 assert.equal(snapshot.gains[0],0);assert.equal(snapshot.truePeakLimit,false);
 const defaults=upstreamDefaults(snapshot);assert.equal(defaults.mode,'mastering');assert.ok(defaults.normalizeLoudness&&defaults.truePeakLimit&&defaults.cleanLowEnd);assert.equal(defaults.bitDepth,16);
 for(const patch of [{mode:'unknown'},{inputGain:Infinity},{stereoWidth:201},{targetLufs:-21},{truePeakCeiling:1},{gains:[0,0,NaN,0,0]},{normalizeLoudness:1},{sampleRate:96000}])assert.throws(()=>snapshotSettings({...snapshot,...patch}));
});

test('preview application acknowledgement follows audio output time and retargets rapid changes', async () => {
 const param = () => ({value:0,cancelScheduledValues(){},setValueAtTime(v){this.value=v;},linearRampToValueAtTime(v){this.value=v;}});
 const node = () => ({connect(next){return next;},disconnect(){},gain:param(),frequency:param(),Q:param(),threshold:param(),knee:param(),ratio:param(),attack:param(),release:param(),start(){},stop(){}});
 let audibleTime = 0;
 const context = {currentTime:1,sampleRate:48000,state:'running',destination:{},getOutputTimestamp:()=>({contextTime:audibleTime,performanceTime:performance.now()}),createAnalyser:node,createGain:node,createBiquadFilter:node,createBufferSource:node,createDynamicsCompressor:node,createWaveShaper:node,createChannelSplitter:node,createChannelMerger:node,close:async()=>{}};
 const engine = new SynchronizedAudioEngine(()=>context), {initialSettings}=await loadTs('../src/audio/mastering/settings.ts');
 engine.setBuffer(0,{duration:240,length:48000*240,numberOfChannels:2}); await engine.play(0,0,1);
 assert.ok(engine.beginPreview(0,initialSettings()));
 audibleTime=1.02; assert.equal(engine.previewIsApplied,false,'preparing graph does not imply audible completion');
 audibleTime=1.05; assert.equal(engine.previewIsApplied,true,'the 43 ms warmup/crossfade has reached the output');
 context.currentTime=2; engine.updatePreview({...initialSettings(),gains:[6,0,0,0,0]});
 audibleTime=2.001; assert.equal(engine.previewIsApplied,false,'parameter changes await a new rendering quantum');
 audibleTime=2.004; assert.equal(engine.previewIsApplied,true);
 engine.bypassPreview(true); audibleTime=2.01; assert.equal(engine.previewIsApplied,false);
 audibleTime=2.02; assert.equal(engine.previewIsApplied,true,'bypass awaits the dry/wet fade');
 context.currentTime=3; engine.updatePreview({...initialSettings(),mode:'mastering'});
 audibleTime=3.02; assert.equal(engine.previewIsApplied,false,'graph replacement waits for its own crossfade');
 context.currentTime=3.03; engine.bypassPreview(false); audibleTime=3.045; assert.equal(engine.previewIsApplied,false,'a later toggle retargets the deadline');
 audibleTime=3.06; assert.equal(engine.previewIsApplied,true);
 engine.pause(); engine.updatePreview(initialSettings()); assert.equal(engine.previewIsApplied,true,'paused settings are ready without requiring autoplay');
 engine.endPreview(); assert.equal(engine.previewIsApplied,false); await engine.close();
});
