import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "./load-ts.mjs";

const { deviceMode } = await loadTs("../src/mobile/deviceMode.ts");
const desktop = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Safari/605.1.15", platform: "MacIntel", maxTouchPoints: 0, coarsePointer: false, canHover: true, viewportWidth: 1440, desktopBridge: false, protocol: "https:" };

test("narrow desktop windows and touch laptops retain the existing UI", () => {
  assert.equal(deviceMode({ ...desktop, viewportWidth: 320 }), "desktop");
  assert.equal(deviceMode({ ...desktop, userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", platform: "Win32", maxTouchPoints: 10, coarsePointer: true, canHover: false, viewportWidth: 360 }), "desktop");
});
test("iPhone Safari, iPhone Chrome, Android and iPad desktop mode select mobile", () => {
  for (const userAgent of ["iPhone OS 18_6 Safari/604.1", "iPhone OS 18_6 CriOS/141.0", "Android 16; Pixel Chrome/141.0"]) {
    assert.equal(deviceMode({ ...desktop, userAgent }), "mobile", userAgent);
  }
  assert.equal(deviceMode({ ...desktop, maxTouchPoints: 5, viewportWidth: 1024 }), "mobile");
});
test("Electron always stays desktop even with a mobile override or emulated device", () => {
  for (const hint of [{ desktopBridge: true }, { protocol: "vibloom:" }, { userAgent: "Electron/43.3.0" }]) {
    assert.equal(deviceMode({ ...desktop, userAgent: "iPhone", override: "mobile", ...hint }), "desktop");
  }
});
test("unknown touch devices use capability fallback; explicit browser preference wins", () => {
  assert.equal(deviceMode({ ...desktop, userAgent: "UnknownBrowser", platform: "", coarsePointer: true, canHover: false, maxTouchPoints: 5, viewportWidth: 430 }), "mobile");
  assert.equal(deviceMode({ ...desktop, userAgent: "iPhone", override: "desktop" }), "desktop");
  assert.equal(deviceMode({ ...desktop, override: "mobile" }), "mobile");
});
