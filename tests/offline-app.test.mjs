import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../build-tools/offline-worker.js', import.meta.url), 'utf8');
function worker({ fail = false, clients = [] } = {}) {
  const handlers = new Map(), stores = new Map(), requests = [];
  let skipped = 0, claims = 0, failed = fail;
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const data = stores.get(name);
      const key = value => typeof value === 'string' ? value : value.url;
      return { async addAll(urls) { if(failed)throw new Error('offline'); for(const url of urls)data.set(key(url),new Response(key(url))); }, async put(url,response) { data.set(key(url),response); }, async match(url) { return data.get(key(url))?.clone(); } };
    },
    async keys() { return [...stores.keys()]; }, async delete(key) { return stores.delete(key); },
  };
  const self = { location:{href:'https://example.test/Vibloom/sw.js'}, clients:{matchAll:async()=>clients,claim:async()=>{claims++;}}, addEventListener:(type,handler)=>handlers.set(type,handler),skipWaiting:async()=>{skipped++;} };
  vm.runInNewContext(source, { BUILD:'test',SHELL:['index.html','assets/app.js','live2d/model.json'],self,caches,URL,Request,Response,fetch:async request=>{requests.push(request);return new Response('network');} });
  return { stores, requests, caches, get skipped(){return skipped;},get claims(){return claims;}, set fail(value){failed=value;},
    async event(type, data={}) { const waits=[]; let response; handlers.get(type)({...data,waitUntil:promise=>waits.push(promise),respondWith:promise=>{response=promise;}}); if(response)response=await response; await Promise.all(waits); return response; },
  };
}

test('offline shell installs atomically under a deployment subpath without activating an update automatically', async () => {
  const f = worker({fail:true}); await assert.rejects(f.event('install'),/offline/); assert.equal(f.stores.size,0);
  f.fail=false; await f.event('install'); assert.equal(f.skipped,0);
  const cache = [...f.stores.values()][0]; assert.equal(cache.size,4);
  let status; await f.event('message',{data:{type:'OFFLINE_STATUS'},ports:[{postMessage:value=>{status=value;}}]}); assert.equal(status.ready,true);
  cache.delete('https://example.test/Vibloom/assets/app.js');
  await f.event('message',{data:{type:'OFFLINE_STATUS'},ports:[{postMessage:value=>{status=value;}}]}); assert.equal(status.ready,false);
});

test('offline navigation retains mobile/desktop query choice, serves app assets and ignores remote/model/audio data', async () => {
  const f=worker(); await f.event('install');
  for(const url of ['https://example.test/Vibloom/?ui=mobile','https://example.test/Vibloom/index.html?ui=desktop']) {
    const response=await f.event('fetch',{request:{method:'GET',mode:'navigate',url}});assert.equal(await response.text(),'https://example.test/Vibloom/index.html');
  }
  assert.equal(await(await f.event('fetch',{request:new Request('https://example.test/Vibloom/assets/app.js')})).text(),'https://example.test/Vibloom/assets/app.js');
  for(const url of ['https://example.test/other/assets/app.js','https://example.test/Vibloom/sw.js','https://remote.test/model.onnx','https://example.test/Vibloom/private.wav'])assert.equal(await f.event('fetch',{request:new Request(url)}),undefined);
  assert.equal(f.requests.length,0);
});

test('explicit update activates without deleting other app caches or shells used by open tabs', async () => {
  const f=worker({clients:[{}]}); await f.event('install');
  await f.caches.open('unrelated');await f.caches.open('vibloom-shell:/Other/:old');await f.caches.open('vibloom-shell:/Vibloom/:old');
  await f.event('message',{data:{type:'ACTIVATE_UPDATE'}});assert.equal(f.skipped,1);
  await f.event('activate');assert.equal(f.claims,1);assert.equal(f.stores.size,4);
  const empty=worker();await empty.event('install');await empty.caches.open('vibloom-shell:/Vibloom/:old');await empty.caches.open('unrelated');await empty.event('activate');
  assert.deepEqual(await empty.caches.keys(),['vibloom-shell:/Vibloom/:test','unrelated']);
});
