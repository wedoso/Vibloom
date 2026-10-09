import { lazy, Suspense, useEffect, useRef } from "react";
import { EMPTY_AUDIO_VISUAL, sampleAnalyser } from "../audioVisual";
import { SILENT_VOCAL_POSE } from "../audio/vocals/envelope";
import type { MobileLibrary } from "./useMobileLibrary";
const Live2DStage = lazy(() => import("../Live2DStage"));

export default function MobileCompanion({ library, focus }: { library: MobileLibrary; focus: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = host.current; if (!node) return;
    const update = () => {
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
  const { sampleVocals } = library.vocals;
  const visual = useRef({ ...EMPTY_AUDIO_VISUAL }), vocals = useRef(SILENT_VOCAL_POSE);
  useEffect(() => {
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
  }, [library.engine, library.playing, library.source, library.comparisons.slots, sampleVocals, library.session.volume]);
  return <div ref={host} className="m-companion"><Suspense fallback={<p className="m-muted">Opening your listening room…</p>}><Live2DStage companionId={library.session.companionId} featuresRef={visual} vocalLevelRef={vocals} variant="player" trackLabel="" activeSource={library.source} isComparing={Object.keys(library.comparisons.slots).length > 0} isPlaying={library.playing} focusMode={focus} containModel layoutKey="mobile" /></Suspense></div>;
}
