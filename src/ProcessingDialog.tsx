import { ArrowRight, Check, Headphones, Sparkles, X, Play, Pause } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { getRepairPreset, REPAIR_PRESETS } from "./audio/remaster/presets";
import type { RemasterProgress } from "./audio/remaster/renderRemaster";
import { EQ_PRESETS, getEqPreset } from "./audio/eq/presets";
import type { CompareView, TransformJob, TransformKind } from "./comparison/useComparisonWorkspace";
import "./remaster.css";
import { EqGainControls, MasteringControls } from "./audio/mastering/SoundControls";
import type { MasteringSettings } from "./audio/mastering/settings";

import StyledSelect from "./StyledSelect";

const GROUPS = [
  { name: "All presets", ids: REPAIR_PRESETS.map(preset => preset.id) },
  { name: "Shimmer", ids: ["default", "gentle", "aggressive", "decrystallize", "light-denoise", "strong-denoise"] },
  { name: "Full stack", ids: ["full-safe", "full-strong"] },
  { name: "Resonance", ids: ["gentle-resonance", "strong-resonance"] },
  { name: "Targeted", ids: ["presence", "upper", "whine", "crickets"] },
  { name: "Delivery", ids: ["delivery", "delivery-loud"] },
];

type Props = {
  soundSettings: MasteringSettings; onSound: (settings: MasteringSettings)=>void;
  preview: "processed" | "original" | null; previewLoading: boolean; previewRevision: number; previewStatus: "idle" | "preparing" | "applying" | "applied" | "bypassed"; onPreview: ()=>void; onBypass: ()=>void; isPlaying: boolean; onTogglePlayback: ()=>void;
  trackName: string;
  duration: string;
  presetId: string;
  progress: RemasterProgress | null;
  error: string;
  kind: TransformKind; source: number; target: number; selectedSource: number; slots: CompareView[]; jobs: TransformJob[]; onTarget: (target: number) => void;
  canApply: boolean;
  onPreset: (id: string) => void;
  onApply: () => void;
  onCancel: () => void;
  onDismiss: () => void;
};

