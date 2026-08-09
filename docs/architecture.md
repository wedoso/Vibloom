# Vibloom architecture

Vibloom is a static React/Vite application. Audio decoding, analysis, playback, Live2D rendering, and A/B switching all run inside the browser tab. The production build has no server runtime and remains deployable directly to GitHub Pages.

## Runtime flow

```text
Local File(s)
    │
    ├─ FileReader progress → Web Audio decode → AudioBuffer A/B
    ├─ optional LRC → Unicode decode → timestamp/offset parser → lyric timeline
    │
    ├─ one shared AudioContext clock → synchronized BufferSource nodes
    │                                  └─ 18 ms A/B gain crossfade
    │
    └─ analyser for audible source
           └─ energy + bass/mid/treble + transient/bass flux
                    ├─ per-track tempo evidence and body-beat scheduler
                    ├─ Hiyori pose/expression state machine
                    ├─ solid music-disc pulse and particles
                    └─ phrase-scale automatic camera
```

`src/App.tsx` owns files, decoded buffers, the shared playback clock, seeking, A/B gain switching, timed lyric state, and the current interaction state. `src/lrc.ts` decodes and parses optional lyrics. `src/audioVisual.ts` samples the analyser. `src/Live2DStage.tsx` consumes the latest features through a ref so the render loop does not require React state updates at 60 fps.

## Optional LRC timeline

- One optional lyric timeline belongs to the listening session and remains synchronized when the user switches Audio A/B.
- `src/lrc.ts` accepts UTF-8 plus BOM-marked UTF-16LE/UTF-16BE, parses centisecond or millisecond timestamps, applies `[offset:]`, expands repeated timestamps, and combines distinct same-time lines for bilingual lyrics.
- React derives the active line from the same `currentTime` used by the waveform and playhead. The next timestamp defines the current line's fill progress.
- Only the lyric viewport scrolls. Its active line is centered programmatically without moving the document.
- The active fill uses the current source accent: green for A and rose for B. A registered CSS color property smooths the transition during track switching.
- The font stack explicitly falls back through English, Simplified Chinese, Traditional Chinese, and Japanese system/CJK families.
- LRC text is never uploaded or persisted; clearing the session removes the parsed timeline.

## Audio clock and A/B behavior

- The landing page accepts one Track A file through a single invitation integrated into Hiyori's stage. The same surface contains the file-picker action and drag/drop hint; a compact player-side action requests Track B, so neither a duplicate homepage uploader nor an empty comparison panel competes with the primary listening path.
- Before B is requested, React renders only Track A's score note and waveform. Requesting B immediately changes the score strip to equal A/B portions; the B waveform and source selector then share the same state boundary.
- A and B use one `AudioContext.currentTime` reference.
- Both sources start at the same scheduled time and timeline offset.
- Switching tracks changes gain only. It never seeks, changes playback rate, or restarts the clock.
- An 18 ms crossfade prevents clicks while preserving comparison timing.
- The longer decoded file defines the shared timeline. A shorter selected source intentionally becomes silent after its own end.
- Pausing updates the interaction ref, silences the master output, and stops sources in the same input frame.

## Music feature pipeline

The audible track produces these normalized features:

- `energy`: time-domain RMS used for overall activity.
- `bass`: 35–190 Hz, used for body weight and kick evidence.
- `mid`: 190–2400 Hz, retained in the shared feature contract while Hiyori's facial performance remains authored by the official motion.
- `treble`: 2400–10000 Hz, used for restrained particle activity.
- `transient`: combined broadband energy rise and bass spectral rise.

Raw onsets are not mapped directly to body movement. Fast subdivisions would make Hiyori twitch at hi-hat speed. Instead, Vibloom folds detected intervals into a 0.5–1.0 second body-groove range, accumulates a per-source tempo histogram, and schedules one body beat at a time.

Each scheduled beat starts a 360 ms asymmetric nod envelope: a quick eased downward accent followed by a longer recovery. It is added at low weight to the official listening motion before Physics, so it reads as musical emphasis without replacing Hiyori's authored timing. Gesture strength follows current energy, bass, and onset evidence. The scheduler cannot continue after playback is paused.

## Live2D motion orchestration

Vibloom uses the official Hiyori PRO `t11` runtime, but the clips' emotional and structural meanings are not interchangeable. The player choreography whitelist contains `m01`, `m02`, `m03`, and `m05`; the homepage has a separate welcome whitelist containing raised-arm `m06` and compact celebratory `m08`. `m04` (upset/pouting), `m07` (startled), `m09` (angry/shouting), and `m10` (distressed/shouting) remain in the official package but are never loaded or scheduled.

