import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshot, waveBytes } from './mobile-ui-fixtures.mjs';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const profile = await mkdtemp(path.join(tmpdir(), 'vibloom-lyrics-export-'));
app.setPath('userData', profile); app.on('window-all-closed', () => {});
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.wasm':'application/wasm' };
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://local').pathname;
  const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  try {
    if (!file.startsWith(root)) throw new Error('Invalid path');
    response.setHeader('Content-Type', mime[path.extname(file)] ?? 'application/octet-stream'); response.end(await readFile(file));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/?ui=mobile`;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let window, exitCode = 0;
const deadline = setTimeout(() => { console.error('Lyrics export smoke timed out'); app.exit(1); }, 45000);
async function smoke() {
  try {
    await app.whenReady();
    await mkdir(path.join(profile, 'exports'));
    window = new BrowserWindow({ width:390, height:844, show:false, webPreferences:{ sandbox:true, contextIsolation:true, nodeIntegration:false, backgroundThrottling:false } });
    window.webContents.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 Version/18.4 Mobile/15E148 Safari/604.1');
    window.webContents.setAudioMuted(true);
    const run = code => window.webContents.executeJavaScript(code, true);
    const wait = async (code, label) => {
      for (let i=0;i<100;i++) { if (await run(code)) return; await pause(100); }
      throw new Error(`Timed out: ${label}`);
    };
    const click = selector => run(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const clickText = text => run(`(() => { const button=[...document.querySelectorAll('dialog[open] button')].find(button=>button.textContent.trim()===${JSON.stringify(text)}); if(!button)throw new Error('Missing button'); button.click(); })()`);
    const downloads = [];
    window.webContents.session.on('will-download', (_event, item) => {
      const filename = item.getFilename(), target = path.join(profile, 'exports', filename);
      item.setSavePath(target);
      const result = new Promise((resolve,reject) => item.once('done', (_event,state) => state === 'completed' ? resolve({ filename, target }) : reject(new Error(`Download ${state}`))));
      downloads.push(result);
    });
    await window.loadURL(url); await wait(`document.querySelector('[data-picker="files"]')`, 'mobile app'); await pause(600);
    const library = snapshot(); library.tracks = [library.tracks[0]]; library.albums = [];
    Object.assign(library.tracks[0], { name:'导出测试.wav', lyricsFileName:'歌词.lrc', comparisons:[], comparison:null,
      lyrics:[{time:1.123,text:'原文\nTranslation'},{time:3,text:'Refrain'},{time:5,text:'Refrain'},{time:7,text:''}], lyricMetadata:['[ti:导出测试]','[ar:Artist]'] });
    library.session.queue = [library.tracks[0].id]; library.session.playbackAlbumId = '';
    const bytes = [...waveBytes(10)];
    const seed = async state => {
      await run(`(async () => { const request=indexedDB.open('vibloom-mobile-library',2); const db=await new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
        await new Promise((resolve,reject)=>{const tx=db.transaction(['state','audio'],'readwrite'); tx.objectStore('state').put(${JSON.stringify(state)},'library');tx.objectStore('state').delete('session');tx.objectStore('audio').put({bytes:new Uint8Array(${JSON.stringify(bytes)}).buffer,type:'audio/wav'},${JSON.stringify(state.tracks[0].id)});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close(); })()`);
      await window.loadURL(url);
      await wait(`document.querySelector('[aria-label="Listening options"]')`, 'restored transport');
    };
    const open = async () => {
      await click('[aria-label="Listening options"]'); await clickText('Lyrics'); await click('[aria-label="Edit lyric timing"]');
      await wait(`document.querySelector('[aria-label="More lyric actions"]')`, 'editor');
    };
    const download = async format => {
      const count = downloads.length; await click('[aria-label="More lyric actions"]'); await clickText(`Export ${format}`);
      for(let i=0; downloads.length===count && i<50; i++) await pause(50);
      assert.equal(downloads.length, count+1, `real ${format} download started`);
      const file = await downloads[count]; return { name:file.filename, text:await readFile(file.target,'utf8') };
    };
    await seed(library);
    await click('[aria-label="Listening options"]'); await clickText('Lyrics');
    for (const format of ['TXT','LRC']) {
      const count=downloads.length; await clickText(`Export ${format}`);
      for(let i=0;downloads.length===count&&i<50;i++)await pause(50);
      const file=await downloads[count];assert.equal(file.filename,`歌词.${format.toLowerCase()}`);
      assert.ok((await readFile(file.target,'utf8')).includes('Translation'));
      assert.equal(await run(`!!document.querySelector('[aria-label="More lyric actions"]')`),false,'direct export never opens the timing editor');
    }
    await click('[aria-label="Close panel"]'); await open();
    assert.deepEqual(await download('TXT'), { name:'歌词.txt', text:'原文\nTranslation\nRefrain\nRefrain\n\n' });
    const lrc = await download('LRC'); assert.equal(lrc.name,'歌词.lrc');
    assert.equal(lrc.text,'[ti:导出测试]\n[ar:Artist]\n[00:01.123]原文\n[00:01.123]Translation\n[00:03.00]Refrain\n[00:05.00]Refrain\n[00:07.00]\n');
    await click('[aria-label="Close panel"]');
    library.tracks[0].lyrics=[]; library.tracks[0].lyricTiming=[{time:null,text:'未打轴第一行'},{time:null,text:'Untimed second line'}]; library.tracks[0].lyricsFileName='草稿.txt';
    await seed(library); await open();
    assert.deepEqual(await download('TXT'), { name:'草稿.txt', text:'未打轴第一行\nUntimed second line\n' });
    await click('[aria-label="More lyric actions"]'); await clickText('Export LRC');
    assert.match(await run(`document.querySelector('dialog[open] [role="alert"]').textContent`), /Timestamp every line/);
    assert.equal(downloads.length,5,'untimed LRC is rejected without a download');
    console.log('PASS actual mobile LRC/TXT downloads, UTF-8 names/content, repeated/multiline/blank lyrics, untimed TXT and LRC validation');
  } catch(error) { console.error(error); exitCode=1; }
  finally { clearTimeout(deadline); window?.destroy(); server.close(); try { await rm(profile,{recursive:true,force:true,maxRetries:3}); } finally { app.exit(exitCode); } }
}
void smoke();
