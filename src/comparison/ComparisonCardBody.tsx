import { useEffect, useState, type ReactNode } from "react";

/** Keep the exit animation, then release hidden waveform controls and bars. */
export default function ComparisonCardBody({ expanded, children }: { expanded: boolean; children: ReactNode }) {
  const [retained, setRetained] = useState(expanded);
  if (expanded && !retained) setRetained(true);
  useEffect(() => {
    if (expanded) return;
    const timeout = window.setTimeout(() => setRetained(false), window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 280);
    return () => window.clearTimeout(timeout);
  }, [expanded]);
  return <div className={`comparison-card-body ${expanded ? "is-expanded" : ""}`} inert={!expanded} aria-hidden={!expanded}>
    <div>{(expanded || retained) && children}</div>
  </div>;
}
