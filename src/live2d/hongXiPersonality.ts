// Values are offsets from the exported neutral pose. Sleeve roots are authored
// controls; their child rotations, hair and torso remain owned by Physics.
export const HONG_XI_PERSONALITY_PARAMS = [
  "ParamAngleX", "ParamAngleY", "ParamAngleZ",
  "ParamMouthForm", "ParamEyeLSmile", "ParamEyeRSmile",
  "ParamBrowLY", "ParamBrowRY", "ParamBrowLForm", "ParamBrowRForm",
  "Param31", "Param32", "Param_Angle_Rotation9", "Param_Angle_Rotation13",
] as const;
type Parameter = typeof HONG_XI_PERSONALITY_PARAMS[number];
type Pose = Partial<Record<Parameter, number>> & { eyesClosed?: number };
type Keyframe = readonly [seconds: number, pose: Pose];

export const HONG_XI_GESTURES = {
  hello: [
    [0, {}],
    [0.65, { ParamAngleX: -7, ParamAngleZ: -9, ParamMouthForm: 0.65, ParamBrowLY: 0.18, ParamBrowRY: 0.18, Param_Angle_Rotation9: -5 }],
    [1.35, { ParamAngleX: 5, ParamAngleZ: 7, ParamMouthForm: 0.8, ParamEyeLSmile: 0.65, ParamEyeRSmile: 0.65, Param_Angle_Rotation13: 5 }],
    [2.2, { ParamAngleY: -5, ParamMouthForm: 0.8, ParamEyeLSmile: 0.8, ParamEyeRSmile: 0.8, eyesClosed: 0.7 }],
    [3.6, {}],
  ],
  curious: [
    [0, {}],
    [0.85, { ParamAngleX: -6, ParamAngleY: 4, ParamAngleZ: -13, ParamBrowLY: 0.4, ParamBrowRY: 0.15, ParamMouthForm: 0.3 }],
    [1.9, { ParamAngleX: -4, ParamAngleY: 2, ParamAngleZ: -11, ParamMouthForm: 0.55, Param_Angle_Rotation9: 5, Param_Angle_Rotation13: -3 }],
    [3.2, {}],
  ],
  doubleNod: [
    [0, {}],
    [0.45, { ParamAngleY: 3, ParamMouthForm: 0.4 }],
    [0.8, { ParamAngleY: -10, ParamMouthForm: 0.65, ParamEyeLSmile: 0.5, ParamEyeRSmile: 0.5 }],
    [1.18, { ParamAngleY: 2, ParamMouthForm: 0.65 }],
    [1.55, { ParamAngleY: -8, ParamMouthForm: 0.7, ParamEyeLSmile: 0.65, ParamEyeRSmile: 0.65, eyesClosed: 0.4 }],
    [2.65, {}],
  ],
  bliss: [
    [0, {}],
    [0.85, { ParamAngleY: 4, ParamAngleZ: -7, ParamMouthForm: 0.8, ParamEyeLSmile: 1, ParamEyeRSmile: 1, eyesClosed: 0.92, Param_Angle_Rotation9: -5, Param_Angle_Rotation13: 5 }],
    [2.1, { ParamAngleY: 2, ParamAngleZ: 7, ParamMouthForm: 0.85, ParamEyeLSmile: 1, ParamEyeRSmile: 1, eyesClosed: 0.92, Param_Angle_Rotation9: -3, Param_Angle_Rotation13: 3 }],
    [3.15, { ParamAngleY: -3, ParamMouthForm: 0.65, ParamEyeLSmile: 0.7, ParamEyeRSmile: 0.7, eyesClosed: 0.55 }],
    [4.4, {}],
  ],
  shy: [
    [0, {}],
    [0.8, { ParamAngleX: 6, ParamAngleY: -6, ParamAngleZ: 8, Param31: 0.8, ParamMouthForm: 0.6, Param_Angle_Rotation9: 6, Param_Angle_Rotation13: -6 }],
    [1.8, { ParamAngleX: 4, ParamAngleY: -4, ParamAngleZ: 6, Param31: 0.9, ParamMouthForm: 0.8, ParamEyeLSmile: 0.8, ParamEyeRSmile: 0.8, eyesClosed: 0.65, Param_Angle_Rotation9: 6, Param_Angle_Rotation13: -6 }],
    [3.5, {}],
  ],
  sparkle: [
    [0, {}],
    [0.6, { ParamAngleY: 6, ParamAngleZ: -5, Param32: 1, ParamMouthForm: 0.8, ParamBrowLY: 0.3, ParamBrowRY: 0.3, Param_Angle_Rotation9: -7, Param_Angle_Rotation13: 7 }],
    [1.5, { ParamAngleY: 2, ParamAngleZ: 5, Param32: 1, ParamMouthForm: 0.85, Param_Angle_Rotation9: -4, Param_Angle_Rotation13: 4 }],
    [2.25, { ParamAngleY: -5, ParamMouthForm: 0.7, ParamEyeLSmile: 0.7, ParamEyeRSmile: 0.7 }],
    [3.5, {}],
  ],
} as const satisfies Record<string, readonly Keyframe[]>;
export type HongXiGesture = keyof typeof HONG_XI_GESTURES;
const POSE_KEYS = [...HONG_XI_PERSONALITY_PARAMS, "eyesClosed"] as const;
const ease = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

