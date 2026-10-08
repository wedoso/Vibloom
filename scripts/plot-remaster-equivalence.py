"""Compare the frozen v1 baseline with current full-Python parity results."""
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
root=Path(__file__).resolve().parent.parent
old=json.loads((root/'outputs/remaster-parity/summary.json').read_text())
# Baseline records preserve the original run even when reference WAVs are rebuilt.
old_rows=old.get('comparisons',old.get('comparison',old.get('rows',[])))
if not old_rows:raise ValueError('Missing frozen baseline comparison rows')
new=json.loads((root/'outputs/remaster-equivalence/comparison.json').read_text())
presets=[p['id']for p in json.loads((root/'outputs/remaster-equivalence/web-presets.json').read_text())['presets']]
fixtures=['clean-tone','shimmer','stereo-whine','transients','wandering','speech','delivery-stress']
fig,axes=plt.subplots(1,2,figsize=(16,9),layout='constrained',sharey=True)
for ax,rows,title in zip(axes,[old_rows,new],['Before: web-deshimmer-1','After: web-deshimmer-2 (TS + WASM)']):
    records=[[next(r for r in rows if r['fixture']==f and r['preset']==p and r['mode']=='full') for f in fixtures]for p in presets]
    values=np.array([[r['snr_db'] if r['snr_db'] is not None else 150 for r in row]for row in records])
    im=ax.imshow(np.clip(values,0,130),cmap='viridis',vmin=0,vmax=130,aspect='auto')
    ax.set_xticks(range(len(fixtures)),fixtures,rotation=35,ha='right');ax.set_yticks(range(len(presets)),presets);ax.set_title(title,pad=14)
    for i in range(len(presets)):
        for j in range(len(fixtures)):
            v=values[i,j];ax.text(j,i,'exact'if records[i][j]['rmse']==0 else f'{v:.1f}',ha='center',va='center',fontsize=8,color='black'if v>95 else'white')
fig.colorbar(im,ax=axes,label='Unshifted, unmatched null-test SNR (dB); higher = closer',shrink=.7)
fig.suptitle('Identical Float32 PCM input vs full Python defaults, all 17 presets\nEngineering threshold: >=60 dB SNR, <=0.1 LU, <=0.1 dB active-band difference',fontsize=13)
output=root/'outputs/remaster-equivalence/remaster-equivalence.png'
output.parent.mkdir(parents=True,exist_ok=True)
fig.savefig(output,dpi=150)
