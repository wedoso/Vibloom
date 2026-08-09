import type { Application as PixiApplication } from "pixi.js";
import { Lock, Mouse, ScanFace, ScanLine, Sparkles } from "lucide-react";
import { MutableRefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AudioVisualFeatures } from "./audioVisual";

type StageVariant = "welcome" | "player";

type Live2DStageProps = {
  featuresRef: MutableRefObject<AudioVisualFeatures>;
  variant: StageVariant;
  trackLabel: string;
  activeSource: 0 | 1;
  isComparing: boolean;
  isPlaying: boolean;
  focusMode: boolean;
  containModel?: boolean;
  layoutKey?: string;
  onPickAudio?: () => void;
};

const PARTICLES = [
  [18, 74, 0.8, 7.2], [27, 61, 2.7, 8.4], [36, 78, 4.1, 6.8],
  [44, 67, 1.9, 9.2], [55, 76, 5.4, 7.8], [63, 64, 3.3, 8.8],
  [72, 79, 0.2, 7.5], [81, 59, 4.8, 9.6], [31, 49, 6.2, 8.1],
  [68, 46, 2.1, 7.1], [47, 55, 7.4, 9.1], [58, 42, 5.8, 8.6],
] as const;

// Complete parameter union authored by the admitted official motions. Pause
// must hand off the whole pose: omitting even the arms, brows, gaze, breath, or ahoge
// makes that part snap to its default on the frame stopAllMotions() runs.
const REST_SETTLE_PARAM_IDS = [
  "ParamAngleX", "ParamAngleY", "ParamAngleZ",
  "ParamArmLA", "ParamArmLB", "ParamArmRA", "ParamArmRB",
  "ParamBodyAngleX", "ParamBodyAngleY", "ParamBodyAngleZ",
  "ParamBreath", "ParamBrowLX", "ParamBrowLY", "ParamBrowLAngle", "ParamBrowLForm",
  "ParamBrowRX", "ParamBrowRY", "ParamBrowRAngle", "ParamBrowRForm",
  "ParamEyeBallX", "ParamEyeBallY",
  "ParamEyeLOpen", "ParamEyeROpen", "ParamEyeLSmile", "ParamEyeRSmile",
  "ParamHairAhoge", "ParamHandL", "ParamHandLB", "ParamHandR", "ParamHandRB",
  "ParamLeg", "ParamShoulder", "ParamMouthForm", "ParamMouthOpenY", "ParamCheek",
] as const;

const REST_EYE_OPEN_PARAM_IDS = new Set(["ParamEyeLOpen", "ParamEyeROpen"]);
const REST_SETTLE_SECONDS = 1.2;
const REST_EYE_HANDOFF_SECONDS = 0.36;

const RESTING_IDLE_GROUP = "__vibloom_resting__";
const MOTION_LOOP_SEAM_SECONDS = 0.72;
const POSE_TRANSITION_MIN_SECONDS = 0.38;
const POSE_TRANSITION_MAX_SECONDS = 0.68;

type OfficialMotionId = "m01" | "m02" | "m03" | "m05" | "m06" | "m08";

type OfficialMotion = {
  id: OfficialMotionId;
  group: string;
  index: number;
  duration: number;
  role: "base" | "gesture" | "welcome";
  mode: "player" | "welcome";
  ignoreParamIds?: readonly string[];
};

const M02_EXPRESSION_PARAM_IDS = [
  "ParamCheek", "ParamEyeLSmile", "ParamEyeRSmile",
  "ParamBrowLX", "ParamBrowLY", "ParamBrowLAngle", "ParamBrowLForm",
  "ParamBrowRX", "ParamBrowRY", "ParamBrowRAngle", "ParamBrowRForm",
  "ParamMouthForm", "ParamMouthOpenY",
] as const;
const M05_MOUTH_PARAM_IDS = ["ParamMouthForm", "ParamMouthOpenY"] as const;
const WELCOME_MOUTH_PARAM_IDS = ["ParamMouthOpenY"] as const;

// Only motions whose emotional meaning fits attentive music listening are
// admitted. m02 keeps its useful body/arm performance without the surprised
// blush and mouth; m05 keeps its joyful listening pose without lip movement.
const OFFICIAL_MOTIONS: Record<OfficialMotionId, OfficialMotion> = {
  m01: { id: "m01", group: "Idle", index: 0, duration: 4.7, role: "base", mode: "player" },
  m02: { id: "m02", group: "Idle", index: 1, duration: 5.93, role: "base", mode: "player", ignoreParamIds: M02_EXPRESSION_PARAM_IDS },
  m03: { id: "m03", group: "Flick", index: 0, duration: 4.2, role: "gesture", mode: "player" },
  m05: { id: "m05", group: "Idle", index: 2, duration: 8.57, role: "base", mode: "player", ignoreParamIds: M05_MOUTH_PARAM_IDS },
  m06: { id: "m06", group: "FlickUp", index: 0, duration: 5.37, role: "welcome", mode: "welcome", ignoreParamIds: WELCOME_MOUTH_PARAM_IDS },
  m08: { id: "m08", group: "Tap", index: 1, duration: 2.1, role: "welcome", mode: "welcome", ignoreParamIds: WELCOME_MOUTH_PARAM_IDS },
};

const BASE_MOTION_SEQUENCE = ["m02", "m01", "m05", "m01"] as const;
const GESTURE_MOTION_SEQUENCE = ["m03"] as const;
const WELCOME_MOTION_SEQUENCE = ["m06", "m08"] as const;

// Exact first authored keyframes for every admitted motion. Zeroes are kept:
// several Arm B hand channels start at 0 even though the model default is 10.
// Falling back to that default would finish the connector at 10 and let the
// target clip hard-reset the hand to 0 on its first frame.
const NEUTRAL_MOTION_START = {
  ParamAngleX: 0, ParamAngleY: 0, ParamAngleZ: 0,
  ParamCheek: 0,
  ParamEyeLOpen: 1, ParamEyeLSmile: 0,
  ParamEyeROpen: 1, ParamEyeRSmile: 0,
  ParamEyeBallX: 0, ParamEyeBallY: 0,
  ParamBrowLY: 0, ParamBrowRY: 0, ParamBrowLX: 0, ParamBrowRX: 0,
  ParamBrowLAngle: 0, ParamBrowRAngle: 0,
  ParamBrowLForm: 0, ParamBrowRForm: 0,
  ParamMouthForm: 1, ParamMouthOpenY: 0,
  ParamBodyAngleX: 0, ParamBodyAngleY: 0, ParamBodyAngleZ: 0,
  ParamBreath: 0, ParamShoulder: 0, ParamLeg: 1, ParamHairAhoge: 0,
} as const;

// A transition owns one pose and moves its joints to this exact boundary
// before the target clip starts; no second motion or opacity-weighted pose is
// rendered underneath it.
const MOTION_START_POSES: Record<OfficialMotionId, Readonly<Record<string, number>>> = {
  m01: { ...NEUTRAL_MOTION_START, ParamAngleX: -8, ParamAngleY: -5, ParamBodyAngleX: 1, ParamArmLA: -10, ParamArmRA: -10 },
  m02: { ...NEUTRAL_MOTION_START, ParamAngleX: 18, ParamAngleY: -24, ParamCheek: 1, ParamEyeLSmile: 0.63, ParamEyeRSmile: 0.63, ParamEyeBallX: -0.002, ParamBrowLAngle: 0.03, ParamMouthForm: -1, ParamMouthOpenY: 1, ParamArmLA: -8.7, ParamArmRA: -8.7, ParamHandL: 0, ParamHandR: 0 },
  m03: { ...NEUTRAL_MOTION_START, ParamArmLA: -10, ParamArmRA: -10, ParamHandL: 0, ParamHandR: 0 },
  m05: { ...NEUTRAL_MOTION_START, ParamArmLA: -10, ParamArmRA: -10, ParamArmRB: 0.02 },
  m06: { ...NEUTRAL_MOTION_START, ParamBodyAngleX: -10, ParamBodyAngleY: 10, ParamArmLB: 0, ParamArmRB: 0, ParamHandLB: 0, ParamHandRB: 0, ParamHandL: 0, ParamHandR: 0 },
  m08: { ...NEUTRAL_MOTION_START, ParamArmLA: 0, ParamArmRA: 0, ParamArmLB: 0, ParamArmRB: 0, ParamHandLB: 10, ParamHandRB: 10 },
};

