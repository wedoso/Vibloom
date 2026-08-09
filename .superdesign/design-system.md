# Vibloom design system

## Product and experience

Vibloom is a private, browser-only local music library, continuous player, and synchronized A/B comparison tool. Hiyori is not a mascot in a card; she is the living center of the listening room. The interface must make empty library, library browsing, solo playback, comparison, queue, storage, and focus states legible without changing visual language or mounting a second application shell.

## Product architecture

- Player and Library are two workspaces inside one persistent player shell. The header, Hiyori stage, current-track identity, audio clock, queue, volume, and bottom transport never remount when the workspace changes.
- The header contains one aligned brand block and one right-side action cluster. Player / Library live in the compact left rail; comparison is progressive inside Player rather than a separate workspace. All header icons use the same 18px icon box, 1.7px stroke, and 36px hit target; labels share one baseline.
- Desktop uses a 72px navigation rail, one flexible work surface, and a protected Hiyori stage. The stage owns the full vertical area between header and transport; no heading, camera capsule, lyric strip, or transport may cover Hiyori's head, hands, skirt, legs, or feet.
- Track A is the currently playing library item and continues without interruption. Track B is added in place; after it is ready, equal A/B waveform cards, the shared timeline, and source selectors appear. Returning to Library changes only the work surface and preserves playback.
- Queue and Storage are deliberate 400–440px side sheets. Each sheet uses a 72px title row, vertically stacked sections, full-width action rows, and clear destructive separation. Never place three paragraph-heavy buttons in one horizontal row.
- On mobile, Library becomes a full-height work surface, Hiyori remains the Now Playing center, and the transport remains reachable without covering list content.

## Visual direction

- Warm editorial listening room, informed by Hiyori's cream cardigan, navy uniform, muted red ribbons, and soft anime rendering.
- UI ornamentation leans toward restrained hand-drawn Japanese stationery: warm washi-like paper grain, slightly imperfect ink rules, pencil-soft icon contours, and small hanko-inspired A/B marks. It should feel illustrated by hand, not themed like an anime fan site.
- Hand-drawn character belongs in the edges and surfaces: subtly irregular borders, occasional short brush underlines, and quiet margin annotations. Preserve generous negative space and precise control alignment so the player remains trustworthy.
- Quiet ivory paper background with subtle texture; deep navy editorial type; muted teal for A and coral rose for B.
- Use generous negative space and thin structural rules. Cards should feel like pieces of a listening console, not generic dashboard widgets.
- Large serif headlines may introduce a mode, but controls and metadata use a compact neutral sans-serif.
- Hiyori remains visually integrated through composition, ambient light, and overlap—not through a bordered character panel.
- Hiyori must always fit inside a measured safe area. In the standard player show her complete body with visible space above the hair and below the contact shadow; focus/portrait may crop below the knees but never crop the head or hands. Camera controls sit outside the model silhouette.
- Avoid gradients with saturated neon color, glassmorphism spectacle, waveform-as-decoration, fake eye-tracking rays, dashed gaze lines, callout arrows, explanatory orbital diagrams, or technical legends.
- Avoid kawaii sticker overload, sakura decoration, manga speed lines, heavy black comic outlines, faux handwritten body copy, or jittering controls. Hand-drawn irregularity is visual only and must never compromise hit targets or alignment.

## Layout

- Listening mode uses a record-book hierarchy with no overlap: editorial masthead, a progressive track score strip, an uninterrupted Live2D stage, then one synchronized transport shelf.
- The loaded-library shell is a stable four-band composition: 64px header, full-height work area, optional side sheet above the work area, and 88–96px transport. Work content scrolls inside its own column; the page itself does not slide beneath the transport.
- A and B are structurally above the stage and aligned to its left and right edges. Hiyori's damped eye and head focus can look upward-left or upward-right toward credible spatial targets without any connector decoration.
- The landing page exposes one audio entrance integrated into Hiyori's stage invitation; never duplicate it with a second upload card elsewhere on the page. In solo mode Track A owns the score strip, with a compact Add Track B affordance at its right edge; never reserve an equal empty B panel.
- Selecting B immediately resolves the strip to A / session / B, with equal A and B portions. Only then reveal the B waveform and A/B selector.
- Mobile keeps the active track note above the character and stacks the comparison affordance below it. Once B is added, both compact notes remain above the uninterrupted stage and transport. Never place cards across the model's feet or body.

## Components