export default function ProcessingDialog({ kind, source, target, selectedSource, slots, jobs, onTarget, trackName, duration, presetId, progress, error, canApply, onPreset, onApply, onCancel, onDismiss, soundSettings, onSound, preview, previewLoading, previewStatus, previewRevision, onPreview, onBypass, isPlaying, onTogglePlayback }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);
  const [group, setGroup] = useState(0);
  const [tab, setTab] = useState("eq");
  const preset = kind === "eq" ? (presetId === "custom" ? { name: "Custom EQ", description: "Your five-band tonal balance." } : getEqPreset(presetId)) : getRepairPreset(presetId);
  const presets = kind === "eq" ? EQ_PRESETS : REPAIR_PRESETS;
  const busyTarget = target === selectedSource || jobs.some(job => job.target === target || job.source === target);
  const replacing = slots.some(slot => slot.slot === target);
  useLayoutEffect(() => {
    const dialog = dialogRef.current!;
    dialog.showModal();
    selectedRef.current?.scrollIntoView({ block: "nearest" });
    return () => dialog.close();
  }, []);

  return <dialog ref={dialogRef} className={`remaster-dialog ${kind === "eq" ? "is-eq-dialog" : ""}`} aria-labelledby="remaster-title" aria-describedby="remaster-intro"
    onCancel={event => { event.preventDefault(); onDismiss(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onDismiss();
    }}>
    <div className="remaster-dialog-heading">
      <span className="remaster-eyebrow"><Sparkles size={13} /> {kind === "eq" ? "EQUALIZER" : "AUDIO REPAIR"}</span>
      <button className="remaster-close" type="button" aria-label={`Close ${kind === "eq" ? "eq" : "audio repair"}`} onClick={onDismiss}><X size={17} /></button>
      <h2 id="remaster-title">{kind === "eq" ? <>Find your <em>balance.</em></> : <>A little more <em>clarity.</em></>}</h2>
      <p id="remaster-intro">{kind === "eq" ? "Preview your sound, then save a version to compare." : "Choose a preset and an output track. Hear the difference."}</p>
    </div>
    <div className="remaster-source"><span className="remaster-source-letter">{source + 1}</span><strong title={trackName}>{trackName}</strong><span>{duration}</span><ArrowRight size={14} /><label className="processing-destination"><span>OUTPUT</span><StyledSelect label="Output track" value={String(target)} disabled={!!progress} onChange={value => onTarget(Number(value))} options={Array.from({ length: 8 }, (_, i) => i + 1).filter(index => index !== source).map(index => ({ value: String(index), disabled: index === selectedSource || jobs.some(job => job.target === index || job.source === index), label: `Track ${index + 1}${index === selectedSource ? " · selected" : slots.some(slot => slot.slot === index) ? " · replace" : " · empty"}` }))}/></label></div>
    {kind === "eq" && <nav className="sound-tabs" aria-label="Sound adjustment"><button type="button" aria-pressed={tab === "eq"} onClick={()=>setTab("eq")}>EQ</button><button type="button" aria-pressed={tab === "mastering"} onClick={()=>setTab("mastering")}>Mastering{soundSettings.mode === "mastering" && <i/>}</button></nav>}
    <div className={`sound-panel ${kind === "eq" && tab === "mastering" ? "is-mastering-panel" : ""}`}>
    {kind === "eq" && tab === "mastering" ? <MasteringControls settings={soundSettings} disabled={!!progress} onChange={onSound}/> : <>
    <div className="remaster-preset-heading"><span>PRESET LIBRARY</span><small>{presets.length} treatments</small></div>
    <div className={`remaster-preset-library ${kind === "eq" ? "is-eq-library" : ""}`}>
      {kind === "remaster" && <nav className="remaster-categories" aria-label="Preset categories">
        {GROUPS.map((item, index) => <button key={item.name} type="button" aria-pressed={group === index} onClick={() => setGroup(index)}>{item.name}<small>{item.ids.length}</small></button>)}
      </nav>}
      <div className="remaster-presets" aria-label={`${kind === "eq" ? "eq" : "audio repair"} preset`}>
        {presets.filter(item => kind === "eq" || GROUPS[group].ids.includes(item.id)).map(item => <button key={item.id} type="button" ref={item.id === presetId ? selectedRef : undefined}
          className={`remaster-preset ${item.id === presetId ? "is-selected" : ""}`} data-preset-id={item.id} aria-pressed={item.id === presetId} disabled={!!progress} onClick={() => onPreset(item.id)}>
          <span><strong>{item.name}</strong>{item.id === "full-safe" && <small>Balanced cleanup</small>}{item.id === "default" && <small>Original deshimmer preset</small>}</span>
          {kind === "eq" && <small className="eq-preset-gains">{getEqPreset(item.id).gains.map(gain => `${gain > 0 ? "+" : ""}${gain}`).join(" / ")} dB</small>}
          <span className="remaster-preset-check" aria-hidden="true">{item.id === presetId && <Check size={13} />}</span>
        </button>)}
      </div>
    </div>
    <div className="remaster-selection"><span>SELECTED PRESET</span><strong>{preset.name}</strong><p>{preset.description}</p></div>
    {kind === "eq" && <div className="eq-band-preview" aria-label="EQ band gains">
      <svg viewBox="0 0 180 44" preserveAspectRatio="none" aria-hidden="true"><line x1="0" y1="22" x2="180" y2="22" /><polyline points={soundSettings.gains.map((gain,index) => `${18 + index * 36},${22 - gain * 2.8}`).join(" ")} />{soundSettings.gains.map((gain,index) => <circle key={index} cx={18 + index * 36} cy={22 - gain * 2.8} r="1.5" />)}</svg>
      <div className="eq-band-labels">{soundSettings.gains.map((gain, index) => <span key={index}><strong>{gain > 0 ? "+" : ""}{gain}<small> dB</small></strong><small>{["80 Hz", "250 Hz", "1 kHz", "4 kHz", "12 kHz"][index]}</small></span>)}</div>
    </div>}
    {kind === "eq" && <EqGainControls settings={soundSettings} disabled={!!progress} onChange={onSound}/>}
    </>}
    </div>
    {kind === "eq" && !progress && <div className="sound-preview-bar"><button type="button" disabled={previewLoading} aria-pressed={preview === "processed"} onClick={preview ? onBypass : onPreview}><Headphones size={13}/>{previewLoading ? "Preparing preview…" : preview === "original" ? "Hear processed" : preview ? "Hear original" : `Preview track ${source + 1}`}</button>{preview && <button type="button" aria-label={isPlaying ? "Pause preview" : "Play preview"} onClick={onTogglePlayback}>{isPlaying ? <Pause size={13}/> : <Play size={13}/>}</button>}<span className="sound-apply-status" data-state={previewStatus} role="status" aria-live="polite" title={previewStatus === "applied" ? isPlaying ? "The selected settings have reached the audio output." : "Settings are ready for playback." : previewStatus === "bypassed" ? "You are hearing the source without preview effects." : "Preview effects are local to this track."}><i key={previewRevision} aria-hidden="true"/>{({idle:"Preview off",preparing:"Preparing",applying:"Applying",applied:"Applied",bypassed:"Bypassed"} as const)[previewStatus]}</span><small>{preview ? `${preview === "original" ? "Original" : "Processed"} · track ${source + 1}` : soundSettings.mode === "eq" ? "EQ only · no loudness changes" : "EQ + mastering"}</small></div>}
    {target === selectedSource && !progress && <p className="remaster-output-note" role="status">Choose another output or switch tracks before replacing this version.</p>}
    {error && <p className="remaster-error" role="alert">{error}</p>}
    <footer className="remaster-dialog-footer">
      {progress ? <>
        <div className="remaster-processing" role="status"><span>{progress.phase}</span><strong>{Math.round(progress.progress * 100)}<small>%</small></strong><i><b style={{ width: `${progress.progress * 100}%` }} /></i></div>
        <div className="remaster-processing-actions"><button type="button" className="remaster-cancel" onClick={onCancel}>Cancel {kind === "eq" ? "EQ" : "audio repair"}</button><button type="button" className="remaster-submit" onClick={onDismiss}><Headphones size={15} /> Keep listening</button></div>
      </> : <><span className="remaster-output-note">Track {target + 1} · Ready to compare & download</span><button type="button" className="remaster-submit" disabled={!canApply || busyTarget} onClick={onApply}>{replacing ? `Replace track ${target + 1}` : `Create track ${target + 1}`}<ArrowRight size={15} /></button></>}
    </footer>
  </dialog>;
}
