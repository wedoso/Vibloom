import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MicVocal, ScanFace } from "lucide-react";
import { EMPTY_AUDIO_VISUAL, sampleAnalyser } from "../audioVisual";
import { SILENT_VOCAL_POSE } from "../audio/vocals/envelope";
import type { MobileLibrary } from "./useMobileLibrary";
import { bindMobileModelPinch } from "./modelPinch";
import { mobileModelZoomOffset } from "./modelFraming";
import { useVisualActivity } from "../platform/useVisualActivity";
import MobileVocalProgress from "./MobileVocalProgress";
import { mobileTrackLabel } from "./comparison";
const Live2DStage = lazy(() => import("../Live2DStage"));

export default function MobileCompanion({ library, focus, onVocals, visible = true }: { library: MobileLibrary; focus: boolean; onVocals: () => void; visible?: boolean }) {
  const renderActive = useVisualActivity(visible);
  const host = useRef<HTMLDivElement>(null);
  const zoomReadout = useRef<HTMLOutputElement>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [capsule, setCapsule] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const node = host.current, readout = zoomReadout.current; if (!node || !readout) return;
    let canvas: HTMLCanvasElement | null = null, unbind = () => {};
    const update = () => {
      const next = node.querySelector<HTMLCanvasElement>(".live2d-canvas");
      if (next === canvas) return;
      unbind(); canvas = next;
      unbind = next ? bindMobileModelPinch(next, readout) : () => {};
    };
    const observer = new MutationObserver(update); observer.observe(node, { childList: true, subtree: true }); update();
    return () => { observer.disconnect(); unbind(); };
  }, []);
  useEffect(() => {
    const node = host.current; if (!node) return;
    const update = () => {
      const controls = node.querySelector<HTMLElement>(".camera-capsule");
      setCapsule(previous => previous === controls ? previous : controls);
      node.querySelector<HTMLButtonElement>('[title="Toggle automatic phrase-level framing"]')?.setAttribute("aria-label", "Automatic camera");
      for (const [label, name] of [["Portrait upper-body framing", "Portrait camera"], ["Wide full-body framing", "Wide camera"]]) {
        const button = node.querySelector<HTMLButtonElement>(`[aria-label="${label}"], [aria-label="${name}"]`);
        if (!button) continue;
        button.setAttribute("aria-label", name);
        const selected = String(button.classList.contains("is-active"));
        if (button.getAttribute("aria-pressed") !== selected) button.setAttribute("aria-pressed", selected);
      }
    };
    const observer = new MutationObserver(update); observer.observe(node, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "aria-pressed", "data-status"] }); update();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!cameraOpen) return;
    const dismiss = (event: PointerEvent) => { if (!(event.target instanceof Node) || !capsule?.contains(event.target)) setCameraOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setCameraOpen(false); capsule?.querySelector<HTMLButtonElement>(".m-stage-camera")?.focus(); } };
    document.addEventListener("pointerdown", dismiss); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
  }, [cameraOpen, capsule]);
  const { sampleVocals } = library.vocals;
  const visual = useRef({ ...EMPTY_AUDIO_VISUAL }), vocals = useRef(SILENT_VOCAL_POSE);
  useEffect(() => {
    if (!renderActive) return;
    let frame = 0;
    const frequency = new Uint8Array(512), samples = new Uint8Array(1024);
    const tick = () => {
      const active = library.playing && library.engine.getContext()?.state === "running";
      vocals.current = active ? sampleVocals(library.engine.getTimelineTime(), library.session.volume) : SILENT_VOCAL_POSE;
      const analyser = library.engine.getAnalyser(library.engine.audibleSource);
      visual.current = library.playing && analyser
        ? sampleAnalyser(analyser, frequency, samples, visual.current, library.engine.getTimelineTime(), library.source)
        : { ...visual.current, isPlaying: false, transient: 0 };
      visual.current.isComparing = Object.keys(library.comparisons.slots).length > 0;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [library.engine, library.playing, library.source, library.comparisons.slots, sampleVocals, library.session.volume, renderActive]);
  const vocalStatus = library.current ? library.vocals.state(library.current, library.source) : null;
  const tasks = library.vocals.activeJobs.filter(task => task.track.id === library.current?.id);
  const vocalTask = tasks.find(task => task.job?.status === "working") ?? tasks.find(task => task.job?.status === "queued") ?? tasks[0];
  const progressJob = vocalTask?.job;
  const progressLabel = `Vocal preparation for track ${mobileTrackLabel(vocalTask?.source ?? library.source)}`;
  return <div ref={host} className={`m-companion ${cameraOpen ? "is-camera-open" : ""}`} onClickCapture={event => {
    const button = (event.target as Element).closest("button");
    if (!button?.closest(".camera-capsule") || button.classList.contains("m-stage-camera")) return;
    setCameraOpen(false);
    if (!button.classList.contains("m-stage-vocals")) requestAnimationFrame(() => capsule?.querySelector<HTMLButtonElement>(".m-stage-camera")?.focus());
  }}>
    <Suspense fallback={<p className="m-muted">Opening your listening room…</p>}>
      <Live2DStage renderActive={renderActive} companionId={library.session.companionId} featuresRef={visual} vocalLevelRef={vocals} variant="player" trackLabel="" activeSource={library.source} isComparing={Object.keys(library.comparisons.slots).length > 0} isPlaying={library.playing} focusMode={focus} containModel layoutKey="mobile" playerZoomOffset={mobileModelZoomOffset} />
    </Suspense>
    <output ref={zoomReadout} className="m-pinch-readout" aria-label="Model zoom" hidden />
    {capsule && createPortal(<>
      <button type="button" className="m-stage-camera" aria-label="Camera controls" aria-expanded={cameraOpen} title="Camera framing" onClick={() => setCameraOpen(value => !value)}><ScanFace size={19} strokeWidth={1.7} /></button>
      <button type="button" className={vocalStatus?.enabled ? "m-stage-vocals is-active" : "m-stage-vocals"} aria-label="Vocal lip sync" aria-haspopup="dialog" aria-pressed={vocalStatus?.enabled ?? false} aria-busy={!!progressJob && progressJob.status !== "error"} title={progressJob ? `${progressLabel} · ${progressJob.error ?? `${progressJob.phase} · ${Math.round(progressJob.progress * 100)}%`}` : vocalStatus?.enabled ? "Vocal lip sync is on" : "Prepare or enable vocal lip sync"} disabled={!library.current} onClick={onVocals}><MicVocal size={19} strokeWidth={1.7} /><MobileVocalProgress job={progressJob} label={progressLabel} /></button>
    </>, capsule)}
  </div>;
}
