import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './load-ts.mjs';
const { readAudioFile } = await loadTs('../src/audio/audioFiles.ts');
const { SynchronizedAudioEngine } = await loadTs('../src/audio/SynchronizedAudioEngine.ts');

test('file reads abort promptly and remove handlers after cancellation, success and synchronous errors', async () => {
  const original = globalThis.FileReader, readers = [];
  globalThis.FileReader = class {
    constructor(){readers.push(this);}
    readAsArrayBuffer(file){if(file.fail)throw new Error('Read failed');}
    abort(){this.aborted=true;this.onabort?.();}
  };
  try {
    const controller=new AbortController(), pending=readAudioFile({},()=>{},controller.signal), reader=readers[0];
    controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.ok(reader.aborted);
    for(const key of ['onload','onprogress','onerror','onabort'])assert.equal(reader[key],null);
    const done=readAudioFile({},()=>{},new AbortController().signal), success=readers[1];
    success.result=new ArrayBuffer(16);success.onload();assert.equal((await done).byteLength,16);assert.equal(success.onload,null);
    await assert.rejects(readAudioFile({fail:true},()=>{}),/Read failed/);assert.equal(readers[2].onabort,null);
    const aborted=new AbortController();aborted.abort();assert.throws(()=>readAudioFile({},()=>{},aborted.signal),{name:'AbortError'});assert.equal(readers.length,3);
  } finally {globalThis.FileReader=original;}
});

test('closing during audio context resume rejects late work and prevents graph resurrection or PCM retention', async () => {
  let resume, creations=0;
  const node=()=>({connect(){},disconnect(){},gain:{value:0}});
  const context=Object.assign(new EventTarget(),{state:'suspended',destination:{},createGain:node,createAnalyser:node,resume:()=>new Promise(resolve=>{resume=resolve;}),close:async()=>{context.state='closed';}});
  const engine=new SynchronizedAudioEngine(()=>{creations++;return context;}), pending=engine.ensureGraph();
  await engine.close();resume();await assert.rejects(pending,{name:'AbortError'});
  await assert.rejects(engine.ensureGraph(false),{name:'AbortError'});assert.equal(creations,1);assert.equal(engine.getContext(),null);
  assert.throws(()=>engine.setBuffer(0,{length:1000}),{name:'AbortError'});assert.equal(engine.getBuffer(0),null);
  assert.equal(await engine.play(0,0,1),false,'a late play action settles without resurrecting the engine');
  await engine.close();
});
