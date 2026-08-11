import { Check, Download, ExternalLink, LoaderCircle, RefreshCw, RotateCw, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { APP_VERSION } from "./appVersion";
import { isNewerVersion } from "./update/version";

const RELEASES_URL = "https://github.com/wedoso/Vibloom/releases/latest";
const LATEST_RELEASE_API = "https://api.github.com/repos/wedoso/Vibloom/releases/latest";

export type UpdateState = {
  status: "idle" | "checking" | "available" | "downloading" | "downloaded" | "current" | "error";
  currentVersion: string;
  availableVersion?: string;
  progress?: number;
  message?: string;
};

type DesktopUpdates = {
  check: () => Promise<void>;
  download: () => Promise<void>;
  install: () => Promise<void>;
  openReleases: () => Promise<void>;
  subscribe: (listener: (state: UpdateState) => void) => () => void;
};

declare global {
  interface Window {
    vibloomUpdates?: DesktopUpdates;
  }
}

const initialState: UpdateState = { status: "idle", currentVersion: APP_VERSION };

export default function UpdateControl() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<UpdateState>(initialState);
  const desktopUpdates = window.vibloomUpdates;

  useEffect(() => desktopUpdates?.subscribe(setState), [desktopUpdates]);

  const check = useCallback(async () => {
    setOpen(true);
    if (desktopUpdates) {
      await desktopUpdates.check();
      return;
    }
    setState({ status: "checking", currentVersion: APP_VERSION });
    try {
      const response = await fetch(LATEST_RELEASE_API, { headers: { Accept: "application/vnd.github+json" } });
      if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
      const release = await response.json() as { tag_name?: string; html_url?: string };
      if (!release.tag_name) throw new Error("The latest release has no version tag.");
      setState({
        status: isNewerVersion(release.tag_name, APP_VERSION) ? "available" : "current",
        currentVersion: APP_VERSION,
        availableVersion: release.tag_name.replace(/^v/u, ""),
      });
    } catch (error) {
      setState({ status: "error", currentVersion: APP_VERSION, message: error instanceof Error ? error.message : "Update check failed." });
    }
  }, [desktopUpdates]);

  const openRelease = useCallback(() => {
    if (desktopUpdates) void desktopUpdates.openReleases();
    else window.location.assign(RELEASES_URL);
  }, [desktopUpdates]);

  const busy = state.status === "checking" || state.status === "downloading";
  const title = state.status === "available" ? `Vibloom ${state.availableVersion} is available` : state.status === "downloaded" ? "Update ready to install" : state.status === "current" ? "Vibloom is up to date" : state.status === "error" ? "Could not check for updates" : state.status === "downloading" ? "Downloading update" : state.status === "checking" ? "Checking for updates" : "Check for updates";

  return (
    <div className="update-control">
      <button className="brand-version" type="button" aria-label={`Vibloom version ${APP_VERSION}. Check for updates`} onClick={() => void check()}>
        v{APP_VERSION}<RefreshCw size={9} />
      </button>
      {open && <div className="update-backdrop" onClick={() => !busy && setOpen(false)}>
        <section className="update-dialog" role="dialog" aria-modal="true" aria-labelledby="update-title" onClick={(event) => event.stopPropagation()}>
          <button className="update-close" type="button" aria-label="Close update window" disabled={busy} onClick={() => setOpen(false)}><X size={17} /></button>
          <span className={`update-orb is-${state.status}`}>
            {busy ? <LoaderCircle size={24} /> : state.status === "downloaded" ? <Download size={23} /> : state.status === "current" ? <Check size={23} /> : <RefreshCw size={22} />}
          </span>
          <p>VIBLOOM UPDATE</p>
          <h2 id="update-title">{title}</h2>
          <span className="update-versions">Installed <strong>v{state.currentVersion}</strong>{state.availableVersion && state.status !== "current" ? <> · Latest <strong>v{state.availableVersion}</strong></> : null}</span>
          {state.status === "idle" && <small>Check GitHub Releases for a newer signed version of Vibloom.</small>}
          {state.status === "checking" && <small>This usually takes only a few seconds.</small>}
          {state.status === "current" && <small>You already have the latest published version.</small>}
          {state.status === "available" && <small>{desktopUpdates ? "Download in the background, then restart when you are ready." : "Open the latest release to download the desktop installer."}</small>}
          {state.status === "downloading" && <div className="update-progress"><i><b style={{ width: `${Math.max(2, state.progress ?? 0)}%` }} /></i><span>{Math.round(state.progress ?? 0)}%</span></div>}
          {state.status === "downloaded" && <small>Vibloom will close briefly and reopen on the new version.</small>}
          {state.status === "error" && <small>{state.message || "Please try again or open the Releases page."}</small>}
          <div className="update-actions">
            {(state.status === "idle" || state.status === "current" || state.status === "error") && <button type="button" onClick={() => void check()} disabled={busy}><RotateCw size={14} /> Check again</button>}
            {state.status === "available" && desktopUpdates && <button className="is-primary" type="button" onClick={() => void desktopUpdates.download()}><Download size={15} /> Download update</button>}
            {state.status === "available" && !desktopUpdates && <button className="is-primary" type="button" onClick={openRelease}><Download size={15} /> Download latest</button>}
            {state.status === "downloaded" && desktopUpdates && <button className="is-primary" type="button" onClick={() => void desktopUpdates.install()}><RotateCw size={15} /> Restart and install</button>}
            {(state.status === "error" || state.status === "current") && <button type="button" onClick={openRelease}><ExternalLink size={14} /> Releases</button>}
          </div>
        </section>
      </div>}
    </div>
  );
}
