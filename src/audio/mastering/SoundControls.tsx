import StyledSelect from "../../StyledSelect";
import { ChevronDown, RotateCcw } from "lucide-react";
import type { CSSProperties } from "react";
import { upstreamDefaults, type MasteringSettings } from "./settings";
type Props = { settings: MasteringSettings; disabled: boolean; onChange: (settings: MasteringSettings)=>void };
export function EqGainControls({settings,disabled,onChange}: Props) {
  return <details className="sound-detail"><summary>Adjust five bands <small>−12 to +12 dB</small></summary><div className="sound-eq-sliders">{settings.gains.map((gain,i)=><label key={i}><span>{["80 Hz","250 Hz","1 kHz","4 kHz","12 kHz"][i]}<strong>{gain>0?"+":""}{gain} dB</strong></span><input aria-label={`EQ ${[80,250,1000,4000,12000][i]} Hz`} type="range" min="-12" max="12" step="0.1" value={gain} disabled={disabled} onChange={event=>onChange({...settings,presetId:"custom",gains:settings.gains.map((value,index)=>index===i?Number(event.target.value):value)})}/></label>)}</div></details>;
}
export function MasteringControls({settings:s,disabled,onChange}: Props) {
  const update = (patch: Partial<MasteringSettings>)=>onChange({...s,mode:"mastering",...patch});
  const toggle = (key: "cleanLowEnd" | "cutMud" | "tameHarsh" | "addAir" | "glueCompression" | "centerBass" | "normalizeLoudness" | "truePeakLimit",label: string, description = "")=> <label className={`sound-toggle ${s[key] ? "is-on" : ""}`}><span>{label}{description && <small>{description}</small>}</span><input aria-label={label} role="switch" type="checkbox" checked={s[key]} disabled={disabled} onChange={event=>update({[key]:event.target.checked})}/></label>;
  const slider = (key:"inputGain" | "stereoWidth" | "targetLufs" | "truePeakCeiling", label:string,min:number,max:number,step:number,unit:string, enabled = true)=> <label className={`sound-slider ${enabled ? "" : "is-inactive"}`}><span>{label}<strong>{key === "inputGain" && s[key] > 0 ? "+" : ""}{s[key]} <small>{unit}</small></strong></span><input aria-label={label} type="range" min={min} max={max} step={step} value={s[key]} style={{"--sound-fill": `${(s[key] - min) / (max - min) * 100}%`} as CSSProperties} disabled={disabled || !enabled} onChange={event=>update({[key]:Number(event.target.value)})}/></label>;
  return <div className="sound-mastering">
    <div className="sound-mode"><label className="sound-toggle"><span>Include mastering</span><input aria-label="Include mastering" role="switch" type="checkbox" checked={s.mode==="mastering"} disabled={disabled} onChange={event=>onChange({...s,mode:event.target.checked?"mastering":"eq"})}/></label><button type="button" disabled={disabled} onClick={()=>onChange(upstreamDefaults(s))}><RotateCcw size={11} aria-hidden="true"/>Suno defaults</button></div>
    <div className="sound-tool-columns">
      <section className="sound-group" aria-labelledby="sound-tone-title"><h3 id="sound-tone-title">Tone</h3><div>{toggle("cleanLowEnd","Clean low end","30 Hz high-pass")}{toggle("cutMud","Cut mud","−3 dB at 250 Hz")}{toggle("tameHarsh","Tame harshness","Soften 4 / 6 kHz")}</div></section>
      <section className="sound-group" aria-labelledby="sound-character-title"><h3 id="sound-character-title">Character & space</h3><div>{toggle("addAir","Add air","+2.5 dB high shelf")}{toggle("glueCompression","Glue","Gentle 3:1 compression")}{toggle("centerBass","Center bass","Mono below 120 Hz")}</div></section>
    </div>
    <div className="sound-stereo">{slider("stereoWidth","Stereo width",0,200,1,"%")} {slider("inputGain","Input gain",-12,12,.1,"dB")}</div>
    <details className="sound-detail sound-delivery" open><summary><span>Loudness & output</span><small>{s.sampleRate/1000} kHz · {s.bitDepth} bit</small><ChevronDown size={12} aria-hidden="true"/></summary>
      <div className="sound-output-grid">
        <div>{toggle("normalizeLoudness","Normalize loudness")}{slider("targetLufs","Target loudness",-20,-6,1,"LUFS",s.normalizeLoudness)}</div>
        <div>{toggle("truePeakLimit","True peak limit")}{slider("truePeakCeiling","True peak ceiling",-6,0,.1,"dBTP",s.truePeakLimit)}</div>
      </div>
      <div className="sound-format"><span>WAV output</span><label><span>Sample rate</span><StyledSelect label="Output sample rate" disabled={disabled} value={String(s.sampleRate)} onChange={value=>update({sampleRate:Number(value) as 44100|48000})} options={[{value:"44100",label:"44.1 kHz"},{value:"48000",label:"48 kHz"}]}/></label><label><span>Bit depth</span><StyledSelect label="Output bit depth" disabled={disabled} value={String(s.bitDepth)} onChange={value=>update({bitDepth:Number(value) as 16|24})} options={[{value:"16",label:"16 bit · dither"},{value:"24",label:"24 bit"}]}/></label></div>
      <p>Saved loudness is measured after processing; preview uses the source.</p>
    </details>
  </div>;
}
