import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './load-ts.mjs';
// Drive the hook's actual async operations and cleanup callbacks without a DOM.
// State and effects are observed; audio/file promises remain independently gated.
globalThis.__comparisonHooks = {
  useCallback: fn => fn,
  useRef: value => ({current:value}),
  useEffect: setup => { globalThis.__comparisonFixture.effects.push(setup); },
  useState: value => {
    const state=globalThis.__comparisonFixture.states,index=state.length;state.push(value);
    return [value,update=>{state[index]=typeof update==='function'?update(state[index]):update;}];
  },
};
const {useComparisonWorkspace}=await loadTs('../src/comparison/useComparisonWorkspace.ts',source=>source.replace(/import \{ useCallback, useEffect, useRef, useState \} from "react";/,'const {useCallback,useEffect,useRef,useState}=globalThis.__comparisonHooks;'));
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(file,decode=async()=>({duration:1,length:10,numberOfChannels:1,getChannelData:()=>new Float32Array(10)})) {
  const runtime=globalThis.__comparisonFixture={effects:[],states:[]};
  const root={id:'root',fingerprint:'file',comparisons:[{id:'B',slot:1,name:'B.wav',persistence:'cached',availability:'available',duration:1}]};
  const buffers=new Map();let graphCalls=0;
  const engine={getBuffer:index=>buffers.get(index),setBuffer:(index,buffer)=>{if(buffer)buffers.set(index,buffer);else buffers.delete(index);},setDuration(){},trimDecodedBuffers(){},ensureGraph:async()=>{graphCalls++;return {decodeAudioData:decode};}};
  const workspace=useComparisonWorkspace({rootId:'root',readRoot:()=>root,readTracks:()=>[root],patchTracks(){},engine,platform:{audioFiles:{get:()=>file}},cacheEnabled:()=>false,onMessage(){},onSelect(){},forgetVocals(){}});
  const cleanups=runtime.effects.map(setup=>setup()).filter(Boolean);
  return {workspace,runtime,buffers,get graphCalls(){return graphCalls;},cleanup:()=>cleanups.forEach(fn=>fn())};
}

test('comparison unmount invalidates a pending file lookup before an audio graph can be recreated',async()=>{
  let finish;const instance=fixture(new Promise(resolve=>{finish=resolve;})),pending=instance.workspace.ensureBuffer(1);
  instance.cleanup();finish({});await assert.rejects(pending,{name:'AbortError'});
  assert.equal(instance.graphCalls,0);assert.equal(instance.buffers.size,0);assert.equal(instance.runtime.states[0][1].status,'ready');
});

test('comparison unmount discards an already running native decode and never republishes PCM or slot state',async()=>{
  const original=globalThis.FileReader;globalThis.FileReader=class {readAsArrayBuffer(){queueMicrotask(()=>{this.result=new ArrayBuffer(16);this.onload?.();});}abort(){this.onabort?.();}};
  try {
    let finish;const instance=fixture({},()=>new Promise(resolve=>{finish=resolve;})),pending=instance.workspace.ensureBuffer(1);
    await flush();assert.equal(instance.graphCalls,1);assert.equal(instance.runtime.states[0][1].status,'loading');
    instance.cleanup();const state=instance.runtime.states[0];finish({duration:1});await assert.rejects(pending,{name:'AbortError'});
    assert.equal(instance.buffers.size,0);assert.equal(instance.runtime.states[0],state,'no late state update after cleanup');
  }finally{globalThis.FileReader=original;}
});

test('cancelled comparison file read stops the reader, restores a usable slot and permits a fresh decode',async()=>{
  const original=globalThis.FileReader,readers=[];
  globalThis.FileReader=class {constructor(){readers.push(this);}readAsArrayBuffer(){}abort(){this.aborted=true;this.onabort?.();}};
  try {
    const instance=fixture({}),controller=new AbortController(),pending=instance.workspace.ensureBuffer(1,controller.signal);
    await flush();controller.abort();await assert.rejects(pending,{name:'AbortError'});
    assert.ok(readers.at(-1).aborted);assert.equal(instance.graphCalls,0);assert.equal(instance.runtime.states[0][1].status,'ready');assert.equal(instance.runtime.states[0][1].error,'');
    const retry=instance.workspace.ensureBuffer(1);await flush();const reader=readers.at(-1);reader.result=new ArrayBuffer(16);reader.onload();await retry;
    assert.equal(instance.graphCalls,1);assert.ok(instance.buffers.has(1));instance.cleanup();
  }finally{globalThis.FileReader=original;}
});
