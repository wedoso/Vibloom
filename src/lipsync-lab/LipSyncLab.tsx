import { useEffect, useRef, useState } from "react";
import { SILENT_VOCAL_POSE } from "../audio/vocals/envelope";
import { sampleVocalCurves } from "../audio/vocals/articulation";
import type { CompanionId } from "../live2d/models";
import { analyzeClip, makeClip, type LabResult } from "./analyze";
import { HEAD_LABELS, VOWELS, strongest, wavBytes } from "./curves";
import "./lab.css";

type Mark = { clipTime: number; songTime: number; verdict: string; note: string; headRaw: string; headShape: string; motionShape: string };
type Run = { result: LabResult; clip: AudioBuffer; start: number; name: string };
const clock = (time: number) => `${Math.floor(time / 60)}:${(time % 60).toFixed(2).padStart(5, "0")}`;

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function WeightBars({ values }: { values: readonly number[] }) {
  return <div className="lab-weights">{VOWELS.map((vowel, i) => <div key={vowel}>
    <span>{vowel}</span><meter min="0" max="1" value={values[i] ?? 0} aria-label={`${vowel} 嘴形权重`} /><small>{(values[i] ?? 0).toFixed(2)}</small>
  </div>)}</div>;
}

function Timeline({ result, time, onSeek }: { result: LabResult; time: number; onSeek: (time: number) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current, ctx = element?.getContext("2d");
    if (!element || !ctx) return;
    const width = element.width, rowHeight = 34;
    ctx.clearRect(0, 0, width, element.height);
    const palette = ["#dc9560", "#d7bf6f", "#67a69b", "#738cc4", "#ae85b2", "#e6e1d8"];
    const count = result.labels.length;
    [result.curves.head, result.curves.motion].forEach((curves, row) => {
      for (let x = 0; x < width; x++) {
        const frame = Math.min(count - 1, Math.floor(x / width * count));
        const weights = curves.vowels!.map(v => v[frame]);
        const shape = strongest(weights);
        const i = VOWELS.findIndex(v => v === shape);
        ctx.fillStyle = palette[curves.open[frame] === 0 || i < 0 ? 5 : i];
        ctx.fillRect(x, row * rowHeight, 1, rowHeight - 4);
      }
    });
    ctx.strokeStyle = "#1f2928"; ctx.lineWidth = 2;
    const x = Math.min(width - 1, time / result.vocals.duration * width);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 68); ctx.stroke();
  }, [result, time]);
  return <div className="lab-timeline">
    <div><span>HeadAudio</span><span>MotionSync</span></div>
    <canvas ref={canvas} width="1100" height="68" aria-label="两种方案的嘴形时间线，点击跳转" onClick={event => {
      const rect = event.currentTarget.getBoundingClientRect();
      onSeek(Math.max(0, Math.min(result.vocals.duration, (event.clientX - rect.left) / rect.width * result.vocals.duration)));
    }} />
    <p>{VOWELS.map((v, i) => <span key={v} className={`lab-key lab-key-${i}`}>{v}</span>)}<span>浅灰：无有效元音或静音</span></p>
  </div>;
}

