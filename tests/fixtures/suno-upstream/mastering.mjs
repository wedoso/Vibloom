// Independent unmodified functions extracted from renderer.js at 862a0aa7a686be3bc7e420d108f4e3e4e050bb1f. ISC, see LICENSE.
import {AUDIO_CONSTANTS} from './audioConstants.mjs';
import {measureLUFS,calculateNormalizationGain} from './lufs.mjs';
const state={file:{buffer:null}};
function configureEQNodes(nodes) {
  nodes.eqLow.type = 'lowshelf';
  nodes.eqLow.frequency.value = AUDIO_CONSTANTS.FREQ_LOW;

  nodes.eqLowMid.type = 'peaking';
  nodes.eqLowMid.frequency.value = AUDIO_CONSTANTS.FREQ_LOW_MID;
  nodes.eqLowMid.Q.value = 1;

  nodes.eqMid.type = 'peaking';
  nodes.eqMid.frequency.value = AUDIO_CONSTANTS.FREQ_MID;
  nodes.eqMid.Q.value = 1;

  nodes.eqHighMid.type = 'peaking';
  nodes.eqHighMid.frequency.value = AUDIO_CONSTANTS.FREQ_HIGH_MID;
  nodes.eqHighMid.Q.value = 1;

  nodes.eqHigh.type = 'highshelf';
  nodes.eqHigh.frequency.value = AUDIO_CONSTANTS.FREQ_HIGH;
}

function configureFilterNodes(nodes, settings = null) {
  const s = settings || {};

  nodes.highpass.type = 'highpass';
  nodes.highpass.frequency.value = (s.cleanLowEnd !== undefined ? s.cleanLowEnd : true)
    ? AUDIO_CONSTANTS.HIGHPASS_FREQ : 1;
  nodes.highpass.Q.value = 0.7;

  nodes.lowshelf.type = 'peaking';
  nodes.lowshelf.frequency.value = AUDIO_CONSTANTS.MUD_CUT_FREQ;
  nodes.lowshelf.Q.value = 1.5;
  nodes.lowshelf.gain.value = s.cutMud ? -3 : 0;

  nodes.highshelf.type = 'highshelf';
  nodes.highshelf.frequency.value = AUDIO_CONSTANTS.AIR_FREQ;
  nodes.highshelf.gain.value = s.addAir ? 2.5 : 0;

  nodes.midPeak.type = 'peaking';
  nodes.midPeak.frequency.value = AUDIO_CONSTANTS.HARSHNESS_FREQ_1;
  nodes.midPeak.Q.value = AUDIO_CONSTANTS.HARSHNESS_Q_4K;
  nodes.midPeak.gain.value = s.tameHarsh ? AUDIO_CONSTANTS.HARSHNESS_GAIN_4K : 0;

  nodes.midPeak2.type = 'peaking';
  nodes.midPeak2.frequency.value = AUDIO_CONSTANTS.HARSHNESS_FREQ_2;
  nodes.midPeak2.Q.value = AUDIO_CONSTANTS.HARSHNESS_Q_6K;
  nodes.midPeak2.gain.value = s.tameHarsh ? AUDIO_CONSTANTS.HARSHNESS_GAIN_6K : 0;

  if (s.glueCompression) {
    nodes.compressor.threshold.value = AUDIO_CONSTANTS.GLUE_THRESHOLD;
    nodes.compressor.knee.value = 10;
    nodes.compressor.ratio.value = AUDIO_CONSTANTS.GLUE_RATIO;
    nodes.compressor.attack.value = AUDIO_CONSTANTS.GLUE_ATTACK;
    nodes.compressor.release.value = AUDIO_CONSTANTS.GLUE_RELEASE;
  } else {
    nodes.compressor.threshold.value = AUDIO_CONSTANTS.GLUE_THRESHOLD;
    nodes.compressor.knee.value = 10;
    nodes.compressor.ratio.value = AUDIO_CONSTANTS.GLUE_RATIO;
    nodes.compressor.attack.value = AUDIO_CONSTANTS.GLUE_ATTACK;
    nodes.compressor.release.value = AUDIO_CONSTANTS.GLUE_RELEASE;
    // Will be overridden by updateAudioChain for preview
  }

  nodes.limiter.threshold.value = -1;
  nodes.limiter.knee.value = 0;
  nodes.limiter.ratio.value = AUDIO_CONSTANTS.LIMITER_RATIO;
  nodes.limiter.attack.value = AUDIO_CONSTANTS.LIMITER_ATTACK;
  nodes.limiter.release.value = AUDIO_CONSTANTS.LIMITER_RELEASE;

  // "Center Bass": high-pass the side (stereo difference) signal so low
  // frequencies collapse to mono. Freq of 1 Hz is effectively transparent.
  nodes.sideHighpass.type = 'highpass';
  nodes.sideHighpass.frequency.value = s.centerBass ? AUDIO_CONSTANTS.BASS_MONO_FREQ : 1;
  nodes.sideHighpass.Q.value = 0.7;
}

