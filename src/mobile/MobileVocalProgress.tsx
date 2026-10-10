import type { VocalJob } from "../audio/vocals/jobStore";

/** The same live job drives the sheet and its minimized icon. */
export default function MobileVocalProgress({ job, label }: { job?: VocalJob; label: string }) {
  if (!job || !["queued", "working", "error"].includes(job.status)) return null;
  const error = job.status === "error";
  const value = Number.isFinite(job.progress) ? Math.max(0, Math.min(1, job.progress)) : 0;
  const waiting = !error && (job.status === "queued" || value === 0);
  const percent = Math.round(value * 100);
  return <svg className={`m-vocal-ring ${waiting ? "is-waiting" : ""} ${error ? "is-error" : ""}`} viewBox="0 0 40 40" role={error ? "img" : "progressbar"}
    aria-label={error ? `${label} failed` : label} aria-valuemin={error ? undefined : 0} aria-valuemax={error ? undefined : 100}
    aria-valuenow={error || waiting ? undefined : percent} aria-valuetext={error ? undefined : waiting ? job.phase : `${job.phase} · ${percent}%`}>
    <circle className="m-vocal-ring-track" cx="20" cy="20" r="18" />
    <circle className="m-vocal-ring-value" cx="20" cy="20" r="18" pathLength="100" strokeDasharray={waiting ? "24 76" : "100"} strokeDashoffset={error || waiting ? 0 : 100 - value * 100} transform="rotate(-90 20 20)" />
  </svg>;
}
