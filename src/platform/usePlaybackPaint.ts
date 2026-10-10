import { useEffect, useLayoutEffect, useRef } from "react";

/** Animate local DOM from the audio clock without committing the whole page.
 * The owner handles gestures; a paused/seek render paints synchronously. */
export function usePlaybackPaint(active: boolean, time: number, readTime: () => number, paint: (position: number) => void) {
  const paintRef = useRef(paint);
  useLayoutEffect(() => {
    paintRef.current = paint;
    paint(active ? readTime() : time);
  }, [active, paint, readTime, time]);
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const tick = () => { paintRef.current(readTime()); frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, readTime]);
}