export function sampleHongXiGesture(gesture: HongXiGesture, elapsed: number): Pose {
  const frames: readonly Keyframe[] = HONG_XI_GESTURES[gesture];
  if (elapsed <= 0 || elapsed >= frames[frames.length - 1][0]) return {};
  const next = frames.findIndex(([time]) => time >= elapsed);
  const [start, from] = frames[next - 1];
  const [end, to] = frames[next];
  const weight = ease((elapsed - start) / (end - start));
  return Object.fromEntries(POSE_KEYS.map((id) => [id, (from[id] ?? 0) + ((to[id] ?? 0) - (from[id] ?? 0)) * weight]));
}

type DirectorInput = { dt: number; playing: boolean; welcome: boolean; energy: number; beatCount: number };

export class HongXiPersonality {
  private active: HongXiGesture | null = null;
  private elapsed = 0;
  private restTime = 0;
  private lastBeat = 0;
  private wasPlaying = false;
  private previous: HongXiGesture | null = null;
  private pendingReaction = false;
  private reactionCursor = 0;
  private bag: HongXiGesture[] = [];
  private pose: Pose = {};
  private releasePose: Pose | null = null;
  private releaseTime = 0;
  private greeted = false;

  constructor(private random: () => number = Math.random) {}

  react() { this.pendingReaction = true; }

  get gesture() { return this.active; }

  update({ dt, playing, welcome, energy, beatCount }: DirectorInput): Pose {
    dt = Math.max(0, Math.min(0.1, dt));
    if (this.wasPlaying && !playing && !welcome) {
      this.releasePose = { ...this.pose };
      this.releaseTime = 0;
      this.active = null;
      this.pendingReaction = false;
      this.restTime = 0;
    }
    if (playing && !this.wasPlaying) this.lastBeat = beatCount;
    this.wasPlaying = playing;
    if (this.releasePose) {
      this.releaseTime += dt;
      const weight = 1 - ease(Math.min(1, this.releaseTime / 0.65));
      this.pose = Object.fromEntries(POSE_KEYS.map((id) => [id, (this.releasePose?.[id] ?? 0) * weight]));
      if (weight === 0) this.releasePose = null;
      return this.pose;
    }
    if (this.active) {
      this.elapsed += dt;
      this.pose = sampleHongXiGesture(this.active, this.elapsed);
      const frames = HONG_XI_GESTURES[this.active];
      if (this.elapsed >= frames[frames.length - 1][0]) {
        this.previous = this.active;
        this.active = null;
        this.restTime = 0;
        this.lastBeat = beatCount;
      }
      return this.pose;
    }
    this.restTime += dt;
    const greeting = welcome && !this.greeted && this.restTime >= 0.8;
    const phrase = playing && this.restTime >= 2.5 && beatCount - this.lastBeat >= 8;
    const quietPassage = playing && this.restTime >= 9;
    const welcomeMoment = welcome && this.restTime >= 6;
    if (this.pendingReaction || greeting || phrase || quietPassage || welcomeMoment) {
      let next: HongXiGesture;
      if (this.pendingReaction) {
        const reactions = ["hello", "shy", "sparkle", "bliss", "curious", "doubleNod"] as const;
        next = reactions[this.reactionCursor++ % reactions.length];
        if (next === this.previous) next = reactions[this.reactionCursor++ % reactions.length];
      } else if (greeting) {
        next = "hello";
      } else {
        // A shuffle bag gives every gesture a turn without mechanical cycling
        // or repeated rolls of the same gesture. Star eyes suit energetic music.
        if (!this.bag.length) {
          this.bag = ["curious", "doubleNod", "bliss", "shy", ...(energy > 0.3 ? ["sparkle" as const] : [])];
          for (let i = this.bag.length - 1; i > 0; i--) {
            const j = Math.floor(this.random() * (i + 1));
            [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
          }
        }
        const candidate = this.bag.findIndex((id) => id !== this.previous && (id !== "sparkle" || energy > 0.3));
        next = candidate >= 0 ? this.bag.splice(candidate, 1)[0] : this.previous === "curious" ? "bliss" : "curious";
        if (candidate < 0) this.bag = [];
      }
      this.greeted = true;
      this.pendingReaction = false;
      this.active = next;
      this.elapsed = 0;
    }
    this.pose = {};
    return this.pose;
  }
}
