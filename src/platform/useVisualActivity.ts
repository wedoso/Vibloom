import { useEffect, useState } from "react";

declare global {
  interface Window {
    vibloomWindowState?: {
      read: () => Promise<boolean>;
      subscribe: (listener: (visible: boolean) => void) => () => void;
    };
  }
}

/** Desktop keeps its audio scheduler alive even when the native window hides.
 * Its renderer visibility is therefore supplied by the native bridge. */
export function useVisualActivity(enabled = true) {
  const [visible, setVisible] = useState(() => !document.hidden);
  useEffect(() => {
    const bridge = window.vibloomWindowState;
    if (bridge) {
      let alive = true, received = false;
      const unsubscribe = bridge.subscribe(value => { received = true; setVisible(value); });
      void bridge.read().then(value => { if (alive && !received) setVisible(value); }).catch(() => { /* Keep the current state if the bridge closes. */ });
      return () => { alive = false; unsubscribe(); };
    }
    const update = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return enabled && visible;
}
