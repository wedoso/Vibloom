#!/usr/bin/env python3
"""Fixed-reference output audit. Python packages are development-only.

Run: python scripts/compare-remaster.py --upstream /path/to/deshimmer
No upstream source is modified, and no production DSP is patched.
"""
import argparse
import ast
from dataclasses import asdict, replace
import hashlib
import importlib.metadata
import json
from pathlib import Path
import subprocess
import sys
import time

import numpy as np
import soundfile as sf
import pyloudnorm as pyln
from scipy.signal import correlate, correlation_lags, resample_poly, stft

ROOT = Path(__file__).resolve().parents[1]
UPSTREAM_SHA = 'fea2cca81da613ec8a3aca4962a359e060eab9d9'
BANDS = [(20,180),(180,1000),(1000,3000),(3000,4200),(4200,5100),(5100,7200),(7200,12000),(12000,20000)]
# These are numerical audit criteria, not perceptual equivalence certification.
PCM_TOLERANCE = 2 / 8388608
SNR_THRESHOLD = 60.0
LUFS_TOLERANCE = .1
BAND_TOLERANCE = .1

def dump(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False)+'\n')

def finite(value):
    return float(value) if np.isfinite(value) else None

def db(value):
    return finite(20*np.log10(value)) if value > 0 else None

def rms(x):
    return float(np.sqrt(np.mean(np.square(x, dtype=np.float64))))

def loudness(x, rate):
    if len(x)<rate*.4 or rms(x)<1e-10: return None
    return finite(pyln.Meter(rate, filter_class='DeMan').integrated_loudness(x))

def spectrum(x, rate):
    f, _, z=stft(x.T,fs=rate,nperseg=2048,noverlap=1536,boundary=None,padded=False)
    return f,np.mean(np.abs(z)**2,axis=(0,2))

def measure(x,rate):
    f,power=spectrum(x,rate)
    return {'lufs':loudness(x,rate),'rms_dbfs':db(rms(x)),
            'sample_peak_dbfs':db(float(np.max(np.abs(x)))),
            'true_peak_4x_db':db(float(np.max(np.abs(resample_poly(x,4,1,axis=0))))),
            'lr_rms_db':db(rms(x[:,0])/rms(x[:,1])) if x.shape[1]==2 and rms(x[:,1]) else None,
            'bands_db':{f'{lo}-{hi}':db(np.sqrt(np.sum(power[(f>=lo)&(f<hi)]))) for lo,hi in BANDS}}

def compare(ref, web, rate):
    assert ref.shape==web.shape and np.isfinite(ref).all() and np.isfinite(web).all()
    delta=web.astype(np.float64)-ref.astype(np.float64)
    rmse=rms(delta); ref_rms=rms(ref)
    snr=20*np.log10(ref_rms/rmse) if ref_rms>0 and rmse>0 else None
    a,b=measure(ref,rate),measure(web,rate)
    lufs_delta=b['lufs']-a['lufs'] if a['lufs'] is not None and b['lufs'] is not None else None
    bands={name:b['bands_db'][name]-value for name,value in a['bands_db'].items()
           if value is not None and value>-80 and b['bands_db'][name] is not None}
    maxband=max(map(abs,bands.values()),default=0)
    dot=float(np.sum(ref.astype(np.float64)*web))
    denominator=float(np.linalg.norm(ref)*np.linalg.norm(web))
    # Measure channel lags independently; do not shift or gain-match the null test.
    lags=[]
    for channel in range(ref.shape[1]):
        if rms(ref[:,channel])<1e-10: lags.append(None);continue
        corr=correlate(web[:,channel],ref[:,channel],method='fft')
        lag=correlation_lags(len(web),len(ref)); limit=np.abs(lag)<=round(rate*.01)
        lags.append(int(lag[limit][np.argmax(corr[limit])]))
    maxerror=float(np.max(np.abs(delta)))
    pcm=maxerror<=PCM_TOLERANCE
    near=pcm or (snr is not None and snr>=SNR_THRESHOLD and (lufs_delta is None or abs(lufs_delta)<=LUFS_TOLERANCE) and maxband<=BAND_TOLERANCE)
    return {'max_abs_error':maxerror,'rmse':rmse,'null_dbfs':db(rmse),'snr_db':finite(snr) if snr is not None else None,
            'correlation':dot/denominator if denominator>0 else None,'best_lag_samples':lags,
            'lufs_delta':lufs_delta,'band_delta_db':bands,'max_band_delta_db':maxband,
            'pcm_equivalent':pcm,'near_equivalent':bool(near),'python':a,'web':b}

