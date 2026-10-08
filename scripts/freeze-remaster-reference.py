"""Freeze sparse PCM24 golden samples from untouched full Python outputs.
Run compare-remaster.py first. This never reads Web output to build expectations.
"""
import base64,gzip,json,hashlib
from pathlib import Path
import numpy as np
import soundfile as sf
root=Path(__file__).resolve().parent.parent
out=root/'outputs/remaster-parity'
manifest=json.loads((out/'manifest.json').read_text())
selected={'shimmer':['decrystallize','full-strong'],'stereo-whine':['default','whine','crickets'],
          'wandering':['whine'],'delivery-stress':['delivery','delivery-loud']}
fixtures=[]
for identifier,presets in selected.items():
    fixture=next(f for f in manifest['fixtures'] if f['id']==identifier)
    raw=(out/fixture['pcm']).read_bytes()
    # Whole PCM input; only expected outputs are sampled. Include endpoints,
    # evenly spaced samples, and independent seeded random frame positions.
    rng=np.random.default_rng(214)
    indices=np.unique(np.r_[np.arange(32),fixture['frames']-1-np.arange(32),
        np.linspace(0,fixture['frames']-1,2048,dtype=int),rng.integers(0,fixture['frames'],2048)]).tolist()
    expected=[]
    for preset in presets:
        pcm,rate=sf.read(out/f'python/{identifier}--{preset}--full.wav',always_2d=True,dtype='float32')
        assert rate==fixture['rate'] and len(pcm)==fixture['frames']
        expected.append({'preset':preset,'pcm':base64.b64encode(pcm[indices].astype('<f4').tobytes()).decode(),
            'rms':float(np.sqrt(np.mean(pcm.astype(np.float64)**2)))})
    fixtures.append({**fixture,'input':base64.b64encode(raw).decode(),'sha256':hashlib.sha256(raw).hexdigest(),'indices':indices,'expected':expected})
record={'upstream':manifest['upstream_sha'],'packages':manifest['packages'],'criteria':manifest['criteria'],'fixtures':fixtures}
target=root/'tests/fixtures/remaster-reference.json.gz'
with target.open('wb')as file:file.write(gzip.compress(json.dumps(record,separators=(',',':')).encode(),mtime=0))
print(target,target.stat().st_size)
