import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { SynchronizedAudioEngine } from "../audio/SynchronizedAudioEngine";
import { APP_VERSION } from "../appVersion";
import { PlaybackDiagnostics, playbackIssueDetails } from "./playbackDiagnostics";
import "./support.css";
type Props = { diagnostics: PlaybackDiagnostics; engine: SynchronizedAudioEngine; retry: () => void | Promise<unknown>; reconnect: () => void; compact?: boolean };
export default function PlaybackHelp({ diagnostics, engine, retry, reconnect, compact = false }: Props) {
  const state = useSyncExternalStore(diagnostics.subscribe, diagnostics.read);
  const [open, setOpen] = useState(false), [report, setReport] = useState(""), [copied, setCopied] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const issue = state.issue ? playbackIssueDetails(state.issue) : null;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    const node = dialog.current;
    node?.showModal();
    return () => { node?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [open]);
  const copy = async () => {
    const value = diagnostics.report(APP_VERSION, engine.getContext(), navigator.onLine);
    setReport(value);
    try { await navigator.clipboard.writeText(value); setCopied(true); } catch { setCopied(false); }
  };
  if (compact && !issue && !open) return null;
  return <>
    <button type="button" className={compact ? "playback-problem" : "support-card"} onClick={() => { setCopied(false); setReport(""); setOpen(true); }}>{compact ? `${issue?.title ?? "Playback status"} · Details` : "Playback status & help"}</button>
    {open && <dialog ref={dialog} className="playback-help" aria-labelledby={compact ? "playback-problem-title" : "playback-help-title"} onCancel={event => { event.preventDefault(); setOpen(false); }}>
      <h2 id={compact ? "playback-problem-title" : "playback-help-title"}>Playback status</h2>
      <p role="status">{issue?.title ?? ({ idle: "Ready when you are", preparing: "Preparing audio", recovering: "Restoring audio", playing: "Playing", paused: "Paused", error: "Playback needs attention" }[state.phase])}</p>
      {issue && <p>{issue.detail}</p>}
      <small>Diagnostics include app version, audio state and recent playback stages. They contain no song names, lyrics or audio. Nothing is uploaded.</small>
      {issue && <button type="button" onClick={() => { setOpen(false); if (issue.action === "reconnect") reconnect(); else void retry(); }}>{issue.action === "reconnect" ? "Reconnect source file" : "Retry playback"}</button>}
      <button type="button" onClick={() => { void copy(); }}>{copied ? "Diagnostics copied" : "Copy diagnostics"}</button>
      {report && !copied && <label>Copy this report<textarea readOnly aria-label="Playback diagnostic report" value={report} onFocus={event => event.currentTarget.select()} /></label>}
      <button type="button" onClick={() => setOpen(false)}>Close playback help</button>
    </dialog>}
  </>;
}