def prepare(args, upstream, m):
    output=args.output
    (output/'input').mkdir(parents=True,exist_ok=True)
    rng=np.random.default_rng(20261007)
    fixtures=[]
    def add(name,x,rate,description):
        x=np.asarray(x,dtype='<f4');x=x[:,None] if x.ndim==1 else x
        pcm=f'input/{name}.f32'; x.tofile(output/pcm)
        sf.write(output/f'input/{name}.wav',x,rate,subtype='FLOAT')
        fixtures.append({'id':name,'pcm':pcm,'rate':rate,'channels':x.shape[1],'frames':len(x),
                         'sha256':hashlib.sha256(x.tobytes()).hexdigest(),'description':description})
    rate=48000;t=np.arange(rate*4)/rate
    noise=rng.normal(0,.04,len(t))
    add('silence',np.zeros(rate*2),rate,'2 s mono silence')
    add('clean-tone',.1*np.sin(2*np.pi*1000*t),rate,'4 s mono 1 kHz clean sine')
    add('shimmer',noise+.015*np.sin(2*np.pi*6000*t)+.04*np.sin(2*np.pi*1000*t),rate,'4 s broadband noise + 6 kHz outlier + low-band tone')
    whine=.08*np.sin(2*np.pi*3500*t)+.04*np.sin(2*np.pi*1000*t)+rng.normal(0,.015,len(t))
    add('stereo-whine',np.column_stack((whine,np.r_[np.zeros(6),.6*whine[:-6]])),rate,'4 s whine; right quieter and delayed by 6 samples')
    pulses=np.exp(-((t% .5)/.025)**2)
    transient=noise*(t>1)+.4*np.sin(2*np.pi*70*t)*pulses
    add('transients',np.column_stack((transient,-.7*transient)),rate,'4 s attacks and silence-to-noise onset; opposite-polarity stereo')
    from tonal_fixtures import TonalFixture
    add('wandering',TonalFixture(44100,4).render('wandering',stereo=True),44100,'4 s upstream wandering-harmonic fixture; opposite-polarity stereo')
    voice,voice_rate=sf.read(ROOT/'tests/fixtures/vocal-speech.wav',dtype='float32',always_2d=True)
    add('speech',voice,voice_rate,'Existing 4 s spoken-voice fixture, not a music recording')
    stress=.12+.07*np.sin(2*np.pi*1000*t)+.78*np.sin(2*np.pi*11000*t)*((t%.8)<.08)
    add('delivery-stress',np.column_stack((stress,.7*stress)),rate,'4 s DC offset + high-crest high-frequency bursts')
    if args.extended:
        for rate,seconds,channels,name in [(8000,2.137,1,'extended-8k'),(96000,3.017,2,'extended-96k'),(48000,20.013,2,'extended-20s')]:
            t=np.arange(int(rate*seconds))/rate
            carrier=.06*np.sin(2*np.pi*997*t)+.035*np.sin(2*np.pi*min(3500,rate*.4)*t)
            bed=rng.normal(0,.016,len(t))*(.1+.9*((t%2)>.7))
            audio=(carrier+bed)*(.25+.75*np.sin(np.pi*np.minimum(t%5,4)/4)**2)
            if channels==2:audio=np.column_stack((audio,np.r_[np.zeros(7),.67*audio[:-7]]))
            add(name,audio,rate,f'{seconds} s non-hop-aligned, modulated noise and tones at {rate} Hz')
    for index,file in enumerate(args.audio):
        x,rate=sf.read(file,dtype='float32',always_2d=True)
        if x.shape[1]>2: raise ValueError('Additional fixture must be mono/stereo')
        add(f'local-{index+1}',x,rate,f'User-supplied local recording: {Path(file).name}')
    source_files=list((ROOT/'src/audio/remaster').glob('*.ts')) + list((ROOT/'src/audio/remaster/wasm').glob('*.wasm')) + list((ROOT/'src/audio/remaster/wasm').glob('*.cpp')) + [ROOT/'scripts/build-remaster-fft.mjs']
    dump(output/'manifest.json',{'upstream_sha':UPSTREAM_SHA,'source_sha256':{str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in source_files},
         'python':sys.version,'packages':{name:importlib.metadata.version(name) for name in ['numpy','scipy','soundfile','pyloudnorm','matplotlib']},
         'has_numba':m.HAS_NUMBA,'fixtures':fixtures,'criteria':{'pcm_tolerance':PCM_TOLERANCE,'snr_db':SNR_THRESHOLD,'lufs':LUFS_TOLERANCE,'max_active_band_db':BAND_TOLERANCE}})

