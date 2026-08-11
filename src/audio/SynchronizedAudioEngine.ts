export type AudioSourceIndex = 0 | 1;

type AudioGraph = {
  context: AudioContext;
  analysers: [AnalyserNode, AnalyserNode];
  gains: [GainNode, GainNode];
  master: GainNode;
};

export class SynchronizedAudioEngine {
  private readonly contextFactory: () => AudioContext;
  private graph: AudioGraph | null = null;
  private buffers: [AudioBuffer | null, AudioBuffer | null] = [null, null];
  private sources: [AudioBufferSourceNode | null, AudioBufferSourceNode | null] = [null, null];
  private playbackOffset = 0;
  private playbackStartedAt = 0;
  private playing = false;

  constructor(contextFactory: () => AudioContext = () => new AudioContext()) {
    this.contextFactory = contextFactory;
  }

  async ensureGraph(resume = true, volume = 0.9) {
    if (!this.graph) {
      const context = this.contextFactory();
      const analysers = [context.createAnalyser(), context.createAnalyser()] as [AnalyserNode, AnalyserNode];
      const gains = [context.createGain(), context.createGain()] as [GainNode, GainNode];
      const master = context.createGain();
      for (const analyser of analysers) {
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.68;
      }
      analysers[0].connect(gains[0]);
      analysers[1].connect(gains[1]);
      gains[0].connect(master);
      gains[1].connect(master);
      master.connect(context.destination);
      gains[0].gain.value = 1;
      gains[1].gain.value = 0;
      master.gain.value = volume;
      this.graph = { context, analysers, gains, master };
    }
    if (resume && this.graph.context.state === "suspended") await this.graph.context.resume();
    return this.graph.context;
  }

  get isPlaying() {
    return this.playing;
  }

  get currentOffset() {
    return this.playbackOffset;
  }

  getBuffer(index: AudioSourceIndex) {
    return this.buffers[index];
  }

  setBuffer(index: AudioSourceIndex, buffer: AudioBuffer | null) {
    this.buffers[index] = buffer;
    if (!buffer) this.stopSource(index);
  }

  getAnalyser(index: AudioSourceIndex) {
    return this.graph?.analysers[index] ?? null;
  }

  getContext() {
    return this.graph?.context ?? null;
  }

  getMaxDuration() {
    return Math.max(this.buffers[0]?.duration ?? 0, this.buffers[1]?.duration ?? 0);
  }

  getTimelineTime() {
    const context = this.graph?.context;
    if (this.playing && context) {
      return this.playbackOffset + Math.max(0, context.currentTime - this.playbackStartedAt);
    }
    return this.playbackOffset;
  }

  setOffset(offset: number) {
    this.playbackOffset = offset;
  }

  startSource(index: AudioSourceIndex, when: number, offset: number) {
    const graph = this.graph;
    const buffer = this.buffers[index];
    if (!graph || !buffer || offset >= buffer.duration - 0.005) return false;
    this.stopSource(index);
    const source = graph.context.createBufferSource();
    source.buffer = buffer;
    source.connect(graph.analysers[index]);
    source.start(when, Math.max(0, offset));
    this.sources[index] = source;
    return true;
  }

  async play(offset: number, leadSeconds: number, volume: number) {
    const context = await this.ensureGraph(true, volume);
    this.stopAllSources();
    const when = context.currentTime + leadSeconds;
    const started = ([0, 1] as const).map((index) => this.startSource(index, when, offset));
    if (!started.some(Boolean)) return false;
    this.playbackOffset = offset;
    this.playbackStartedAt = when;
    this.playing = true;
    return true;
  }

  pause() {
    const pausedAt = this.getTimelineTime();
    this.playing = false;
    this.playbackOffset = pausedAt;
    this.stopAllSources();
    return pausedAt;
  }

  stop() {
    const stoppedAt = this.getTimelineTime();
    this.playing = false;
    this.playbackOffset = stoppedAt;
    this.stopAllSources();
    return stoppedAt;
  }

  stopSource(index: AudioSourceIndex) {
    const source = this.sources[index];
    if (!source) return;
    source.onended = null;
    try { source.stop(); } catch { /* The shorter source may already have ended. */ }
    source.disconnect();
    this.sources[index] = null;
  }

  stopAllSources() {
    this.stopSource(0);
    this.stopSource(1);
  }

  markEnded(offset = this.getMaxDuration()) {
    this.playing = false;
    this.playbackOffset = offset;
    this.stopAllSources();
  }

  selectSource(source: AudioSourceIndex, fadeSeconds: number) {
    if (!this.graph) return false;
    const now = this.graph.context.currentTime;
    for (const [index, gain] of this.graph.gains.entries()) {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(index === source ? 1 : 0, now + fadeSeconds);
    }
    return true;
  }

  selectSourceImmediately(source: AudioSourceIndex) {
    if (!this.graph) return;
    this.graph.gains[0].gain.value = source === 0 ? 1 : 0;
    this.graph.gains[1].gain.value = source === 1 ? 1 : 0;
  }

  setVolume(volume: number) {
    if (!this.graph) return;
    this.graph.master.gain.setTargetAtTime(volume, this.graph.context.currentTime, 0.015);
  }

  async close() {
    this.playing = false;
    this.stopAllSources();
    const context = this.graph?.context;
    this.graph = null;
    if (context && context.state !== "closed") await context.close();
  }
}
