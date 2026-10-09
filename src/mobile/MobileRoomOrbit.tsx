import { useState, useSyncExternalStore, type CSSProperties } from "react";
import { ChevronDown, Plus } from "lucide-react";
import type { MobileLibrary } from "./useMobileLibrary";

const compactQuery = "(max-height: 700px)";
const subscribeViewport = (changed: () => void) => { const query = window.matchMedia(compactQuery); query.addEventListener("change", changed); return () => query.removeEventListener("change", changed); };

/** Track controls live around the companion, outside the central face area. */
export default function MobileRoomOrbit({ library, pendingSource, onSelect, onAdd }: {
  library: MobileLibrary;
  pendingSource: number | null;
  onSelect: (source: number) => void;
  onAdd: () => void;
}) {
  const compact = useSyncExternalStore(subscribeViewport, () => window.matchMedia(compactQuery).matches, () => false);
  const capacity = compact ? 3 : 4;
  const [bank, setBank] = useState({ capacity, index: 0 });
  const versions = Object.values(library.comparisons.slots).sort((a, b) => a.slot - b.slot);
  const banks = Math.max(1, Math.ceil(versions.length / capacity));
  const activeBank = Math.min(bank.capacity === capacity ? bank.index : Math.max(0, Math.floor(versions.findIndex(version => version.slot === library.source) / capacity)), banks - 1);
  const visible = versions.slice(activeBank * capacity, activeBank * capacity + capacity);
  const nextBank = (activeBank + 1) % banks;
  const nextVersions = versions.slice(nextBank * capacity, nextBank * capacity + capacity);
  const addInOrbit = versions.length < capacity;
  const count = visible.length + (addInOrbit ? 1 : 0);
  const y = (index: number) => count === 1 ? 50 : 16 + index * 48 / (count - 1);
  const disabled = !library.current || !library.ready || !!library.busy;
  const button = (source: number, title: string, style?: CSSProperties) => <button
    className={`m-orbit-track ${source === 0 ? "m-orbit-original" : ""} ${pendingSource === source ? "is-loading" : ""}`}
    style={style} disabled={disabled} key={source} aria-label={`Listen to track ${source + 1}`}
    title={title} aria-pressed={library.source === source} aria-busy={pendingSource === source}
    onClick={() => onSelect(source)}>{source + 1}</button>;
  return <div className="m-room-orbits" aria-label="Track circles">
    <div className="m-orbit-primary">{button(0, library.current?.name ?? "Original track")}<span>Original</span></div>
    <div className="m-orbit-comparisons" aria-label="Comparison tracks">{visible.map((version, index) => button(version.slot, version.name, { top: `${y(index)}%`, right: `${visible.length > 2 && (index === 0 || index === count - 1) ? 12 : 0}px` }))}
      {addInOrbit && <button className="m-orbit-track m-orbit-add" aria-label="Add a comparison file" disabled={disabled} style={{ top: `${y(visible.length)}%` }} onClick={onAdd}><Plus size={19} /></button>}
      {banks > 1 && <button className="m-orbit-bank" aria-label="Show other comparison tracks" onClick={() => setBank({ capacity, index: nextBank })}>{nextVersions[0].slot + 1}–{nextVersions.at(-1)!.slot + 1}<ChevronDown size={12} /></button>}
    </div>
  </div>;
}