function createProcessingNodes(ctx) {
  const nodes = {};
  nodes.inputGain = ctx.createGain();
  nodes.gain = ctx.createGain();
  nodes.normGain = ctx.createGain();
  nodes.highpass = ctx.createBiquadFilter();
  nodes.lowshelf = ctx.createBiquadFilter();
  nodes.highshelf = ctx.createBiquadFilter();
  nodes.midPeak = ctx.createBiquadFilter();
  nodes.midPeak2 = ctx.createBiquadFilter();
  nodes.compressor = ctx.createDynamicsCompressor();
  nodes.limiter = ctx.createDynamicsCompressor();
  nodes.ceilingClip = ctx.createWaveShaper(); // brickwall clamp after the limiter
  nodes.ceilingClip.oversample = '4x';

  // Stereo width processing (mid-side)
  nodes.stereoSplitter = ctx.createChannelSplitter(2);
  nodes.stereoMerger = ctx.createChannelMerger(2);
  nodes.midGain = ctx.createGain();
  nodes.sideGain = ctx.createGain();
  nodes.leftToMid = ctx.createGain();
  nodes.rightToMid = ctx.createGain();
  nodes.leftToSide = ctx.createGain();
  nodes.rightToSide = ctx.createGain();
  nodes.midToLeft = ctx.createGain();
  nodes.midToRight = ctx.createGain();
  nodes.sideToLeft = ctx.createGain();
  nodes.sideToRight = ctx.createGain();
  nodes.sideHighpass = ctx.createBiquadFilter(); // "Center Bass": mono the low end

  // 5-band EQ
  nodes.eqLow = ctx.createBiquadFilter();
  nodes.eqLowMid = ctx.createBiquadFilter();
  nodes.eqMid = ctx.createBiquadFilter();
  nodes.eqHighMid = ctx.createBiquadFilter();
  nodes.eqHigh = ctx.createBiquadFilter();

  return nodes;
}

