import { startOfflineApp } from "./platform/offlineApp";
import { deviceMode } from "./mobile/deviceMode";

const mode = deviceMode({
  userAgent: navigator.userAgent,
  platform: navigator.platform,
  maxTouchPoints: navigator.maxTouchPoints,
  coarsePointer: window.matchMedia("(pointer: coarse)").matches,
  canHover: window.matchMedia("(hover: hover)").matches,
  viewportWidth: window.innerWidth,
  desktopBridge: !!window.vibloomUpdates,
  protocol: window.location.protocol,
  override: new URLSearchParams(window.location.search).get("ui"),
});

// Neither the desktop stylesheet nor its UI loads in the mobile branch.
const entry = mode === "mobile" ? import("./mobile/main") : import("./main");
void entry.catch((error: unknown) => {
  const root = document.getElementById("root");
  if (root) {
    root.textContent = "Vibloom could not load. Please reload this page.";
    root.setAttribute("role", "alert");
  }
  console.error(error);
});

void entry.then(() => startOfflineApp()).catch(() => {});
