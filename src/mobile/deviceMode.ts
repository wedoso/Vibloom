export type DeviceSignals = {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  coarsePointer: boolean;
  canHover: boolean;
  viewportWidth: number;
  desktopBridge: boolean;
  protocol: string;
  override?: string | null;
};

/** Choose once at boot; rotating or resizing must never unmount a playing app. */
export function deviceMode(signals: DeviceSignals): "desktop" | "mobile" {
  if (signals.desktopBridge || signals.protocol === "vibloom:" || /Electron\//u.test(signals.userAgent)) return "desktop";
  if (signals.override === "desktop" || signals.override === "mobile") return signals.override;
  if (/iPhone|iPad|iPod|Android/u.test(signals.userAgent)
    || (signals.platform === "MacIntel" && signals.maxTouchPoints > 1)) return "mobile";
  // Touch laptops retain the desktop UI, even in a narrow window.
  if (/Windows|Macintosh|CrOS|X11/u.test(signals.userAgent)) return "desktop";
  return signals.coarsePointer && !signals.canHover && signals.viewportWidth <= 1100 ? "mobile" : "desktop";
}
