import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import changelog from "../../CHANGELOG.md?raw";
import { APP_VERSION } from "../appVersion";
import { changelogNotes, fetchReleaseNotes, releaseNoteBlocks } from "./releaseNotes";

export default function ReleaseNotes({ version, notes, onOpenRelease }: {
  version: string;
  notes?: string;
  onOpenRelease: (version: string) => void;
}) {
  const supplied = notes?.trim() || (version === APP_VERSION ? changelogNotes(changelog, version) : "");
  const [remote, setRemote] = useState({ status: "loading", body: "" });
  useEffect(() => {
    if (supplied) return;
    const controller = new AbortController();
    let active = true;
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    void fetchReleaseNotes(version, controller.signal).then(body => {
      if (active) setRemote({ status: "ready", body });
    }).catch(() => {
      if (active) setRemote({ status: "error", body: "" });
    }).finally(() => window.clearTimeout(timeout));
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); };
  }, [version, supplied]);
  const body = supplied || remote.body;
  return (
    <section className="update-notes" aria-labelledby="update-notes-title">
      <h3 id="update-notes-title">What's new <span>v{version}</span></h3>
      <div className="update-notes-content" role="region" aria-label="Release notes" tabIndex={0}>
        {body ? releaseNoteBlocks(body).map((block, index) => block.kind === "list"
          ? <ul key={index}>{block.items.map((item, i) => <li key={i}>{item}</li>)}</ul>
          : block.kind === "heading" ? <h4 key={index}>{block.text}</h4> : <p key={index}>{block.text}</p>)
          : <p role="status">{remote.status === "loading" ? "Loading release notes…" : remote.status === "error" ? "Release notes could not be loaded. You can still download the update." : "No release notes were provided for this version."}</p>}
      </div>
      <button className="update-notes-link" type="button" onClick={() => onOpenRelease(version)}>Full release notes <ExternalLink size={12} /></button>
    </section>
  );
}