# One-to-one fields represented by current Web recipes. Others are explicitly
# recorded rather than silently forcing the Python reference to match Web.
WEB_FIELDS={'startHz':'start_hz','endHz':'end_hz','edgeHz':'edge_hz','thresholdDb':'thr_db','slope':'slope',
    'noiseResynth':'noise_resynth','denoise':'denoise','noiseStartHz':'dn_start_hz','noiseWindowMs':'dn_minwin_ms',
    'noisePsdMs':'dn_psd_smooth_ms','enhance':'enhance','tonalRepair':'tonal_repair',
    'resonanceSmoothBins':'deq_freq_smooth_bins','resonancePersistenceDb':'deq_persist_thr_db',
    'noiseFloorDb':'dn_floor_db','noiseSmoothBins':'dn_freq_smooth_bins','deres':'deres',
    'resonanceThresholdDb':'deq_thr_db','resonanceMaxDb':'deq_max_att_db','resonanceWindowMs':'deq_persist_ms',
    'resonanceMedianBins':'deq_freq_med_bins','stationaryFloor':'deq_time_floor'}

def references(args, upstream, m, ui):
    output=args.output;manifest=json.loads((output/'manifest.json').read_text());web=json.loads((output/'web-presets.json').read_text())
    tree=ast.parse((upstream/'ui_gradio.py').read_text())
    presets_node=next(n for n in ast.walk(tree) if isinstance(n,ast.AnnAssign) and isinstance(n.target,ast.Name) and n.target.id=='base_presets')
    originals=list(ast.literal_eval(presets_node.value).items())
    assert len(originals)==len(web['presets'])==17
    (output/'python').mkdir(exist_ok=True)
    audit=[];results=[]
    for preset,(name,recipe) in zip(web['presets'],originals,strict=True):
        p,mp,_=ui._build_params(recipe['values'])
        settings=preset['settings']
        differences={web_name:{'web':settings[web_name],'python':getattr(p,py_name)} for web_name,py_name in WEB_FIELDS.items() if settings[web_name]!=getattr(p,py_name)}
        audit.append({'id':preset['id'],'upstream_name':name,'overrides':recipe['values'],'mapped_differences':differences,'params':asdict(p),'master':asdict(mp)})
    dump(output/'parameter-audit.json',audit)
    for fixture in manifest['fixtures']:
        x=np.fromfile(output/fixture['pcm'],dtype='<f4').reshape(fixture['frames'],fixture['channels'])
        for preset in audit:
            p=m.Params(**preset['params']);mp=m.MasterParams(**preset['master'])
            for mode in ['full','repair-only']:
                actual=p if mode=='full' else replace(p,enhance=False,tonal_repair=0)
                start=time.perf_counter();info={}
                repaired=m.process_stft(x.copy(),fixture['rate'],actual,diagnostics=info)
                y,_=m.master_post(repaired,fixture['rate'],mp)
                y=m._as_2d(y);assert y.shape==x.shape and np.isfinite(y).all()
                file=f"python/{fixture['id']}--{preset['id']}--{mode}.wav"
                sf.write(output/file,y,fixture['rate'],subtype='PCM_24')
                results.append({'fixture':fixture['id'],'preset':preset['id'],'mode':mode,'file':file,
                    'elapsedMs':(time.perf_counter()-start)*1000,'tonal':info.get('tonal'),
                    'float_peak':float(np.max(np.abs(y))),'float_clipped_samples':int(np.count_nonzero(np.abs(y)>1))})
        print(f"PYTHON {fixture['id']}: 17 presets × full/repair-only",flush=True)
    dump(output/'python-results.json',results)