// Every admitted Hiyori clip is marked as looping, although some authored
// curves end away from their first value. Correct only the final 720 ms of the
// active cycle so a loop or beat-aligned handoff cannot expose a one-frame snap.
const MOTION_LOOP_CORRECTIONS: Record<OfficialMotionId, readonly (readonly [string, number])[]> = {
  m01: [["ParamAngleX", -9], ["ParamAngleY", 4], ["ParamAngleZ", 11.207], ["ParamEyeBallX", -0.803], ["ParamEyeBallY", -0.794], ["ParamBodyAngleX", 7], ["ParamBodyAngleZ", 3.976], ["ParamShoulder", 0.9]],
  m02: [["ParamAngleX", 18], ["ParamAngleY", -24], ["ParamAngleZ", -17], ["ParamEyeLOpen", 1], ["ParamEyeLSmile", -0.141], ["ParamEyeROpen", 1], ["ParamEyeRSmile", -0.13], ["ParamEyeBallX", -0.002], ["ParamBrowLY", -0.396], ["ParamBrowRY", -0.417], ["ParamMouthForm", -2], ["ParamMouthOpenY", 1], ["ParamBodyAngleX", -0.013], ["ParamBodyAngleZ", 3], ["ParamShoulder", 1], ["ParamArmLA", -5.7], ["ParamArmRA", -8.698], ["ParamHandL", -0.208], ["ParamHandR", -0.208]],
  m03: [["ParamAngleX", 2], ["ParamAngleY", 3], ["ParamAngleZ", -11], ["ParamBodyAngleY", -6], ["ParamBodyAngleZ", -8], ["ParamLeg", 0.938], ["ParamArmLA", -7], ["ParamArmRA", -9.971], ["ParamHandL", -0.8], ["ParamHandR", -0.8]],
  m05: [["ParamEyeLSmile", -0.812], ["ParamEyeRSmile", -0.8], ["ParamBodyAngleX", 0.326], ["ParamBodyAngleZ", -0.025]],
  m06: [["ParamAngleY", 10], ["ParamAngleZ", 3], ["ParamEyeLOpen", 1], ["ParamEyeLSmile", -0.833], ["ParamEyeROpen", 1], ["ParamEyeRSmile", -0.823], ["ParamEyeBallX", 0.28], ["ParamEyeBallY", -0.13], ["ParamBrowLY", -0.479], ["ParamBrowRY", -0.479], ["ParamBrowLX", 0.479], ["ParamBrowRX", 0.69], ["ParamMouthOpenY", -1], ["ParamBodyAngleX", -12.025], ["ParamBodyAngleY", 9.905], ["ParamBodyAngleZ", -8], ["ParamShoulder", 0.2], ["ParamLeg", 0.948], ["ParamArmLB", 6.458], ["ParamArmRB", 5.833], ["ParamHandLB", -7.1], ["ParamHandRB", -6.8], ["ParamHandL", -0.4], ["ParamHandR", -0.3]],
  m08: [["ParamAngleY", -11], ["ParamAngleZ", 9], ["ParamEyeLOpen", 1], ["ParamEyeLSmile", -1], ["ParamEyeROpen", 1], ["ParamEyeRSmile", -1], ["ParamBrowLY", 0.14], ["ParamBrowRY", 0.14], ["ParamBrowLX", 0.21], ["ParamBrowRX", 0.2], ["ParamBrowLAngle", -0.25], ["ParamBrowRAngle", -0.23], ["ParamMouthOpenY", -1], ["ParamBodyAngleZ", -2], ["ParamArmLB", -9.583], ["ParamArmRB", -4.375], ["ParamHandLB", 5.208], ["ParamHandRB", 2.708]],
};

type CoreModel = {
  getParameterIndex: (id: string) => number;
  getParameterDefaultValue: (index: number) => number;
  getParameterValueByIndex: (index: number) => number;
  setPartOpacityById: (id: string, opacity: number) => void;
  addParameterValueByIndex: (index: number, value: number, weight?: number) => void;
  setParameterValueByIndex: (index: number, value: number, weight?: number) => void;
};

type FocusController = {
  focus: (x: number, y: number, instant?: boolean) => void;
};

type MotionQueueEntryController = {
  getStartTime: () => number;
  getStateTime: () => number;
  isFinished: () => boolean;
  isStarted: () => boolean;
};

type MotionAssetController = {
  setFadeInTime: (seconds: number) => void;
  setFadeOutTime: (seconds: number) => void;
  setIsLoopFadeIn: (enabled: boolean) => void;
};

type MotionManagerController = {
  groups: { idle: string };
  queueManager?: { _motions?: MotionQueueEntryController[] };
  loadMotion: (group: string, index: number) => Promise<MotionAssetController | undefined>;
  startMotion: (
    group: string,
    index: number,
    priority: number,
    options?: { ignoreParamIds?: string[] },
  ) => Promise<boolean>;
  stopAllMotions: () => void;
};

type InternalModelControls = {
  coreModel: CoreModel;
  focusController: FocusController;
  eyeBlink?: unknown;
  pose?: {
    reset: (model: CoreModel) => void;
    updateParameters: (model: CoreModel, deltaTimeSeconds: number) => void;
  };
  motionManager: MotionManagerController;
  on: (event: "afterMotionUpdate" | "beforeModelUpdate", listener: () => void) => void;
  off: (event: "afterMotionUpdate" | "beforeModelUpdate", listener: () => void) => void;
};