The motion manager has two explicit states:

- **Homepage:** `m06` supplies the raised-arm greeting and `m08` supplies a short celebratory accent. Each leaves during its first authored return window, before Cubism wraps the PRO loop clock; this avoids an endpoint correction/reset frame on the landing page. Both keep Arm A hidden and Arm B visible, mask the speaking-mouth channel, and transition only within this compatible set.
- **Playing:** `m01`, `m02`, and `m05` form the base listening rotation and `m03` supplies the restrained phrase gesture. All four keep Arm A visible and Arm B hidden at their boundaries. `m02` ignores blush, smile, brow, and mouth expression curves; `m05` ignores its speaking/singing mouth. Vibloom then adds only a small beat accent after the official motion update.
- **Paused or ready:** the Idle group is disabled and all authored motions stop. The SDK's automatic blink, Natural Breath, pointer focus, and Physics remain active, producing a quiet living pose rather than a frozen image.

Every admitted motion declares itself as looping, but several authored curves have different start and end values. A direct modulo loop can therefore produce a visible one-frame pose jump. Vibloom stores the measured endpoint delta for every whitelisted clip, leaves the authored motion unchanged until its final 720 ms, then smoothly returns those curves to their exact starting values. The correction reads Cubism's active motion-queue clock directly rather than integrating the renderer's capped `dt`. It also detects the exact update in which Cubism has already reset that clock to zero while still rendering the old endpoint; that boundary frame receives the complete correction instead of exposing one raw end pose.

The SDK's automatic Idle group remains disabled during both rest and playback. Vibloom starts every clip explicitly, preventing an unscheduled random action from landing between beats.

The PRO files omit fade metadata, which makes the Cubism runtime inject a one-second motion fade and restart it at every loop. Vibloom explicitly disables motion fade-in, fade-out, and loop fade-in for the admitted clips.

Clip changes use a single synthesized joint trajectory. A phrase first queues its requested action; the switch waits for a learned beat inside the outgoing clip's authored return window. At the join, Vibloom stops the outgoing authored controller, captures the one visible pose and its measured joint velocities, and moves that same pose along a cubic Hermite path to the target clip's exact first keyframe. The path is distance-scaled from 380 to 680 ms, preserves the outgoing velocity, and arrives with zero velocity because every admitted clip has a stationary first keyframe. No incoming motion runs underneath it, no two poses are weighted together, and no opacity channel is animated. The exact endpoint is rendered for a complete frame; only on the following update does the target authored clip start at that identical parameter state.

The two compatible sets never use that connector across their boundary. Loading or clearing the first track opens the solid scene curtain; React changes the stage variant only after the curtain fully covers the viewport. During that hidden commit, Vibloom stops the current controller, restores model parameters, sets Arm A/Arm B ownership directly for the destination, and prepares its first pose. The curtain remains opaque for two more paint opportunities before reveal. The unavoidable mesh swap is therefore a scene cut, never a visible motion fade or hard pose jump.

The beat tracker remains the timing authority. Its 360 ms nod begins on every accepted learned beat, independent of the longer authored clip. Full motions may change only on that same beat edge: energetic material can introduce a reviewed gesture after eight beats, restrained material waits sixteen, and all normal changes land on eight-beat phrase boundaries. Gestures return to the rotating base motion on a beat near their authored ending; quiet passages still rotate base motions after a complete cycle. A/B source changes affect gaze and the existing low-weight body accent only.

The first `startMotion` request can occasionally be rejected while Cubism still owns a stale loading or priority reservation. Playback therefore clears stale reservations before requesting `Idle[0]`, then runs a 550 ms watchdog. The watchdog requests the same official motion only when playback is active, no request is in flight, and Cubism's motion queue is genuinely empty. It never stacks multiple motions or falls back to a random Idle clip.

When pause lands partway through an authored gesture or synthesized transition, Vibloom cancels that controller, captures every parameter authored by the admitted whitelist, and eases the complete pose to model defaults for 1.2 seconds with zero velocity at both ends. The handoff runs before Physics and Pose. Eye openness uses a shorter 360 ms transfer into the SDK's live blink value. After the handoff, every channel is released.

## Playback states

### Ready or paused

- No new onset or scheduled beat can start.
- The listening motion stops and all queued musical beats are cleared immediately.
- The complete authored pose—including admitted arm/hand channels, brows, gaze, shoulder, leg, breath, and ahoge—eases upright over 1.2 seconds before Physics and Pose.
- A/B listening gaze returns to center; pointer gaze remains available.
- SDK blink, restrained Natural Breath, pointer focus, and Physics remain alive.
- The automatic camera holds the framing captured at pause instead of continuing to push or pull.

