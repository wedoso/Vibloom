import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("ships the local library as the primary application", async () => {
  const [main, app, styles] = await Promise.all([
    readFile(new URL("src/main.tsx", root), "utf8"),
    readFile(new URL("src/LibraryApp.tsx", root), "utf8"),
    readFile(new URL("src/library.css", root), "utf8"),
  ]);

  assert.match(main, /import LibraryApp from "\.\/LibraryApp"/u);
  assert.match(main, /<LibraryApp \/>/u);
  assert.match(app, /multiple hidden/u);
  assert.match(app, /folderInput\.webkitdirectory = true/u);
  assert.match(app, /createShuffleBag/u);
  assert.doesNotMatch(app, /ComparisonApp/u);
  assert.match(app, /const \[workspace, setWorkspace\]/u);
  assert.match(app, /persistent-stage-panel/u);
  assert.match(app, /ensureAudioGraph/u);
  assert.match(app, /createBufferSource/u);
  assert.match(app, /source\.start\(when, Math\.max\(0, offset\)\)/u);
  assert.doesNotMatch(app, /new Audio\(\)/u);
  assert.match(app, /linearRampToValueAtTime/u);
  assert.match(app, /Add version B/u);
  assert.match(app, /PrecisionWaveform/u);
  assert.match(app, /window\.addEventListener\("keydown"/u);
  assert.match(app, /Exit focus mode/u);
  assert.doesNotMatch(app, /className="shared-timeline"/u);
  assert.match(styles, /grid-template-columns/u);
  assert.match(styles, /@media \(max-width: 680px\)/u);
  assert.match(styles, /prefers-reduced-motion/u);
});

test("keeps playback and Hiyori inside one player-first shell", async () => {
  const [app, stage, spec] = await Promise.all([
    readFile(new URL("src/LibraryApp.tsx", root), "utf8"),
    readFile(new URL("src/Live2DStage.tsx", root), "utf8"),
    readFile(new URL("docs/library-player.md", root), "utf8"),
  ]);

  assert.match(app, /changeWorkspace\("player"\)/u);
  assert.match(app, /changeWorkspace\("library"\)/u);
  assert.doesNotMatch(app, /audioRef\.current\?\.pause\(\);\s*setWorkspace/u);
  assert.match(app, /<Live2DStage containModel layoutKey=/u);
  assert.match(stage, /containModelRef/u);
  assert.match(stage, /cameraPreset/u);
  assert.match(stage, /const PORTRAIT_ZOOM = 1\.92/u);
  assert.match(stage, /startsInPortrait \? "portrait" : "director"/u);
  assert.match(stage, /FOCUS_MODEL_HEIGHT_FACTOR = 0\.84/u);
  assert.match(stage, /FOCUS_VIEWPORT_HEIGHT_FACTOR = 0\.72/u);
  assert.match(stage, /LIBRARY_PORTRAIT_OFFSET_FACTOR = 0\.1/u);
  assert.match(stage, /ROOM_PORTRAIT_OFFSET_FACTOR = 0\.18/u);
  assert.match(stage, /DISC_MODEL_CENTER_OFFSET_FACTOR = 0\.1/u);
  assert.match(stage, /DISC_ZOOM_CENTER_OFFSET_FACTOR = 0\.09/u);
  assert.match(stage, /window\.innerHeight \* FOCUS_VIEWPORT_HEIGHT_FACTOR/u);
  assert.match(stage, /containModelRef\.current[\s\S]*LIBRARY_PORTRAIT_OFFSET_FACTOR/u);
  assert.match(stage, /const isCompact = window\.innerWidth < 600/u);
  assert.match(stage, /--stage-model-width/u);
  assert.match(stage, /--stage-subject-y/u);
  assert.match(stage, /tallViewportProgress = Math\.max\(0, Math\.min\(1, \(window\.innerHeight - 720\) \/ 600\)\)/u);
  assert.match(stage, /roomRigYFactor = 0\.62 - tallViewportProgress \* \(containModelRef\.current \? 0\.18 : 0\.12\)/u);
  assert.match(stage, /targetRigY = host\.clientHeight \* \(focused \? 0\.58 : roomRigYFactor\)/u);
  assert.match(spec, /never remount/u);
});

test("attaches or replaces timestamped LRC lyrics per track", async () => {
  const app = await readFile(new URL("src/LibraryApp.tsx", root), "utf8");

  assert.match(app, /ref=\{lyricsInputRef\}/u);
  assert.match(app, /accept="\.lrc,text\/plain"/u);
  assert.match(app, /openLyricsPicker\(track\.id\)/u);
  assert.match(app, /Attach lyrics \(\.lrc\)/u);
  assert.match(app, /Replace lyrics \(\.lrc\)/u);
  assert.match(app, /Remove lyrics/u);
  assert.match(app, /lyrics: parsed\.lines/u);
  assert.match(app, /lyricsFileName: file\.name/u);
  assert.match(app, /lyrics: \[\],[\s\S]*lyricsFileName: ""/u);
  assert.match(app, /viewport\.scrollTo/u);
  assert.match(app, /--lyric-progress/u);
  assert.match(app, /lines\.map\(\(line, index\)/u);
});

test("covers camera-layout changes and animates persistent side sheets", async () => {
  const [app, libraryStyles, baseStyles] = await Promise.all([
    readFile(new URL("src/LibraryApp.tsx", root), "utf8"),
    readFile(new URL("src/library.css", root), "utf8"),
    readFile(new URL("src/index.css", root), "utf8"),
  ]);

  assert.match(app, /withSceneTransition/u);
  assert.match(app, /flushSync\(update\)/u);
  assert.match(app, /await withSceneTransition\(commitImport, "enter"\)/u);
  assert.match(app, /webkitGetAsEntry/u);
  assert.match(app, /filesFromDroppedEntry/u);
  assert.match(app, /"workspace-player" \| "workspace-library" \| "focus-enter" \| "focus-exit"/u);
  assert.match(app, /toggleFocusMode\(\)/u);
  assert.match(app, /<span>Exit focus<\/span><kbd>Esc<\/kbd>/u);
  assert.match(baseStyles, /data-scene-transition="workspace-library"/u);
  assert.match(libraryStyles, /side-sheet-backdrop:not\(\.is-open\)[\s\S]*display: grid/u);
  assert.match(libraryStyles, /translate3d\(105%, 0, 0\)/u);
  assert.match(libraryStyles, /\.track-availability[\s\S]*min-width: 68px[\s\S]*height: 24px/u);
  assert.match(libraryStyles, /\.track-feature-icons > span[\s\S]*width: 24px[\s\S]*height: 24px/u);
  assert.match(libraryStyles, /\.library-list-toolbar > div button[\s\S]*width: 88px[\s\S]*height: 32px/u);
  assert.match(libraryStyles, /\.library-lyrics-label button[\s\S]*width: 72px[\s\S]*height: 24px/u);
  assert.match(libraryStyles, /--lyrics-accent: rgb\(84 127 121\)/u);
  assert.match(libraryStyles, /lyrics-source-b \{ --lyrics-accent: rgb\(200 95 109\)/u);
  assert.match(app, /waveform-source-\$\{source === 0 \? "a" : "b"\}/u);
  assert.match(libraryStyles, /waveform-source-a \{ --waveform-rgb: 84 127 121/u);
  assert.match(libraryStyles, /waveform-source-b \{ --waveform-rgb: 200 95 109/u);
  assert.match(libraryStyles, /\.waveform-bars i[\s\S]*background: rgb\(var\(--waveform-rgb\)\)/u);
  assert.match(libraryStyles, /\.waveform-played[\s\S]*background: rgb\(var\(--waveform-rgb\) \/ \.2\)/u);
  assert.match(baseStyles, /--font-ui:[\s\S]*PingFang SC[\s\S]*Hiragino Sans[\s\S]*Yu Gothic/u);
  assert.match(app, /layoutKey=\{`\$\{workspace\}:\$\{focusMode \? "focus" : "room"\}`\}/u);
});

test("persists only intentional local state and supports recoverable clearing", async () => {
  const [app, store, spec] = await Promise.all([
    readFile(new URL("src/LibraryApp.tsx", root), "utf8"),
    readFile(new URL("src/libraryStore.ts", root), "utf8"),
    readFile(new URL("docs/library-player.md", root), "utf8"),
  ]);

  assert.match(store, /indexedDB\.open/u);
  assert.match(store, /navigator\.storage\.getDirectory/u);
  assert.match(store, /removeEntry\(OPFS_TRACKS_DIR, \{ recursive: true \}\)/u);
  assert.match(store, /cacheEnabled: true/u);
  assert.match(store, /comparisonCacheKey/u);
  assert.match(app, /Automatically keep new music/u);
  assert.match(app, /Version B is synchronized and kept for your next visit/u);
  assert.match(store, /normalizeFileName\(file\.name\)/u);
  assert.match(app, /Clear queue only/u);
  assert.match(app, /Clear cached audio/u);
  assert.match(app, /Reset Vibloom/u);
  assert.match(spec, /Chrome/u);
  assert.match(spec, /Safari/u);
  assert.match(spec, /Firefox/u);
});

test("reconnect preserves queue identity and missing tracks are skippable", async () => {
  const app = await readFile(new URL("src/LibraryApp.tsx", root), "utf8");

  assert.match(app, /reconnected without changing the queue/u);
  assert.match(app, /availability: "missing"/u);
  assert.match(app, /availability === "session"/u);
  assert.match(app, /Queue complete\. Reconnect any unavailable tracks/u);
  assert.doesNotMatch(app, /queue: remaining/u);
});

test("completes the progressive A/B comparison workflow", async () => {
  const [app, store, styles] = await Promise.all([
    readFile(new URL("src/LibraryApp.tsx", root), "utf8"),
    readFile(new URL("src/libraryStore.ts", root), "utf8"),
    readFile(new URL("src/library.css", root), "utf8"),
  ]);

  assert.match(app, /readAudioFile/u);
  assert.match(app, /loadStage: "reading"/u);
  assert.match(app, /loadStage: "decoding"/u);
  assert.match(app, /loadStage: "caching"/u);
  assert.match(app, /formatBytes\(compareSlot\.size\)/u);
  assert.match(app, /Replace version B/u);
  assert.match(app, /handleComparisonDrop/u);
  assert.match(app, /Different lengths/u);
  assert.match(app, /ended at[\s\S]*Switch source to hear the remaining audio/u);
  assert.match(app, /Back 5 seconds/u);
  assert.match(app, /Forward 5 seconds/u);
  assert.doesNotMatch(app, /Focus comparison waveforms/u);
  assert.match(app, /comparisonCacheKey\(track\.id\)/u);
  assert.match(app, /has-version-b/u);
  assert.match(store, /comparison: TrackComparison \| null/u);
  assert.match(store, /--version-b/u);
  assert.doesNotMatch(styles, /\.focus-compare-waveforms/u);
  assert.match(styles, /\.transport-ab-switch[\s\S]*border-radius: 999px/u);
  assert.match(styles, /\.transport-ab-switch\.is-source-b::before[\s\S]*translateX\(34px\)/u);
  assert.match(styles, /\.transport-secondary \.transport-ab-switch button[\s\S]*place-items: center/u);
  assert.match(styles, /\.focus-exit-control kbd[\s\S]*border-radius: 999px/u);
  assert.match(styles, /\.is-library-shell \.persistent-stage-canvas \.camera-capsule/u);
  assert.match(styles, /\.is-library-shell \.persistent-stage-canvas \.camera-capsule button[\s\S]*width: 34px/u);
  assert.match(styles, /\.is-library-shell \.persistent-stage-canvas \.camera-capsule button span \{ display: none; \}/u);
  assert.match(styles, /\.comparison-duration-alert/u);
});