export default function Live2DStage({
  featuresRef,
  variant,
  trackLabel,
  activeSource,
  isComparing,
  isPlaying,
  focusMode,
  containModel = false,
  layoutKey,
  onPickAudio,
}: Live2DStageProps) {
  const stageRef = useRef<HTMLElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneLayoutSnapRef = useRef(false);
  const focusCameraSnapRef = useRef(false);
  const variantRef = useRef(variant);
  const previousVariantRef = useRef(variant);
  const previousFocusModeRef = useRef(focusMode);
  const focusModeRef = useRef(focusMode);
  const containModelRef = useRef(containModel);
  const focusCameraTransitionUntilRef = useRef(0);
  const layoutRef = useRef<(() => void) | null>(null);
  const cameraModeRef = useRef<"auto" | "locked">("auto");
  const manualZoomRef = useRef(1);
  const currentCameraZoomRef = useRef(1);
  const autoSuspendUntilRef = useRef(0);
  const zoomTimerRef = useRef<number | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [cameraMode, setCameraMode] = useState<"auto" | "locked">("auto");
  const [cameraPreset, setCameraPreset] = useState<"director" | "portrait" | "wide" | "manual">("director");
  const [zoomReadout, setZoomReadout] = useState(100);
  const [showZoom, setShowZoom] = useState(false);

  useLayoutEffect(() => {
    const enteringPlayer = previousVariantRef.current === "welcome" && variant === "player";
    const leavingPlayer = previousVariantRef.current === "player" && variant === "welcome";
    const changingFocus = previousFocusModeRef.current !== focusMode;
    variantRef.current = variant;
    focusModeRef.current = focusMode;
    containModelRef.current = containModel;
    const sceneCovered = document.documentElement.classList.contains("is-scene-covering");
    if (changingFocus && sceneCovered) {
      focusCameraSnapRef.current = true;
      focusCameraTransitionUntilRef.current = 0;
    } else if (changingFocus) {
      focusCameraTransitionUntilRef.current = performance.now() + 1100;
    }
    if ((enteringPlayer || leavingPlayer) && sceneCovered) sceneLayoutSnapRef.current = true;
    if (enteringPlayer) {
      // Establish an intimate first shot before the phrase director takes over.
      // The camera rig moves; Hiyori's authored model coordinates stay untouched.
      manualZoomRef.current = containModel ? 1 : 2.12;
      autoSuspendUntilRef.current = performance.now() + 2800;
      cameraModeRef.current = "auto";
      setCameraMode("auto");
      setCameraPreset("director");
    } else if (leavingPlayer) {
      manualZoomRef.current = 1;
      currentCameraZoomRef.current = 1;
      autoSuspendUntilRef.current = 0;
      cameraModeRef.current = "auto";
      setCameraMode("auto");
      setCameraPreset("director");
    }
    previousVariantRef.current = variant;
    previousFocusModeRef.current = focusMode;
    layoutRef.current?.();
  }, [containModel, focusMode, layoutKey, variant]);

  useEffect(() => {
    cameraModeRef.current = cameraMode;
  }, [cameraMode]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let app: PixiApplication | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let resizeFrame: number | null = null;
    let cleanupPointer: (() => void) | null = null;
    let cleanupMotionPose: (() => void) | null = null;
    let cleanupModel: (() => void) | null = null;
    let appDestroyed = false;
    const destroyApp = () => {
      if (!app || appDestroyed) return;
      appDestroyed = true;
      app.destroy(true, { children: true, texture: true, baseTexture: true });
      app = null;
    };

    async function mountModel() {
      try {
        const [
          { Application, BlurFilter, Container, Graphics, UPDATE_PRIORITY },
          { Live2DModel, MotionPreloadStrategy, configureCubism4 },
        ] = await Promise.all([
          import("pixi.js"),
          import("pixi-live2d-display-advanced/cubism4"),
        ]);
        if (disposed) return;
        configureCubism4({ memorySizeMB: 64 });
        app = new Application({
          backgroundAlpha: 0,
          antialias: true,
          autoDensity: true,
          resolution: Math.min(window.devicePixelRatio || 1, 2),
          width: host?.clientWidth || 720,
          height: host?.clientHeight || 720,
        });
        if (!host || disposed) return;
        const canvas = app.view as HTMLCanvasElement;
        canvas.className = "live2d-canvas";
        canvas.setAttribute("aria-label", "Hiyori, an interactive Live2D music companion");
        canvas.style.visibility = "hidden";
        host.appendChild(canvas);

        const base = import.meta.env.BASE_URL;
        const model = await Live2DModel.from(`${base}live2d/hiyori-pro/hiyori_pro_t11.model3.json`, {
          autoHitTest: false,
          autoFocus: false,
          autoUpdate: false,
          motionPreload: MotionPreloadStrategy.IDLE,
          ticker: app.ticker,
        });
        if (disposed || !app) {
          model.automator.autoUpdate = false;
          model.destroy();
          destroyApp();
          return;
        }
        model.anchor.set(0.5, 0.5);
        const cameraRig = new Container();
        app.stage.addChild(cameraRig);
        app.ticker.maxFPS = 60;
        app.ticker.minFPS = 30;
        const internalModel = model.internalModel as unknown as InternalModelControls;
        await Promise.all(
          Object.values(OFFICIAL_MOTIONS).map(async (motion) => {
            const asset = await internalModel.motionManager.loadMotion(motion.group, motion.index);
            if (!asset) return;
            // The PRO files omit fade metadata, so Cubism otherwise injects a
            // one-second SDK fade and restarts it on every loop. Vibloom inserts
            // an explicit single-pose joint transition instead; SDK weights
            // would overlap controllers and can expose a pale boundary frame.
            asset.setFadeInTime(0);
            asset.setFadeOutTime(0);
            asset.setIsLoopFadeIn(false);
          }),
        );
        if (disposed) {
          model.automator.autoUpdate = false;
          model.destroy();
          destroyApp();
          return;
        }
        // Rest is intentionally not an authored looping motion. The official m01
        // clip becomes the listening performance only while audio is playing;
        // paused Hiyori keeps the SDK's quiet blink, breath, focus, and Physics.
        internalModel.motionManager.groups.idle = RESTING_IDLE_GROUP;
        internalModel.motionManager.stopAllMotions();
        const naturalWidth = model.width;
        const naturalHeight = model.height;
        const contactShadow = new Graphics();
        // The model canvas includes transparent space below the visible soles.
        // Pull the shadow into the rendered foot line instead of using the
        // texture's geometric bottom, which makes Hiyori appear to float.
        const contactShadowY = naturalHeight * 0.463;
        contactShadow.beginFill(0x202b46, 0.19);
        contactShadow.drawEllipse(0, contactShadowY, naturalWidth * 0.25, naturalHeight * 0.009);
        contactShadow.endFill();
        contactShadow.filters = [new BlurFilter(4, 2)];
        cameraRig.addChild(contactShadow, model);
        cleanupModel = () => {
          model.automator.autoUpdate = false;
          cameraRig.removeChild(model);
          model.destroy();
        };
        let targetModelScale = 1;
        let currentModelScale = 1;
        let targetRigX = host.clientWidth * 0.5;
        let targetRigY = host.clientHeight * 0.54;
        let currentRigX = targetRigX;
        let currentRigY = targetRigY;
        let currentPortraitOffset = 0;
        let layoutInitialized = false;
        let canvasRevealed = false;
        let isCompactLayout = host.clientWidth < 600;
        let previousHostBounds: DOMRect | null = null;

        let rendererWidth = 0;
        let rendererHeight = 0;
        const layout = () => {
          if (!app || !host) return;
          const nextWidth = Math.max(1, Math.round(host.clientWidth));
          const nextHeight = Math.max(1, Math.round(host.clientHeight));
          const nextHostBounds = host.getBoundingClientRect();
          const sceneCovered = document.documentElement.classList.contains("is-scene-covering");
          if (layoutInitialized && previousHostBounds && canvasRevealed && !sceneCovered) {
            // Keep Hiyori at the same viewport pixel while the header/score strip
            // changes the stage's origin. The camera then eases from that exact
            // screen-space pose into its new focus composition.
            currentRigX += previousHostBounds.left - nextHostBounds.left;
            currentRigY += previousHostBounds.top - nextHostBounds.top;
          }
          previousHostBounds = nextHostBounds;
          if (nextWidth !== rendererWidth || nextHeight !== rendererHeight) {
            rendererWidth = nextWidth;
            rendererHeight = nextHeight;
            app.renderer.resize(nextWidth, nextHeight);
          }
          const isWelcome = variantRef.current === "welcome";
          const isCompact = host.clientWidth < 600;
          isCompactLayout = isCompact;
          const focused = focusModeRef.current && !isWelcome;
          const targetHeight = host.clientHeight * (focused ? 0.68 : 0.88);
          const targetWidth = host.clientWidth * (isCompact ? 0.84 : isWelcome ? 0.68 : focused ? 0.64 : 0.64);
          targetModelScale = Math.min(targetHeight / naturalHeight, targetWidth / naturalWidth);
          targetRigX = host.clientWidth * (isWelcome && !isCompact ? 0.58 : 0.5);
          targetRigY = host.clientHeight * (focused ? 0.51 : 0.54);
          if (!layoutInitialized) {
            currentModelScale = targetModelScale;
            currentRigX = targetRigX;
            currentRigY = targetRigY;
            model.scale.set(currentModelScale);
            contactShadow.scale.set(currentModelScale);
            cameraRig.position.set(currentRigX, currentRigY);
            layoutInitialized = true;
          } else if (sceneCovered) {
            // Resolve the destination camera under the opaque scene curtain.
            // This applies to Player/Library changes as well as Focus, including
            // position-only layout changes that ResizeObserver cannot detect.
            sceneLayoutSnapRef.current = true;
            currentModelScale = targetModelScale;
            currentRigX = targetRigX;
            currentRigY = targetRigY;
            const snapZoom = currentCameraZoomRef.current;
            const snapPortraitFactor = focused || isCompactLayout ? 0.14 : 0.29;
            currentPortraitOffset = Math.max(0, snapZoom - 1) * host.clientHeight * snapPortraitFactor;
            model.scale.set(currentModelScale);
            contactShadow.scale.set(currentModelScale);
            cameraRig.position.set(currentRigX, currentRigY + currentPortraitOffset);
            cameraRig.scale.set(snapZoom);
          } else if (!canvasRevealed) {
            // Model loading and late font/layout resolution happen while the
            // canvas is hidden. Keep replacing the provisional geometry with
            // the latest target instead of visibly easing from stale bounds.
            currentModelScale = targetModelScale;
            currentRigX = targetRigX;
            currentRigY = targetRigY;
            model.scale.set(currentModelScale);
            contactShadow.scale.set(currentModelScale);
            cameraRig.position.set(currentRigX, currentRigY);
          }
          // Resizing a WebGL backing buffer clears it. Repaint synchronously so
          // a focus layout change cannot expose that cleared frame as a flash.
          app.render();
        };
        layoutRef.current = layout;
        layout();
        resizeObserver = new ResizeObserver(() => {
          if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
          resizeFrame = requestAnimationFrame(() => {
            resizeFrame = null;
            layout();
          });
        });
        resizeObserver.observe(host);

        let pointerX = 0;
        let pointerY = 0;
        const handlePointer = (event: PointerEvent) => {
          const bounds = host.getBoundingClientRect();
          pointerX = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
          pointerY = -(((event.clientY - bounds.top) / bounds.height) * 2 - 1);
        };
        const resetPointer = () => { pointerX = 0; pointerY = 0; };
        const revealZoom = () => {
          setZoomReadout(Math.round(manualZoomRef.current * 100));
          setShowZoom(true);
          if (zoomTimerRef.current !== null) window.clearTimeout(zoomTimerRef.current);
          zoomTimerRef.current = window.setTimeout(() => setShowZoom(false), 1100);
        };
        const handleWheel = (event: WheelEvent) => {
          if (variantRef.current !== "player") return;
          event.preventDefault();
          const delta = Math.max(-80, Math.min(80, event.deltaY));
          manualZoomRef.current = Math.max(0.78, Math.min(2.35, currentCameraZoomRef.current * Math.exp(-delta * 0.0018)));
          autoSuspendUntilRef.current = Number.POSITIVE_INFINITY;
          cameraModeRef.current = "locked";
          setCameraMode("locked");
          setCameraPreset("manual");
          revealZoom();
        };
        host.addEventListener("pointermove", handlePointer);
        host.addEventListener("pointerleave", resetPointer);
        host.addEventListener("wheel", handleWheel, { passive: false });
        cleanupPointer = () => {
          host.removeEventListener("pointermove", handlePointer);
          host.removeEventListener("pointerleave", resetPointer);
          host.removeEventListener("wheel", handleWheel);
        };

        let lastSource: 0 | 1 = featuresRef.current.source;
        let rhythmPhase = 0;
        let beatInterval = 0.68;
        let targetBeatInterval = 0.68;
        const tempoBinsBySource = [new Float32Array(26), new Float32Array(26)] as const;
        const tempoEvidenceBySource = [0, 0];
        const learnedBeatIntervalBySource = [0.68, 0.68];
        let timeSinceOnset = 1;
        let variationPhase = 0;
        let energy = 0;
        let energyLong = 0;
        let bass = 0;
        let treble = 0;
        let gazeX = 0;
        let gazeY = 0;
        let switchAccent = 0;
        let activity = 0;
        let nodGestureTime = Number.POSITIVE_INFINITY;
        let nodGestureStrength = 0;
        let onsetCooldown = 0;
        let beatClock = 0;
        let pendingBeatAccent = 0;
        let hasNoddedSincePlay = false;
        let lastTransient = 0;
        let lastBassInput = 0;
        let transientFloor = 0;
        let lightPulse = 0;
        let lightImpulse = 0;
        let lightAccentCooldown = 0;
        let lightTier = 0;
        let lightTierTarget = 0;
        let lightTierStep = 0;
        let timeSinceLightAccent = Number.POSITIVE_INFINITY;
        let particlePulse = 0;
        let wasListening = false;
        let motionRequestVersion = 0;
        let motionStartInFlightVersion: number | null = null;
        let motionWatchdog = 0;
        let activeMotion: OfficialMotion = OFFICIAL_MOTIONS.m01;
        let pendingMotion: OfficialMotion | null = null;
        let baseMotionCursor = 0;
        let gestureMotionCursor = 0;
        let welcomeMotionCursor = 0;
        let activeStageVariant: StageVariant = variantRef.current;
        let beatCount = 0;
        let beatsSinceGesture = 16;
        let hasPlayed = false;
        let pausedCameraZoom = 2.02;
        let cameraPhase = Math.PI;
        let cameraZoom = 1;
        let poseSway = 0;
        let poseGroove = 0;
        let poseNod = 0;
        let restSettleElapsed = Number.POSITIVE_INFINITY;
        const restStartValues = new Map<number, number>();
        let activeMotionRuntime = 0;
        let lastMotionCycleTime = 0;
        let poseTransitionTarget: OfficialMotion | null = null;
        let poseTransitionElapsed = 0;
        let poseTransitionDuration = POSE_TRANSITION_MIN_SECONDS;
        let poseTransitionEndpointRendered = false;
        let poseTransitionStarting = false;
        const poseTransitionStartValues = new Map<number, number>();
        const poseTransitionStartVelocities = new Map<number, number>();
        const poseTransitionTargetValues = new Map<number, number>();
        const poseHistoryValues = new Map<number, number>();
        const poseVelocities = new Map<number, number>();
        let poseHistoryAt = performance.now() / 1000;
        const core = internalModel.coreModel;
        const focusController = internalModel.focusController;
        const parameterIndexes = new Map(
          [...REST_SETTLE_PARAM_IDS, "ParamBustY"].map((id) => [id, core.getParameterIndex(id)]),
        );
        const addMusicParameter = (id: string, value: number, weight: number) => {
          const index = parameterIndexes.get(id);
          if (index !== undefined && index >= 0) core.addParameterValueByIndex(index, value, weight);
        };
        const restSettleParameters = REST_SETTLE_PARAM_IDS
          .map((id) => ({ id, index: core.getParameterIndex(id) }))
          .filter(({ index }) => index >= 0);
        const restEyeOpenIndexes = restSettleParameters
          .filter(({ id }) => REST_EYE_OPEN_PARAM_IDS.has(id))
          .map(({ index }) => index);
        const setArmRigOwnership = (welcomeArms: boolean) => {
          const armAParameter = core.getParameterIndex("PartArmA");
          const armBParameter = core.getParameterIndex("PartArmB");
          // Prime CubismPose's model cache before assigning the visible rig.
          // Its first update otherwise calls reset() internally and overwrites
          // this assignment, producing the SDK's default 0.5 s part fade.
          internalModel.pose?.reset(core);
          internalModel.pose?.updateParameters(core, 0);
          if (armAParameter >= 0) core.setParameterValueByIndex(armAParameter, welcomeArms ? 0 : 1);
          if (armBParameter >= 0) core.setParameterValueByIndex(armBParameter, welcomeArms ? 1 : 0);
          core.setPartOpacityById("PartArmA", welcomeArms ? 0 : 1);
          core.setPartOpacityById("PartArmB", welcomeArms ? 1 : 0);
          // Synchronize the selected part after the explicit assignment. With
          // its target already fully opaque, Pose has no fade left to perform.
          internalModel.pose?.updateParameters(core, 0);
        };
        const motionCanRun = (motion: OfficialMotion) => (
          motion.mode === "welcome"
            ? variantRef.current === "welcome"
            : variantRef.current === "player" && featuresRef.current.isPlaying
        );
        const snapToMotionBoundary = (motion: OfficialMotion) => {
          const authoredStart = MOTION_START_POSES[motion.id];
          const ignored = new Set(motion.ignoreParamIds ?? []);
          for (const { id, index } of restSettleParameters) {
            const explicitTarget = ignored.has(id) ? undefined : authoredStart[id];
            core.setParameterValueByIndex(index, explicitTarget ?? core.getParameterDefaultValue(index));
          }
          const welcomeArms = motion.mode === "welcome";
          setArmRigOwnership(welcomeArms);
        };
        const smootherstep = (value: number) => value ** 3 * (value * (value * 6 - 15) + 10);
        const restEase = (duration: number) => smootherstep(Math.min(1, restSettleElapsed / duration));
        const transitionParameterScale = (id: string) => {
          if (/EyeOpen|EyeSmile|Cheek|Leg|Shoulder|Breath/u.test(id)) return 1;
          if (/Hand/u.test(id)) return 10;
          if (/Arm/u.test(id)) return 30;
          return 30;
        };
        const getOfficialMotionElapsed = () => {
          const entries = internalModel.motionManager.queueManager?._motions;
          if (!entries?.length) return null;
          for (let index = entries.length - 1; index >= 0; index -= 1) {
            const entry = entries[index];
            if (!entry.isStarted() || entry.isFinished()) continue;
            const elapsed = entry.getStateTime() - entry.getStartTime();
            if (!Number.isFinite(elapsed) || elapsed < 0) return null;
            return elapsed;
          }
          return null;
        };
        const startOfficialMotion = async (motion: OfficialMotion, requestVersion: number) => {
          if (motionStartInFlightVersion !== null || requestVersion !== motionRequestVersion) return;
          motionStartInFlightVersion = requestVersion;
          let started = false;
          try {
            started = await internalModel.motionManager.startMotion(
              motion.group,
              motion.index,
              3,
              { ignoreParamIds: [...(motion.ignoreParamIds ?? [])] },
            );
          } catch (error) {
            console.warn(`Hiyori ${motion.id} motion will retry`, error);
          }
          if (motionStartInFlightVersion === requestVersion) motionStartInFlightVersion = null;
          if (requestVersion !== motionRequestVersion) {
            // A pause/resume may supersede a request while its file is loading.
            // Remove that stale result; the watchdog will restore the current
            // intended motion on the next frame if playback is active again.
            internalModel.motionManager.stopAllMotions();
            motionWatchdog = 0;
            return;
          }
          if (!motionCanRun(motion)) {
            internalModel.motionManager.groups.idle = RESTING_IDLE_GROUP;
            internalModel.motionManager.stopAllMotions();
            return;
          }
          if (started) {
            activeMotion = motion;
            activeMotionRuntime = 0;
            lastMotionCycleTime = 0;
            poseTransitionTarget = null;
            poseTransitionElapsed = 0;
            poseTransitionEndpointRendered = false;
            poseTransitionStarting = false;
            poseTransitionStartValues.clear();
            poseTransitionStartVelocities.clear();
            poseTransitionTargetValues.clear();
          }
          // A false result can occur when the SDK still owns a stale reservation.
          // The watchdog below retries only if no official queue entry exists.
          if (!started) {
            poseTransitionStarting = false;
            motionWatchdog = 0;
          }
        };
        const beginPoseTransition = (motion: OfficialMotion) => {
          if (!motionCanRun(motion) || motionStartInFlightVersion !== null || poseTransitionTarget !== null) return false;
          const authoredStart = MOTION_START_POSES[motion.id];
          const ignored = new Set(motion.ignoreParamIds ?? []);
          let normalizedDistance = 0;
          poseTransitionStartValues.clear();
          poseTransitionStartVelocities.clear();
          poseTransitionTargetValues.clear();
          for (const { id, index } of restSettleParameters) {
            const start = core.getParameterValueByIndex(index);
            const explicitTarget = ignored.has(id) ? undefined : authoredStart[id];
            const target = explicitTarget ?? core.getParameterDefaultValue(index);
            poseTransitionStartValues.set(index, start);
            poseTransitionStartVelocities.set(index, poseVelocities.get(index) ?? 0);
            poseTransitionTargetValues.set(index, target);
            normalizedDistance = Math.max(
              normalizedDistance,
              Math.abs(target - start) / transitionParameterScale(id),
            );
          }
          poseTransitionDuration = POSE_TRANSITION_MIN_SECONDS
            + (POSE_TRANSITION_MAX_SECONDS - POSE_TRANSITION_MIN_SECONDS) * Math.min(1, normalizedDistance);
          poseTransitionTarget = motion;
          poseTransitionElapsed = 0;
          poseTransitionEndpointRendered = false;
          poseTransitionStarting = false;
          pendingMotion = null;
          motionRequestVersion += 1;
          motionWatchdog = 0;
          internalModel.motionManager.stopAllMotions();
          return true;
        };
        const cancelMotionControllers = () => {
          motionRequestVersion += 1;
          motionWatchdog = 0;
          pendingMotion = null;
          poseTransitionTarget = null;
          poseTransitionElapsed = 0;
          poseTransitionEndpointRendered = false;
          poseTransitionStarting = false;
          poseTransitionStartValues.clear();
          poseTransitionStartVelocities.clear();
          poseTransitionTargetValues.clear();
          internalModel.motionManager.groups.idle = RESTING_IDLE_GROUP;
          internalModel.motionManager.stopAllMotions();
        };
        const startWelcomeMotion = (motion: OfficialMotion) => {
          cancelMotionControllers();
          activeMotion = motion;
          activeMotionRuntime = 0;
          lastMotionCycleTime = 0;
          snapToMotionBoundary(motion);
          const requestVersion = ++motionRequestVersion;
          motionWatchdog = 0.55;
          return startOfficialMotion(motion, requestVersion);
        };
        const hardResetForStageVariant = (nextVariant: StageVariant) => {
          cancelMotionControllers();
          wasListening = false;
          restSettleElapsed = Number.POSITIVE_INFINITY;
          restStartValues.clear();
          if (nextVariant === "welcome") {
            welcomeMotionCursor = 0;
            void startWelcomeMotion(OFFICIAL_MOTIONS.m06);
            return;
          }
          // The scene curtain is fully opaque when React changes this variant.
          // Reset the incompatible Arm B welcome rig to the player's Arm A rest
          // pose here, never during a visible cross-controller transition.
          activeMotion = OFFICIAL_MOTIONS.m01;
          for (const { index } of restSettleParameters) {
            core.setParameterValueByIndex(index, core.getParameterDefaultValue(index));
          }
          setArmRigOwnership(false);
        };

        const applyMusicPose = () => {
          // The active official curves remain the performance. Music adds only a
          // small downbeat accent before Physics, preserving authored easing,
          // facial timing, arm movement, and secondary follow-through.
          const welcomePerformance = variantRef.current === "welcome" && activeMotion.mode === "welcome";
          if (!featuresRef.current.isPlaying && !welcomePerformance) return;
          const seamStart = activeMotion.duration - MOTION_LOOP_SEAM_SECONDS;
          // Read the queue entry's real clock. A capped render dt can lag behind
          // Cubism after a dropped frame and expose the raw loop boundary once.
          const elapsed = getOfficialMotionElapsed();
          const motionTime = elapsed === null ? null : elapsed % activeMotion.duration;
          const wrappedBoundaryFrame = motionTime !== null
            && lastMotionCycleTime > seamStart
            && motionTime < 0.08;
          if (motionTime !== null && (motionTime > seamStart || wrappedBoundaryFrame)) {
            // Cubism resets the queue clock from duration to zero inside the
            // boundary update. Preserve the full endpoint correction on that
            // exact rendered frame instead of letting one raw end pose flash.
            const seamProgress = wrappedBoundaryFrame
              ? 1
              : Math.min(1, (motionTime - seamStart) / MOTION_LOOP_SEAM_SECONDS);
            const seamEase = seamProgress * seamProgress * (3 - 2 * seamProgress);
            for (const [id, correction] of MOTION_LOOP_CORRECTIONS[activeMotion.id]) {
              if (activeMotion.ignoreParamIds?.includes(id)) continue;
              addMusicParameter(id, correction * seamEase, 1);
            }
          }
          if (motionTime !== null) lastMotionCycleTime = motionTime;
          if (!featuresRef.current.isPlaying) return;
          addMusicParameter("ParamAngleY", -poseNod * (4.2 + bass * 1.4), 0.72);
          addMusicParameter("ParamBodyAngleY", -poseNod * 0.9, 0.48);
          addMusicParameter("ParamBodyAngleX", poseSway * poseGroove * (0.72 + bass * 1.05) + switchAccent * 0.42, 0.2);
          addMusicParameter("ParamAngleZ", -poseSway * poseGroove * (0.55 + bass * 0.72) + switchAccent * 0.28, 0.18);
          addMusicParameter("ParamCheek", energy * 0.08, 0.12);
        };
        const applyPoseTransition = () => {
          if (poseTransitionTarget === null || !motionCanRun(poseTransitionTarget)) return;
          const progress = Math.min(1, poseTransitionElapsed / poseTransitionDuration);
          const progress2 = progress * progress;
          const progress3 = progress2 * progress;
          const h00 = 2 * progress3 - 3 * progress2 + 1;
          const h10 = progress3 - 2 * progress2 + progress;
          const h01 = -2 * progress3 + 3 * progress2;

          for (const { id, index } of restSettleParameters) {
            const start = poseTransitionStartValues.get(index) ?? core.getParameterDefaultValue(index);
            const target = poseTransitionTargetValues.get(index) ?? core.getParameterDefaultValue(index);
            const velocityLimit = transitionParameterScale(id) * 3;
            const measuredVelocity = poseTransitionStartVelocities.get(index) ?? 0;
            const startVelocity = Math.max(-velocityLimit, Math.min(velocityLimit, measuredVelocity));
            const value = h00 * start
              + h10 * poseTransitionDuration * startVelocity
              + h01 * target;
            core.setParameterValueByIndex(index, value);
          }
          if (progress >= 1) poseTransitionEndpointRendered = true;
        };
        const applyRestPose = () => {
          if (restSettleElapsed >= REST_SETTLE_SECONDS || featuresRef.current.isPlaying) return;
          const poseEase = restEase(REST_SETTLE_SECONDS);
          const eyeEase = restEase(REST_EYE_HANDOFF_SECONDS);
          // This runs immediately after the authored motion and before the SDK
          // saves its baseline, applies focus/breath, and evaluates Physics.
          // Secondary hair and ribbon movement therefore follows the deceleration.
          for (const { id, index } of restSettleParameters) {
            const start = restStartValues.get(index) ?? core.getParameterDefaultValue(index);
            const target = core.getParameterDefaultValue(index);
            const eased = REST_EYE_OPEN_PARAM_IDS.has(id) ? eyeEase : poseEase;
            core.setParameterValueByIndex(index, start + (target - start) * eased);
          }
        };
        const applyRestEyeHandoff = () => {
          if (restSettleElapsed >= REST_EYE_HANDOFF_SECONDS || featuresRef.current.isPlaying) return;
          const eased = restEase(REST_EYE_HANDOFF_SECONDS);
          // Auto blink runs after afterMotionUpdate. Blend toward its live value
          // here so it can take ownership without one open/closed-frame flash.
          for (const index of restEyeOpenIndexes) {
            const start = restStartValues.get(index) ?? core.getParameterDefaultValue(index);
            const blinkValue = core.getParameterValueByIndex(index);
            core.setParameterValueByIndex(index, start + (blinkValue - start) * eased);
          }
        };
        const capturePoseHistory = () => {
          const now = performance.now() / 1000;
          const sampleDt = Math.min(0.05, Math.max(0.001, now - poseHistoryAt));
          for (const { index } of restSettleParameters) {
            const value = core.getParameterValueByIndex(index);
            const previous = poseHistoryValues.get(index);
            if (previous !== undefined) {
              const measured = (value - previous) / sampleDt;
              const filtered = (poseVelocities.get(index) ?? measured) * 0.58 + measured * 0.42;
              poseVelocities.set(index, Math.max(-120, Math.min(120, filtered)));
            }
            poseHistoryValues.set(index, value);
          }
          poseHistoryAt = now;
        };
        // `afterMotionUpdate` belongs to InternalModel, not MotionManager. Binding
        // it to the manager silently skips every pose controller and turns clip
        // changes into hard cuts when the next authored motion takes ownership.
        internalModel.on("afterMotionUpdate", applyPoseTransition);
        internalModel.on("afterMotionUpdate", applyMusicPose);
        internalModel.on("afterMotionUpdate", applyRestPose);
        internalModel.on("afterMotionUpdate", capturePoseHistory);
        internalModel.on("beforeModelUpdate", applyRestEyeHandoff);
        cleanupMotionPose = () => {
          internalModel.off("afterMotionUpdate", applyPoseTransition);
          internalModel.off("afterMotionUpdate", applyMusicPose);
          internalModel.off("afterMotionUpdate", applyRestPose);
          internalModel.off("afterMotionUpdate", capturePoseHistory);
          internalModel.off("beforeModelUpdate", applyRestEyeHandoff);
        };

        app.ticker.add(() => {
          const features = featuresRef.current;
          const dt = Math.min(1 / 30, Math.max(0.001, app?.ticker.deltaMS ? app.ticker.deltaMS / 1000 : 1 / 60));
          const follow = (value: number, target: number, speed: number) => (
            value + (target - value) * (1 - Math.exp(-speed * dt))
          );
          const listening = features.isPlaying ? 1 : 0;

          if (activeStageVariant !== variantRef.current) {
            activeStageVariant = variantRef.current;
            hardResetForStageVariant(activeStageVariant);
          }

          if (sceneLayoutSnapRef.current) {
            cameraZoom = variantRef.current === "player" ? manualZoomRef.current : 1;
            currentCameraZoomRef.current = cameraZoom;
            currentModelScale = targetModelScale;
            currentRigX = targetRigX;
            currentRigY = targetRigY;
            const snapPortraitFactor = focusModeRef.current || isCompactLayout ? 0.14 : 0.29;
            currentPortraitOffset = Math.max(0, cameraZoom - 1) * host.clientHeight * snapPortraitFactor;
            model.scale.set(currentModelScale);
            contactShadow.scale.set(currentModelScale);
            cameraRig.position.set(currentRigX, currentRigY + currentPortraitOffset);
            cameraRig.scale.set(cameraZoom);
            sceneLayoutSnapRef.current = false;
          }

          if (features.isPlaying && !wasListening) {
            // Playback begins from the restrained m01 clip. Later changes are
            // explicitly scheduled on learned beats; random Idle remains off.
            internalModel.motionManager.groups.idle = RESTING_IDLE_GROUP;
            // Clear any stale SDK reservation before requesting the authored
            // listening loop. This does not affect a pause pose because this
            // branch runs only on the rising edge of playback.
            internalModel.motionManager.stopAllMotions();
            activeMotion = OFFICIAL_MOTIONS.m01;
            pendingMotion = null;
            beginPoseTransition(activeMotion);
            rhythmPhase = 0;
            beatClock = 0;
            beatCount = 0;
            beatsSinceGesture = 16;
            pendingBeatAccent = 0;
            lightImpulse = 0;
            lightAccentCooldown = 0;
            lightTier = 0;
            lightTierTarget = 0;
            lightTierStep = 0;
            timeSinceLightAccent = Number.POSITIVE_INFINITY;
            hasNoddedSincePlay = false;
            timeSinceOnset = beatInterval;
            nodGestureTime = Number.POSITIVE_INFINITY;
            nodGestureStrength = 0;
            restSettleElapsed = Number.POSITIVE_INFINITY;
            restStartValues.clear();
            hasPlayed = true;
            lastTransient = features.transient;
            lastBassInput = features.bass;
          } else if (!features.isPlaying && wasListening) {
            // Capture every channel authored by the admitted motions, stop the performance, then
            // ease the whole pose to neutral before Physics. Blink gets a shorter
            // late-stage handoff to avoid flashing between controller owners.
            restStartValues.clear();
            for (const { index } of restSettleParameters) {
              restStartValues.set(index, core.getParameterValueByIndex(index));
            }
            restSettleElapsed = 0;
            poseTransitionTarget = null;
            poseTransitionElapsed = 0;
            poseTransitionEndpointRendered = false;
            poseTransitionStarting = false;
            poseTransitionStartValues.clear();
            poseTransitionStartVelocities.clear();
            poseTransitionTargetValues.clear();
            motionRequestVersion += 1;
            pendingMotion = null;
            motionWatchdog = 0;
            internalModel.motionManager.groups.idle = RESTING_IDLE_GROUP;
            internalModel.motionManager.stopAllMotions();
            beatClock = 0;
            pendingBeatAccent = 0;
            lightImpulse = 0;
            lightAccentCooldown = 0;
            lightTierTarget = 0;
            lightTierStep = 0;
            timeSinceLightAccent = Number.POSITIVE_INFINITY;
            hasNoddedSincePlay = false;
            nodGestureTime = Number.POSITIVE_INFINITY;
            nodGestureStrength = 0;
            pausedCameraZoom = currentCameraZoomRef.current;
          }
          wasListening = features.isPlaying;

          // The synthesized joint transition renders its exact endpoint for one
          // complete frame. Only then does the target authored clip start at its
          // identical first keyframe, so there is no pose ownership overlap.
          if (
            poseTransitionTarget
            && motionCanRun(poseTransitionTarget)
            && poseTransitionEndpointRendered
            && !poseTransitionStarting
            && motionStartInFlightVersion === null
          ) {
            poseTransitionStarting = true;
            const requestVersion = ++motionRequestVersion;
            motionWatchdog = 0.55;
            void startOfficialMotion(poseTransitionTarget, requestVersion);
          }

          // Loading or a stale priority reservation can occasionally reject the
          // first startMotion request. Poll slowly and restart only when the
          // official queue is genuinely empty, never on every render frame.
          motionWatchdog = Math.max(0, motionWatchdog - dt);
          if (
            poseTransitionTarget === null
            && motionCanRun(activeMotion)
            && motionStartInFlightVersion === null
            && motionWatchdog === 0
            && getOfficialMotionElapsed() === null
          ) {
            motionWatchdog = 0.55;
            const requestVersion = ++motionRequestVersion;
            void startOfficialMotion(activeMotion, requestVersion);
          }

          activity = follow(activity, listening, features.isPlaying ? 3.2 : 7.5);
          energy = follow(energy, features.energy * listening, features.isPlaying ? 7 : 5.5);
          energyLong = follow(energyLong, features.energy * listening, features.isPlaying ? 0.7 : 2.8);
          bass = follow(bass, features.bass * listening, features.isPlaying ? 6 : 5.2);
          treble = follow(treble, features.treble * listening, features.isPlaying ? 4.5 : 4.4);

          // Raw onsets can arrive at hi-hat or subdivision speed. They estimate the
          // tempo and drive light, but a separate body-beat clock schedules Hiyori's
          // nod so repeated transients cannot collapse the spring into a static lean.
          onsetCooldown = Math.max(0, onsetCooldown - dt);
          lightAccentCooldown = Math.max(0, lightAccentCooldown - dt);
          timeSinceLightAccent += dt;
          timeSinceOnset += dt;
          const transientRise = features.transient - lastTransient;
          const bassInputRise = Math.max(0, features.bass - lastBassInput);
          transientFloor = follow(
            transientFloor,
            features.transient,
            features.transient < transientFloor ? 5.2 : 0.55,
          );
          const onsetStrength = Math.max(
            0,
            features.transient - transientFloor,
            transientRise * 1.4,
            bassInputRise * 1.9,
          );
          const detectedOnset = transientRise > 0.014 || bassInputRise > 0.012 || onsetStrength > 0.055;
          if (features.isPlaying && onsetCooldown === 0 && detectedOnset && onsetStrength > 0.025) {
            if (timeSinceOnset >= 0.16 && timeSinceOnset <= 1.6) {
              let candidate = timeSinceOnset;
              // Fold fast subdivisions upward and long gaps downward into a
              // natural 60–120 BPM body groove rather than nodding at every hit.
              while (candidate < 0.5) candidate *= 2;
              while (candidate > 1) candidate *= 0.5;
              const source = features.source;
              const bins = tempoBinsBySource[source];
              const binIndex = Math.max(0, Math.min(bins.length - 1, Math.round((candidate - 0.51) / 0.02)));
              const tempoWeight = 0.28 + Math.min(1, onsetStrength * 4.5) * 0.72;
              for (let index = 0; index < bins.length; index += 1) bins[index] *= 0.997;
              bins[binIndex] += tempoWeight;
              if (binIndex > 0) bins[binIndex - 1] += tempoWeight * 0.28;
              if (binIndex < bins.length - 1) bins[binIndex + 1] += tempoWeight * 0.28;
              tempoEvidenceBySource[source] += 1;
              if (tempoEvidenceBySource[source] >= 6) {
                let strongestBin = 0;
                for (let index = 1; index < bins.length; index += 1) {
                  if (bins[index] > bins[strongestBin]) strongestBin = index;
                }
                learnedBeatIntervalBySource[source] = 0.51 + strongestBin * 0.02;
                targetBeatInterval = learnedBeatIntervalBySource[source];
              }
            }
            pendingBeatAccent = Math.max(pendingBeatAccent, Math.min(1, onsetStrength * 5 + bass * 0.24));
            // The solid disc answers low-frequency accents, not every broadband
            // transient. The gate rejects hi-hat subdivisions; the cooldown and
            // envelope keep repeated kick evidence from becoming visual chatter.
            const lowFrequencyAccent = Math.min(
              1,
              Math.max(0, bassInputRise - 0.012) * 13
                + Math.max(0, bass - 0.14) * Math.max(0, onsetStrength - 0.05) * 2.8,
            );
            if (lightAccentCooldown === 0 && lowFrequencyAccent > 0.12) {
              // Consecutive downbeats climb through three stable size tiers.
              // A gap starts a new phrase at tier one; the tier then releases
              // slowly, while a smaller impulse preserves the exact hit.
              lightTierStep = timeSinceLightAccent > 1.05 ? 1 : Math.min(3, lightTierStep + 1);
              lightTierTarget = lightTierStep / 3;
              timeSinceLightAccent = 0;
              lightImpulse = Math.max(lightImpulse, 0.3 + lowFrequencyAccent * 0.42);
              lightAccentCooldown = 0.34;
            }
            if (treble > 0.12) particlePulse = Math.max(particlePulse, Math.min(1, onsetStrength * 4.2 + treble * 0.24));
            timeSinceOnset = 0;
            onsetCooldown = 0.16;
          }

          // Homepage choreography is a separate Arm B performance. Each clip
          // leaves through its first authored return window, before Cubism can
          // wrap the loop clock. Avoiding a completed PRO loop removes the
          // expensive endpoint correction/reset frame that looked like a drop.
          if (
            variantRef.current === "welcome"
            && activeMotion.mode === "welcome"
            && poseTransitionTarget === null
          ) {
            const welcomeElapsed = getOfficialMotionElapsed();
            const welcomeMotionTime = welcomeElapsed === null
              ? null
              : welcomeElapsed % activeMotion.duration;
            const dwellBeforeChange = activeMotion.duration * 0.55;
            const inReturnWindow = welcomeMotionTime !== null
              && welcomeMotionTime >= activeMotion.duration - MOTION_LOOP_SEAM_SECONDS;
            if (activeMotionRuntime >= dwellBeforeChange && inReturnWindow) {
              const nextCursor = (welcomeMotionCursor + 1) % WELCOME_MOTION_SEQUENCE.length;
              const nextMotion = OFFICIAL_MOTIONS[WELCOME_MOTION_SEQUENCE[nextCursor]];
              if (beginPoseTransition(nextMotion)) welcomeMotionCursor = nextCursor;
            }
          }
          lastTransient = features.transient;
          lastBassInput = features.bass;
          beatInterval = follow(beatInterval, targetBeatInterval, 1.25);
          beatClock += dt * listening;
          pendingBeatAccent *= Math.exp(-0.65 * dt);
          const firstAudibleBeat = !hasNoddedSincePlay && pendingBeatAccent > 0.25 && beatClock >= 0.14;
          const strongEarlyBeat = hasNoddedSincePlay && pendingBeatAccent > 0.42 && beatClock >= beatInterval * 0.82;
          const scheduledBeat = hasNoddedSincePlay && beatClock >= beatInterval;
          if (features.isPlaying && energy > 0.015 && (firstAudibleBeat || scheduledBeat || strongEarlyBeat)) {
            beatClock = scheduledBeat ? Math.max(0, beatClock - beatInterval) : 0;
            const nearestBeat = Math.round(rhythmPhase / Math.PI) * Math.PI;
            rhythmPhase += (nearestBeat - rhythmPhase) * 0.42;
            const gestureVariation = 0.84 + Math.sin(variationPhase * 1.7) * 0.1 + Math.sin(variationPhase * 0.63 + 1.4) * 0.06;
            const gestureStrength = Math.min(1, 0.48 + energy * 0.72 + pendingBeatAccent * 0.5);
            nodGestureTime = 0;
            nodGestureStrength = gestureStrength * gestureVariation;
            beatCount += 1;
            beatsSinceGesture += 1;

            // Full authored gestures begin and end only on this same learned
            // beat edge. The nod is intentionally independent and immediate,
            // so it keeps exact rhythmic contact while the motion contributes
            // larger arm, face, and torso phrasing over several beats.
            const motionElapsed = getOfficialMotionElapsed();
            const phraseBoundary = beatCount % 8 === 0;
            if (poseTransitionTarget !== null) {
              // The joint transition already owns the pose; do not queue another clip
              // until its target has taken over at the identical boundary.
            } else if (activeMotion.role === "gesture") {
              if (pendingMotion === null && activeMotionRuntime >= activeMotion.duration - Math.min(0.72, beatInterval)) {
                const baseId = BASE_MOTION_SEQUENCE[baseMotionCursor % BASE_MOTION_SEQUENCE.length];
                pendingMotion = OFFICIAL_MOTIONS[baseId];
                baseMotionCursor += 1;
              }
            } else {
              const energeticPhrase = energy > 0.38 || bass > 0.4 || pendingBeatAccent > 0.62;
              const gestureInterval = energeticPhrase ? 8 : 16;
              const canQueueMotion = activeMotionRuntime >= 0.85;
              const phraseGestureDue = phraseBoundary && beatsSinceGesture >= gestureInterval;
              if (pendingMotion === null && canQueueMotion && phraseGestureDue) {
                const gestureId = GESTURE_MOTION_SEQUENCE[
                  gestureMotionCursor % GESTURE_MOTION_SEQUENCE.length
                ];
                pendingMotion = OFFICIAL_MOTIONS[gestureId];
                gestureMotionCursor += 1;
              } else if (
                pendingMotion === null
                && canQueueMotion
                && phraseBoundary
                && activeMotionRuntime >= activeMotion.duration * 1.6
              ) {
                // Quiet passages still evolve: rotate among the three official
                // Idle performances after a complete cycle.
                const baseId = BASE_MOTION_SEQUENCE[baseMotionCursor % BASE_MOTION_SEQUENCE.length];
                if (OFFICIAL_MOTIONS[baseId].id !== activeMotion.id) {
                  pendingMotion = OFFICIAL_MOTIONS[baseId];
                  baseMotionCursor += 1;
                }
              }
            }

            // A musical phrase can request the next action, but the actual join
            // waits for the outgoing clip's authored return window. This keeps
            // the switch on a learned beat without cutting an arm gesture at its
            // apex. A single synthesized joint motion then reaches the target's
            // exact first keyframe before that authored clip begins.
            const transitionWindow = Math.min(MOTION_LOOP_SEAM_SECONDS, Math.max(0.42, beatInterval * 0.9));
            const atConnectorAnchor = motionElapsed !== null
              && motionElapsed >= activeMotion.duration - transitionWindow;
            if (pendingMotion && atConnectorAnchor) {
              const nextMotion = pendingMotion;
              if (beginPoseTransition(nextMotion)) {
                if (nextMotion.role === "gesture") beatsSinceGesture = 0;
              }
            }
            pendingBeatAccent = 0;
            hasNoddedSincePlay = true;
          }
          rhythmPhase += dt * Math.PI / beatInterval * listening;
          variationPhase += dt * (0.17 + energy * 0.06);
          nodGestureTime += dt;
          restSettleElapsed += dt;
          const motionClockActive = features.isPlaying
            || (variantRef.current === "welcome" && activeMotion.mode === "welcome");
          if (poseTransitionTarget) poseTransitionElapsed += dt * (motionClockActive ? 1 : 0);
          else activeMotionRuntime += dt * (motionClockActive ? 1 : 0);
          const nodProgress = Math.min(1, nodGestureTime / 0.36);
          const smoothstep = (value: number) => value * value * (3 - 2 * value);
          const nodEnvelope = nodProgress < 0.3
            ? smoothstep(nodProgress / 0.3)
            : 1 - smoothstep((nodProgress - 0.3) / 0.7);
          lightImpulse *= Math.exp(-2.15 * dt);
          if (timeSinceLightAccent > 0.58) lightTierTarget *= Math.exp(-0.72 * dt);
          if (!features.isPlaying) lightTierTarget = 0;
          lightTier = follow(
            lightTier,
            lightTierTarget * listening,
            lightTierTarget > lightTier ? 5.4 : features.isPlaying ? 0.9 : 2.8,
          );
          lightPulse = follow(lightPulse, lightImpulse * listening, lightImpulse > lightPulse ? 7.2 : 2.8);
          particlePulse *= Math.exp(-1.35 * dt);

          // Camera movement lives on a separate rig. It follows phrase-scale
          // energy and never uses individual onsets, keeping musical pose and
          // framing independent. Wheel input temporarily takes priority.
          cameraPhase += dt * (0.36 + energyLong * 0.08) * listening;
          const phraseArc = (1 - Math.cos(cameraPhase)) * 0.5;
          const autoZoom = features.isPlaying
            ? 1.46 + phraseArc * 0.54 + energyLong * 0.07
            : variantRef.current === "player" ? (hasPlayed ? pausedCameraZoom : 2.02) : 1;
          const autoSuspended = performance.now() < autoSuspendUntilRef.current;
          const baseCameraZoom = variantRef.current === "welcome"
            ? 1
            : cameraModeRef.current === "locked" || autoSuspended
              ? manualZoomRef.current
              : Math.max(1.42, Math.min(2.1, autoZoom));
          const containedCameraZoom = containModelRef.current && !focusModeRef.current && cameraModeRef.current === "auto" ? 1 : baseCameraZoom;
          const focusCameraBias = focusModeRef.current ? 0.2 : 0;
          const targetCameraZoom = Math.min(2.35, containedCameraZoom + focusCameraBias);
          const focusCameraTransitioning = performance.now() < focusCameraTransitionUntilRef.current;
          const portraitOffsetFactor = focusModeRef.current || isCompactLayout ? 0.14 : 0.29;
          if (focusCameraSnapRef.current) {
            // Focus layout commits only while the solid scene curtain is opaque.
            // Snap the complete Pixi camera composition in that hidden frame;
            // revealing a settled rig avoids simultaneous resize/zoom motion.
            cameraZoom = targetCameraZoom;
            currentCameraZoomRef.current = cameraZoom;
            currentModelScale = targetModelScale;
            currentRigX = targetRigX;
            currentRigY = targetRigY;
            currentPortraitOffset = Math.max(0, cameraZoom - 1) * host.clientHeight * portraitOffsetFactor;
            focusCameraSnapRef.current = false;
          } else {
            cameraZoom = follow(cameraZoom, targetCameraZoom, focusCameraTransitioning ? 2.8 : autoSuspended ? 5.2 : 0.95);
            currentCameraZoomRef.current = cameraZoom;
            currentModelScale = follow(currentModelScale, targetModelScale, 3.6);
            currentRigX = follow(currentRigX, targetRigX, 3.2);
            currentRigY = follow(currentRigY, targetRigY, 3.2);
            const targetPortraitOffset = Math.max(0, cameraZoom - 1) * host.clientHeight * portraitOffsetFactor;
            currentPortraitOffset = follow(
              currentPortraitOffset,
              targetPortraitOffset,
              focusCameraTransitioning ? 2.8 : 4.2,
            );
          }
          model.scale.set(currentModelScale);
          contactShadow.scale.set(currentModelScale);
          cameraRig.position.set(currentRigX, currentRigY + currentPortraitOffset);
          cameraRig.scale.set(cameraZoom);

          if (lastSource !== features.source) {
            lastSource = features.source;
            switchAccent = features.source === 0 ? -1 : 1;
            targetBeatInterval = learnedBeatIntervalBySource[features.source];
            beatInterval = targetBeatInterval;
            beatClock = 0;
            pendingBeatAccent = 0;
            timeSinceOnset = beatInterval;
            lastTransient = features.transient;
            lastBassInput = features.bass;
            transientFloor = features.transient;
          }
          switchAccent *= Math.exp(-2.2 * dt);

          const followsComparedTrack = features.isComparing && features.isPlaying;
          const sourceGaze = followsComparedTrack ? (features.source === 0 ? -0.82 : 0.82) : pointerX * 0.32;
          const sourceGazeY = followsComparedTrack ? (isCompactLayout ? 0.24 : 0.18) : pointerY * 0.22;
          gazeX = follow(gazeX, sourceGaze, features.isComparing ? 2.6 : 4.2);
          gazeY = follow(gazeY, sourceGazeY, 3.4);
          // This controller accepts normalized coordinates directly. `model.focus()`
          // expects world-space pixels, which would make an A/B target near zero
          // collapse toward the upper-left corner rather than the intended side.
          focusController.focus(gazeX, gazeY);

          const phaseDrift = Math.sin(variationPhase * 0.71) * 0.12;
          const amplitudeDrift = 0.86 + Math.sin(variationPhase) * 0.1 + Math.sin(variationPhase * 0.43 + 0.8) * 0.04;
          poseSway = Math.sin(rhythmPhase + phaseDrift);
          poseGroove = activity * Math.min(1, 0.28 + energy * 0.9 + bass * 1.35) * amplitudeDrift;
          poseNod = nodEnvelope * nodGestureStrength * activity;

          const stage = stageRef.current;
          if (stage) {
            stage.style.setProperty("--music-energy", energy.toFixed(3));
            stage.style.setProperty("--music-energy-long", energyLong.toFixed(3));
            stage.style.setProperty("--music-bass", bass.toFixed(3));
            stage.style.setProperty("--beat-pulse", lightPulse.toFixed(3));
            stage.style.setProperty("--beat-tier", lightTier.toFixed(3));
            stage.style.setProperty("--particle-strength", particlePulse.toFixed(3));
            stage.style.setProperty("--music-active", activity.toFixed(3));
            stage.style.setProperty("--camera-zoom", cameraZoom.toFixed(3));
            stage.style.setProperty("--camera-rig-x", currentRigX.toFixed(3));
            stage.style.setProperty("--camera-rig-y", (currentRigY + currentPortraitOffset).toFixed(3));
            stage.style.setProperty("--model-scale", currentModelScale.toFixed(5));
          }
        }, undefined, UPDATE_PRIORITY.HIGH);

        if (variantRef.current === "welcome") {
          welcomeMotionCursor = 0;
          await startWelcomeMotion(OFFICIAL_MOTIONS.m06);
        }
        if ("fonts" in document) await document.fonts.ready;
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        layout();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        layout();
        currentModelScale = targetModelScale;
        currentRigX = targetRigX;
        currentRigY = targetRigY;
        cameraZoom = containModelRef.current && !focusModeRef.current
          ? 1
          : variantRef.current === "player"
          ? Math.min(2.35, manualZoomRef.current + (focusModeRef.current ? 0.2 : 0))
          : 1;
        const initialPortraitFactor = focusModeRef.current || isCompactLayout ? 0.14 : 0.29;
        currentPortraitOffset = Math.max(0, cameraZoom - 1) * host.clientHeight * initialPortraitFactor;
        currentCameraZoomRef.current = cameraZoom;
        model.scale.set(currentModelScale);
        contactShadow.scale.set(currentModelScale);
        cameraRig.position.set(currentRigX, currentRigY + currentPortraitOffset);
        cameraRig.scale.set(cameraZoom);
        model.automator.autoUpdate = true;
        model.update(16.67);
        app.render();
        canvasRevealed = true;
        canvas.style.visibility = "";
        if (!disposed) setStatus("ready");
      } catch (error) {
        console.error("Live2D model failed to load", error);
        if (!disposed) setStatus("error");
      }
    }

    void mountModel();
    return () => {
      disposed = true;
      layoutRef.current = null;
      resizeObserver?.disconnect();
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      cleanupPointer?.();
      cleanupMotionPose?.();
      if (zoomTimerRef.current !== null) window.clearTimeout(zoomTimerRef.current);
      try {
        if (cleanupModel) {
          cleanupModel();
          destroyApp();
        }
      } catch (error) {
        console.warn("Live2D cleanup completed with a renderer warning", error);
      }
    };
  }, [featuresRef]);

  const listeningLabel = variant === "welcome"
    ? "Waiting for a track"
    : !isPlaying
      ? "Paused · resting"
      : isComparing
        ? `Listening to ${activeSource === 0 ? "A" : "B"}`
        : "Listening with you";

  return (
    <section ref={stageRef} className={`live2d-stage live2d-stage-${variant} light-${activeSource === 0 ? "a" : "b"} ${isPlaying ? "is-playing" : "is-paused"} ${focusMode ? "is-focused" : ""}`} aria-label="Interactive music companion">
      <div className="stage-music-disc" />
      <div className="stage-particles" aria-hidden="true">
        {PARTICLES.map(([left, top, delay, duration], index) => (
          <span
            key={index}
            style={{ "--particle-left": `${left}%`, "--particle-top": `${top}%`, "--particle-delay": `${delay}s`, "--particle-duration": `${duration}s` } as React.CSSProperties}
          />
        ))}
      </div>
      <div className="live2d-host" ref={hostRef} />
      <div className="stage-topline">
        <span><i className={status === "ready" ? "is-ready" : ""} /> {status === "ready" ? listeningLabel : `Hiyori / ${status}`}</span>
        <span>{trackLabel}</span>
      </div>
      {status === "error" && (
        <div className="model-error">Live2D could not start. Audio playback remains available.</div>
      )}
      {variant === "player" && (
        <div className="camera-capsule" aria-label="Camera controls">
          <button
            type="button"
            className={cameraPreset === "director" ? "is-active" : ""}
            aria-pressed={cameraMode === "auto"}
            title="Toggle automatic phrase-level framing"
            onClick={() => {
              if (cameraMode === "auto") {
                manualZoomRef.current = currentCameraZoomRef.current;
                setCameraMode("locked");
                setCameraPreset("manual");
              } else {
                autoSuspendUntilRef.current = 0;
                setCameraMode("auto");
                setCameraPreset("director");
              }
            }}
          >
            {cameraMode === "auto" ? <Sparkles size={15} strokeWidth={1.7} /> : <Lock size={14} strokeWidth={1.7} />}
            <span>{cameraMode === "auto" ? "Director" : "Manual"}</span>
          </button>
          <i aria-hidden="true" />
          <button
            type="button"
            title="Portrait framing — Hiyori from the waist up"
            aria-label="Portrait upper-body framing"
            className={cameraPreset === "portrait" ? "is-active" : ""}
            onClick={() => {
              manualZoomRef.current = 2.12;
              cameraModeRef.current = "locked";
              autoSuspendUntilRef.current = Number.POSITIVE_INFINITY;
              setCameraMode("locked");
              setCameraPreset("portrait");
              setZoomReadout(212);
              setShowZoom(true);
              if (zoomTimerRef.current !== null) window.clearTimeout(zoomTimerRef.current);
              zoomTimerRef.current = window.setTimeout(() => setShowZoom(false), 1100);
            }}
          >
            <ScanFace size={15} strokeWidth={1.7} />
            <span>Portrait</span>
          </button>
          <i aria-hidden="true" />
          <button
            type="button"
            title="Wide framing"
            aria-label="Wide full-body framing"
            className={cameraPreset === "wide" ? "is-active" : ""}
            onClick={() => {
              manualZoomRef.current = 1;
              autoSuspendUntilRef.current = Number.POSITIVE_INFINITY;
              cameraModeRef.current = "locked";
              setCameraMode("locked");
              setCameraPreset("wide");
              setZoomReadout(100);
              setShowZoom(true);
              if (zoomTimerRef.current !== null) window.clearTimeout(zoomTimerRef.current);
              zoomTimerRef.current = window.setTimeout(() => setShowZoom(false), 1100);
            }}
          >
            <ScanLine size={15} strokeWidth={1.7} />
            <span>Wide</span>
          </button>
          <span className={`camera-zoom ${showZoom ? "is-visible" : ""}`}>{zoomReadout}%</span>
          <span className="camera-hint"><Mouse size={11} strokeWidth={1.7} /> scroll to frame</span>
        </div>
      )}
      {variant === "welcome" && onPickAudio && (
        <div className="stage-invitation">
          <span>YOUR MUSIC, HER MOVEMENT</span>
          <strong>Hiyori is ready to listen.</strong>
          <button type="button" onClick={onPickAudio}>Choose audio</button>
          <small>or drop one audio file anywhere on the stage</small>
        </div>
      )}
    </section>
  );
}
