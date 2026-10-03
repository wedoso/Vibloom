import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState } from "react";
import Live2DStage from "../Live2DStage";
import { EMPTY_AUDIO_VISUAL } from "../audioVisual";
import { SILENT_VOCAL_POSE, type VocalPose } from "../audio/vocals/envelope";
import type { CompanionId } from "../live2d/models";
import "../index.css";
import "./lab.css";

/** Cubism's shader singleton does not support two independent GL contexts in
 * one realm. Same-origin frames isolate that singleton, not the audio clock.
 * This child never creates an audio element, context, classifier, or timeline.
 */
function ModelFrame() {
  const features = useRef({ ...EMPTY_AUDIO_VISUAL });
  const pose = useRef<VocalPose>(SILENT_VOCAL_POSE);
  const current = useRef({ companion: "hong-xi" as CompanionId, playing: false });
  const [companion, setCompanion] = useState<CompanionId>("hong-xi");
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== location.origin || event.data?.kind !== "vibloom-lipsync-frame") return;
      const data = event.data;
      if (!["hong-xi", "hiyori"].includes(data.companion) || !Number.isFinite(data.time)
        || !data.pose || !Number.isFinite(data.pose.open)) return;
      pose.current = data.pose;
      features.current = { ...EMPTY_AUDIO_VISUAL, isPlaying: data.isPlaying, elapsed: data.time };
      if (current.current.companion !== data.companion) setCompanion(data.companion);
      if (current.current.playing !== data.isPlaying) setPlaying(data.isPlaying);
      current.current = { companion: data.companion, playing: data.isPlaying };
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);
  return <div className="lab-frame"><Live2DStage companionId={companion} featuresRef={features} vocalLevelRef={pose} variant="player" trackLabel="口型对比" activeSource={0} isComparing={false} isPlaying={playing} focusMode={false} /></div>;
}

createRoot(document.getElementById("root")!).render(<ModelFrame />);
