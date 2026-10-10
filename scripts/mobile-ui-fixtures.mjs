/* global indexedDB */
// Test-only library data; the live mobile app starts empty.
export function waveBytes(seconds = 30, frequency = 220) {
  const rate = 8000, length = rate * seconds, bytes = Buffer.alloc(44 + length * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(length * 2, 40);
  for (let i = 0; i < length; i++) bytes.writeInt16LE(Math.round(Math.sin(i * Math.PI * 2 * frequency / rate) * 4000), 44 + i * 2);
  return bytes;
}
export const fixtureNames = ['借风 · 夜晚的慢慢来.wav', 'A very long recording name with no missing details — live concert edition.wav', '超长中文歌曲标题用于验证窄屏不会文字重叠与按钮遮挡的现场录音.wav', '雨のあと、静かな部屋.wav', 'OneContinuousFilenameWithoutAnySpacesOrBreakPointsForNarrowScreenValidation.wav'];
export function snapshot(companionId = 'hong-xi') {
  const tracks = fixtureNames.map((name, index) => ({ id: 'fixture-' + index, fingerprint: 'fixture-' + index, name, relativePath: 'Evening collection/' + name, sourceLabel: 'Evening collection', size: 480044, lastModified: 1, duration: 30, availability: 'available', persistence: 'cached', lyricsFileName: index === 0 ? '借风.lrc' : '', lyrics: index === 0 ? Array.from({length: 18}, (_, i) => ({time:i * 1.5,text:i % 2 ? 'Let the room slow down, and listen to the details.' : '风从窗边经过，歌声留在这里。'})) : [], comparison: null, comparisons: [] }));
  const versions = Array.from({length:8},(_,i)=>({id:'version-' + i,slot:i+1,cacheKey:'fixture-version-' + i,name:i===3?'A comparison with an extraordinarily long file name — listen for subtle changes.wav':`借风 · comparison ${i+2}.wav`,size:480044,lastModified:1,duration:30,availability:'available',persistence:'cached',peaks:Array.from({length:80},(_,n)=>.15+Math.abs(Math.sin(n*.8))*.65)}));
  tracks[0].comparison=versions[0];tracks[0].comparisons=versions;
  return {version:3,tracks,albums:[{id:'evening',name:'Evening manuscripts · 夜晚手记',trackIds:tracks.map(t=>t.id)},{id:'empty',name:'A collection waiting to bloom',trackIds:[]}],session:{queue:tracks.map(t=>t.id),history:[],currentTrackId:tracks[0].id,currentTime:3,playbackAlbumId:'evening',shuffle:false,repeat:'off',volume:.5,cacheEnabled:true,companionId}};
}
export async function seedMobile(page, library, wave) {
  await page.evaluate(async ({library, data}) => {
    const bytes = new Uint8Array(data);
    const request=indexedDB.open('vibloom-mobile-library',2);
    const db=await new Promise((resolve,reject)=>{request.onupgradeneeded=()=>{for(const name of ['state','audio'])if(!request.result.objectStoreNames.contains(name))request.result.createObjectStore(name);};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    await new Promise((resolve,reject)=>{const tx=db.transaction(['state','audio'],'readwrite');tx.objectStore('state').put(library,'library');tx.objectStore('state').delete('session');
      for(const track of library.tracks)tx.objectStore('audio').put({bytes:bytes.buffer,type:'audio/wav'},track.id);
      for(const version of library.tracks[0].comparisons)tx.objectStore('audio').put({bytes:bytes.buffer,type:'audio/wav'},version.cacheKey);
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
  }, {library,data:[...wave]});
}