### Playing

- The restrained official `hiyori_m01` performance starts from its authored beginning, then the beat/phrase scheduler introduces only the reviewed whitelist.
- Facial timing, arms, torso motion, and secondary movement come from the official motion and Physics.
- Scheduled body beats add a restrained, visible nod accent without replacing the authored pose.
- In comparison mode, gaze follows the currently audible A or B track.

The paused state is intentionally quiet, not a frozen bitmap. Natural secondary motion must not be confused with a rhythmic head or torso gesture.

## Stage visuals and camera

- One edge-clean solid circle sits behind Hiyori. Phrase energy controls its slow breathing range. Gated low-frequency accents climb through three accumulated size tiers: roughly 8%, 16%, and 24%, plus a small 4% exact-hit accent. After 580 ms without a qualifying hit, the accumulated tier releases slowly. Opacity stays nearly constant, so the response is legible without flashing.
- The circle has no gradient, blur halo, duplicate floor light, or shadow relationship.
- The single neutral contact shadow is a Pixi graphic inside Hiyori's camera rig. Its center is offset above the model texture's transparent lower padding so its soft core overlaps the visible soles. It shares the model's position and scale, so wide/close transitions cannot separate the two.
- Automatic camera motion follows phrase-scale energy, never individual onsets.
- Entering the player begins on an upper-body close-up. Mouse-wheel input locks manual framing; the Director control resumes automatic framing.
- Pausing holds the current automatic shot.

## Focus-mode transition

Focus mode changes the composition rather than simply hiding elements:

- a navy editorial iris covers the viewport when entering; a warm paper iris covers it when leaving;
- React commits the focus layout only after the iris is fully opaque;
- Hiyori's Pixi camera receives its additional 0.2× close-up bias, while rig position, model scale, portrait offset, contact shadow, and renderer size snap to the final composition during the hidden frame;
- the curtain stays opaque for two further paint opportunities before revealing the settled stage;
- the score strip, header context, compact transport, Focus button, and camera controls may still use staggered entrance animation after the structural cut.

The Live2D canvas remains mounted throughout. Stage height is not CSS-tweened because that would repeatedly clear and resize Pixi's WebGL backing buffer. Resize observations are coalesced, and the renderer repaints synchronously after a genuine size change. No visible frame contains both a layout resize and a moving Live2D camera, removing the compositor race that previously appeared as character shake.

On initial landing load, the canvas stays hidden while fonts settle and two animation frames recompute the final host bounds. The renderer, model scale, camera rig, and first PRO pose are then painted once at their target geometry before the canvas becomes visible. There is no visible easing from provisional loading coordinates. The welcome camera is fixed at `1.0x`; the player's `1.42x` automatic minimum never leaks into the homepage.

Arm B ownership is assigned only after CubismPose has initialized its model cache, preventing its implicit first-update reset and 0.5-second part fade. Motion connectors use the complete authored first keyframe—including explicit zero-valued Arm B hand channels—so the final connector frame and the target motion's first frame are identical.

The standard waveform and A/B selector remain the only track controls in both layouts. `prefers-reduced-motion: reduce` disables decorative choreography while preserving the state change.

## Landing-to-player transition

`withSceneTransition` uses a two-phase compositor-friendly curtain. The landing and player remain two arrangements of the same listening room:

- a solid A/B-tinted circle expands to cover the viewport;
- React commits the layout change only after the curtain is opaque;
- the curtain remains opaque for two additional animation frames so React layout and the Pixi camera both finish before reveal;
- the persistent Pixi/Live2D canvas is never captured or duplicated;
- the curtain recedes while track score and console enter in restrained stagger;
- clearing the session uses the same sequence with the alternate accent color.

The interstitial reads “The room is listening.” rather than repeating the product name. The animation uses transform and opacity only, avoiding expensive canvas filters and clip-path snapshots. `prefers-reduced-motion: reduce` skips the curtain and commits the scene immediately.

## Static deployment

`npm run build` emits `dist/` containing static HTML, JavaScript, CSS, images, Cubism Core, and the Hiyori assets. Vite uses relative asset paths, so the same output works at a domain root or a GitHub Pages repository path.

The deployment workflow runs the checks and publishes `dist/`. No API keys, server functions, database, cookies, analytics, or upload endpoint are required.

## Validation

Run the complete suite with:

```bash
npm run check
```

The checks cover the portable build, multilingual/offset/UTF-16 LRC parsing, synchronized audio clock, immediate pause signaling, Live2D parameter ownership, beat scheduling, camera separation, stage-light/shadow invariants, responsive collision rules, and the landing/player transition fallback.
