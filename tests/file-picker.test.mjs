import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "./load-ts.mjs";

const { filePickerPolicy } = await loadTs("../src/platform/filePickerPolicy.ts");
const iphone = version => ({
  userAgent: `Mozilla/5.0 (iPhone; CPU iPhone OS ${version} like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1`,
  platform: "iPhone", maxTouchPoints: 5,
});

test("iOS can browse cloud files without media filters, with directories from 18.4", () => {
  for (const [version, supported] of [["17_7", false], ["18_3", false], ["18_4", true], ["18_6", true], ["26_0", true]]) {
    const policy = filePickerPolicy(iphone(version), true);
    assert.equal(policy.isIOS, true);
    assert.equal(policy.supportsDirectories, supported, version);
    assert.equal(policy.libraryAccept, undefined);
    assert.equal(policy.audioAccept, undefined);
    assert.equal(policy.lyricsAccept, undefined);
  }
  assert.equal(filePickerPolicy(iphone("26_0"), false).supportsDirectories, false);
});

test("iPad desktop mode uses Safari version and handles missing version conservatively", () => {
  for (const [version, supported] of [["18.3", false], ["18.4", true], ["26.0", true]]) {
    const policy = filePickerPolicy({
      userAgent: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/${version} Safari/605.1.15`,
      platform: "MacIntel", maxTouchPoints: 5,
    }, true);
    assert.equal(policy.isIOS, true);
    assert.equal(policy.supportsDirectories, supported);
    assert.equal(policy.audioAccept, undefined);
  }
  assert.equal(filePickerPolicy({ userAgent: "iPad", platform: "iPad", maxTouchPoints: 5 }, true).supportsDirectories, false);
});

test("desktop retains main's exact filters and directory behavior", () => {
  const desktop = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Version/26.0 Safari/605.1.15", platform: "MacIntel", maxTouchPoints: 0 };
  const policy = filePickerPolicy(desktop, true);
  assert.equal(policy.isIOS, false);
  assert.equal(policy.supportsDirectories, true);
  assert.equal(policy.audioAccept, "audio/*,.flac,.aiff,.aif");
  assert.equal(policy.libraryAccept, "audio/*,.flac,.aiff,.aif,.lrc,.txt");
  assert.equal(policy.lyricsAccept, ".lrc,.txt,text/plain");
  // Main always enables the directory input outside iOS.
  assert.equal(filePickerPolicy(desktop, false).supportsDirectories, true);
});

test("Chrome on iOS receives the same Files workaround and OS-dependent directory support", () => {
  for (const [version, supported] of [["18_3", false], ["18_6", true], ["26_0", true]]) {
    const browser = iphone(version);
    browser.userAgent = browser.userAgent.replace("Version/18.0", "CriOS/141.0.0.0");
    const policy = filePickerPolicy(browser, true);
    assert.equal(policy.isIOS, true);
    assert.equal(policy.supportsDirectories, supported);
    assert.equal(policy.libraryAccept, undefined);
  }
});
