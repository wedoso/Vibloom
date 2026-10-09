import { useState } from "react";
import { ArrowRight, SlidersHorizontal, WandSparkles } from "lucide-react";
import { EQ_FREQUENCIES, EQ_PRESETS } from "../audio/eq/presets";
import { initialSettings, upstreamDefaults, type MasteringSettings } from "../audio/mastering/settings";
import { REPAIR_PRESETS } from "../audio/remaster/presets";
import type { MobileLibrary } from "./useMobileLibrary";
import MobileSheet from "./MobileSheet";

export default function MobileTools({ library, source, kind, onClose }: { library: MobileLibrary; source: number; kind: "sound" | "repair"; onClose: () => void }) {
  const [settings, setSettings] = useState(initialSettings);
  const [repair, setRepair] = useState("default");
  const [target, setTarget] = useState(() => library.comparisons.nextTarget(source));
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const job = library.comparisons.jobs[source];
  const locked = starting || !!job;
  const update = (patch: Partial<MasteringSettings>) => setSettings(current => ({ ...current, ...patch }));
  const create = async () => {
    if (target === null || locked) return;
    setStarting(true); setError("");
    try {
      if (!library.engine.getBuffer(0) && library.current) {
        if (!await library.load(library.current.id, false, library.time)) throw new Error("Reconnect and load the original song first.");
      }
      const success = await library.comparisons.process(source, target, kind === "repair" ? "remaster" : "eq", kind === "repair" ? repair : settings.presetId, kind === "sound" ? settings : undefined);
      if (success) onClose();
    } catch (reason) { if (!(reason instanceof Error && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : "Processing could not finish."); }
    finally { setStarting(false); }
  };
  const toggle = (key: "cleanLowEnd" | "cutMud" | "addAir" | "tameHarsh" | "glueCompression" | "centerBass" | "normalizeLoudness" | "truePeakLimit", label: string) => <label className="m-setting-row" key={key}><span>{label}</span><input role="switch" type="checkbox" checked={settings[key]} disabled={locked} onChange={event => update({ [key]: event.target.checked })} /></label>;
  const slider = (key: "inputGain" | "stereoWidth" | "targetLufs" | "truePeakCeiling", label: string, min: number, max: number, step: number, unit: string) => <label className="m-slider" key={key}><span>{label}<output>{settings[key]} {unit}</output></span><input type="range" min={min} max={max} step={step} value={settings[key]} disabled={locked} onChange={event => update({ [key]: Number(event.target.value) })} /></label>;
  return <MobileSheet title={kind === "repair" ? "Audio repair" : "Sound & mastering"} onClose={onClose}>
    <p className="m-muted">Track {source + 1} stays intact. Save your changes as another version, then compare on the same clock.</p>
    <label className="m-field"><span>Save as</span><select aria-label="Output version" value={target ?? ""} disabled={locked} onChange={event => setTarget(Number(event.target.value))}><option value="" disabled>No empty versions</option>{Array.from({ length: 8 }, (_, i) => i + 1).map(slot => <option key={slot} value={slot} disabled={slot === source || !!library.comparisons.slots[slot]}>Track {slot + 1}{library.comparisons.slots[slot] ? " · occupied" : ""}</option>)}</select></label>
    {kind === "repair" ? <><label className="m-field"><span>Repair recipe</span><select aria-label="Repair recipe" value={repair} disabled={locked} onChange={event => setRepair(event.target.value)}>{REPAIR_PRESETS.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></label><p className="m-muted">{REPAIR_PRESETS.find(preset => preset.id === repair)?.description}</p></> : <>
      <label className="m-field"><span>EQ preset</span><select aria-label="EQ preset" value={settings.presetId} disabled={locked} onChange={event => { const preset = EQ_PRESETS.find(item => item.id === event.target.value); if (preset) update({ presetId: preset.id, gains: [...preset.gains] }); }}><option value="custom" disabled>Custom</option>{EQ_PRESETS.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></label>
      <details className="m-details" open><summary><SlidersHorizontal size={17} />Five-band EQ</summary><div>{settings.gains.map((gain, index) => <label className="m-slider" key={index}><span>{EQ_FREQUENCIES[index] < 1000 ? `${EQ_FREQUENCIES[index]} Hz` : `${EQ_FREQUENCIES[index] / 1000} kHz`}<output>{gain > 0 ? "+" : ""}{gain} dB</output></span><input aria-label={`EQ ${EQ_FREQUENCIES[index]} Hz`} type="range" min="-12" max="12" step="0.1" value={gain} disabled={locked} onChange={event => update({ presetId: "custom", gains: settings.gains.map((value, i) => i === index ? Number(event.target.value) : value) })} /></label>)}</div></details>
      <label className="m-setting-row"><span>Include mastering</span><input role="switch" type="checkbox" checked={settings.mode === "mastering"} disabled={locked} onChange={event => update({ mode: event.target.checked ? "mastering" : "eq" })} /></label>
      {settings.mode === "mastering" && <><button className="m-button" disabled={locked} onClick={() => setSettings(upstreamDefaults(settings))}>Use Suno defaults</button><div className="m-settings-card">{toggle("cleanLowEnd", "Clean low end")}{toggle("cutMud", "Cut mud")}{toggle("tameHarsh", "Tame harshness")}{toggle("addAir", "Add air")}{toggle("glueCompression", "Glue compression")}{toggle("centerBass", "Center bass")}</div>{slider("inputGain", "Input gain", -12, 12, .1, "dB")}{slider("stereoWidth", "Stereo width", 0, 200, 1, "%")}{toggle("normalizeLoudness", "Normalize loudness")}{settings.normalizeLoudness && slider("targetLufs", "Target loudness", -20, -6, 1, "LUFS")}{toggle("truePeakLimit", "True peak limit")}{settings.truePeakLimit && slider("truePeakCeiling", "True peak ceiling", -6, 0, .1, "dBTP")}</>}
      <div className="m-format"><label className="m-field"><span>Sample rate</span><select aria-label="Output sample rate" value={settings.sampleRate} disabled={locked} onChange={event => update({ sampleRate: Number(event.target.value) as 44100 | 48000 })}><option value="44100">44.1 kHz</option><option value="48000">48 kHz</option></select></label><label className="m-field"><span>Bit depth</span><select aria-label="Output bit depth" value={settings.bitDepth} disabled={locked} onChange={event => update({ bitDepth: Number(event.target.value) as 16 | 24 })}><option value="16">16 bit</option><option value="24">24 bit</option></select></label></div>
    </>}
    {job && <div className="m-job" role="status"><span>{job.phase}</span><progress max="1" value={job.progress} /><button className="m-button" onClick={() => library.comparisons.cancel(source)}>Cancel processing</button></div>}
    {error && <p className="m-error" role="alert">{error}</p>}
    <button className="m-button m-primary m-full" disabled={locked || target === null} onClick={() => void create()}>{kind === "repair" ? <WandSparkles size={18} /> : <SlidersHorizontal size={18} />}{locked ? "Processing…" : "Create comparison version"}<ArrowRight size={17} /></button>
  </MobileSheet>;
}