- Track notes: flat manuscript rows inside the score strip, separated by fine ink rules rather than floating rounded cards. Use a hanko-like A/B identity marker, concise metadata, restrained active underline, and no decorative connector.
- Track state language: use `READY` for a decoded inactive track, `CUED` for the selected paused track, and `PLAYING` only while audio is audible. Do not pair a generic success checkmark with overlapping hover-only actions. Replace and Remove remain stable, separately labeled controls that reserve their own layout space.
- Status capsule: compact text only; it can state Listening to A/B but must not draw a line toward a target.
- Storage sheet: usage is a semantic block containing one label row and a separate 8px meter. The cache toggle uses a two-column label/control grid. Maintenance actions are stacked 48–56px rows with a title and one short subtitle; Reset is isolated below a divider.
- Transport: shared clock and play control are primary. Solo mode shows only A's waveform and a quiet single-track label. A/B source controls appear only after B has been requested; Focus adds two compact synchronized waveforms above the same transport rather than creating another player. Waveform-like amplitude bars are functional seeking context only.
- Persistent media: newly imported A and B files are kept in browser storage by default after a quota check. The library uses equal-size Available, On device, Lyrics, Reconnect, and Version B tags; Storage exposes automatic caching, cache clearing, and complete reset as visibly distinct actions.
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
- On the landing stage, compensate for the PRO texture's asymmetric transparent padding: Hiyori's camera rig remains at 58% / 54%, while the visible body axis and solid circle align at the stage midpoint / 54%. Do not add a second welcome halo, scan light, or decorative orbit behind it.
- Timed lyrics use the original listening-room theater: the complete LRC remains rendered, the active line scrolls to the exact viewport center, and its accent fill advances between adjacent timestamps. The compact player and Focus composition share this behavior.
- Timed-lyric progress uses the exact music-field source color: A is `rgb(84 127 121)` and B is `rgb(200 95 109)`. Do not substitute the library UI accent or a third lyric color.
- Functional waveform sections use those same source identities: A is `rgb(84 127 121)` and B is `rgb(200 95 109)`. Derive their bars, playhead, played range, border, and quiet surface tint from that exact RGB value so the waveform, lyric progress, and solid music circle remain one coherent system.
- Repeated sibling controls use measured geometry. Library state pills are 72×22px with identical 9px type and horizontal padding; Play all / Shuffle are 88×32px; same-level lyric actions are 72×24px.
- Hiyori has exactly one neutral contact shadow: a narrow blurred ellipse whose soft core overlaps the visible sole line inside the same Pixi camera rig as the model. The model texture contains transparent padding below the feet, so the shadow must use the measured visual foot offset rather than the texture bottom. It follows model framing, zoom, and position exactly, but never reads music features or changes color with the music circle.
- Loading or decoding progress may extend the file-copy column downward, but the audio icon keeps the same top baseline before, during, and after processing.
- Focus Mode is always reversible. Keep a persistent high-contrast Leave Focus control above the scene, support `F` to toggle and `Escape` to leave, and never fade the exit control with the surrounding chrome.
- Focus Mode preserves A/B listening without adding a second control set. Keep the existing transport A/B selector and make the audible waveform unmistakably dominant while the inactive waveform recedes.
- Paused Hiyori keeps only restrained breathing, SDK blinking, physics settling, and pointer gaze. No authored looping performance may continue in silence.
- Landing → player uses a two-phase solid-color curtain: cover the viewport, commit and snap the complete destination layout under the opaque curtain, hold for four rendered frames, then reveal the already-positioned persistent stage and staggered console. The interstitial leads with the editorial phrase “The room is listening.” rather than repeating the product name. Never snapshot or duplicate the Pixi canvas; use transform and opacity only, and honor reduced motion.
- Folder drops recursively preserve directory-relative paths when the browser exposes directory entries. Chrome and Safari accept direct folder drops; Firefox retains the visible folder-picker fallback when its drag API does not expose directory contents.
- The interface sans stack follows the original multilingual listening room: SF Pro / Segoe for Latin, then PingFang, Hiragino Sans, Yu Gothic, and Noto Sans CJK fallbacks. Editorial headings use Georgia for Latin with Songti, Hiragino Mincho, Yu Mincho, and Noto Serif CJK fallbacks.
- Where the lower stage boundary or essential status copy can intersect Hiyori, dissolve the final 58px of the canvas mask. Never use a hard rectangular cut through the legs.
- Focus mode is a reversible staged shot. Entering withdraws header context and the score strip, slides the focus control in from the edge, moves the camera controls, then pushes Hiyori's Pixi camera 0.2× closer. Exiting reverses the camera and brings the desk, score, and controls back with staggered motion. The single Pixi canvas stays mounted and must not be resized on every frame of a CSS height tween; preserve Hiyori's exact viewport-space position when the stage origin changes, ease portrait offset separately, and repaint immediately after any real backing-buffer resize. Never restore focus chrome or Hiyori as a one-frame visibility cut.
- Focus scene commits hide the persistent canvas only while the curtain is fully covering, repaint and settle the destination under that cover, and reveal the canvas with the disc already at its final center. Do not run a separate FLIP/WAAPI disc translation after the scene commit.
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
