import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const dist = new URL("../dist/", import.meta.url);

async function importTypeScriptModule(url) {
  const source = await readFile(url, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}

test("parses multilingual, offset, repeated, and UTF-16 LRC lyrics", async () => {
  const { decodeLrc, parseLrc } = await importTypeScriptModule(new URL("src/lrc.ts", root));
  const parsed = parseLrc([
    "[ti:多语言测试]",
    "[ar:Vibloom]",
    "[offset:250]",
    "[00:01.00]Hello",
    "[00:02.5][00:03.500]简体中文",
    "[00:04.00]繁體中文",
    "[00:04.00]日本語",
  ].join("\n"));

  assert.equal(parsed.title, "多语言测试");
  assert.equal(parsed.artist, "Vibloom");
  assert.deepEqual(parsed.lines, [
    { time: 1.25, text: "Hello" },
    { time: 2.75, text: "简体中文" },
    { time: 3.75, text: "简体中文" },
    { time: 4.25, text: "繁體中文\n日本語" },
  ]);

  const utf16 = Buffer.from("\ufeff[00:01.00]日本語", "utf16le");
  const decoded = decodeLrc(utf16.buffer.slice(utf16.byteOffset, utf16.byteOffset + utf16.byteLength));
  assert.match(decoded, /日本語/u);
});

test("produces a portable static site", async () => {
  const html = await readFile(new URL("index.html", dist), "utf8");
  const assets = await readdir(new URL("assets/", dist));

  assert.match(html, /<title>Vibloom — Live2D Music Player & Listening Room<\/title>/);
  assert.match(html, /href="\.\/favicon\.svg"/u);
  assert.match(html, /type="module"/);
  assert.match(html, /\.\/assets\//);
  assert.doesNotMatch(html, /_next|_vinext|server\/index|codex-preview/i);
  assert.ok(assets.some((file) => file.endsWith(".js")));
  assert.ok(assets.some((file) => file.endsWith(".css")));
  await access(new URL("og.png", dist));
  await access(new URL("favicon.svg", dist));
  await access(new URL("live2d/live2dcubismcore.min.js", dist));
  await access(new URL("live2d/hiyori-pro/hiyori_pro_t11.model3.json", dist));
  await access(new URL("live2d/hiyori-pro/hiyori_pro_t11.moc3", dist));
  await access(new URL("live2d/hiyori-pro/hiyori_pro_t11.pose3.json", dist));
  await access(new URL("live2d/hiyori-pro/hiyori_pro_t11.2048/texture_01.png", dist));
});

test("drives Hiyori from meaningful per-track audio features", async () => {
  const [app, engine, visual, stage, styles] = await Promise.all([
    readFile(new URL("src/LibraryApp.tsx", root), "utf8"),
    readFile(new URL("src/audio/SynchronizedAudioEngine.ts", root), "utf8"),
    readFile(new URL("src/audioVisual.ts", root), "utf8"),
    readFile(new URL("src/Live2DStage.tsx", root), "utf8"),
    readFile(new URL("src/index.css", root), "utf8"),
  ]);
  const listeningMotions = await Promise.all(
    [1, 2, 3, 5].map((index) => (
      readFile(new URL(`public/live2d/hiyori-pro/motion/hiyori_m0${index}.motion3.json`, root), "utf8")
        .then(JSON.parse)
    )),
  );
  const welcomeMotions = await Promise.all(
    [6, 8].map((index) => (
      readFile(new URL(`public/live2d/hiyori-pro/motion/hiyori_m0${index}.motion3.json`, root), "utf8")
        .then(JSON.parse)
    )),
  );
  const authoredMotionParameters = [...new Set(
    [...listeningMotions, ...welcomeMotions].flatMap((motion) => motion.Curves)
      .filter((curve) => curve.Target === "Parameter")
      .map((curve) => curve.Id),
  )].sort();
  const restSettleBlock = stage.match(/const REST_SETTLE_PARAM_IDS = \[([\s\S]*?)\] as const;/u)?.[1] ?? "";
  const restSettleParameters = [...restSettleBlock.matchAll(/"(Param[^"]+)"/gu)]
    .map((match) => match[1])
    .sort();
  for (const motion of listeningMotions) {
    const partStarts = Object.fromEntries(
      motion.Curves
        .filter((curve) => curve.Target === "PartOpacity")
        .map((curve) => [curve.Id, curve.Segments[1]]),
    );
    assert.equal(partStarts.PartArmA, 1);
    assert.equal(partStarts.PartArmB, 0);
  }
  for (const motion of welcomeMotions) {
    const partStarts = Object.fromEntries(
      motion.Curves
        .filter((curve) => curve.Target === "PartOpacity")
        .map((curve) => [curve.Id, curve.Segments[1]]),
    );
    assert.equal(partStarts.PartArmA, 0);
    assert.ok(partStarts.PartArmB >= 0.99);
  }

  assert.match(engine, /context\.createAnalyser\(\)/u);
  assert.match(engine, /source\.connect\(graph\.analysers\[index\]\)/u);
  assert.match(visual, /band\(35, 190\)/u);
  assert.match(visual, /band\(190, 2400\)/u);
  assert.match(visual, /band\(2400, 10000\)/u);
  assert.match(stage, /ParamBodyAngleX/u);
  assert.match(stage, /ParamAngleY/u);
  assert.match(stage, /ParamBodyAngleY/u);
  assert.match(stage, /rhythmPhase \+=/u);
  assert.match(stage, /addParameterValueByIndex/u);
  assert.match(stage, /features\.isComparing/u);
  assert.match(stage, /focusController\.focus\(gazeX, gazeY\)/u);
  assert.match(stage, /motionPreload: MotionPreloadStrategy\.IDLE/u);
  assert.match(stage, /Object\.values\(OFFICIAL_MOTIONS\)[\s\S]*?motionManager\.loadMotion\(motion\.group, motion\.index\)/u);
  assert.match(stage, /m01: \{ id: "m01", group: "Idle", index: 0, duration: 4\.7, role: "base", mode: "player" \}/u);
  assert.match(stage, /m03: \{ id: "m03", group: "Flick", index: 0, duration: 4\.2, role: "gesture", mode: "player" \}/u);
  assert.match(stage, /m06: \{ id: "m06", group: "FlickUp", index: 0, duration: 5\.37, role: "welcome", mode: "welcome"/u);
  assert.match(stage, /m08: \{ id: "m08", group: "Tap", index: 1, duration: 2\.1, role: "welcome", mode: "welcome"/u);
  assert.equal([...stage.matchAll(/^ {2}m0\d: \{ id:/gmu)].length, 6);
  const admittedMotionBlock = stage.match(/const OFFICIAL_MOTIONS[\s\S]*?^\};/mu)?.[0] ?? "";
  assert.doesNotMatch(admittedMotionBlock, /m04|m07|m09|m10/u);
  assert.match(stage, /M02_EXPRESSION_PARAM_IDS/u);
  assert.match(stage, /M05_MOUTH_PARAM_IDS/u);
  assert.match(stage, /startMotion\([\s\S]*?motion\.group,[\s\S]*?motion\.index,[\s\S]*?3,[\s\S]*?ignoreParamIds/u);
  assert.match(stage, /const startOfficialMotion = async/u);
  assert.match(stage, /motionWatchdog === 0[\s\S]*?getOfficialMotionElapsed\(\) === null/u);
  assert.match(stage, /Hiyori \$\{motion\.id\} motion will retry/u);
  assert.match(stage, /const MOTION_LOOP_SEAM_SECONDS = 0\.72/u);
  assert.match(stage, /const MOTION_LOOP_CORRECTIONS: Record<OfficialMotionId/u);
  assert.match(stage, /const seamEase = seamProgress \* seamProgress \* \(3 - 2 \* seamProgress\)/u);
  assert.match(stage, /entry\.getStateTime\(\) - entry\.getStartTime\(\)/u);
  assert.match(stage, /elapsed % activeMotion\.duration/u);
  assert.match(stage, /MOTION_LOOP_CORRECTIONS\[activeMotion\.id\]/u);
  assert.match(stage, /activeMotion\.ignoreParamIds\?\.includes\(id\)/u);
  assert.doesNotMatch(stage, /officialMotionTime = \(officialMotionTime \+ dt/u);
  assert.match(stage, /const RESTING_IDLE_GROUP = "__vibloom_resting__"/u);
  assert.match(stage, /internalModel\.motionManager\.groups\.idle = RESTING_IDLE_GROUP/u);
  assert.doesNotMatch(stage, /groups\.idle = PLAYING_IDLE_GROUP/u);
  assert.match(stage, /internalModel\.motionManager\.stopAllMotions\(\)/u);
  assert.match(stage, /const REST_SETTLE_PARAM_IDS = \[/u);
  assert.doesNotMatch(stage, /MUSIC_OWNED_PARAM_IDS/u);
  assert.doesNotMatch(stage, /internalModel\.eyeBlink = undefined/u);
  assert.match(stage, /afterMotionUpdate/u);
  assert.match(stage, /"ParamArmLA", "ParamArmLB", "ParamArmRA", "ParamArmRB"/u);
  assert.match(restSettleBlock, /ParamArmLB/u);
  assert.match(restSettleBlock, /ParamHandLB/u);
  assert.match(restSettleBlock, /ParamHandRB/u);
  assert.match(stage, /"ParamBreath", "ParamBrowLX", "ParamBrowLY"/u);
  assert.match(stage, /"ParamEyeBallX", "ParamEyeBallY"/u);
  assert.match(stage, /"ParamHairAhoge"/u);
  assert.deepEqual(restSettleParameters, authoredMotionParameters);
  assert.match(stage, /const REST_SETTLE_SECONDS = 1\.2/u);
  assert.match(stage, /const REST_EYE_HANDOFF_SECONDS = 0\.36/u);
  assert.doesNotMatch(stage, /MOTION_HANDOFF_SECONDS/u);
  assert.match(stage, /value \*\* 3 \* \(value \* \(value \* 6 - 15\) \+ 10\)/u);
  assert.match(stage, /asset\.setFadeInTime\(0\)/u);
  assert.match(stage, /asset\.setFadeOutTime\(0\)/u);
  assert.match(stage, /asset\.setIsLoopFadeIn\(false\)/u);
  assert.match(stage, /const POSE_TRANSITION_MIN_SECONDS = 0\.38/u);
  assert.match(stage, /const POSE_TRANSITION_MAX_SECONDS = 0\.68/u);
  assert.match(stage, /const MOTION_START_POSES: Record<OfficialMotionId/u);
  assert.match(stage, /m06: \{ \.\.\.NEUTRAL_MOTION_START[\s\S]*?ParamHandLB: 0, ParamHandRB: 0/u);
  assert.match(stage, /m08: \{ \.\.\.NEUTRAL_MOTION_START[\s\S]*?ParamHandLB: 10, ParamHandRB: 10/u);
  assert.match(stage, /internalModel\.on\("afterMotionUpdate", applyPoseTransition\)/u);
  assert.match(stage, /internalModel\.off\("afterMotionUpdate", applyPoseTransition\)/u);
  assert.doesNotMatch(stage, /motionManager\.on\("afterMotionUpdate"/u);
  assert.match(stage, /const h00 = 2 \* progress3 - 3 \* progress2 \+ 1/u);
  assert.match(stage, /const h10 = progress3 - 2 \* progress2 \+ progress/u);
  assert.match(stage, /const h01 = -2 \* progress3 \+ 3 \* progress2/u);
  assert.match(stage, /h10 \* poseTransitionDuration \* startVelocity/u);
  assert.match(stage, /if \(progress >= 1\) poseTransitionEndpointRendered = true/u);
  assert.match(stage, /poseTransitionEndpointRendered[\s\S]*?startOfficialMotion\(poseTransitionTarget, requestVersion\)/u);
  assert.doesNotMatch(stage, /Math\.exp\(-state\.omega|connectorStates|applyMotionConnector/u);
  assert.match(stage, /const wrappedBoundaryFrame/u);
  assert.match(stage, /lastMotionCycleTime > seamStart/u);
  assert.match(stage, /internalModel\.on\("afterMotionUpdate", applyRestPose\)/u);
  assert.match(stage, /internalModel\.off\("afterMotionUpdate", applyRestPose\)/u);
  assert.match(stage, /internalModel\.on\("beforeModelUpdate", applyRestEyeHandoff\)/u);
  assert.match(stage, /internalModel\.off\("beforeModelUpdate", applyRestEyeHandoff\)/u);
  assert.doesNotMatch(stage, /internalModel\.on\("beforeModelUpdate", applyRestPose\)/u);
  assert.doesNotMatch(stage, /internalModel\.on\("beforeModelUpdate", applyMusicPose\)/u);
  assert.match(stage, /UPDATE_PRIORITY\.HIGH/u);
  assert.match(stage, /for \(const \{ id, index \} of restSettleParameters\)/u);
  assert.match(stage, /restSettleElapsed >= REST_SETTLE_SECONDS/u);
  assert.match(stage, /if \(!featuresRef\.current\.isPlaying\) return/u);
  assert.match(stage, /ParamAngleY", -poseNod \* \(4\.2 \+ bass \* 1\.4\)/u);
  assert.match(stage, /const nodEnvelope = nodProgress < 0\.3/u);
  assert.match(stage, /poseGroove = activity \* Math\.min\(1, 0\.28/u);
  assert.match(stage, /if \(features\.isPlaying && !wasListening\)/u);
  assert.match(stage, /rhythmPhase \+= dt \* Math\.PI \/ beatInterval \* listening/u);
  assert.match(stage, /while \(candidate < 0\.5\) candidate \*= 2/u);
  assert.match(stage, /const tempoBinsBySource = \[new Float32Array\(26\), new Float32Array\(26\)\]/u);
  assert.match(stage, /learnedBeatIntervalBySource\[source\] = 0\.51 \+ strongestBin \* 0\.02/u);
  assert.match(stage, /const scheduledBeat = hasNoddedSincePlay && beatClock >= beatInterval/u);
  assert.match(stage, /const phraseBoundary = beatCount % 8 === 0/u);
  assert.match(stage, /const gestureInterval = energeticPhrase \? 8 : 16/u);
  assert.match(stage, /const GESTURE_MOTION_SEQUENCE = \["m03"\] as const/u);
  assert.match(stage, /const WELCOME_MOTION_SEQUENCE = \["m06", "m08"\] as const/u);
  assert.match(stage, /motion\.mode === "welcome"[\s\S]*?variantRef\.current === "welcome"/u);
  assert.match(stage, /const setArmRigOwnership = \(welcomeArms: boolean\)/u);
  const armOwnershipBlock = stage.match(/const setArmRigOwnership = \(welcomeArms: boolean\) => \{([\s\S]*?)\n[ ]{8}\};/u)?.[1] ?? "";
  assert.match(armOwnershipBlock, /pose\?\.reset\(core\);[\s\S]*?pose\?\.updateParameters\(core, 0\);[\s\S]*?setPartOpacityById\("PartArmB"[\s\S]*?pose\?\.updateParameters\(core, 0\)/u);
  assert.match(stage, /internalModel\.pose\?\.reset\(core\)/u);
  assert.match(stage, /core\.setParameterValueByIndex\(armAParameter, welcomeArms \? 0 : 1\)/u);
  assert.match(stage, /core\.setParameterValueByIndex\(armBParameter, welcomeArms \? 1 : 0\)/u);
  assert.match(stage, /core\.setPartOpacityById\("PartArmA", welcomeArms \? 0 : 1\)/u);
  assert.match(stage, /core\.setPartOpacityById\("PartArmB", welcomeArms \? 1 : 0\)/u);
  assert.match(stage, /internalModel\.pose\?\.updateParameters\(core, 0\)/u);
  assert.match(stage, /hardResetForStageVariant\(activeStageVariant\)/u);
  assert.match(stage, /setArmRigOwnership\(false\)/u);
  assert.match(stage, /activeMotion\.mode === "welcome"[\s\S]*?dwellBeforeChange/u);
  assert.match(stage, /const dwellBeforeChange = activeMotion\.duration \* 0\.55/u);
  assert.doesNotMatch(stage, /activeMotion\.duration \* 1\.8/u);
  assert.match(stage, /let canvasRevealed = false/u);
  assert.match(stage, /if \("fonts" in document\) await document\.fonts\.ready/u);
  assert.match(stage, /await new Promise<void>\(\(resolve\) => requestAnimationFrame\(\(\) => resolve\(\)\)\)/u);
  assert.match(stage, /canvasRevealed = true;[\s\S]*?canvas\.style\.visibility = ""/u);
  assert.match(stage, /const baseCameraZoom = variantRef\.current === "welcome"[\s\S]*?\? 1[\s\S]*?: cameraModeRef\.current/u);
  assert.doesNotMatch(stage, /variantRef\.current === "welcome"[\s\S]{0,120}?Math\.max\(1\.42/u);
  assert.match(stage, /gestureMotionCursor % GESTURE_MOTION_SEQUENCE\.length/u);
  assert.match(stage, /BASE_MOTION_SEQUENCE\[baseMotionCursor % BASE_MOTION_SEQUENCE\.length\]/u);
  assert.match(stage, /activeMotion\.role === "gesture"/u);
  assert.match(stage, /let pendingMotion: OfficialMotion \| null = null/u);
  assert.match(stage, /const atConnectorAnchor/u);
  assert.match(stage, /motionElapsed >= activeMotion\.duration - transitionWindow/u);
  assert.match(stage, /beginPoseTransition\(nextMotion\)/u);
  assert.match(stage, /pendingBeatAccent/u);
  assert.match(stage, /const firstAudibleBeat = !hasNoddedSincePlay/u);
  assert.match(stage, /nodGestureTime = 0;[\s\S]*?nodGestureStrength = gestureStrength \* gestureVariation;/u);
  assert.match(stage, /poseNod = nodEnvelope \* nodGestureStrength \* activity/u);
  assert.match(stage, /const bassInputRise = Math\.max\(0, features\.bass - lastBassInput\)/u);
  assert.match(stage, /const detectedOnset = transientRise > 0\.014 \|\| bassInputRise > 0\.012/u);
  assert.match(stage, /const lowFrequencyAccent = Math\.min/u);
  assert.match(stage, /Math\.max\(0, bassInputRise - 0\.012\) \* 13/u);
  assert.match(stage, /lightAccentCooldown = 0\.34/u);
  assert.match(stage, /lightPulse = follow\(lightPulse, lightImpulse \* listening/u);
  assert.doesNotMatch(stage, /lightPulse = Math\.max\(lightPulse, Math\.min\(1, onsetStrength/u);
  assert.match(stage, /--music-active/u);
  assert.match(stage, /else if \(!features\.isPlaying && wasListening\)/u);
  assert.match(stage, /restStartValues\.set\(index, core\.getParameterValueByIndex\(index\)\)/u);
  assert.match(stage, /restSettleElapsed = 0;[\s\S]*?stopAllMotions\(\);[\s\S]*?pendingBeatAccent = 0;/u);
  assert.match(stage, /nodGestureTime = Number\.POSITIVE_INFINITY;[\s\S]*?nodGestureStrength = 0;/u);
  assert.match(stage, /features\.isPlaying \? 3\.2 : 7\.5/u);
  assert.match(stage, /Math\.max\(directorRange\.min, Math\.min\(directorRange\.max, pausedCameraZoom\)\)/u);
  assert.match(stage, /const followsComparedTrack = features\.isComparing && features\.isPlaying/u);
  assert.match(stage, /getParameterDefaultValue/u);
  assert.match(visual, /const bassRise = Math\.max\(0, bass - previous\.bass\)/u);
  assert.doesNotMatch(stage, /model\.rotation =/u);
  assert.doesNotMatch(stage, /model\.position\.set\(/u);
  assert.doesNotMatch(stage, /addMusicParameter\("ParamHair/u);
  assert.match(engine, /analyser\.fftSize = 1024/u);
  assert.match(engine, /analyser\.smoothingTimeConstant = 0\.68/u);
  assert.match(styles, /--beat-pulse/u);
  assert.match(styles, /\.stage-music-disc/u);
  assert.doesNotMatch(styles, /\.stage-floor-light/u);
  assert.doesNotMatch(styles, /\.live2d-stage-player::after/u);
  // Welcome and player variants are mutually exclusive at runtime.
  assert.equal([...app.matchAll(/<Live2DStage/gu)].length, 2);
  assert.match(stage, /import\("pixi\.js"\)/u);
  assert.match(stage, /const naturalWidth = model\.width/u);
  assert.match(stage, /targetHeight \/ naturalHeight/u);
  assert.match(stage, /targetWidth \/ naturalWidth/u);
  assert.doesNotMatch(stage, /\[featuresRef, variant\]/u);
});

test("keeps phrase camera motion separate from Live2D music pose", async () => {
  const [stage, app] = await Promise.all([
    readFile(new URL("src/Live2DStage.tsx", root), "utf8"),
    readFile(new URL("src/LibraryApp.tsx", root), "utf8"),
  ]);

  assert.match(stage, /const cameraRig = new Container\(\)/u);
  assert.match(stage, /cameraRig\.addChild\(contactShadow, model\)/u);
  assert.match(stage, /const phraseArc = \(1 - Math\.cos\(cameraPhase\)\) \* 0\.5/u);
  assert.match(stage, /const directorRange = directorZoomRangeRef\.current/u);
  assert.match(stage, /focusCameraTransitionUntilRef\.current/u);
  assert.match(stage, /let lightTier = 0/u);
  assert.match(stage, /lightTierStep = timeSinceLightAccent > 1\.05 \? 1 : Math\.min\(3, lightTierStep \+ 1\)/u);
  assert.match(stage, /stage\.style\.setProperty\("--beat-tier", lightTier\.toFixed\(3\)\)/u);
  assert.doesNotMatch(stage, /radialSpectrum|radialWaveform|RADIAL_CONTOUR/u);
  assert.match(stage, /app\.render\(\)/u);
  assert.match(stage, /resizeFrame = requestAnimationFrame/u);
  assert.match(stage, /Math\.max\(MIN_CAMERA_ZOOM, Math\.min\(MAX_CAMERA_ZOOM, autoZoom\)\)/u);
  assert.match(stage, /currentCameraZoomRef\.current \* Math\.exp/u);
  assert.match(stage, /manualZoomRef\.current = portraitZoomRef\.current/u);
  assert.match(stage, /previousVariantRef\.current === "welcome" && variant === "player"/u);
  assert.match(stage, /autoSuspendUntilRef\.current = Number\.POSITIVE_INFINITY/u);
  assert.match(stage, /nextCameraUi = \{ mode: "locked", preset: "portrait" \}/u);
  assert.match(stage, /host\.addEventListener\("wheel", handleWheel/u);
  assert.doesNotMatch(stage, /autoZoom[^;]*lightPulse/u);
  assert.match(stage, /ParamEyeBallX/u);
  assert.match(stage, /ParamEyeBallY/u);
  assert.match(stage, /features\.source === 0 \? -0\.82 : 0\.82/u);
  assert.match(app, /focusMode=\{focusMode\}/u);
});

test("separates the static contact shadow from ambient music lighting", async () => {
  const [stage, styles] = await Promise.all([
    readFile(new URL("src/Live2DStage.tsx", root), "utf8"),
    readFile(new URL("src/index.css", root), "utf8"),
  ]);
  const musicDisc = styles.match(/\.stage-music-disc\s*\{([^}]*)\}/u)?.[1] ?? "";

  assert.match(stage, /const contactShadow = new Graphics\(\)/u);
  assert.match(stage, /const contactShadowY = naturalHeight \* 0\.463/u);
  assert.match(stage, /contactShadow\.drawEllipse\(0, contactShadowY, naturalWidth \* 0\.25, naturalHeight \* 0\.009\)/u);
  assert.match(stage, /or drop one audio file anywhere on the stage/u);
  assert.match(stage, /contactShadow\.drawEllipse/u);
  assert.match(stage, /cameraRig\.addChild\(contactShadow, model\)/u);
  assert.match(stage, /contactShadow\.scale\.set\(currentModelScale\)/u);
  assert.doesNotMatch(styles, /\.live2d-stage::before/u);
  assert.match(musicDisc, /aspect-ratio: 1;/u);
  assert.match(musicDisc, /border-radius: 50%;/u);
  assert.match(musicDisc, /background: rgb\(var\(--stage-light-rgb\) \/ \.34\);/u);
  assert.match(musicDisc, /--beat-tier, 0\) \* \.24/u);
  assert.match(musicDisc, /--beat-pulse, 0\) \* \.04/u);
  assert.match(musicDisc, /filter: none;/u);
  assert.doesNotMatch(musicDisc, /gradient|blur|box-shadow/u);
  assert.doesNotMatch(styles, /\.stage-floor-light/u);
  assert.doesNotMatch(styles, /\.welcome-screen::before|\.stage-glow|\.stage-orbit/u);
  assert.doesNotMatch(stage, /className="stage-glow"/u);
  assert.match(styles, /\.live2d-stage-welcome \{[\s\S]*?--stage-subject-x: 50%;[\s\S]*?--stage-subject-y: 54%;/u);
  assert.match(styles, /left: var\(--stage-subject-x, 50%\);[\s\S]*?top: var\(--stage-subject-y, 47%\);/u);
  assert.match(styles, /@media \(max-width: 600px\)[\s\S]*?\.live2d-stage-welcome \{ --stage-subject-x: 50%; \}/u);
  assert.doesNotMatch(styles, /\.player-hero::before/u);
  assert.match(styles, /\.stage-particles span/u);
});

test("keeps the record-book layout collision-free across responsive breakpoints", async () => {
  const styles = await readFile(new URL("src/index.css", root), "utf8");

  assert.match(
    styles,
    /\.app-shell:not\(\.is-focus-mode\) \.track-score-strip \.file-icon,[\s\S]*?width: 28px;[\s\S]*?height: 28px;/u,
  );
  assert.match(styles, /\.track-score-strip \.empty-slot-content \{[\s\S]*?margin: 1px 0 0;/u);
  assert.match(
    styles,
    /@media \(max-width: 900px\) \{[\s\S]*?grid-template-rows: auto 540px;[\s\S]*?\.live2d-stage-player \{ min-height: 540px; \}/u,
  );
  assert.match(
    styles,
    /@media \(max-width: 600px\) \{[\s\S]*?grid-template-rows: auto 500px;[\s\S]*?\.live2d-stage-player \{ min-height: 500px; \}/u,
  );
  assert.match(styles, /@media \(max-width: 1100px\) \{[\s\S]*?\.header-actions \.local-note \{ display: none; \}/u);
  assert.match(styles, /\.live2d-stage-player \.camera-capsule \{[\s\S]*?top: 16px;[\s\S]*?bottom: auto;/u);
  assert.match(styles, /\.app-shell\.is-focus-mode \.focus-mode-button \{[\s\S]*?position: fixed;[\s\S]*?pointer-events: auto;/u);
  assert.match(styles, /grid-template-columns: 210px minmax\(0, 1fr\);/u);
  assert.match(styles, /\.time-readout,[\s\S]*?\.total-time \{[\s\S]*?font-variant-numeric: tabular-nums;[\s\S]*?white-space: nowrap;/u);
  assert.doesNotMatch(styles, /\.site-header \.brand-mark::after/u);
});

test("interactive surfaces use one persistent boundary", async () => {
  const styles = await readFile(new URL("src/index.css", root), "utf8");

  assert.doesNotMatch(styles, /\.brand-mark::after/u);
  assert.doesNotMatch(styles, /\.welcome-choices button::after/u);
  assert.doesNotMatch(styles, /\.file-slot::after/u);
  assert.doesNotMatch(styles, /\.player::after/u);
  assert.doesNotMatch(styles, /\.camera-capsule::after/u);
  assert.match(styles, /\.site-header \.brand-mark \{[^}]*box-shadow: none;/u);
  assert.match(styles, /\.camera-capsule button\.is-active \{[^}]*box-shadow: none;/u);
});
