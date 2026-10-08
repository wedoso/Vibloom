import { useLayoutEffect, useRef, useState } from "react";

/** One perimeter treatment shared by EQ, remaster and per-source vocal jobs. */
export default function CardProgress({ progress, label }: { progress: number; label: string }) {
  const ref = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const card = ref.current?.parentElement;
    if (!card) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.borderBoxSize[0]?.inlineSize ?? card.clientWidth, height: entry.borderBoxSize[0]?.blockSize ?? card.clientHeight }));
    observer.observe(card);
    return () => observer.disconnect();
  }, []);
  const value = Math.max(0, Math.min(1, progress));
  return <svg ref={ref} className={`card-perimeter-progress ${value === 0 ? "is-queued" : ""}`} width="100%" height="100%" role="progressbar" aria-label={label} aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
    <rect x="1" y="1" width={Math.max(0, size.width - 2)} height={Math.max(0, size.height - 2)} rx="16" pathLength="100" strokeDasharray="100" strokeDashoffset={100 - value * 100} />
  </svg>;
}
