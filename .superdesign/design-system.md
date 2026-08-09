# Vibloom design system

## Product and experience

Vibloom is a private, browser-only music player and synchronized A/B comparison tool. Hiyori is not a mascot in a card; she is the living center of the listening room. The interface must make three states legible without changing visual language: no track, one-track listening, and two-track comparison.

## Visual direction

- Warm editorial listening room, informed by Hiyori's cream cardigan, navy uniform, muted red ribbons, and soft anime rendering.
- UI ornamentation leans toward restrained hand-drawn Japanese stationery: warm washi-like paper grain, slightly imperfect ink rules, pencil-soft icon contours, and small hanko-inspired A/B marks. It should feel illustrated by hand, not themed like an anime fan site.
- Hand-drawn character belongs in the edges and surfaces: subtly irregular borders, occasional short brush underlines, and quiet margin annotations. Preserve generous negative space and precise control alignment so the player remains trustworthy.
- Quiet ivory paper background with subtle texture; deep navy editorial type; muted teal for A and coral rose for B.
- Use generous negative space and thin structural rules. Cards should feel like pieces of a listening console, not generic dashboard widgets.
- Large serif headlines may introduce a mode, but controls and metadata use a compact neutral sans-serif.
- Hiyori remains visually integrated through composition, ambient light, and overlap—not through a bordered character panel.
- Avoid gradients with saturated neon color, glassmorphism spectacle, waveform-as-decoration, fake eye-tracking rays, dashed gaze lines, callout arrows, explanatory orbital diagrams, or technical legends.
- Avoid kawaii sticker overload, sakura decoration, manga speed lines, heavy black comic outlines, faux handwritten body copy, or jittering controls. Hand-drawn irregularity is visual only and must never compromise hit targets or alignment.

## Layout

- Listening mode uses a record-book hierarchy with no overlap: editorial masthead, a separate A / session / B score strip, an uninterrupted Live2D stage, then one synchronized transport shelf.
- A and B are structurally above the stage and aligned to its left and right edges. Hiyori's damped eye and head focus can look upward-left or upward-right toward credible spatial targets without any connector decoration.
- Solo retains the same score strip so adding B feels like completing the facing page.
- Mobile keeps both compact track notes above the character, followed by the uninterrupted stage and transport. Never place cards across the model's feet or body.

## Components

- Track notes: flat manuscript rows inside the score strip, separated by fine ink rules rather than floating rounded cards. Use a hanko-like A/B identity marker, concise metadata, restrained active underline, and no decorative connector.
- Track state language: use `READY` for a decoded inactive track, `CUED` for the selected paused track, and `PLAYING` only while audio is audible. Do not pair a generic success checkmark with overlapping hover-only actions. Replace and Remove remain stable, separately labeled controls that reserve their own layout space.
- Status capsule: compact text only; it can state Listening to A/B but must not draw a line toward a target.
- Transport: shared clock and play control are primary. A/B selector is adjacent and unambiguous. Waveform-like amplitude bars are functional seeking context only.
- Buttons: navy primary, ivory paper secondary, pencil-soft icon treatment, clear keyboard focus. Every interactive surface has exactly one persistent boundary; never duplicate its border with an offset pseudo-element or inset ring. Depth comes from a soft diffuse shadow, while an extra outline appears only for `:focus-visible`.
- Icon system: secondary actions use one optically balanced 1.7px rounded monoline family with geometric SVG rendering and 32–40px hit areas. Filled geometry is reserved for the primary play/pause control. Product title, session title, status, and metadata must remain four distinct typographic levels.
- Brand mark: one navy rounded-square silhouette with no permanent outer contour, inset ring, or hard bottom-edge shadow.
- Precision time: current time and total duration use tabular numerals, never wrap, and occupy a reserved column wide enough for two `00:00.000` values plus separator. Timeline A/B row labels must never share that overflow space.
- Camera controls: a small stage-edge capsule with Director/Manual state, explicit Portrait and Wide presets, and a transient zoom readout. Entering the player establishes a 212% upper-body portrait before handing off to the Director; wheel framing switches to persistent Manual control. Manual framing may reach 235%. Never use a permanent large zoom slider.
- Secondary controls and status copy should not repeat the same information. File removal stays discoverable on hover/focus; clear-all remains visually subordinate; privacy and keyboard help may recede further once the listening scene is active.

## Motion principles

