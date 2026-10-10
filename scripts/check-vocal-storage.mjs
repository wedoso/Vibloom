/* global indexedDB, window, document */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { snapshot, seedMobile, waveBytes } from './mobile-ui-fixtures.mjs';
const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i+1]; };
const modulePath = arg('--playwright-module') ?? 'playwright';
const { chromium, webkit } = await import(path.isAbsolute(modulePath) ? pathToFileURL(modulePath).href : modulePath);
const origin = arg('--url') ?? 'http://127.0.0.1:5190/';
const output = 'outputs/vocal-storage'; await mkdir(output,{recursive:true});
const reports=[];
for (const [engine,type] of Object.entries({chromium,webkit})) {
  const browser=await type.launch({headless:true});
  try {
    const page=await browser.newPage(); await page.goto(new URL('/vibloom-icon.png',origin).href);
    const cdp=engine==='chromium'?await page.context().newCDPSession(page):null;
    const measure=async()=>{if(!cdp)return null;for(let i=0;i<3;i++)await cdp.send('HeapProfiler.collectGarbage');return cdp.send('Runtime.getHeapUsage');};
    for(const [file,exported,name,version] of [
      ['/src/platform/browserLibraryPlatform.ts','browserLibraryPlatform','vibloom-library',1],
      ['/src/mobile/platform.ts','mobilePlatform','vibloom-mobile-library',2],
    ]) {
      await page.evaluate(async({file,exported,name,version})=>{
        window.__platform=(await import(file))[exported]; await window.__platform.repository.reset();
        const request=indexedDB.open(name,version);
        request.onupgradeneeded=()=>{for(const name of version===2?['state','audio']:['state'])if(!request.result.objectStoreNames.contains(name))request.result.createObjectStore(name);};
        const db=await new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
        const tracks=Array.from({length:128},(_,i)=>({id:'song-'+i,fingerprint:'file-'+i,name:'Song '+i+'.wav',duration:240,lyrics:[],comparison:null,comparisons:[],vocalAnalysis:{version:4,rms:Array.from({length:12000},()=>.1234),vowels:Array.from({length:60000},(_,n)=>n%256)}}));
        const library={version:3,tracks,albums:[],session:{queue:[],history:[],currentTrackId:'',currentTime:0,volume:.5,shuffle:false,repeat:'off',cacheEnabled:true,companionId:'hong-xi'}};
        await new Promise((resolve,reject)=>{const tx=db.transaction('state','readwrite');tx.objectStore('state').put(library,'library');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
        window.__snapshot=await new Promise((resolve,reject)=>{const r=db.transaction('state').objectStore('state').get('library');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});db.close();
      },{file,exported,name,version});
      const baselineHeap=await measure();
      const migration=await page.evaluate(async()=>{
        window.__snapshot=null;
        const start=performance.now();window.__snapshot=await window.__platform.repository.load();
        const analyses=window.__snapshot.tracks.map(track=>track.vocalAnalysis);
        return {milliseconds:performance.now()-start,tracks:analyses.length,references:analyses.filter(value=>value.cacheKey&&!('rms'in value)).length,residentBytes:window.__platform.vocalAnalyses.residentBytes};
      });
      const migratedHeap=await measure();
      assert.equal(migration.references,128);assert.equal(migration.residentBytes,0);
      const loaded=await page.evaluate(async()=>{
        const ref=window.__snapshot.tracks[0].vocalAnalysis,store=window.__platform.vocalAnalyses;
        const [a,b]=await Promise.all([store.get(ref),store.get(ref)]);
        const result={same:a===b,rms:a.rms[42],vowel:a.vowels[42],resident:store.residentBytes,typed:a.rms instanceof Float64Array&&a.vowels instanceof Uint8Array};
        store.release();window.__snapshot=await window.__platform.repository.load();
        result.restoredReferences=window.__snapshot.tracks.filter(track=>track.vocalAnalysis.cacheKey).length;result.restoredResident=store.residentBytes;
        return result;
      });
      assert.deepEqual(loaded,{same:true,rms:.1234,vowel:42,resident:156000,typed:true,restoredReferences:128,restoredResident:0});
      const writes=await page.evaluate(async()=>{
        const keys=[];
        const {prototype}=globalThis.IDBObjectStore,put=prototype.put;
        prototype.put=function(value,key){keys.push(key);return put.call(this,value,key);};
        try{await window.__platform.repository.saveSession({...window.__snapshot.session,currentTime:8});}finally{prototype.put=put;}
        return keys;
      });
      assert.deepEqual(writes,['session']);
      reports.push({engine,database:name,baselineHeap,migratedHeap,migration,loaded});
      console.log(`PASS ${engine} ${name}: 128 legacy curves migrate, zero initial resident curves, exact values, lazy restore and session-only writes`);
      await page.evaluate(async()=>{window.__snapshot=null;await window.__platform.repository.reset();});
    }
    // Exercise request ordering through the real desktop/mobile song buttons.
    for(const mobile of [false,true]) {
      const errors=[];const errorListener=error=>errors.push(error.message);page.on('pageerror',errorListener);
      await page.goto(new URL('/vibloom-icon.png',origin).href);
      const library=snapshot();library.tracks=library.tracks.slice(0,3);library.tracks.forEach(track=>{track.comparison=null;track.comparisons=[];});library.session.queue=library.tracks.map(track=>track.id);library.session.currentTrackId='';
      library.tracks[0].vocalAnalysis={version:4,frames:1500,cacheKey:'deliberately-missing-record'};
      const wave=waveBytes();
      if(!mobile&&engine==='webkit') {
        // This WebKit automation build cannot write desktop OPFS fixtures.
        // Supply the same real WAV File at the file-store boundary; decoding,
        // audio playback, and stale-request guards remain production code.
        await page.route('**/src/platform/browserLibraryPlatform.ts*',async route=>{
          const response=await route.fetch(),body=await response.text();
          await route.fulfill({response,body:body+`\nconst __fixtureBytes=Uint8Array.from(atob(${JSON.stringify(wave.toString('base64'))}),c=>c.charCodeAt(0));browserLibraryPlatform.audioFiles.get=async key=>new File([__fixtureBytes],key+'.wav',{type:'audio/wav'});`});
        });
      }
      if(mobile)await seedMobile(page,library,wave);
      else await page.evaluate(async({library,bytes,writeAudio})=>{
        const {browserLibraryPlatform:p}=await import('/src/platform/browserLibraryPlatform.ts');await p.repository.reset();
        if(writeAudio)for(const track of library.tracks)await p.audioFiles.put(track.id,new Blob([new Uint8Array(bytes)],{type:'audio/wav'}));
        await p.repository.save(library);
      },{library,bytes:[...wave],writeAudio:engine!=='webkit'});
      await page.goto(new URL(mobile?'/?ui=mobile':'/?ui=desktop',origin).href);
      await page.waitForSelector('.live2d-stage[data-status="ready"]');
      if(mobile){await page.getByRole('button',{name:'Open navigation',exact:true}).click();await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Library',exact:true}).click();}
      else await page.locator('button[title="Library"]').click();
      await page.waitForSelector(mobile?'.m-song-main':'.track-index');
      await page.evaluate(async mobile=>{
        const file=mobile?'/src/mobile/platform.ts':'/src/platform/browserLibraryPlatform.ts';
        // Vite may attach an HMR timestamp. Import the UI's exact URL so this
        // seam observes its real platform instance, rather than a second module.
        const url=performance.getEntriesByType('resource').find(entry=>new URL(entry.name).pathname===file)?.name??file;
        const module=await import(url),p=module[mobile?'mobilePlatform':'browserLibraryPlatform'];window.__uiPlatform=p;
        const get=p.audioFiles.get.bind(p.audioFiles);window.__originalGet=get;window.__resolveOld=null;window.__oldReadStarted=false;
        p.audioFiles.get=async key=>{if(key==='fixture-0'){window.__oldReadStarted=true;await new Promise(resolve=>{window.__resolveOld=resolve;});}return get(key);};
      },mobile);
      const buttons=page.locator(mobile?'.m-song-main':'.track-index');
      await buttons.nth(0).click();await page.waitForFunction(()=>window.__oldReadStarted);
      await buttons.nth(1).click();
      await page.waitForFunction(mobile=>mobile?document.querySelector('.m-song-row.is-current')?.textContent.includes('A very long recording'):document.querySelector('.track-row.is-active')?.dataset.trackId==='fixture-1',mobile).catch(async()=>{
        // Mobile uses an active class on the row rather than a data attribute.
        if(!mobile)throw new Error('Latest desktop selection did not become active');
        await page.waitForFunction(()=>document.querySelector('.m-song-row.is-current')?.textContent.includes('A very long recording'));
      });
      await page.evaluate(()=>window.__resolveOld());await page.waitForTimeout(250);
      const current=await page.evaluate(async()=> (await window.__uiPlatform.repository.load()).session.currentTrackId);
      // Session persistence is debounced; wait before checking the durable value.
      if(current!=='fixture-1')await page.waitForTimeout(500);
      const final=await page.evaluate(async()=> (await window.__uiPlatform.repository.load()).session.currentTrackId);
      assert.equal(final,'fixture-1');assert.deepEqual(errors,[]);page.off('pageerror',errorListener);
      console.log(`PASS ${engine} ${mobile?'mobile':'desktop'} delayed old file read cannot override latest song`);
      await page.evaluate(()=>{window.__uiPlatform.audioFiles.get=window.__originalGet;});
      await buttons.nth(0).click();
      if(!mobile) {
        await page.waitForFunction(()=>document.querySelector('.track-row.is-active')?.dataset.trackId==='fixture-0');
        await page.locator('button[title="Player"]').click();
        await page.waitForSelector('[aria-label="Enable singing track 1"]');
        await page.locator('[aria-label="Enable singing track 1"]').click();
        await page.waitForSelector('[aria-label="Prepare vocals track 1"]');
      }
      await page.waitForTimeout(800);
      const recovered=await page.evaluate(async()=>{const saved=await window.__uiPlatform.repository.load();return {id:saved.session.currentTrackId,analysis:saved.tracks.find(track=>track.id==='fixture-0').vocalAnalysis};});
      assert.equal(recovered.id,'fixture-0');assert.equal(recovered.analysis,undefined);
      console.log(`PASS ${engine} ${mobile?'mobile':'desktop'} missing curve keeps music usable and restores preparation control`);
      if(!mobile) {
        await page.evaluate(async()=>{
          const p=window.__uiPlatform, saved=await p.repository.load();
          const analysis=await p.vocalAnalyses.put({version:4,rms:new Float64Array(1500).fill(.3),vowels:Uint8Array.from({length:7500},(_,i)=>[200,20,30,10,10][i%5])});
          await p.repository.save({...saved,tracks:saved.tracks.map(track=>track.id==='fixture-0'?{...track,vocalAnalysis:analysis}:track)});
        });
        const injectReadFailure=async permanent=>{
          await page.reload();await page.waitForSelector('[aria-label="Enable singing track 1"]');
          await page.evaluate(async permanent=>{
            const file='/src/platform/browserLibraryPlatform.ts',url=performance.getEntriesByType('resource').find(entry=>new URL(entry.name).pathname===file)?.name??file;
            const p=(await import(url)).browserLibraryPlatform,get=p.vocalAnalyses.get.bind(p.vocalAnalyses);
            window.__vocalReads=0;window.__vocalReadBroken=permanent;
            const footer=document.querySelector('.version-a .waveform-card-foot');
            window.__vocalFooterBefore=footer.textContent;window.__vocalFooterTexts=[];
            new window.MutationObserver(()=>window.__vocalFooterTexts.push(footer.textContent)).observe(footer,{childList:true,subtree:true,characterData:true});
            p.vocalAnalyses.get=async ref=>{window.__vocalReads++;if(window.__vocalReadBroken || !permanent && window.__vocalReads<=2)throw new Error('Temporary vocal timing read failure');return get(ref);};
          },permanent);
          await page.locator('[aria-label="Enable singing track 1"]').click();
        };
        await injectReadFailure(false);
        await page.waitForSelector('[data-vocal-track="1"][data-vocal-playback="enabled"][aria-pressed="true"]');
        assert.equal(await page.evaluate(()=>window.__vocalReads),3);
        assert.equal(await page.locator('.version-a .card-vocal-status').count(),0,'loaded vocal timing leaves no redundant completion text');
        assert.equal(await page.evaluate(()=>window.__vocalFooterTexts.every(text=>text===window.__vocalFooterBefore)),true,'first enable after refresh keeps footer text stable throughout loading and automatic retries');
        assert.ok(await page.locator('.version-a .waveform-card-foot > span:last-child').isVisible(),'original status remains visible');
        console.log(`PASS ${engine} desktop real Player control automatically enables after transient timing read failures`);
        await injectReadFailure(true);
        await page.waitForSelector('[aria-label="Retry singing track 1"][aria-pressed="false"]');
        assert.equal(await page.evaluate(()=>window.__vocalReads),4);
        assert.match(await page.locator('.version-a .card-vocal-status').textContent(),/Vocal timing unavailable/,'persistent read failure still shows recovery status');
        await page.evaluate(()=>{window.__vocalReadBroken=false;});
        await page.locator('[aria-label="Retry singing track 1"]').click();
        await page.waitForSelector('[data-vocal-track="1"][data-vocal-playback="enabled"][aria-pressed="true"]');
        assert.equal(await page.evaluate(()=>window.__vocalReads),5);
        console.log(`PASS ${engine} desktop failed timing exposes one-click retry without disabling singing`);
      }
      if(engine==='webkit'&&!mobile)await page.unroute('**/src/platform/browserLibraryPlatform.ts*');
    }
  } finally {await browser.close();}
}
await writeFile(path.join(output,'report.json'),JSON.stringify(reports,null,2));