def report(args):
    output=args.output;manifest=json.loads((output/'manifest.json').read_text())
    web_results={(r['fixture'],r['preset']):r for r in json.loads((output/'web-results.json').read_text())}
    python_results=json.loads((output/'python-results.json').read_text());rows=[]
    for reference in python_results:
        fixture=next(f for f in manifest['fixtures'] if f['id']==reference['fixture'])
        a,rate=sf.read(output/reference['file'],always_2d=True,dtype='float32')
        web=web_results[(reference['fixture'],reference['preset'])]
        b,b_rate=sf.read(output/web['file'],always_2d=True,dtype='float32');assert b_rate==rate==fixture['rate']
        rows.append({'fixture':fixture['id'],'preset':reference['preset'],'mode':reference['mode'],**compare(a,b,rate),
                     'python_file':reference['file'],'web_file':web['file'],'tonal_changed_partials':(reference['tonal'] or {}).get('changed_partials',0),
                     'python_clipped_samples':reference['float_clipped_samples']})
    dump(output/'comparison.json',rows)
    summary=[]
    for preset in json.loads((output/'web-presets.json').read_text())['presets']:
        for mode in ['full','repair-only']:
            subset=[r for r in rows if r['preset']==preset['id'] and r['mode']==mode]
            snr=[r['snr_db'] for r in subset if r['snr_db'] is not None]
            loud=[abs(r['lufs_delta']) for r in subset if r['lufs_delta'] is not None]
            summary.append({'preset':preset['id'],'mode':mode,'pcm_matches':sum(r['pcm_equivalent'] for r in subset),
                'near_matches':sum(r['near_equivalent'] for r in subset),'cases':len(subset),'median_snr_db':float(np.median(snr)) if snr else None,
                'worst_lufs_delta':max(loud,default=0),'worst_band_delta_db':max(r['max_band_delta_db'] for r in subset)})
    dump(output/'summary.json',summary)
    print(json.dumps(summary,indent=2))