async function processAudioOffline(settings) {
  const inputBuffer = state.file.buffer;
  const targetSampleRate = settings.sampleRate;
  const numChannels = inputBuffer.numberOfChannels;

  const outputLength = Math.ceil(inputBuffer.length * targetSampleRate / inputBuffer.sampleRate);

  const offlineCtx = new OfflineAudioContext(numChannels, outputLength, targetSampleRate);

  const source = offlineCtx.createBufferSource();
  source.buffer = inputBuffer;

  // Use shared node factory
  const nodes = createProcessingNodes(offlineCtx);

  // Configure input gain
  const inputGainDb = settings.inputGain || 0;
  nodes.inputGain.gain.value = Math.pow(10, inputGainDb / 20);

  // Configure EQ
  configureEQNodes(nodes);
  nodes.eqLow.gain.value = settings.eqLow;
  nodes.eqLowMid.gain.value = settings.eqLowMid;
  nodes.eqMid.gain.value = settings.eqMid;
  nodes.eqHighMid.gain.value = settings.eqHighMid;
  nodes.eqHigh.gain.value = settings.eqHigh;

  // Configure filters using shared function
  configureFilterNodes(nodes, settings);

  // Glue compressor config
  if (settings.glueCompression) {
    nodes.compressor.threshold.value = AUDIO_CONSTANTS.GLUE_THRESHOLD;
    nodes.compressor.knee.value = 10;
    nodes.compressor.ratio.value = AUDIO_CONSTANTS.GLUE_RATIO;
    nodes.compressor.attack.value = AUDIO_CONSTANTS.GLUE_ATTACK;
    nodes.compressor.release.value = AUDIO_CONSTANTS.GLUE_RELEASE;
  } else {
    nodes.compressor.threshold.value = 0;
    nodes.compressor.ratio.value = 1;
  }

  // Pass 1 renders tonal shaping + dynamics + stereo width WITHOUT the limiter
  // and WITHOUT normalization gain. Normalization is measured and applied
  // afterwards, then the limiter runs as a final pass — so make-up gain can
  // never push peaks past the true-peak ceiling.
  nodes.normGain.gain.value = 1.0;

  // Configure stereo width via mid-side nodes
  const stereoWidth = settings.stereoWidth !== undefined ? settings.stereoWidth : 100;
  const sideLevel = stereoWidth / 100;

  // Connect the chain including mid-side processing (no limiter here)
  source
    .connect(nodes.inputGain)
    .connect(nodes.highpass)
    .connect(nodes.eqLow)
    .connect(nodes.eqLowMid)
    .connect(nodes.eqMid)
    .connect(nodes.eqHighMid)
    .connect(nodes.eqHigh)
    .connect(nodes.lowshelf)
    .connect(nodes.midPeak)
    .connect(nodes.midPeak2)
    .connect(nodes.highshelf)
    .connect(nodes.compressor);

  // Mid-side stereo width processing (same as preview chain)
  nodes.compressor.connect(nodes.stereoSplitter);

  nodes.stereoSplitter.connect(nodes.leftToMid, 0);
  nodes.stereoSplitter.connect(nodes.rightToMid, 1);
  nodes.leftToMid.gain.value = 0.5;
  nodes.rightToMid.gain.value = 0.5;
  nodes.leftToMid.connect(nodes.midGain);
  nodes.rightToMid.connect(nodes.midGain);

  nodes.stereoSplitter.connect(nodes.leftToSide, 0);
  nodes.stereoSplitter.connect(nodes.rightToSide, 1);
  nodes.leftToSide.gain.value = 0.5;
  nodes.rightToSide.gain.value = -0.5;
  nodes.leftToSide.connect(nodes.sideGain);
  nodes.rightToSide.connect(nodes.sideGain);

  nodes.midGain.gain.value = 1;
  nodes.sideGain.gain.value = sideLevel;

  nodes.midToLeft.gain.value = 1;
  nodes.midToRight.gain.value = 1;
  nodes.sideToLeft.gain.value = 1;
  nodes.sideToRight.gain.value = -1;

  nodes.midGain.connect(nodes.midToLeft);
  nodes.midGain.connect(nodes.midToRight);
  // Side passes through the "Center Bass" high-pass before distribution
  nodes.sideGain.connect(nodes.sideHighpass);
  nodes.sideHighpass.connect(nodes.sideToLeft);
  nodes.sideHighpass.connect(nodes.sideToRight);

  nodes.midToLeft.connect(nodes.stereoMerger, 0, 0);
  nodes.sideToLeft.connect(nodes.stereoMerger, 0, 0);
  nodes.midToRight.connect(nodes.stereoMerger, 0, 1);
  nodes.sideToRight.connect(nodes.stereoMerger, 0, 1);

  nodes.stereoMerger
    .connect(nodes.normGain)
    .connect(offlineCtx.destination);

  source.start(0);

  let renderedBuffer = await offlineCtx.startRendering();

  // Loudness normalization — measured on the fully processed (pre-limiter)
  // signal and applied before the limiter runs.
  if (settings.normalizeLoudness) {
    const lufsResult = measureLUFS(renderedBuffer);
    const targetLufs = settings.targetLufs || AUDIO_CONSTANTS.TARGET_LUFS;
    const normGain = calculateNormalizationGain(lufsResult.integratedLUFS, targetLufs);

    if (normGain !== 1.0 && isFinite(normGain)) {
      for (let ch = 0; ch < renderedBuffer.numberOfChannels; ch++) {
        const channelData = renderedBuffer.getChannelData(ch);
        for (let i = 0; i < channelData.length; i++) {
          channelData[i] *= normGain;
        }
      }
    }
  }

  // Final limiting stage — runs last so the ceiling holds after normalization:
  //   1. musical peak limiting (compressor-based) to control dynamics
  //   2. true-peak (4x oversampled) clip so inter-sample peaks stay under the
  //      ceiling — genuine dBTP compliance, not just sample-peak.
  if (settings.truePeakLimit) {
    renderedBuffer = await applyLimiterPass(renderedBuffer, settings.truePeakCeiling);
    renderedBuffer = await truePeakClip(renderedBuffer, settings.truePeakCeiling);
  }

  return renderedBuffer;
}

function makeClipCurve(ceilingLinear) {
  const n = 2048;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1; // map index to input range [-1, 1]
    curve[i] = Math.max(-ceilingLinear, Math.min(ceilingLinear, x));
  }
  return curve;
}

function applyCeilingClip(buffer, ceilingDb) {
  const ceilingLin = Math.pow(10, ceilingDb / 20);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      if (data[i] > ceilingLin) data[i] = ceilingLin;
      else if (data[i] < -ceilingLin) data[i] = -ceilingLin;
    }
  }
}

