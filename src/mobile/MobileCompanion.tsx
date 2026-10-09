import { forwardRef, lazy, Suspense, useEffect, useImperativeHandle, useRef } from "react";
import { EMPTY_AUDIO_VISUAL, sampleAnalyser } from "../audioVisual";
import { SILENT_VOCAL_POSE } from "../audio/vocals/envelope";
import type { MobileLibrary } from "./useMobileLibrary";
const Live2DStage = lazy(() => import("../Live2DStage"));

export type MobileCompanionControls = { frame: (mode: "portrait" | "wide") => void; interact: () => void };

const MobileCompanion = forwardRef<MobileCompanionControls, { library: MobileLibrary }>(function MobileCompanion({ library }, ref) {
  const host = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => ({
    frame: mode => host.current?.querySelector<HTMLButtonElement>(mode === "portrait" ? '[aria-label="Portrait upper-body framing"]' : '[aria-label="Wide full-body framing"]')?.click(),
    interact: () => host.current?.querySelector<HTMLButtonElement>('[aria-label^="Interact with"]')?.click(),
  }), []);
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