export default function LipSyncLab() {
  const [file, setFile] = useState<{ name: string; buffer: AudioBuffer } | null>(null);
  const [start, setStart] = useState(0), [seconds, setSeconds] = useState(30);
  const [separate, setSeparate] = useState(true), [smoothing, setSmoothing] = useState(60);
  const [scalePreset, setScalePreset] = useState("neutral");
  const [companion, setCompanion] = useState<CompanionId>("hong-xi");
  const [run, setRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [progress, setProgress] = useState({ phase: "选择一段中文歌开始", value: 0 });
  const [playing, setPlaying] = useState(false), [time, setTime] = useState(0);
  const [listen, setListen] = useState("original");
  const [marks, setMarks] = useState<Mark[]>([]), [note, setNote] = useState("");
  const audio = useRef<HTMLAudioElement>(null);
  const controller = useRef<AbortController | null>(null);
  const loadGeneration = useRef(0);
  const modelFrames = useRef<Array<HTMLIFrameElement | null>>([]);

  useEffect(() => () => { controller.current?.abort(); loadGeneration.current++; }, []);
  useEffect(() => {
    const element = audio.current;
    if (!element || !run) return;
    const previous = element.currentTime;
    element.pause();
    const url = URL.createObjectURL(new Blob([wavBytes(listen === "vocals" ? run.result.vocals : run.clip)], { type: "audio/wav" }));
    const loaded = () => { element.currentTime = Math.min(previous, run.clip.duration); };
    element.addEventListener("loadedmetadata", loaded, { once: true });
    element.src = url; element.load();
    return () => { element.removeEventListener("loadedmetadata", loaded); element.pause(); element.removeAttribute("src"); element.load(); URL.revokeObjectURL(url); };
  }, [run, listen]);
  useEffect(() => {
    let frame = 0, previousUI = 0;
    const tick = (now: number) => {
      const element = audio.current;
      const isPlaying = Boolean(element && !element.paused && !element.ended);
      const position = element?.currentTime ?? 0;
      const poses = [run && isPlaying ? sampleVocalCurves(run.result.curves.head, position, 1) : SILENT_VOCAL_POSE,
        run && isPlaying ? sampleVocalCurves(run.result.curves.motion, position, 1) : SILENT_VOCAL_POSE];
      modelFrames.current.forEach((modelFrame, i) => modelFrame?.contentWindow?.postMessage({
        kind: "vibloom-lipsync-frame", companion, isPlaying, time: position, pose: poses[i],
      }, location.origin));
      if (now - previousUI >= 80) { setTime(position); setPlaying(isPlaying); previousUI = now; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [run, companion]);

  const loadFile = async (selected: File) => {
    const generation = ++loadGeneration.current;
    controller.current?.abort(); audio.current?.pause();
    setRun(null); setFile(null); setMarks([]); setError(""); setBusy(true);
    setProgress({ phase: "读取本地音频", value: 0 });
    let context: AudioContext | null = null;
    try {
      if (selected.size > 200 * 1024 * 1024) throw new Error("测试版请使用小于 200 MB 的音频。");
      context = new AudioContext();
      const buffer = await context.decodeAudioData(await selected.arrayBuffer());
      if (generation !== loadGeneration.current) return;
      setFile({ name: selected.name, buffer }); setStart(0); setSeconds(Math.min(30, Math.floor(buffer.duration * 100) / 100)); setTime(0);
      setProgress({ phase: `已读取 ${selected.name} · ${clock(buffer.duration)}`, value: 0 });
    } catch (e) { if (generation === loadGeneration.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { await context?.close(); if (generation === loadGeneration.current) setBusy(false); }
  };
  const analyze = async () => {
    if (!file) return;
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    audio.current?.pause(); setRun(null); setTime(0); setMarks([]); setBusy(true); setError("");
    try {
      const clip = await makeClip(file.buffer, start, seconds, abort.signal);
      const scales = scalePreset === "official" ? [.3, 6, 1, 8, 1.5, 1] : [1, 1, 1, 1, 1, 1];
      const result = await analyzeClip(clip, separate, smoothing, scales, abort.signal,
        (phase, value) => { if (!abort.signal.aborted) setProgress({ phase, value }); });
      abort.signal.throwIfAborted();
      setRun({ result, clip, start, name: file.name }); setListen("original");
      setProgress({ phase: "两种方案已就绪，可以播放对比", value: 1 });
    } catch (e) {
      if (abort.signal.aborted) setProgress({ phase: "分析已取消", value: 0 });
      else setError(e instanceof Error ? e.message : String(e));
    } finally { if (controller.current === abort) setBusy(false); }
  };
  const seek = (position: number) => { if (audio.current && run) { audio.current.currentTime = Math.max(0, Math.min(run.clip.duration, position)); setTime(audio.current.currentTime); } };
  const toggle = async () => {
    const element = audio.current;
    if (!element || !run) return;
    try {
      if (element.paused) { if (element.ended) element.currentTime = 0; await element.play(); }
      else element.pause();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const headSample = run ? sampleVocalCurves(run.result.curves.head, time, 1) : SILENT_VOCAL_POSE;
  const motionSample = run ? sampleVocalCurves(run.result.curves.motion, time, 1) : SILENT_VOCAL_POSE;
  const index = run ? Math.min(run.result.labels.length - 1, Math.floor(time * 50)) : 0;
  const mark = (verdict: string) => {
    if (!run) return;
    const clipTime = audio.current?.currentTime ?? time;
    const frame = Math.min(run.result.labels.length - 1, Math.floor(clipTime * 50));
    setMarks(list => [...list, { clipTime, songTime: run.start + clipTime, verdict, note,
      headRaw: HEAD_LABELS[run.result.labels[frame]],
      headShape: strongest(sampleVocalCurves(run.result.curves.head, clipTime, 1).vowels ?? []),
      motionShape: strongest(sampleVocalCurves(run.result.curves.motion, clipTime, 1).vowels ?? []) }]);
    setNote("");
  };
  const exportReport = () => {
    if (!run) return;
    download("vibloom-lipsync-comparison.json", new Blob([JSON.stringify({
      format: "vibloom-lipsync-comparison-v1", createdAt: new Date().toISOString(), name: run.name,
      clipStart: run.start, clipDuration: run.clip.duration, sampleRate: 44100, fps: 50,
      input: run.result.separate ? "htdemucs-vocals" : "provided-vocals", mapping: "shared-MusicLipSync", jaw: "shared-energy",
      headAudio: "0.1.0/model-en-mixed", motionSync: run.result.motion, timings: run.result.timings,
      marks, rms: Array.from(run.result.rms), headRawLabels: Array.from(run.result.labels),
      motionWeights: run.result.weights.map(w => Array.from(w)),
      renderedVowels: { head: run.result.curves.head.vowels!.map(w => Array.from(w)), motion: run.result.curves.motion.vowels!.map(w => Array.from(w)) },
    }, null, 2)], { type: "application/json" }));
  };

  return <main className="lab">
    <header><div><p className="lab-eyebrow">VIBLOOM · LOCAL LIP SYNC LAB</p><h1>中文口型对比</h1><p>同一份人声、同一个播放时钟、同一套嘴部映射。左侧 HeadAudio，右侧 MotionSync。</p></div><a href="./">返回播放器</a></header>
    <section className="lab-controls" aria-label="测试片段设置">
      <label className="lab-file">选择歌曲或人声<input type="file" accept="audio/*,.wav,.mp3,.flac,.m4a,.ogg" disabled={busy} onChange={event => { const selected = event.target.files?.[0]; if (selected) void loadFile(selected); event.target.value = ""; }} /><small>{file?.name ?? "音频只在本机处理"}</small></label>
      <label>开始时间（秒）<input aria-label="开始时间" type="number" min="0" max={file?.buffer.duration ?? 0} step=".1" value={start} disabled={busy} onChange={event => setStart(Number(event.target.value))} /></label>
      <label>片段长度（秒）<input aria-label="片段长度" type="number" min="1" max="60" step=".1" value={seconds} disabled={busy} onChange={event => setSeconds(Number(event.target.value))} /></label>
      <label>输入类型<select value={String(separate)} disabled={busy} onChange={event => setSeparate(event.target.value === "true")}><option value="true">歌曲：先分离人声</option><option value="false">已分离人声：直接分析</option></select></label>
      <label>MotionSync 元音倍率<select value={scalePreset} disabled={busy} onChange={event => setScalePreset(event.target.value)}><option value="neutral">统一倍率 1（默认）</option><option value="official">官方 Kei 示例倍率</option></select></label>
      <label>MotionSync 平滑（1–100）<input type="number" aria-label="MotionSync 平滑" min="1" max="100" value={smoothing} disabled={busy} onChange={event => setSmoothing(Math.max(1, Math.min(100, Math.round(Number(event.target.value)) || 1)))} /></label>
      <label>模型<select aria-label="对比模型" value={companion} onChange={event => setCompanion(event.target.value as CompanionId)}><option value="hong-xi">Hong Xi</option><option value="hiyori">Hiyori</option></select></label>
      <button type="button" className="lab-primary" disabled={!file || busy} onClick={() => void analyze()}>分析两种方案</button>
      {busy && <button type="button" onClick={() => controller.current?.abort()} disabled={!file}>取消分析</button>}
    </section>
    <div className="lab-status" role="status"><span>{progress.phase}</span>{busy && <progress max="1" value={progress.value} />}</div>
    {error && <p className="lab-error" role="alert">{error}</p>}
    <section className="lab-player" aria-label="共同播放控制">
      <audio ref={audio} preload="auto" />
      <button type="button" disabled={!run || busy} onClick={() => void toggle()}>{playing ? "暂停" : "播放"}</button>
      <button type="button" disabled={!run} onClick={() => seek(0)}>回到开头</button>
      <input type="range" aria-label="共同播放位置" min="0" max={run?.clip.duration ?? 0} step=".01" value={time} disabled={!run} onChange={event => seek(Number(event.target.value))} />
      <output>{clock(time)} / {clock(run?.clip.duration ?? 0)}</output>
      <label>试听<select aria-label="试听音频" value={listen} disabled={!run || playing} onChange={event => setListen(event.target.value)}><option value="original">原曲</option><option value="vocals">共同人声</option></select></label>
    </section>
    <div className="lab-stages">
      {[{ name: "HeadAudio", sample: headSample }, { name: "MotionSync", sample: motionSample }].map(({ name, sample }, i) => <section className="lab-card" key={name}>
        <div className="lab-card-heading"><h2>{name}</h2><strong>{sample.open > .01 ? strongest(sample.vowels ?? [], "无元音") : "静音"}</strong></div>
        <iframe className="lab-model-frame" title={`${name} 模型预览`} src="./lipsync-model.html" ref={element => { modelFrames.current[i] = element; }} />
        <WeightBars values={sample.vowels ?? []} />
        <p className="lab-diagnostic">{name === "HeadAudio" ? `原始标签：${run ? HEAD_LABELS[run.result.labels[index]] : "—"}` : `原始最强项：${run ? strongest(run.result.weights.map(w => w[index])) : "—"}`} · 共同开合：{sample.open.toFixed(2)}</p>
      </section>)}
    </div>
    {run && <>
      <Timeline result={run.result} time={time} onSeek={seek} />
      <p className="lab-method">当前结果：{run.name} · 原曲 {clock(run.start)} 起 · {run.result.separate ? "分离后共同人声" : "直接输入人声"} · MotionSync 平滑 {run.result.motion.smoothing}，倍率 {run.result.motion.scales.slice(0, 5).join(" / ")}。修改上方参数后需重新分析。</p>
      <p className="lab-method">单次离线分析耗时（含首次加载）：HeadAudio {(run.result.timings.headMs / 1000).toFixed(2)} s，MotionSync {(run.result.timings.motionMs / 1000).toFixed(2)} s，总流程 {(run.result.timings.totalMs / 1000).toFixed(2)} s。此处不是实时端到端延迟。</p>
      <section className="lab-review"><h2>记录听感与嘴形</h2><p>对比是否发音匹配、切换及时、拖音稳定。没有人工标注时，不自动生成“准确率”。</p>
        <input aria-label="对比备注" placeholder="例如：这里唱「我」，右侧圆唇更接近" value={note} onChange={event => setNote(event.target.value)} />
        <div>{["HeadAudio 更准", "MotionSync 更准", "差不多", "都不准"].map(verdict => <button type="button" key={verdict} onClick={() => mark(verdict)}>记录：{verdict}</button>)}<button type="button" onClick={exportReport}>导出对比记录</button><button type="button" onClick={() => download("comparison-vocals.wav", new Blob([wavBytes(run.result.vocals)], { type: "audio/wav" }))}>导出共同人声</button></div>
        <ol>{marks.map((item, i) => <li key={i}><button type="button" onClick={() => seek(item.clipTime)}>{clock(item.songTime)}</button> {item.verdict} · {item.note || "无备注"}<button type="button" aria-label={`删除记录 ${i + 1}`} onClick={() => setMarks(list => list.filter((_, j) => i !== j))}>删除</button></li>)}</ol>
      </section>
    </>}
    <footer>本地测试版 · 音频不上传。带伴奏歌曲首次分析会下载约 172 MiB 的人声分离模型。两侧统一音量开合，识别器各自保留嘴形后处理；Hong Xi 的五元音仍通过现有两个有效嘴部参数近似呈现。</footer>
  </main>;
}
