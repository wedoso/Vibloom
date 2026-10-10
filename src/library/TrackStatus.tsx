import { useMemo, type ReactNode } from "react";
import { LibraryIcon } from "./LibraryIcons";
import { comparisonsOf, isVocalAnalysisReady, type LibraryTrack } from "../domain/library";
import type { VocalJob } from "../audio/vocals/jobStore";

export function useVocalPreparationState(track: LibraryTrack, job?: VocalJob) {
  const ready = useMemo(() => isVocalAnalysisReady(track.vocalAnalysis, track.duration || undefined)
    || job?.status === "ready" && isVocalAnalysisReady(job.analysis, track.duration || undefined),
  [track.vocalAnalysis, track.duration, job?.status, job?.analysis]);
  if (job?.status === "working" || job?.status === "queued" || job?.status === "error") return job.status;
  return ready ? "ready" : track.vocalAnalysis ? "outdated" : "idle";
}

function Feature({ label, className = "", children }: { label: string; className?: string; children: ReactNode }) {
  return <span className={`track-status-icon ${className}`} role="img" aria-label={label} tabIndex={0} onKeyDown={event => event.stopPropagation()}>
    {children}<span className="track-status-tooltip" aria-hidden="true">{label}</span>
  </span>;
}

export function TrackStatus({ track, job }: { track: LibraryTrack; job?: VocalJob }) {
  const state = useVocalPreparationState(track, job);
  const lyrics = track.lyrics.length > 0 || !!track.lyricTiming?.length;
  const comparisons = comparisonsOf(track);
  const unavailable = track.availability === "missing" || track.availability === "reconnect";
  const availability = unavailable ? track.availability === "missing" ? "Missing" : "Reconnect"
    : track.persistence === "cached" ? "On device" : track.availability === "available" ? "Available" : "This session";
  const vocalLabel = state === "ready" ? "Vocal lip sync ready" : state === "queued" ? "Vocal lip sync queued"
    : state === "working" ? `${job?.phase || "Preparing vocal lip sync"} · ${Math.round((job?.progress ?? 0) * 100)}%`
      : state === "error" ? `Vocal lip sync failed · ${job?.error || "Retry preparation"}`
        : state === "outdated" ? "Reprepare vocal lip sync" : "Vocal lip sync not prepared";
  const comparisonUnavailable = comparisons.some(item => item.availability !== "available" && item.availability !== "session");
  return <span className="track-states">
    <span className={`track-availability availability-${track.availability} ${track.persistence === "cached" && !unavailable ? "is-cached" : ""}`}>{availability}</span>
    <span className="track-feature-icons">
      <Feature label={vocalLabel} className={`has-vocals vocal-${state} ${state === "idle" || state === "outdated" ? "is-muted" : ""}`}>
        <LibraryIcon name={state === "working" ? "LoaderCircle" : state === "queued" ? "Clock3" : state === "error" ? "CircleAlert" : "MicVocal"} size={14} className={state === "working" ? "vocal-spinner" : ""} />
        {state === "ready" && <LibraryIcon name="Check" className="vocal-ready-check" size={8} />}
      </Feature>
      <Feature label={lyrics ? track.lyrics.length ? "Synced lyrics attached" : "TXT lyrics attached" : "No lyrics attached"} className={lyrics ? "has-lyrics" : "is-muted"}><LibraryIcon name="FileText" size={14} /></Feature>
      <Feature label={comparisons.length ? `${comparisons.length} comparison tracks attached${comparisonUnavailable ? " · Reconnect audio" : ""}` : "No comparison tracks attached"} className={comparisons.length ? `has-version-b ${comparisonUnavailable ? "comparison-reconnect" : ""}` : "is-muted"}><LibraryIcon name="ArrowLeftRight" size={14} /></Feature>
    </span>
  </span>;
}

export function TrackVocalProgress({ trackName, job, onCancel, onRetry }: { trackName: string; job?: VocalJob; onCancel: () => void; onRetry: () => void }) {
  if (!job || !["queued", "working", "error"].includes(job.status)) return null;
  const error = job.status === "error";
  return <span className={`track-vocal-job ${error ? "is-error" : ""}`} role="status">
    <span className="track-vocal-phase" title={error ? job.error : job.phase} aria-label={error ? job.error : undefined}>
      {error ? <><LibraryIcon name="CircleAlert" size={10} /> Lip sync preparation failed</> : `${job.phase} · ${Math.round(job.progress * 100)}%`}
    </span>
    <button type="button" aria-label={`${error ? "Retry" : "Cancel"} vocal preparation for ${trackName}`} onClick={error ? onRetry : onCancel}>{error ? "Retry" : "Cancel"}</button>
    {!error && <progress aria-label={`Vocal preparation for ${trackName}`} max={1} value={job.progress} />}
  </span>;
}
