import { useSyncExternalStore } from "react";
import { applyOfflineUpdate, readOffline, retryOfflineApp, subscribeOffline } from "./offlineApp";
import "./support.css";
export default function OfflineStatus({ playing }: { playing: boolean }) {
  const state = useSyncExternalStore(subscribeOffline, readOffline);
  if (state.phase === "unavailable") return null;
  return <section className="support-card" aria-label="Offline access">
    <strong>Offline access</strong>
    <p role="status">{state.phase === "ready" ? state.online ? "Ready to open offline." : "Offline · using saved app resources." : state.phase === "preparing" ? "Preparing the app and companions for offline use…" : "Offline setup is incomplete. Connect to the internet and retry."}</p>
    <small>Only songs kept on this device can play offline. First-time vocal preparation needs a connection.</small>
    {state.phase === "error" && <button type="button" onClick={() => { void retryOfflineApp(); }}>Retry offline setup</button>}
    {state.update && <><p>A new app version is ready.{playing ? " Pause playback before applying it." : " Apply when you are ready to reload this page."}</p><button type="button" disabled={playing} onClick={applyOfflineUpdate}>Update &amp; reload</button></>}
  </section>;
}