async function resampleBuffer(buffer, targetRate) {
  if (buffer.sampleRate === targetRate) return buffer;
  const frames = Math.max(1, Math.round(buffer.length * targetRate / buffer.sampleRate));
  const ctx = new OfflineAudioContext(buffer.numberOfChannels, frames, targetRate);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start(0);
  return ctx.startRendering();
}

function peakOf(buffer) {
  let peak = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
    }
  }
  return peak;
}

async function truePeakClip(buffer, ceilingDb) {
  const OS = 4;
  const baseRate = buffer.sampleRate;
  const ceilingLin = Math.pow(10, ceilingDb / 20);

  const up = await resampleBuffer(buffer, baseRate * OS);

  if (peakOf(up) <= ceilingLin) {
    return buffer; // already true-peak compliant — leave the audio alone
  }

  // Clip inter-sample overshoots in the oversampled domain, then come back.
  applyCeilingClip(up, ceilingDb);
  const out = await resampleBuffer(up, baseRate);

  // Guard against any tiny ripple introduced by the downsampling filter.
  applyCeilingClip(out, ceilingDb);
  return out;
}

async function applyLimiterPass(buffer, ceiling) {
  const ctx = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  const src = ctx.createBufferSource();
  src.buffer = buffer;

  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = ceiling;
  limiter.knee.value = 0;
  limiter.ratio.value = AUDIO_CONSTANTS.LIMITER_RATIO;
  limiter.attack.value = AUDIO_CONSTANTS.LIMITER_ATTACK;
  limiter.release.value = AUDIO_CONSTANTS.LIMITER_RELEASE;

  src.connect(limiter).connect(ctx.destination);
  src.start(0);
  return ctx.startRendering();
}
export async function upstreamMastering(buffer,settings){state.file.buffer=buffer;try{return await processAudioOffline(settings);}finally{state.file.buffer=null;}}
export {createProcessingNodes,configureEQNodes,configureFilterNodes,makeClipCurve,measureLUFS,calculateNormalizationGain};

let dom;
function updateAudioChain() {
  if (!state.audio.context) return;

  const nodes = state.audio.nodes;
  const bypassed = state.ui.isBypassed;

  if (nodes.inputGain && dom.inputGain) {
    const inputDb = bypassed ? 0 : parseFloat(dom.inputGain.value);
    nodes.inputGain.gain.value = Math.pow(10, inputDb / 20);
  }

  nodes.highpass.frequency.value = (dom.cleanLowEnd.checked && !bypassed)
    ? AUDIO_CONSTANTS.HIGHPASS_FREQ : 1;

  nodes.lowshelf.gain.value = (dom.cutMud.checked && !bypassed) ? -3 : 0;
  nodes.highshelf.gain.value = (dom.addAir.checked && !bypassed) ? 2.5 : 0;

  if (dom.tameHarsh.checked && !bypassed) {
    nodes.midPeak.gain.value = AUDIO_CONSTANTS.HARSHNESS_GAIN_4K;
    nodes.midPeak2.gain.value = AUDIO_CONSTANTS.HARSHNESS_GAIN_6K;
  } else {
    nodes.midPeak.gain.value = 0;
    nodes.midPeak2.gain.value = 0;
  }

  if (dom.glueCompression.checked && !bypassed) {
    nodes.compressor.threshold.value = AUDIO_CONSTANTS.GLUE_THRESHOLD;
    nodes.compressor.ratio.value = AUDIO_CONSTANTS.GLUE_RATIO;
  } else {
    nodes.compressor.threshold.value = 0;
    nodes.compressor.ratio.value = 1;
  }

  if (dom.truePeakLimit.checked && !bypassed) {
    const ceiling = parseFloat(dom.truePeakSlider.value);
    nodes.limiter.threshold.value = ceiling;
    nodes.limiter.ratio.value = AUDIO_CONSTANTS.LIMITER_RATIO;
    if (nodes.ceilingClip) {
      nodes.ceilingClip.curve = makeClipCurve(Math.pow(10, ceiling / 20));
    }
  } else {
    nodes.limiter.threshold.value = 0;
    nodes.limiter.ratio.value = 1;
    if (nodes.ceilingClip) nodes.ceilingClip.curve = null; // passthrough
  }

  if (nodes.midGain && nodes.sideGain && dom.stereoWidth) {
    const width = bypassed ? 100 : parseInt(dom.stereoWidth.value);
    const sideLevel = width / 100;
    nodes.sideGain.gain.value = sideLevel;
  }

  if (nodes.sideHighpass && dom.centerBass) {
    nodes.sideHighpass.type = 'highpass';
    nodes.sideHighpass.frequency.value = (dom.centerBass.checked && !bypassed)
      ? AUDIO_CONSTANTS.BASS_MONO_FREQ : 1;
    nodes.sideHighpass.Q.value = 0.7;
  }

  if (nodes.normGain) {
    if (dom.normalizeLoudness.checked && !bypassed && state.file.normGain !== 1.0) {
      nodes.normGain.gain.value = state.file.normGain;
    } else {
      nodes.normGain.gain.value = 1.0;
    }
  }
}

