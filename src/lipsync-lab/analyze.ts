import { motionFrames, comparisonCurves, type MotionEvent } from "./curves";

type HeadResult = { frames: Float32Array<ArrayBuffer>; visemes: Uint8Array<ArrayBuffer>; headElapsedMs: number; left?: Float32Array<ArrayBuffer>; right?: Float32Array<ArrayBuffer> };
type MotionResult = { events: MotionEvent[]; elapsedMs: number; engine: string; version: number; required: number };
export type LabResult = Awaited<ReturnType<typeof analyzeClip>>;

function workerRequest<T>(worker: Worker, message: unknown, signal: AbortSignal, progress: (phase: string, value: number) => void, transfers: Transferable[] = []) {
  return new Promise<T>((resolve, reject) => {
    const abort = () => { worker.terminate(); reject(new DOMException("已取消", "AbortError")); };
    const finish = (callback: () => void) => { signal.removeEventListener("abort", abort); worker.terminate(); callback(); };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) { abort(); return; }
    worker.onerror = () => finish(() => reject(new Error("分析运行库无法启动，请查看控制台。")));
    worker.onmessage = ({ data }) => {
      if (data.type === "progress") progress(data.phase, data.progress);
      else if (data.type === "error") finish(() => reject(new Error(data.message)));
      else if (data.type === "result") finish(() => resolve(data));
      else if (data.type === "ready") worker.postMessage(message, transfers);
    };
    if ((message as { captureVocals?: boolean }).captureVocals) worker.postMessage({ type: "init" });
    else worker.postMessage(message, transfers);
  });
}

export async function makeClip(buffer: AudioBuffer, start: number, seconds: number, signal: AbortSignal) {
  if (!Number.isFinite(start) || !Number.isFinite(seconds) || start < 0 || start >= buffer.duration || seconds <= 0 || seconds > 60) throw new Error("请选择有效片段：开始时间在歌曲内，长度为 1–60 秒。");
  const duration = Math.min(seconds, buffer.duration - start);
  const offline = new OfflineAudioContext(2, Math.ceil(duration * 44100), 44100);
  const source = offline.createBufferSource(); source.buffer = buffer;
  source.connect(offline.destination); source.start(0, start, duration);
  const clip = await offline.startRendering();
  signal.throwIfAborted();
  return clip;
}

export async function analyzeClip(clip: AudioBuffer, separate: boolean, smoothing: number, scales: readonly number[], signal: AbortSignal, progress: (phase: string, value: number) => void) {
  const started = performance.now();
  let left = clip.getChannelData(0).slice(), right = clip.getChannelData(1).slice();
  const worker = separate
    ? new Worker(new URL("../audio/vocals/separation.worker.ts", import.meta.url), { type: "module" })
    : new Worker(new URL("./head.worker.ts", import.meta.url), { type: "module" });
  progress(separate ? "分离共同人声" : "分析 HeadAudio", 0);
  const head = await workerRequest<HeadResult>(worker, { type: "separate", left, right, captureVocals: separate }, signal, progress,
    separate ? [] : [left.buffer, right.buffer]);
  if (separate) { left = head.left!; right = head.right!; }
  else { left = clip.getChannelData(0).slice(); right = clip.getChannelData(1).slice(); }
  signal.throwIfAborted();
  const vocals = new AudioBuffer({ numberOfChannels: 2, length: left.length, sampleRate: 44100 });
  vocals.copyToChannel(left, 0); vocals.copyToChannel(right, 1);
  const mono = Float32Array.from(left, (v, i) => (v + right[i]) / 2);
  progress("分析 MotionSync", .95);
  const motion = await workerRequest<MotionResult>(new Worker(new URL("lipsync-lab/motionsync.worker.js", new URL(import.meta.env.BASE_URL, location.href))),
    { mono, sampleRate: 44100, smoothing, scales }, signal, progress, [mono.buffer]);
  const weights = motionFrames(motion.events, head.frames.length);
  const curves = comparisonCurves(head.frames, head.visemes, weights);
  return { curves, weights, labels: head.visemes, rms: head.frames, vocals,
    timings: { totalMs: performance.now() - started, headMs: head.headElapsedMs, motionMs: motion.elapsedMs },
    motion: { engine: motion.engine, version: motion.version, required: motion.required, smoothing, scales: [...scales] }, separate };
}
