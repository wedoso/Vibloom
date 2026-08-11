import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const root = new URL("../", import.meta.url);

async function importTypeScriptModule(url) {
  const source = await readFile(url, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}

test("migrates legacy library snapshots at the domain boundary", async () => {
  const { migrateLibrarySnapshot } = await importTypeScriptModule(new URL("src/domain/library.ts", root));
  const migrated = migrateLibrarySnapshot({
    version: 1,
    tracks: [{ id: "track-1", comparison: undefined }],
    session: { queue: ["track-1"], volume: 0.5 },
  });

  assert.equal(migrated.version, 2);
  assert.equal(migrated.session.cacheEnabled, true);
  assert.equal(migrated.session.volume, 0.5);
  assert.deepEqual(migrated.session.history, []);
  assert.equal(migrated.tracks[0].comparison, null);
});

test("keeps browser APIs behind the replaceable platform boundary", async () => {
  const [app, contract, browser] = await Promise.all([
    readFile(new URL("src/LibraryApp.tsx", root), "utf8"),
    readFile(new URL("src/platform/libraryPlatform.ts", root), "utf8"),
    readFile(new URL("src/platform/browserLibraryPlatform.ts", root), "utf8"),
  ]);

  assert.match(app, /platform = browserLibraryPlatform/u);
  assert.match(app, /platform\.repository\.load\(\)/u);
  assert.match(app, /platform\.audioFiles\.put/u);
  assert.doesNotMatch(app, /indexedDB\.open|navigator\.storage/u);
  assert.match(contract, /interface LibraryRepository/u);
  assert.match(contract, /interface AudioFileStore/u);
  assert.match(browser, /indexedDB\.open/u);
  assert.match(browser, /navigator\.storage\.getDirectory/u);
});

test("schedules A and B against one clock and preserves the pause position", async () => {
  const { SynchronizedAudioEngine } = await importTypeScriptModule(new URL("src/audio/SynchronizedAudioEngine.ts", root));
  const starts = [];
  const ramps = [];
  const stopped = [];

  class FakeParam {
    value = 0;
    cancelScheduledValues() {}
    setValueAtTime(value) { this.value = value; }
    linearRampToValueAtTime(value, time) { this.value = value; ramps.push({ value, time }); }
    setTargetAtTime(value) { this.value = value; }
  }
  class FakeNode {
    connect() { return this; }
    disconnect() {}
  }
  class FakeAnalyser extends FakeNode {
    fftSize = 0;
    smoothingTimeConstant = 0;
    frequencyBinCount = 512;
  }
  class FakeGain extends FakeNode { gain = new FakeParam(); }
  class FakeSource extends FakeNode {
    buffer = null;
    onended = null;
    start(when, offset) { starts.push({ when, offset, duration: this.buffer.duration }); }
    stop() { stopped.push(this.buffer.duration); }
  }
  class FakeContext {
    currentTime = 10;
    state = "running";
    destination = new FakeNode();
    createAnalyser() { return new FakeAnalyser(); }
    createGain() { return new FakeGain(); }
    createBufferSource() { return new FakeSource(); }
    async resume() { this.state = "running"; }
    async close() { this.state = "closed"; }
  }

  const context = new FakeContext();
  const engine = new SynchronizedAudioEngine(() => context);
  engine.setBuffer(0, { duration: 120 });
  engine.setBuffer(1, { duration: 90 });

  assert.equal(await engine.play(5, 0.025, 0.9), true);
  assert.deepEqual(starts, [
    { when: 10.025, offset: 5, duration: 120 },
    { when: 10.025, offset: 5, duration: 90 },
  ]);

  context.currentTime = 12.025;
  assert.equal(engine.getTimelineTime(), 7);
  assert.equal(engine.selectSource(1, 0.018), true);
  assert.deepEqual(ramps.map(({ value, time }) => ({ value, time: Number(time.toFixed(3)) })), [
    { value: 0, time: 12.043 },
    { value: 1, time: 12.043 },
  ]);

  assert.equal(engine.pause(), 7);
  context.currentTime = 20;
  assert.equal(engine.getTimelineTime(), 7);
  assert.deepEqual(stopped, [120, 90]);
});

test("keeps the desktop renderer sandboxed and packages both operating systems", async () => {
  const [main, packageJson, workflow, releaseWorkflow, releaseConfig, releaseManifest] = await Promise.all([
    readFile(new URL("desktop/main.mjs", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
    readFile(new URL(".github/workflows/desktop-release.yml", root), "utf8"),
    readFile(new URL(".github/workflows/release-please.yml", root), "utf8"),
    readFile(new URL("release-please-config.json", root), "utf8"),
    readFile(new URL(".release-please-manifest.json", root), "utf8"),
  ]);

  assert.match(main, /registerSchemesAsPrivileged/u);
  assert.match(main, /standard: true/u);
  assert.match(main, /secure: true/u);
  assert.match(main, /contextIsolation: true/u);
  assert.match(main, /nodeIntegration: false/u);
  assert.match(main, /sandbox: true/u);
  assert.match(main, /setPermissionRequestHandler/u);
  assert.match(main, /setWindowOpenHandler\(\(\) => \(\{ action: "deny" \}\)\)/u);
  assert.match(main, /state\.appVersion !== `v\$\{app\.getVersion\(\)\}`/u);
  assert.doesNotMatch(main, /shell\.openExternal|contextBridge|ipcRenderer/u);

  const manifest = JSON.parse(packageJson);
  assert.equal(manifest.main, "desktop/main.mjs");
  assert.deepEqual(manifest.build.mac.target, ["dmg", "zip"]);
  assert.equal(manifest.build.mac.hardenedRuntime, true);
  assert.equal(manifest.build.mac.notarize, true);
  assert.equal(manifest.build.mac.strictVerify, true);
  assert.equal(manifest.build.mac.entitlements, "build/entitlements.mac.plist");
  assert.equal(manifest.build.mac.entitlementsInherit, "build/entitlements.mac.inherit.plist");
  assert.deepEqual(manifest.build.win.target, ["nsis"]);
  assert.match(workflow, /macos-14/u);
  assert.match(workflow, /macOS Apple Silicon/u);
  assert.match(workflow, /macOS Intel/u);
  assert.match(workflow, /--mac --arm64/u);
  assert.match(workflow, /--mac --x64/u);
  assert.match(workflow, /windows-latest/u);
  assert.match(workflow, /xvfb-run --auto-servernum env VIBLOOM_SMOKE_TEST=1 npx electron --no-sandbox \./u);
  assert.match(workflow, /actions\/upload-artifact@v4/u);
  assert.match(workflow, /gh release create/u);
  assert.match(workflow, /--publish never/u);
  assert.match(workflow, /forceCodeSigning=true/u);
  assert.match(workflow, /Require macOS signing and notarization credentials/u);
  assert.match(workflow, /codesign --verify --deep --strict/u);
  assert.match(workflow, /xcrun stapler validate/u);
  assert.match(workflow, /spctl --assess --type execute/u);
  assert.match(workflow, /Vibloom-\$\{\{ matrix\.platform \}\}-\$\{\{ matrix\.arch \}\}/u);
  assert.match(workflow, /inputs\.release_tag/u);
  assert.match(releaseWorkflow, /googleapis\/release-please-action@v4/u);
  assert.match(releaseWorkflow, /token: \$\{\{ secrets\.RELEASE_PLEASE_TOKEN \}\}/u);
  assert.match(releaseWorkflow, /Explain required release token/u);
  assert.match(releaseWorkflow, /branches: \[main\]/u);
  const release = JSON.parse(releaseConfig);
  const versions = JSON.parse(releaseManifest);
  assert.equal(release["release-type"], "node");
  assert.equal(release["include-component-in-tag"], false);
  assert.equal(release["include-v-in-tag"], true);
  assert.equal(release.packages["."]["package-name"], "vibloom");
  assert.equal(versions["."], manifest.version);
});

test("keeps macOS playback alive when the last window is closed", async () => {
  const desktopMain = await readFile(new URL("desktop/main.mjs", root), "utf8");
  assert.match(desktopMain, /window\.on\("close", \(event\) => \{/u);
  assert.match(desktopMain, /process\.platform !== "darwin" \|\| isQuitting \|\| SMOKE_TEST/u);
  assert.match(desktopMain, /event\.preventDefault\(\);\s*window\.hide\(\);/u);
  assert.match(desktopMain, /app\.on\("before-quit"/u);
  assert.match(desktopMain, /backgroundThrottling: false/u);
  assert.match(desktopMain, /VIBLOOM_BACKGROUND_READY/u);
  assert.match(desktopMain, /window\.isDestroyed\(\) \|\| window\.isVisible\(\) \|\| after <= before/u);
  assert.match(desktopMain, /mainWindow\.show\(\);\s*mainWindow\.focus\(\);/u);
});
