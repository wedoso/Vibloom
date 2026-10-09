import { MicVocal } from "lucide-react";
import { comparisonsOf, withoutExtension, type LibraryTrack } from "../domain/library";
import MobileSheet from "./MobileSheet";
import type { MobileLibrary } from "./useMobileLibrary";

export default function MobileVocals({ library, track, onClose }: { library: MobileLibrary; track: LibraryTrack; onClose: () => void }) {
  const sources = [{ ...track, slot: 0 }, ...(track.id === library.current?.id ? comparisonsOf(track) : [])];
  return <MobileSheet title="Vocal lip sync" onClose={onClose}>
    <p className="m-muted">Prepare each track once. Mouth shapes follow the voice of the track you hear, including after seeking and switching.</p>
    <p className="m-picker-hint">First preparation downloads a 172 MiB vocal model. Keep this page open while preparing. Your music stays on this device.</p>
    <div className="m-vocal-sources">{sources.map(item => {
      const source = item.slot!, status = library.vocals.state(track, source);
      const transforming = Object.values(library.comparisons.jobs).some(job => job.target === source) && track.id === library.current?.id;
      const label = status.working ? "Cancel preparation" : status.ready ? status.enabled ? "Disable lip sync" : "Enable lip sync" : status.job?.status === "error" ? "Retry preparation" : "Prepare lip sync";
      return <section className="m-vocal-source" key={status.key} data-vocal-track={source + 1} data-vocal-status={status.working ? "working" : status.ready ? "ready" : status.job?.status ?? "idle"}>
        <div className="m-vocal-heading"><span className="m-vocal-number">{source + 1}</span><div><strong>{withoutExtension(item.name)}</strong><small>{source === 0 ? "Original" : "Comparison"} · {status.ready ? status.enabled ? "Lip sync on" : "Lip sync off" : status.working ? "Preparing" : "Not prepared"}</small></div></div>
        {status.working && <div role="status" className="m-vocal-progress"><span>{status.job?.phase} · {Math.round((status.job?.progress ?? 0) * 100)}%</span><progress aria-label={`Vocal preparation for track ${source + 1}`} max={1} value={status.job?.progress ?? 0} /></div>}
        {status.job?.status === "error" && <p className="m-error" role="status">{status.job.error}</p>}
        <button className={`m-button ${status.ready && status.enabled ? "is-enabled" : ""}`} aria-label={`${label} track ${source + 1}`} aria-pressed={status.ready ? status.enabled : undefined} disabled={!status.working && (library.importing || !!library.busy || transforming)} onClick={() => library.vocals.prepare(track, source)}><MicVocal size={18} />{label}</button>
      </section>;
    })}</div>
  </MobileSheet>;
}
