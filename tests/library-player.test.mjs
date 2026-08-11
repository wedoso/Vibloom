import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("ships the local library as the primary application", async () => {
  const [main, app, engine, styles] = await Promise.all([
    readFile(new URL("src/main.tsx", root), "utf8"),
    readFile(new URL("src/LibraryApp.tsx", root), "utf8"),
    readFile(new URL("src/audio/SynchronizedAudioEngine.ts", root), "utf8"),
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
  assert.match(engine, /createBufferSource/u);
  assert.match(engine, /source\.start\(when, Math\.max\(0, offset\)\)/u);
  assert.doesNotMatch(app, /new Audio\(\)/u);
  assert.match(engine, /linearRampToValueAtTime/u);
  assert.match(app, /Add version B/u);
  assert.match(app, /PrecisionWaveform/u);
  assert.match(app, /className="waveform-seek"/u);
  assert.match(app, /beginWaveformScrub/u);
  assert.match(app, /finishWaveformScrub/u);
  assert.match(app, /comparison-status-lane/u);
  assert.match(app, /preloadingTrackIdRef/u);
  assert.match(app, /startTrack\(trackId, false, session\.currentTime\)/u);
  assert.match(app, /window\.addEventListener\("keydown"/u);
  assert.match(app, /Exit focus mode/u);
  assert.doesNotMatch(app, /className="shared-timeline"/u);
  assert.match(styles, /grid-template-columns/u);
  assert.match(styles, /@media \(max-width: 680px\)/u);
  assert.match(styles, /prefers-reduced-motion/u);
});

test("keeps playback and Hiyori inside one player-first shell", async () => {
  const [app, stage, spec, libraryStyles, stageStyles] = await Promise.all([
    readFile(new URL("src/LibraryApp.tsx", root), "utf8"),
    readFile(new URL("src/Live2DStage.tsx", root), "utf8"),
    readFile(new URL("docs/library-player.md", root), "utf8"),
    readFile(new URL("src/library.css", root), "utf8"),
    readFile(new URL("src/index.css", root), "utf8"),
  ]);

  assert.match(app, /changeWorkspace\("player"\)/u);
  assert.match(app, /changeWorkspace\("library"\)/u);
  assert.doesNotMatch(app, /audioRef\.current\?\.pause\(\);\s*setWorkspace/u);
  assert.match(app, /<Live2DStage containModel layoutKey=/u);
  assert.match(stage, /containModelRef/u);
  assert.match(stage, /cameraPreset/u);
  assert.match(stage, /const PORTRAIT_ZOOM = 1\.92/u);
  assert.match(stage, /const FULL_BODY_SAFE_ZOOM = 1\.62/u);
  assert.match(stage, /const FULL_BODY_RENDER_ZOOM = 1\.4/u);
  assert.match(stage, /const WIDE_ZOOM = 1\.18/u);
  assert.match(stage, /HIGH_ZOOM_SAFE_OFFSET_FACTOR = 0\.5/u);
  assert.match(stage, /function portraitOffsetForZoom/u);
  assert.match(stage, /function renderZoomForFraming/u);
  assert.match(stage, /const portraitProgress = Math\.max\(0, Math\.min\(1,/u);
  assert.match(stage, /startsInPortrait \? "portrait" : "director"/u);
  assert.match(stage, /FOCUS_MODEL_HEIGHT_FACTOR = 0\.84/u);
  assert.match(stage, /FOCUS_VIEWPORT_HEIGHT_FACTOR = 0\.72/u);
  assert.match(stage, /FOCUS_RIG_Y_FACTOR = 0\.65/u);
  assert.match(stage, /LIBRARY_PORTRAIT_OFFSET_FACTOR = 0\.1/u);
  assert.match(stage, /ROOM_PORTRAIT_OFFSET_FACTOR = 0\.18/u);
  assert.match(stage, /DISC_MODEL_CENTER_OFFSET_FACTOR = 0\.1/u);
  assert.match(stage, /DISC_ZOOM_CENTER_OFFSET_FACTOR = 0\.09/u);
  assert.match(stage, /window\.innerHeight \* FOCUS_VIEWPORT_HEIGHT_FACTOR/u);
  assert.match(stage, /containModelRef\.current[\s\S]*LIBRARY_PORTRAIT_OFFSET_FACTOR/u);
  assert.match(stage, /const isCompact = window\.innerWidth < 600/u);
  assert.match(stage, /--stage-model-width/u);
  assert.match(stage, /--stage-subject-y/u);
  assert.match(stage, /stage-disc-viewport/u);
  assert.match(stageStyles, /\.live2d-stage-player \.stage-disc-viewport \{[\s\S]*mask-image: linear-gradient\(to right/u);
  assert.match(libraryStyles, /\.comparison-deck\.is-solo/u);
  assert.match(libraryStyles, /\.unified-shell\.is-player-shell\.is-solo-player/u);
  assert.match(libraryStyles, /comparison-card-enter/u);
  assert.match(libraryStyles, /\.solo-track-context/u);
  assert.match(stage, /tallViewportProgress = Math\.max\(0, Math\.min\(1, \(window\.innerHeight - 720\) \/ 600\)\)/u);
  assert.match(stage, /roomRigYFactor = 0\.62 - tallViewportProgress \* \(containModelRef\.current \? 0\.18 : 0\.04\)/u);
  assert.match(stage, /targetRigX = host\.clientWidth \* \(isWelcome && !isCompact \? 0\.52 : 0\.5\)/u);
  assert.match(stage, /targetRigY = host\.clientHeight \* \(isWelcome \? 0\.52 : focused \? FOCUS_RIG_Y_FACTOR : roomRigYFactor\)/u);
  assert.match(stage, /manualZoomRef\.current = WIDE_ZOOM/u);
  assert.match(libraryStyles, /\.library-app\.is-empty \.library-status \{ bottom: 28px; \}/u);
  assert.match(libraryStyles, /\.is-player-shell \.persistent-stage-panel \{[^}]*padding: 18px 18px 12px;/u);
  assert.match(libraryStyles, /\.library-app\.is-library-focus \.persistent-stage-panel \{ padding: 24px 24px 12px;/u);
  assert.match(libraryStyles, /\.library-app\.is-library-focus \.library-transport \{ grid-row: 2; \}/u);
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
  const [app, platform, domain, spec] = await Promise.all([
    readFile(new URL("src/LibraryApp.tsx", root), "utf8"),
    readFile(new URL("src/platform/browserLibraryPlatform.ts", root), "utf8"),
    readFile(new URL("src/domain/library.ts", root), "utf8"),
    readFile(new URL("docs/library-player.md", root), "utf8"),
  ]);

  assert.match(platform, /indexedDB\.open/u);
  assert.match(platform, /navigator\.storage\.getDirectory/u);
  assert.match(platform, /removeEntry\(OPFS_TRACKS_DIR, \{ recursive: true \}\)/u);
  assert.match(domain, /cacheEnabled: true/u);
  assert.match(domain, /comparisonCacheKey/u);
  assert.match(app, /Automatically keep new music/u);
  assert.match(app, /Version B is synchronized and kept for your next visit/u);
  assert.match(domain, /normalizeFileName\(file\.name\)/u);
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
  const [app, domain, styles] = await Promise.all([
    readFile(new URL("src/LibraryApp.tsx", root), "utf8"),
    readFile(new URL("src/domain/library.ts", root), "utf8"),
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
  assert.match(domain, /comparison: TrackComparison \| null/u);
  assert.match(domain, /--version-b/u);
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
