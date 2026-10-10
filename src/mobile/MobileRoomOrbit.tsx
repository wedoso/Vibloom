import { Plus } from "lucide-react";
import type { MobileLibrary } from "./useMobileLibrary";
import { mobileTrackLabel } from "./comparison";

/** A and B sit on either side of the companion; taps only change audible audio. */
export default function MobileRoomOrbit({ library, pendingSource, onSelect, onAdd }: {
  library: MobileLibrary; pendingSource: number | null;
  onSelect: (source: number) => void; onAdd: () => void;
}) {
  const comparison = Object.values(library.comparisons.slots)[0];
  const disabled = !library.current || !library.ready || !!library.busy;
  const button = (source: number, title: string) => <button
    className={`m-orbit-track ${source === 0 ? "m-orbit-original" : ""} ${pendingSource === source ? "is-loading" : ""}`}
    disabled={disabled} aria-label={`Listen to track ${mobileTrackLabel(source)}`} title={title}
    aria-pressed={library.source === source} aria-busy={pendingSource === source}
    onClick={() => onSelect(source)}>{mobileTrackLabel(source)}</button>;
  return <div className="m-room-orbits" aria-label="A/B track circles">
    <div className="m-orbit-primary">{button(0, library.current?.name ?? "Original track")}<span>Original</span></div>
    <div className="m-orbit-comparisons">{comparison ? button(comparison.slot, comparison.name) :
      <button className="m-orbit-track m-orbit-add" aria-label="Add a comparison file" disabled={disabled} onClick={onAdd}><Plus size={19} /></button>}
    </div>
  </div>;
}
