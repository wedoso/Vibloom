import { ArrowRight, Check, Headphones, Sparkles, X } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { getRepairPreset, REPAIR_PRESETS } from "./audio/remaster/presets";
import type { RemasterProgress } from "./audio/remaster/renderRemaster";
import "./remaster.css";

const GROUPS = [
  { name: "All presets", ids: REPAIR_PRESETS.map(preset => preset.id) },
  { name: "Shimmer", ids: ["default", "gentle", "aggressive", "decrystallize", "light-denoise", "strong-denoise"] },
  { name: "Full stack", ids: ["full-safe", "full-strong"] },
  { name: "Resonance", ids: ["gentle-resonance", "strong-resonance"] },
  { name: "Targeted", ids: ["presence", "upper", "whine", "crickets"] },
  { name: "Delivery", ids: ["delivery", "delivery-loud"] },
];

type Props = {
  trackName: string;
  duration: string;
  presetId: string;
  progress: RemasterProgress | null;
  error: string;
  replaceB: boolean;
  canApply: boolean;
  onPreset: (id: string) => void;
  onApply: () => void;
  onCancel: () => void;
  onDismiss: () => void;
};

export default function RemasterDialog({ trackName, duration, presetId, progress, error, replaceB, canApply, onPreset, onApply, onCancel, onDismiss }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);
  const [group, setGroup] = useState(0);
  const preset = getRepairPreset(presetId);
  useLayoutEffect(() => {
    const dialog = dialogRef.current!;
    dialog.showModal();
    selectedRef.current?.scrollIntoView({ block: "nearest" });
    return () => dialog.close();
  }, []);

  return <dialog ref={dialogRef} className="remaster-dialog" aria-labelledby="remaster-title" aria-describedby="remaster-intro"
    onCancel={event => { event.preventDefault(); onDismiss(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onDismiss();
    }}>
    <div className="remaster-dialog-heading">
      <span className="remaster-eyebrow"><Sparkles size={13} /> REMASTER</span>
      <button className="remaster-close" type="button" aria-label="Close remaster" onClick={onDismiss}><X size={17} /></button>
      <h2 id="remaster-title">A little more <em>clarity.</em></h2>
      <p id="remaster-intro">Choose a preset. Hear the difference in B.</p>
    </div>
    <div className="remaster-source"><span className="remaster-source-letter">A</span><strong title={trackName}>{trackName}</strong><span>{duration}</span><ArrowRight size={14} /><span className="remaster-source-letter is-b">B</span></div>
    <div className="remaster-preset-heading"><span>PRESET LIBRARY</span><small>{REPAIR_PRESETS.length} treatments</small></div>
    <div className="remaster-preset-library">
      <nav className="remaster-categories" aria-label="Preset categories">
        {GROUPS.map((item, index) => <button key={item.name} type="button" aria-pressed={group === index} onClick={() => setGroup(index)}>{item.name}<small>{item.ids.length}</small></button>)}
      </nav>
      <div className="remaster-presets" aria-label="Remaster preset">
        {REPAIR_PRESETS.filter(item => GROUPS[group].ids.includes(item.id)).map(item => <button key={item.id} type="button" ref={item.id === presetId ? selectedRef : undefined}
          className={`remaster-preset ${item.id === presetId ? "is-selected" : ""}`} data-preset-id={item.id} aria-pressed={item.id === presetId} disabled={!!progress} onClick={() => onPreset(item.id)}>
          <span><strong>{item.name}</strong>{item.id === "full-safe" && <small>Balanced cleanup</small>}{item.id === "default" && <small>Original deshimmer preset</small>}</span>
          <span className="remaster-preset-check" aria-hidden="true">{item.id === presetId && <Check size={13} />}</span>
        </button>)}
      </div>
    </div>
    <div className="remaster-selection"><span>SELECTED PRESET</span><strong>{preset.name}</strong><p>{preset.description}</p></div>
    {error && <p className="remaster-error" role="alert">{error}</p>}
    <footer className="remaster-dialog-footer">
      {progress ? <>
        <div className="remaster-processing" role="status"><span>{progress.phase}</span><strong>{Math.round(progress.progress * 100)}<small>%</small></strong><i><b style={{ width: `${progress.progress * 100}%` }} /></i></div>
        <div className="remaster-processing-actions"><button type="button" className="remaster-cancel" onClick={onCancel}>Cancel remaster</button><button type="button" className="remaster-submit" onClick={onDismiss}><Headphones size={15} /> Keep listening</button></div>
      </> : <><span className="remaster-output-note">Listen in B · Download WAV</span><button type="button" className="remaster-submit" disabled={!canApply} onClick={onApply}>{replaceB ? "Replace version B" : "Create version B"}<ArrowRight size={15} /></button></>}
    </footer>
  </dialog>;
}
