#!/usr/bin/env python3
"""Render static numerical comparison plots from already-generated audit data."""
import argparse
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import soundfile as sf
from scipy.signal import welch

root=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--output',type=Path,default=root/'outputs/remaster-parity')
parser.add_argument('--figures',type=Path,default=root/'docs/assets')
args=parser.parse_args();args.figures.mkdir(parents=True,exist_ok=True)
rows=json.loads((args.output/'comparison.json').read_text())
presets=[p['id'] for p in json.loads((args.output/'web-presets.json').read_text())['presets']]
fixtures=[f['id'] for f in json.loads((args.output/'manifest.json').read_text())['fixtures'] if f['id']!='silence']
fig,axes=plt.subplots(1,2,figsize=(16,9),layout='constrained',sharey=True)
for ax,mode,title in zip(axes,['full','repair-only'],['Web vs full Python defaults','Web vs Python with engineering / tonal repair disabled']):
    values=np.empty((len(presets),len(fixtures)))
    for i,preset in enumerate(presets):
        for j,fixture in enumerate(fixtures):
            row=next(r for r in rows if (r['preset'],r['fixture'],r['mode'])==(preset,fixture,mode))
            values[i,j]=row['snr_db'] if row['snr_db'] is not None else 130
    im=ax.imshow(np.clip(values,0,100),cmap='viridis',vmin=0,vmax=100,aspect='auto')
    ax.set_xticks(range(len(fixtures)),fixtures,rotation=40,ha='right');ax.set_yticks(range(len(presets)),presets)
    ax.set_title(title,fontsize=12,pad=14)
    for i in range(len(presets)):
        for j in range(len(fixtures)):
            value=values[i,j];label='>100' if value>100 else f'{value:.1f}'
            ax.text(j,i,label,ha='center',va='center',fontsize=8,color='black' if value>75 else 'white')
fig.colorbar(im,ax=axes,label='Null-test SNR (dB); higher = smaller waveform difference',shrink=.7)
fig.suptitle('Fixed Float32 input, identical rate / channels; PCM24 WAV comparison\nSilence excluded; no gain matching or temporal realignment',fontsize=14)
fig.savefig(args.figures/'remaster-consistency.png',dpi=150);plt.close(fig)

fig,axes=plt.subplots(2,2,figsize=(13,8),layout='constrained')
for ax,(fixture,preset) in zip(axes.flat,[('shimmer','default'),('shimmer','full-safe'),('stereo-whine','whine'),('delivery-stress','delivery')]):
    for file,label,color in [(f'input/{fixture}.wav','Input','#777777'),(f'python/{fixture}--{preset}--full.wav','Python full','#b44e3f'),(f'web/{fixture}--{preset}.wav','Web','#277ca8')]:
        x,rate=sf.read(args.output/file,always_2d=True)
        f,power=welch(x.T,fs=rate,nperseg=4096)
        ax.semilogx(f[1:],10*np.log10(np.mean(power,axis=0)[1:]+1e-16),label=label,color=color,alpha=.9)
    ax.set(title=f'{fixture} / {preset}',xlim=(20,24000),ylim=(-145,-25),xlabel='Frequency (Hz)',ylabel='PSD (dB/Hz)');ax.grid(alpha=.15);ax.legend(fontsize=8)
fig.suptitle('Spectrum comparison: numerical differences do not rank perceived audio quality',fontsize=13)
fig.savefig(args.figures/'remaster-consistency-spectra.png',dpi=150);plt.close(fig)
