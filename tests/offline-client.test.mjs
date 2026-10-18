import assert from 'node:assert/strict';
import test from 'node:test';
import { tsUrl } from './load-ts.mjs';
const url=await tsUrl(new URL('../src/platform/offlineApp.ts',import.meta.url).href,source=>source.replaceAll('import.meta.env.DEV','false').replaceAll('import.meta.env.BASE_URL','"./"'));
let sequence=0;
async function fixture(t,{online=false,ready=true,registerFails=false}={}){
  const originals=new Map(['navigator','document','location','window'].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  let registrations=0,reloads=0;
  const messages=[];
  const worker={postMessage(data,ports){messages.push(data.type);if(ports)ports[0].postMessage({ready});}};
  const registration=new EventTarget();registration.active=worker;registration.waiting=null;
  const serviceWorker=new EventTarget();serviceWorker.controller=worker;
  serviceWorker.getRegistration=async()=>registration;
  serviceWorker.register=async()=>{registrations++;if(registerFails)throw new Error('Network unavailable');return registration;};
  const events=new EventTarget();events.isSecureContext=true;
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:online,userAgent:'Test browser',serviceWorker}});
  globalThis.window=events;globalThis.document={baseURI:'https://example.test/Vibloom/?ui=mobile'};globalThis.location={protocol:'https:',reload:()=>{reloads++;}};
  const client=await import(`${url}#${++sequence}`);
  t.after(()=>{for(const[name,descriptor]of originals){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}});
  return {client,serviceWorker,registration,worker,messages,get registrations(){return registrations;},get reloads(){return reloads;}};
}

test('cold offline startup uses installed shell without fetching the registration script',async t=>{
  const f=await fixture(t);await f.client.startOfflineApp();assert.equal(f.client.readOffline().phase,'ready');assert.equal(f.client.readOffline().online,false);assert.equal(f.registrations,0);
});
test('failed online update checks do not hide an already usable offline shell',async t=>{
  const f=await fixture(t,{online:true,registerFails:true});await f.client.startOfflineApp();assert.equal(f.registrations,1);assert.equal(f.client.readOffline().phase,'ready');
});
test('evicted shell is reported incomplete and worker changes never reload without a user-requested update',async t=>{
  const f=await fixture(t,{online:true,ready:false});await f.client.startOfflineApp();assert.equal(f.client.readOffline().phase,'error');
  f.serviceWorker.dispatchEvent(new Event('controllerchange'));assert.equal(f.reloads,0);
  f.registration.waiting=f.worker;f.client.applyOfflineUpdate();assert.ok(f.messages.includes('ACTIVATE_UPDATE'));
  f.serviceWorker.dispatchEvent(new Event('controllerchange'));assert.equal(f.reloads,1);
});
