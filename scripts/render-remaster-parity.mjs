// Exercise the exact production DSP/WAV modules on shared Float32 PCM, without
// an AudioContext decode/resample or Worker transport changing the input.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadTs } from '../tests/load-ts.mjs';
const { REPAIR_PRESETS, REMASTER_ENGINE_VERSION } = await loadTs('../src/audio/remaster/presets.ts');
const { OfflineRepair } = await loadTs('../src/audio/remaster/dsp.ts');
const { WavRender } = await loadTs('../src/audio/remaster/wav.ts');
const directory = path.resolve(process.argv[2] ?? 'outputs/remaster-parity');
await mkdir(path.join(directory,'web'),{recursive:true});
await writeFile(path.join(directory,'web-presets.json'),JSON.stringify({engineVersion:REMASTER_ENGINE_VERSION,presets:REPAIR_PRESETS},null,2));
if(process.argv.includes('--presets-only')) process.exit(0);
const manifest=JSON.parse(await readFile(path.join(directory,'manifest.json'),'utf8'));
const results=[];
for(const fixture of manifest.fixtures) {
  const bytes=await readFile(path.join(directory,fixture.pcm));
  // Copy into an aligned, owned buffer. Values match Python's little-endian f32.
  const interleaved=new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  const channels=Array.from({length:fixture.channels},(_,c)=>Float32Array.from({length:fixture.frames},(_,i)=>interleaved[i*fixture.channels+c]));
  for(const preset of REPAIR_PRESETS) {
    const start=performance.now(), core=new OfflineRepair(fixture.rate,fixture.channels,fixture.frames,preset.settings);
    const wav=new WavRender(fixture.rate,fixture.frames,fixture.channels);
    for(let offset=0;offset<fixture.frames;offset+=fixture.rate*2) {
      const end=Math.min(fixture.frames,offset+fixture.rate*2);
      core.append(channels.map(x=>x.subarray(offset,end)));
    }
    wav.append(await core.finish());
    const result=await wav.finish(preset.settings.targetLufs,preset.settings.ceilingDb,()=>{});
    const file=`web/${fixture.id}--${preset.id}.wav`;
    await writeFile(path.join(directory,file),new Uint8Array(result.buffer,0,result.byteLength));
    results.push({fixture:fixture.id,preset:preset.id,file,metrics:result.metrics,elapsedMs:performance.now()-start});
  }
  console.log(`WEB ${fixture.id}: ${REPAIR_PRESETS.length} presets`);
}
await writeFile(path.join(directory,'web-results.json'),JSON.stringify(results,null,2));