- Every music-driven change is continuous and phase-coherent. Never launch random authored full-body motions on isolated thresholds.
- The visible beat must be expressed through Hiyori's internal pose parameters, never by translating, rotating, or scaling the entire Live2D display object. A scheduled body beat produces one explicit 360ms down-and-recover head-nod envelope; bass shapes internal body sway.
- Percussive onset detection and character gesture scheduling are separate layers. Fold dense subdivisions into a learned 0.5–1.0 second body-beat histogram per track; lights may answer individual accents, but Hiyori nods once on the learned body beat so the down-and-return arc remains visible.
- Hair, skirt, and ribbons are outputs of Hiyori's authored Physics and must follow head/body movement naturally rather than being driven directly.
- A/B gaze changes use normalized eye/head focus targets with damping. Do not visualize the gaze path with UI decoration.
- Automatic camera changes operate at phrase scale and must be perceptible without becoming rhythmic zoom: use bounded 12–18 second push/pull arcs between roughly 142% and 210%, velocity-limited easing, and no onset-driven camera changes. Start near portrait framing, then let the phrase arc earn the pull-back.
- Official Hiyori motion is the primary performance layer. During playback, run the complete `hiyori_m01` curve set and add only a low-weight scheduled beat accent before Physics. Never replace the official face, arms, torso, blink, and secondary timing with a deterministic pose system.
- The official 4.7-second listening loop has non-matching head, eye, and torso endpoints. Close only its final 720ms seam with a smooth endpoint correction driven by Cubism's actual motion-queue time, never an independently integrated render clock. Keep the automatic Idle group disabled and start only m01 explicitly, so m02/m05 can never leak into an async startup frame.
- Pause is a visible semantic transition: cancel queued beats and stop the authored listening motion in the input frame, ease every m01-authored channel to model defaults over roughly 680ms before Physics, and blend eye openness into the SDK blink controller over 280ms. Do not run a looping Idle motion in silence.
- Playing state must read before close inspection through Hiyori's complete official listening motion plus the restrained beat accent. Paused state stops that performance and settles into the SDK's quiet blink, Natural Breath, pointer focus, and Physics.
- Only gated low-frequency accents may pulse the solid A/B music disc. Give them a roughly 340ms refractory period and a softened attack/decay envelope; broadband transients and treble subdivisions may affect sparse particles but never the disc. Never add an ambient bloom or floor light. Keep the physical contact shadow narrow, centered, and independent from the colored field.
- Music color is one solid, edge-clean A/B circle behind Hiyori. It remembers consecutive gated low-frequency accents: the first downbeat enters a small size tier, the second a medium tier, and the third the largest tier, followed by a slow release. The full accumulated range is roughly 24% plus a small 4% hit accent; opacity remains nearly stable so the motion reads clearly without flashing. It has no gradient, blur, floor-light duplicate, or relationship to the contact shadow.
- On the landing stage, the solid circle and Hiyori share one subject anchor: 58% / 54% on the desktop composition and 50% / 54% on narrow screens. Do not add a second welcome halo, scan light, or decorative orbit behind it.
- Hiyori has exactly one neutral contact shadow: a narrow blurred ellipse directly beneath her feet inside the same Pixi camera rig as the model. It follows model framing, zoom, and position exactly, but never reads music features or changes color with the music circle.
- Loading or decoding progress may extend the file-copy column downward, but the audio icon keeps the same top baseline before, during, and after processing.
- Focus Mode is always reversible. Keep a persistent high-contrast Leave Focus control above the scene, support `F` to toggle and `Escape` to leave, and never fade the exit control with the surrounding chrome.
- Focus Mode preserves A/B listening without adding a second control set. Keep the existing transport A/B selector and make the audible waveform unmistakably dominant while the inactive waveform recedes.
- Paused Hiyori keeps only restrained breathing, SDK blinking, physics settling, and pointer gaze. No authored looping performance may continue in silence.
- Landing → player uses a two-phase solid-color curtain: cover the viewport, commit and snap the complete destination layout under the opaque curtain, hold for two rendered frames, then reveal the already-positioned persistent stage and staggered console. The interstitial leads with the editorial phrase “The room is listening.” rather than repeating the product name. Never snapshot or duplicate the Pixi canvas; use transform and opacity only, and honor reduced motion.
- Focus mode is a reversible staged shot. Entering withdraws header context and the score strip, slides the focus control in from the edge, moves the camera controls, then pushes Hiyori's Pixi camera 0.2× closer. Exiting reverses the camera and brings the desk, score, and controls back with staggered motion. The single Pixi canvas stays mounted and must not be resized on every frame of a CSS height tween; preserve Hiyori's exact viewport-space position when the stage origin changes, ease portrait offset separately, and repaint immediately after any real backing-buffer resize. Never restore focus chrome or Hiyori as a one-frame visibility cut.
- During playback, EyeOpen follows the official motion curves. When no motion is active, the SDK's automatic blink resumes; do not add a competing custom blink writer.

## Tokens

- Background: #f8f4ed
- Primary ink: #202b46
- Muted ink: #737786
- Track A: #5b8d86
- Track B: #d45f73
- Ready: #61c79a
- Surface: rgba(255, 252, 247, 0.92)
- Border: rgba(32, 43, 70, 0.14)
- Display font: Georgia, Times New Roman, serif
- UI font: Inter-like system sans-serif
- Main radii: 14px, 22px, 26px
- Breakpoints: 900px, 600px