function connectAudioChain(source) {
  const nodes = state.audio.nodes;

  source
    .connect(nodes.inputGain)
    .connect(nodes.highpass)
    .connect(nodes.eqLow)
    .connect(nodes.eqLowMid)
    .connect(nodes.eqMid)
    .connect(nodes.eqHighMid)
    .connect(nodes.eqHigh)
    .connect(nodes.lowshelf)
    .connect(nodes.midPeak)
    .connect(nodes.midPeak2)
    .connect(nodes.highshelf)
    .connect(nodes.compressor);

  // Mid-side stereo width (runs before normalization + the final limiter)
  nodes.compressor.connect(nodes.stereoSplitter);

  nodes.stereoSplitter.connect(nodes.leftToMid, 0);
  nodes.stereoSplitter.connect(nodes.rightToMid, 1);
  nodes.leftToMid.gain.value = 0.5;
  nodes.rightToMid.gain.value = 0.5;
  nodes.leftToMid.connect(nodes.midGain);
  nodes.rightToMid.connect(nodes.midGain);

  nodes.stereoSplitter.connect(nodes.leftToSide, 0);
  nodes.stereoSplitter.connect(nodes.rightToSide, 1);
  nodes.leftToSide.gain.value = 0.5;
  nodes.rightToSide.gain.value = -0.5;
  nodes.leftToSide.connect(nodes.sideGain);
  nodes.rightToSide.connect(nodes.sideGain);

  nodes.midGain.gain.value = 1;
  nodes.sideGain.gain.value = 1;

  nodes.midToLeft.gain.value = 1;
  nodes.midToRight.gain.value = 1;
  nodes.sideToLeft.gain.value = 1;
  nodes.sideToRight.gain.value = -1;

  nodes.midGain.connect(nodes.midToLeft);
  nodes.midGain.connect(nodes.midToRight);
  // Side passes through the "Center Bass" high-pass before distribution
  nodes.sideGain.connect(nodes.sideHighpass);
  nodes.sideHighpass.connect(nodes.sideToLeft);
  nodes.sideHighpass.connect(nodes.sideToRight);

  nodes.midToLeft.connect(nodes.stereoMerger, 0, 0);
  nodes.sideToLeft.connect(nodes.stereoMerger, 0, 0);
  nodes.midToRight.connect(nodes.stereoMerger, 0, 1);
  nodes.sideToRight.connect(nodes.stereoMerger, 0, 1);

  // Normalize first, then limit + brickwall clip last so make-up gain can't
  // exceed the ceiling
  nodes.stereoMerger
    .connect(nodes.normGain)
    .connect(nodes.limiter)
    .connect(nodes.ceilingClip)
    .connect(state.audio.analyser)
    .connect(nodes.gain);

  nodes.gain.connect(state.audio.splitter);
  state.audio.splitter.connect(state.audio.analyserLeft, 0);
  state.audio.splitter.connect(state.audio.analyserRight, 1);

  nodes.gain.connect(state.audio.context.destination);
}
export async function upstreamPreview(buffer,settings,normGain){
 const context=new OfflineAudioContext(buffer.numberOfChannels,buffer.length,buffer.sampleRate),source=context.createBufferSource();source.buffer=buffer;
 const nodes=createProcessingNodes(context);configureEQNodes(nodes);configureFilterNodes(nodes,settings);
 ['eqLow','eqLowMid','eqMid','eqHighMid','eqHigh'].forEach(key=>nodes[key].gain.value=settings[key]);
 state.audio={context,nodes,analyser:context.createAnalyser(),splitter:context.createChannelSplitter(2),analyserLeft:context.createAnalyser(),analyserRight:context.createAnalyser()};state.file.normGain=normGain;state.ui={isBypassed:false};
 dom=Object.fromEntries(Object.entries(settings).map(([key,value])=>[key,{value,checked:value}]));dom.truePeakSlider={value:settings.truePeakCeiling};
 connectAudioChain(source);updateAudioChain();source.start();try{return await context.startRendering();}finally{source.disconnect();source.buffer=null;Object.values(nodes).forEach(n=>n.disconnect());state.audio=null;}
}
