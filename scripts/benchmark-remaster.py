#!/usr/bin/env python3
import argparse,ast,hashlib,io,json,sys,time,subprocess
from pathlib import Path
import numpy as np
import soundfile as sf
import pyloudnorm as pyln
root=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description='Serial Web Worker vs pinned Python benchmark, same PCM and full presets.')
parser.add_argument('--upstream',type=Path,required=True)
parser.add_argument('--output',type=Path,default=root/'outputs/remaster-speed/benchmark')
parser.add_argument('--seconds',type=int,nargs='+',default=[180,240])
parser.add_argument('--preset',default='full-safe')
args=parser.parse_args();out=args.output.resolve();(out/'input').mkdir(parents=True,exist_ok=True);upstream=args.upstream.resolve()
if any(s<1 or s>300 for s in args.seconds):raise ValueError('Benchmark durations must be 1..300 seconds')
sys.path.insert(0,str(upstream));import master as m;import ui_gradio as ui
assert subprocess.check_output(['git','-C',str(upstream),'rev-parse','HEAD'],text=True).strip()=='fea2cca81da613ec8a3aca4962a359e060eab9d9'
assert not subprocess.check_output(['git','-C',str(upstream),'status','--porcelain'],text=True).strip()
rate=44100;rng=np.random.default_rng(42);fixtures=[]
for seconds in args.seconds:
 t=np.arange(rate*seconds)/rate
 x=.18*np.sin(2*np.pi*1000*t)+.035*np.sin(2*np.pi*3500*t)+rng.uniform(-.02,.02,len(t))
 x=np.asarray(np.column_stack((x,-.5*x)),dtype='<f4')
 pcm=f'input/{seconds}s.f32';x.tofile(out/pcm)
 fixtures.append({'id':f'{seconds}s','seconds':seconds,'pcm':pcm,'rate':rate,'channels':2,'frames':len(x),'sha256':hashlib.sha256(x.tobytes()).hexdigest()})
subprocess.run(['node',str(root/'scripts/render-remaster-parity.mjs'),str(out),'--presets-only'],check=True)
web=json.loads((out/'web-presets.json').read_text())
index=next(i for i,p in enumerate(web['presets']) if p['id']==args.preset)
tree=ast.parse((upstream/'ui_gradio.py').read_text())
node=next(n for n in ast.walk(tree)if isinstance(n,ast.AnnAssign)and isinstance(n.target,ast.Name)and n.target.id=='base_presets')
original=list(ast.literal_eval(node.value).values())[index]
params,master_params,_=ui._build_params(original['values'])
manifest={'preset':args.preset,'engineVersion':web['engineVersion'],'fixtures':fixtures,'has_numba':m.HAS_NUMBA,'method':'Serial, same Float32 PCM; prepared input to PCM24 WAV plus two DeMan loudness passes; excludes decode, startup/import and disk output. Browser Worker includes chunk transport.'}
(out/'manifest.json').write_text(json.dumps(manifest,indent=2))
subprocess.run([str(root/'node_modules/.bin/electron'),str(root/'scripts/benchmark-remaster-worker.mjs'),str(out)],check=True)
rows=[]
for fixture in fixtures:
 x=np.fromfile(out/fixture['pcm'],dtype='<f4').reshape(fixture['frames'],2)
 start=time.perf_counter()
 p=params;mp=master_params
 repaired=m.process_stft(x.copy(),rate,p)
 repaired_lufs=pyln.Meter(rate,filter_class='DeMan').integrated_loudness(repaired)
 y,_=m.master_post(repaired,rate,mp)
 output_lufs=pyln.Meter(rate,filter_class='DeMan').integrated_loudness(y)
 peak=float(np.max(np.abs(y)))
 wav=io.BytesIO();sf.write(wav,y,rate,format='WAV',subtype='PCM_24')
 elapsed=(time.perf_counter()-start)*1000
 row={'fixture':fixture['id'],'elapsedMs':elapsed,'repairedLufs':float(repaired_lufs),'outputLufs':float(output_lufs),'samplePeak':peak,'byteLength':len(wav.getvalue())}
 rows.append(row);print('PYTHON',json.dumps(row),flush=True)
(out/'python-results.json').write_text(json.dumps(rows,indent=2))
