import { forwardRef, lazy, Suspense, useEffect, useImperativeHandle, useRef } from "react";
import { EMPTY_AUDIO_VISUAL, sampleAnalyser } from "../audioVisual";
import { SILENT_VOCAL_POSE } from "../audio/vocals/envelope";
import type { MobileLibrary } from "./useMobileLibrary";
const Live2DStage = lazy(() => import("../Live2DStage"));

export type MobileCameraState = { preset: "director" | "portrait" | "wide" | "manual"; ready: boolean };
export type MobileCompanionControls = { frame: (mode: "director" | "portrait" | "wide") => void; interact: () => void };

const MobileCompanion = forwardRef<MobileCompanionControls, { library: MobileLibrary; onCameraChange: (state: MobileCameraState) => void }>(function MobileCompanion({ library, onCameraChange }, ref) {
  const host = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => ({
    frame: mode => {
      const button = host.current?.querySelector<HTMLButtonElement>(mode === "director" ? '[title="Toggle automatic phrase-level framing"]' : mode === "portrait" ? '[aria-label="Portrait upper-body framing"]' : '[aria-label="Wide full-body framing"]');
      if (mode !== "director" || button?.getAttribute("aria-pressed") !== "true") button?.click();
    },
    interact: () => host.current?.querySelector<HTMLButtonElement>('[aria-label^="Interact with"]')?.click(),
  }), []);
  useEffect(() => {
    const node = host.current; if (!node) return;
    let previous = "";
    const update = () => {
      const preset = node.querySelector('.camera-capsule > button.is-active')?.textContent?.trim().toLowerCase();
      const state: MobileCameraState = { preset: preset === "director" || preset === "portrait" || preset === "wide" ? preset : "manual", ready: node.querySelector('.live2d-stage')?.getAttribute("data-status") === "ready" };
      const key = `${state.preset}:${state.ready}`; if (key !== previous) { previous = key; onCameraChange(state); }
    };
    const observer = new MutationObserver(update); observer.observe(node, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "aria-pressed", "data-status"] }); update();
    return () => observer.disconnect();
  }, [onCameraChange]);
  const visual = useRef({ ...EMPTY_AUDIO_VISUAL }), vocals = useRef(SILENT_VOCAL_POSE);
  useEffect(() => {
    let frame = 0;
    const frequency = new Uint8Array(512), samples = new Uint8Array(1024);
    const tick = () => {
      const analyser = library.engine.getAnalyser(library.engine.audibleSource);
      visual.current = library.playing && analyser
        ? sampleAnalyser(analyser, frequency, samples, visual.current, library.engine.getTimelineTime(), library.source)
        : { ...visual.current, isPlaying: false, transient: 0 };
      visual.current.isComparing = Object.keys(library.comparisons.slots).length > 0;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [library.engine, library.playing, library.source, library.comparisons.slots]);
  return <div ref={host} className="m-companion"><Suspense fallback={<p className="m-muted">Opening your listening room…</p>}><Live2DStage companionId={library.session.companionId} featuresRef={visual} vocalLevelRef={vocals} variant="player" trackLabel="" activeSource={library.source} isComparing={Object.keys(library.comparisons.slots).length > 0} isPlaying={library.playing} focusMode={false} containModel layoutKey="mobile" /></Suspense></div>;
});
export default MobileCompanion;
