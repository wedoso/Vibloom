// Suno-Song-Remaster (ISC), pinned revision in settings.ts. See /eq-NOTICES.txt.
import { EQ_FREQUENCIES } from "../eq/presets";
import type { MasteringSettings } from "./settings";
export function makeClipCurve(ceiling: number) {
  const curve = new Float32Array(2048);
  for (let i = 0; i < curve.length; i++) curve[i] = Math.max(-ceiling, Math.min(ceiling, (i / (curve.length - 1)) * 2 - 1));
  return curve;
}
export function configureLimiter(node: DynamicsCompressorNode, ceiling: number, enabled = true) {
  node.threshold.value = enabled ? ceiling : 0; node.knee.value = 0; node.ratio.value = enabled ? 20 : 1; node.attack.value = .001; node.release.value = .05;
}
/** One disposable graph per preview or render; never attached to the master bus. */
export function createMasteringChain(context: BaseAudioContext, initial: MasteringSettings, live = false, normalization = 1) {
  const owned: AudioNode[] = [];
  const own = <T extends AudioNode>(node: T) => { owned.push(node); return node; };
  const input = own(context.createGain()), output = own(context.createGain());
  const eq = EQ_FREQUENCIES.map((frequency,i) => { const n = own(context.createBiquadFilter()); n.type = i === 0 ? "lowshelf" : i === 4 ? "highshelf" : "peaking"; n.frequency.value = frequency; if (i > 0 && i < 4) n.Q.value = 1; return n; });
  if (initial.mode === "eq") {
    const sequence = [input,...eq,output]; sequence.slice(0,-1).forEach((node,i)=>node.connect(sequence[i+1]));
    const update = (s: MasteringSettings) => { eq.forEach((node,i)=>node.gain.value=s.gains[i]); };
    update(initial);
    return { input, output, mode: initial.mode, update, dispose: () => { for (const node of owned) node.disconnect(); } };
  }
  const filter = (type: BiquadFilterType, frequency: number, Q?: number) => { const n = own(context.createBiquadFilter()); n.type = type; n.frequency.value = frequency; if (Q !== undefined) n.Q.value = Q; return n; };
  const highpass = filter("highpass",30,.7), mud = filter("peaking",250,1.5), harsh = filter("peaking",4000,2), harsh2 = filter("peaking",6000,1.5), air = filter("highshelf",12000);
  const compressor = own(context.createDynamicsCompressor()), limiter = own(context.createDynamicsCompressor()), clip = own(context.createWaveShaper()); clip.oversample = "4x";
  const splitter = own(context.createChannelSplitter(2)), merger = own(context.createChannelMerger(2));
  const gain = (value: number) => { const n = own(context.createGain()); n.gain.value = value; return n; };
  const leftMid = gain(.5), rightMid = gain(.5), leftSide = gain(.5), rightSide = gain(-.5), mid = gain(1), side = gain(1);
  const midLeft = gain(1), midRight = gain(1), sideLeft = gain(1), sideRight = gain(-1), norm = gain(1), sideHP = filter("highpass",1,.7);
  // EQ-only preserves source channels and excludes the full mastering graph.
  const sequence: AudioNode[] = [input,highpass,...eq,mud,harsh,harsh2,air,compressor,splitter];
  sequence.slice(0,-1).forEach((node,i) => node.connect(sequence[i + 1]));
  if (initial.mode === "mastering") {
    splitter.connect(leftMid,0); splitter.connect(rightMid,1); leftMid.connect(mid); rightMid.connect(mid);
    splitter.connect(leftSide,0); splitter.connect(rightSide,1); leftSide.connect(side); rightSide.connect(side);
    mid.connect(midLeft); mid.connect(midRight); side.connect(sideHP); sideHP.connect(sideLeft); sideHP.connect(sideRight);
    midLeft.connect(merger,0,0); sideLeft.connect(merger,0,0); midRight.connect(merger,0,1); sideRight.connect(merger,0,1);
    merger.connect(norm);
    if (live) norm.connect(limiter).connect(clip).connect(output); else norm.connect(output);
  }
  const update = (s: MasteringSettings, normGain = normalization) => {
    eq.forEach((n,i) => n.gain.value = s.gains[i]); input.gain.value = s.mode === "eq" ? 1 : Math.pow(10,s.inputGain / 20);
    highpass.frequency.value = s.cleanLowEnd ? 30 : 1; mud.gain.value = s.cutMud ? -3 : 0; harsh.gain.value = s.tameHarsh ? -2 : 0; harsh2.gain.value = s.tameHarsh ? -1.5 : 0; air.gain.value = s.addAir ? 2.5 : 0;
    compressor.threshold.value = s.glueCompression ? -18 : 0; compressor.knee.value = 10; compressor.ratio.value = s.glueCompression ? 3 : 1; compressor.attack.value = .02; compressor.release.value = .25;
    side.gain.value = s.stereoWidth / 100; sideHP.frequency.value = s.centerBass ? 120 : 1;
    norm.gain.value = live && s.normalizeLoudness ? normGain : 1;
    configureLimiter(limiter,s.truePeakCeiling,s.truePeakLimit);
    clip.curve = s.truePeakLimit ? makeClipCurve(Math.pow(10,s.truePeakCeiling / 20)) : null;
  };
  update(initial);
  return { input, output, mode: initial.mode, update, dispose: () => { for (const node of owned) node.disconnect(); clip.curve = null; } };
}