def diagnose(args, upstream, m):
    """Cumulative ablations, kept separate from untouched production references.
    The AST variant removes only the hard-coded three projection iterations;
    other diagnostic changes use Params/pipeline APIs. No checkout is edited.
    """
    import copy
    tree=ast.parse((upstream/'master.py').read_text())
    function=copy.deepcopy(next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='process_stft'))
    function.name='process_without_projection'
    function.body=[n for n in function.body if not (isinstance(n,ast.For) and isinstance(n.target,ast.Name) and n.target.id=='_proj_iter')]
    isolated_globals=dict(vars(m))
    exec(compile(ast.fix_missing_locations(ast.Module(body=[function],type_ignores=[])),str(upstream/'master.py'), 'exec'),isolated_globals)
    no_projection=isolated_globals['process_without_projection']
    class NoMask:
        name='gain_application_no_mask'
        def __init__(self,stage):self.stage=stage
        def is_enabled(self):return True
        def process(self,ctx):
            ctx.mask_psd.fill(0)
            self.stage.process(ctx)
    output=args.output;manifest=json.loads((output/'manifest.json').read_text())
    audit={r['id']:r for r in json.loads((output/'parameter-audit.json').read_text())}
    presets={r['id']:r for r in json.loads((output/'web-presets.json').read_text())['presets']}
    rows=[]
    for fixture_id,preset_id in [('shimmer','default'),('shimmer','aggressive'),('stereo-whine','whine'),
                                ('transients','strong-denoise'),('shimmer','strong-denoise'),('shimmer','decrystallize'),('delivery-stress','delivery')]:
        fixture=next(f for f in manifest['fixtures'] if f['id']==fixture_id)
        x=np.fromfile(output/fixture['pcm'],dtype='<f4').reshape(fixture['frames'],fixture['channels'])
        b,_=sf.read(output/f'web/{fixture_id}--{preset_id}.wav',dtype='float32',always_2d=True)
        params=m.Params(**audit[preset_id]['params']);mp=m.MasterParams(**audit[preset_id]['master'])
        params=replace(params,enhance=False,tonal_repair=0)
        for mode in ['repair-only','no-projection','no-mask','matched-stage-settings']:
            p=params
            if mode=='matched-stage-settings':
                settings=presets[preset_id]['settings']
                # Retain the historical v1 approximation as a diagnostic, separate from the full-chain baseline.
                overrides={py_name:settings[web_name] for web_name,py_name in WEB_FIELDS.items()}
                overrides.update(deq_inpaint=False,deq_freq_smooth_bins=5,deq_persist_thr_db=2.5,dn_psd_smooth_ms=50,enhance=False,tonal_repair=0)
                p=replace(p,**overrides)
            pipeline=m.build_default_pipeline(p)
            if mode in ['no-mask','matched-stage-settings']:
                pipeline.stages=[NoMask(stage) if stage.name=='gain_application' else stage for stage in pipeline.stages]
            function=m.process_stft if mode=='repair-only' else no_projection
            y=function(x.copy(),fixture['rate'],p,pipeline=pipeline)
            y,_=m.master_post(y,fixture['rate'],mp)
            file=f'python/{fixture_id}--{preset_id}--diagnostic-{mode}.wav'
            sf.write(output/file,y,fixture['rate'],subtype='PCM_24')
            a,_=sf.read(output/file,dtype='float32',always_2d=True)
            rows.append({'fixture':fixture_id,'preset':preset_id,'mode':mode,**compare(a,b,fixture['rate'])})
        print(f'DIAGNOSTIC {fixture_id}/{preset_id}',flush=True)
    dump(output/'diagnostics.json',rows)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--upstream',type=Path,required=True)
    parser.add_argument('--output',type=Path,default=ROOT/'outputs/remaster-parity')
    parser.add_argument('--audio',type=Path,action='append',default=[])
    parser.add_argument('--extended',action='store_true',help='Add 8/96 kHz and 20 s non-hop-aligned regression signals')
    parser.add_argument('--phase',choices=['all','prepare','reference','report','diagnose'],default='all')
    args=parser.parse_args();args.output=args.output.resolve();upstream=args.upstream.resolve()
    sha=subprocess.check_output(['git','-C',str(upstream),'rev-parse','HEAD'],text=True).strip()
    if sha!=UPSTREAM_SHA:raise ValueError(f'Expected {UPSTREAM_SHA}; found {sha}')
    if subprocess.check_output(['git','-C',str(upstream),'status','--porcelain'],text=True).strip():raise ValueError('Upstream checkout must be clean')
    sys.path.insert(0,str(upstream));import master as m;import ui_gradio as ui
    if args.phase in ['all','prepare']:
        prepare(args,upstream,m)
        subprocess.run(['node',str(ROOT/'scripts/render-remaster-parity.mjs'),str(args.output),'--presets-only'],check=True)
    if args.phase=='all':subprocess.run(['node',str(ROOT/'scripts/render-remaster-parity.mjs'),str(args.output)],check=True)
    if args.phase in ['all','reference']:references(args,upstream,m,ui)
    if args.phase in ['all','report']:report(args)
    if args.phase in ['all','diagnose']:diagnose(args,upstream,m)

if __name__=='__main__':main()
