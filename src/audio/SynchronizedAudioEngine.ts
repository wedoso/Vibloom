import { createMasteringChain } from "./mastering/chain";
import type { MasteringSettings } from "./mastering/settings";
export type AudioSourceIndex = number;
export const MAX_AUDIO_SOURCES = 9;
export const DECODED_BUFFER_BUDGET = 256 * 1024 * 1024;

type AudioGraph = { context: AudioContext; analysers: AnalyserNode[]; gains: GainNode[]; master: GainNode };
const valid = (index: number) => { if (!Number.isInteger(index) || index < 0 || index >= MAX_AUDIO_SOURCES) throw new Error("Track number must be between 1 and 9."); };
export class SynchronizedAudioEngine {
  private graph: AudioGraph | null = null;
  private preview: { source: number; returnSource: number; bypass: boolean; wet: GainNode; dry: GainNode; chain: ReturnType<typeof createMasteringChain> } | null = null;
  private previewAppliedAt = 0;
  private retiredPreviewGraphs = new Map<ReturnType<typeof createMasteringChain>, ReturnType<typeof setTimeout>>();
  private buffers: (AudioBuffer | null)[] = Array(MAX_AUDIO_SOURCES).fill(null);
  private sources: (AudioBufferSourceNode | null)[] = Array(MAX_AUDIO_SOURCES).fill(null);
  private sourceEnds: number[] = Array(MAX_AUDIO_SOURCES).fill(0);
  private durations: number[] = Array(MAX_AUDIO_SOURCES).fill(0);
  private touched: number[] = Array(MAX_AUDIO_SOURCES).fill(0);
  private stamp = 0;
  private active = 0;
  private playbackOffset = 0;
  private playbackStartedAt = 0;
  private playing = false;
  private playRequest = 0;
  constructor(private readonly contextFactory: () => AudioContext = () => new AudioContext()) {}
  async ensureGraph(resume = true, volume = .9) {
    if (!this.graph) {
      const context = this.contextFactory(), master = context.createGain();
      const analysers = Array.from({ length: MAX_AUDIO_SOURCES }, () => context.createAnalyser());
      const gains = Array.from({ length: MAX_AUDIO_SOURCES }, () => context.createGain());
      for (let i = 0; i < MAX_AUDIO_SOURCES; i++) {
        analysers[i].fftSize = 1024; analysers[i].smoothingTimeConstant = .68;
        analysers[i].connect(gains[i]); gains[i].connect(master); gains[i].gain.value = i === this.active ? 1 : 0;
      }
      master.connect(context.destination); master.gain.value = volume;
      this.graph = { context, analysers, gains, master };
    }
    if (resume && this.graph.context.state === "suspended") await this.graph.context.resume();
    return this.graph.context;
  }
  get isPlaying() { return this.playing; }
  get currentOffset() { return this.playbackOffset; }
  get selectedSource() { return this.preview?.returnSource ?? this.active; }
  get audibleSource() { return this.active; }
  get previewSource() { return this.preview?.source ?? null; }
  get previewIsApplied() {
    const context = this.graph?.context;
    if (!this.preview || !context) return false;
    // Suspended/paused previews are configured for the next play. During
    // playback, wait until the scheduled transition reaches the output device.
    if (!this.playing || context.state !== "running") return true;
    const timestamp = context.getOutputTimestamp?.();
    const audibleTime = timestamp?.contextTime && timestamp.performanceTime
      ? timestamp.contextTime + Math.max(0, performance.now() - timestamp.performanceTime) / 1000
      : context.currentTime - (context.baseLatency || 0) - (context.outputLatency || 0);
    return audibleTime >= this.previewAppliedAt;
  }
  getBuffer(index: AudioSourceIndex) { valid(index); this.touched[index] = ++this.stamp; return this.buffers[index]; }
  setBuffer(index: AudioSourceIndex, buffer: AudioBuffer | null) {
    valid(index); if (this.preview && (this.preview.source === index || this.preview.returnSource === index)) this.endPreview(); this.stopSource(index); this.buffers[index] = buffer; this.durations[index] = buffer?.duration ?? 0; this.touched[index] = ++this.stamp;
  }
  setDuration(index: AudioSourceIndex, duration: number) { valid(index); this.durations[index] = Math.max(0, duration); }
  getAnalyser(index: AudioSourceIndex) { valid(index); return this.graph?.analysers[index] ?? null; }
  getContext() { return this.graph?.context ?? null; }
  getMaxDuration() { return Math.max(...this.durations); }
  getTimelineTime() { return this.playing && this.graph ? this.playbackOffset + Math.max(0, this.graph.context.currentTime - this.playbackStartedAt) : this.playbackOffset; }
  setOffset(offset: number) { this.playbackOffset = offset; }
  startSource(index: AudioSourceIndex, when: number, offset: number) {
    valid(index); const graph = this.graph, buffer = this.buffers[index];
    if (!graph || !buffer || offset >= buffer.duration - .005) return false;
    this.stopSource(index);
    const source = graph.context.createBufferSource(); source.buffer = buffer;
    if (this.preview?.source === index) { source.connect(this.preview.chain.input); source.connect(this.preview.dry); }
    else source.connect(graph.analysers[index]);
    source.onended = () => {
      source.disconnect(); source.buffer = null;
      if (this.sources[index] === source) { this.sources[index] = null; this.sourceEnds[index] = 0; }
      this.trimDecodedBuffers();
    };
    source.start(when, Math.max(0, offset)); this.sources[index] = source;
    this.sourceEnds[index] = when + buffer.duration - Math.max(0, offset); return true;
  }
  async play(offset: number, leadSeconds: number, volume: number) {
    const request = ++this.playRequest, context = await this.ensureGraph(true, volume);
    if (request !== this.playRequest) return false;
    this.stopAllSources();
    if (offset >= this.getMaxDuration() || !this.buffers[this.active]) return false;
    const when = context.currentTime + leadSeconds;
    this.startSource(this.active, when, offset);
    this.playbackOffset = offset; this.playbackStartedAt = when; this.playing = true; return true;
  }
  pause() { this.playRequest++; const time = this.getTimelineTime(); this.playing = false; this.playbackOffset = time; this.stopAllSources(); return time; }
  stop() { return this.pause(); }
  stopSource(index: AudioSourceIndex) {
    valid(index); const source = this.sources[index]; if (!source) return;
    source.onended = null; try { source.stop(); } catch { /* It may already have ended. */ }
    source.disconnect(); source.buffer = null; this.sources[index] = null; this.sourceEnds[index] = 0;
  }
  stopAllSources() { for (let i = 0; i < MAX_AUDIO_SOURCES; i++) this.stopSource(i); }
  markEnded(offset = this.getMaxDuration()) { this.playRequest++; this.playing = false; this.playbackOffset = offset; this.stopAllSources(); }
  selectSource(source: AudioSourceIndex, fadeSeconds: number) {
    this.endPreview(false);
    valid(source); const graph = this.graph;
    if (!graph || !this.buffers[source]) return false;
    if (source === this.active) return true;
    const now = graph.context.currentTime, when = now + (this.playing ? .025 : 0);
    if (this.playing) {
      // A rapid return may still have a correctly aligned source fading out.
      // Reuse it and replace its scheduled stop instead of disconnecting it.
      const live = this.sources[source];
      if (live && this.sourceEnds[source] > now) {
        const end = now + Math.max(0, this.buffers[source]!.duration - this.getTimelineTime());
        live.stop(end); this.sourceEnds[source] = end;
      } else this.startSource(source, when, this.getTimelineTime() + .025);
    }
    for (let i = 0; i < graph.gains.length; i++) {
      const gain = graph.gains[i].gain, value = gain.value;
      if (typeof gain.cancelAndHoldAtTime === "function") gain.cancelAndHoldAtTime(now);
      else { gain.cancelScheduledValues(now); gain.setValueAtTime(value, now); }
      gain.setValueAtTime(value, when); gain.linearRampToValueAtTime(i === source ? 1 : 0, when + fadeSeconds);
    }
    // Retarget every unfinished fade: an older source may still contribute
    // when another key interrupts the transition, not only the last selection.
    if (this.playing) for (let i = 0; i < MAX_AUDIO_SOURCES; i++) {
      if (i === source || !this.sources[i] || this.sourceEnds[i] <= now) continue;
      try { this.sources[i]!.stop(when + fadeSeconds); this.sourceEnds[i] = when + fadeSeconds; } catch { /* Ended during the switch. */ }
    }
    this.active = source; return true;
  }
  selectSourceImmediately(source: AudioSourceIndex) {
    this.endPreview(false);
    valid(source); this.active = source;
    if (!this.graph) return;
    for (let i = 0; i < MAX_AUDIO_SOURCES; i++) {
      this.graph.gains[i].gain.cancelScheduledValues(this.graph.context.currentTime);
      this.graph.gains[i].gain.value = i === source ? 1 : 0;
      if (i !== source) this.stopSource(i);
    }
  }
  beginPreview(source: number, settings: MasteringSettings, normalization = 1) {
    this.endPreview();
    const graph = this.graph; if (!graph || !this.buffers[source]) return false;
    const returnSource = this.active;
    if (!this.selectSource(source, .018)) return false;
    const chain = createMasteringChain(graph.context, settings, true, normalization);
    const wet = graph.context.createGain(), dry = graph.context.createGain();
    wet.gain.value = 0; dry.gain.value = 1;
    chain.output.connect(wet); wet.connect(graph.analysers[source]); dry.connect(graph.analysers[source]);
    this.preview = { source, returnSource, bypass: false, chain, wet, dry };
    this.routePreview(); this.fadePreview(false, .025); return true;
  }
  updatePreview(settings: MasteringSettings, normalization = 1) {
    const preview = this.preview, graph = this.graph; if (!preview || !graph) return;
    if (preview.chain.mode !== settings.mode) {
      const replacement = createMasteringChain(graph.context, settings, true, normalization);
      replacement.output.gain.value = 0; replacement.output.connect(preview.wet);
      const previous = preview.chain, source = this.sources[preview.source], now = graph.context.currentTime;
      if (source) source.connect(replacement.input);
      preview.chain = replacement;
      replacement.output.gain.setValueAtTime(0, now); replacement.output.gain.linearRampToValueAtTime(1, now + .043);
      previous.output.gain.setValueAtTime(previous.output.gain.value, now + .025); previous.output.gain.linearRampToValueAtTime(0, now + .043);
      const timer = setTimeout(() => {
        try { source?.disconnect(previous.input); } catch { /* Source ended or was rerouted. */ }
        previous.dispose(); this.retiredPreviewGraphs.delete(previous);
      }, 60);
      this.retiredPreviewGraphs.set(previous, timer);
      this.previewAppliedAt = now + .043;
    } else {
      preview.chain.update(settings, normalization);
      this.previewAppliedAt = graph.context.currentTime + 128 / graph.context.sampleRate;
    }
  }
  bypassPreview(bypass: boolean) { if (this.preview) { this.preview.bypass = bypass; this.fadePreview(bypass); } }
  private fadePreview(bypass: boolean, warmup = 0) {
    const preview = this.preview, graph = this.graph; if (!preview || !graph) return;
    const now = graph.context.currentTime;
    this.previewAppliedAt = now + warmup + .018;
    for (const [node, target] of [[preview.wet, bypass ? 0 : 1], [preview.dry, bypass ? 1 : 0]] as const) {
      const parameter = node.gain;
      if (typeof parameter.cancelAndHoldAtTime === "function") parameter.cancelAndHoldAtTime(now);
      else { parameter.cancelScheduledValues(now); parameter.setValueAtTime(parameter.value, now); }
      parameter.setValueAtTime(parameter.value, now + warmup); parameter.linearRampToValueAtTime(target, now + warmup + .018);
    }
  }
  private routePreview() {
    const preview = this.preview, graph = this.graph; if (!preview || !graph) return;
    const source = this.sources[preview.source];
    if (source) { source.disconnect(); source.connect(preview.chain.input); source.connect(preview.dry); }
  }
  endPreview(restore = true) {
    const preview = this.preview, graph = this.graph; if (!preview) return;
    this.preview = null; this.previewAppliedAt = 0;
    const source = this.sources[preview.source];
    if (source && graph) { source.disconnect(); source.connect(graph.analysers[preview.source]); }
    preview.chain.dispose(); preview.wet.disconnect(); preview.dry.disconnect();
    for (const [chain, timer] of this.retiredPreviewGraphs) { clearTimeout(timer); chain.dispose(); } this.retiredPreviewGraphs.clear();
    if (restore && graph && this.buffers[preview.returnSource]) this.selectSource(preview.returnSource, .018);
  }
  /** PCM residency is bounded independently of the nine metadata/file slots.
   * Original + audible version stay warm. In-flight rendering owns its input. */
  trimDecodedBuffers(extraKeep: number[] = [], budget = DECODED_BUFFER_BUDGET) {
    const bytes = (buffer: AudioBuffer | null) => buffer ? buffer.length * buffer.numberOfChannels * 4 : 0;
    let total = this.buffers.reduce((sum, buffer) => sum + bytes(buffer), 0);
    // Fading sources own their PCM until onended. Trimming them early would
    // turn a short crossfade into a gap; onended retries the budget immediately.
    const live = this.sources.flatMap((source, index) => source ? [index] : []);
    const keep = new Set([0, this.active, ...(this.preview ? [this.preview.returnSource] : []), ...extraKeep, ...live]);
    const candidates = this.buffers.map((_, index) => index).filter(index => !keep.has(index)).sort((a, b) => this.touched[a] - this.touched[b]);
    for (const index of candidates) {
      if (total <= budget) break;
      total -= bytes(this.buffers[index]); this.stopSource(index); this.buffers[index] = null;
    }
    return total;
  }
  setVolume(volume: number) { this.graph?.master.gain.setTargetAtTime(volume, this.graph.context.currentTime, .015); }
  clearBuffers() { this.endPreview(false); this.stopAllSources(); this.buffers.fill(null); this.durations.fill(0); }
  async close() {
    this.playRequest++; this.playing = false; this.clearBuffers();
    const graph = this.graph; this.graph = null;
    if (graph) { for (const node of [...graph.analysers, ...graph.gains, graph.master]) node.disconnect(); if (graph.context.state !== "closed") await graph.context.close(); }
  }
}
