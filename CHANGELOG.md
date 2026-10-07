# Changelog

Notable changes to Vibloom are recorded here. Release entries summarize the changes shipped from `main`.

## [1.8.0](https://github.com/wedoso/Vibloom/compare/v1.7.0...v1.8.0) (2026-10-07)

- Drop audio files, TXT/LRC lyrics, or nested folders into the Library. The import hint appears over the visible song list only while dragging, without shifting the layout; matching lyrics load with their songs.
- Organize music into virtual albums with your own cover images. Browse album sleeves, choose songs, and import or drag music into a collection. Albums and covers stay on-device.
- Edit TXT/LRC text, insert and delete lyric lines, and overwrite a selected line with the current playback time. Use `S` or `Command/Ctrl + Enter` to overwrite, and `T` to stamp and advance; export TXT or synced LRC.
- Restore the Library's editorial layout and introduce a two-pane lyric editor, with responsive layouts, saved drafts, undo, and preserved LRC metadata and translations.

## [1.7.0](https://github.com/wedoso/Vibloom/compare/v1.6.0...v1.7.0) (2026-10-03)

- Drive vocal mouth shapes with Live2D MotionSync, retaining continuous vowel blends and local vocal separation.
- Reprepare older lip-sync results with the new engine; songs, lyrics and playback settings are preserved.

## [1.6.0](https://github.com/wedoso/Vibloom/compare/v1.5.3...v1.6.0) (2026-10-02)

- Read release notes directly in the update window, including while downloading. See what's new in your installed version even when offline.
- Switch between Hong Xi and Hiyori with consistent fonts, control positions and shapes. Each companion keeps her own room colors.
- Improve Hong Xi's singing mouth form and opening so AA/E/I/O/U look more distinct, with smoother transitions and natural closures during silence.

## [1.5.3](https://github.com/wedoso/Vibloom/compare/v1.5.2...v1.5.3) (2026-09-28)

- Center all five TXT/LRC transport controls vertically without changing playback or scrubbing.
- Hold sustained vowels through brief energy dips and reject moderate-energy false PP closures; preserve confirmed silence and deep bilabial closures.
- Preserve independent vowel blends and add capability-tested Hong Xi mouth mapping. The bundled export's advanced channels are unbound, so it safely retains the generic mouth fallback.

## [1.5.2](https://github.com/wedoso/Vibloom/compare/v1.5.1...v1.5.2) (2026-09-27)

- Smooth singing jaw curves and vowel transitions; add restrained, persistent consonant shapes without increasing short-label chatter.
- Keep the lyric timing transport fixed while stamping lines, changing timestamp precision, or showing scrollbars.
- Enter Library lip-sync selection only when requested. Share per-source preparation jobs, live progress, cancellation, errors and results with Player, without duplicate analysis.

## [1.5.1](https://github.com/wedoso/Vibloom/compare/v1.5.0...v1.5.1) (2026-09-27)

- Stabilize vocal lip sync: drive opening from vocal energy, hold meaningful vowel shapes, reject brief false closures, and replace fixed viseme latency compensation with acoustic onset alignment. Existing analyses are reused.
- Animate the TXT/LRC editor playhead directly from the audio clock, with local drag previews and one seek on release.
- Use the new Vibloom icon across desktop packages, the app, browser tabs, and project documentation.

## [1.5.0](https://github.com/wedoso/Vibloom/compare/v1.4.0...v1.5.0) (2026-09-27)

- Estimate syllable mouth shapes from separated vocals with HeadAudio; preserve short closures, reduce response latency, and report WebGPU/CPU processing.
- Prepare selected songs from Library with a shared background queue, per-song progress, cancellation, and saved results.
- Fade between Live2D companions and enable Hiyori's **Say hello**, including while paused.
- Stabilize the TXT/LRC timing slider while dragging and keep timestamp changes from shifting its layout.

## [1.4.0](https://github.com/wedoso/Vibloom/compare/v1.3.0...v1.4.0) (2026-09-27)

- Add vocal-driven lip sync to Hong Xi and Hiyori using local Demucs separation. Save per-source timing, follow A/B selection and seeking, and close through instrumental passages, pause, or unavailable analysis. Prepare in the background with a progress bar, cancellation, and retry, then enable singing without interrupting playback.

- Preserve in-progress vocal preparation when repeating the current track.
- Make **Say hello** respond immediately during ambient gestures, with a smooth pose transition and visible feedback.

## [1.3.0](https://github.com/wedoso/Vibloom/compare/v1.2.0...v1.3.0) (2026-09-26)

### Features

- Import TXT lyrics, timestamp each line during playback, save drafts, and download synchronized LRC files.
- Edit existing LRC timestamps with exact time entry, 0.1-second nudges, and a global offset; preserve metadata, bilingual lines, blank cues, and millisecond precision.
- Add headset and system media controls with resumable playback, Now Playing metadata, and synchronized A/B pause/resume.

### Fixes and maintenance

- Cancel pending audio starts when a pause arrives while an audio device is resuming.
- Preserve the edited track when playback ends during lyric timing; validate timestamp order before export.
- Add desktop workflow tests for lyric conversion and media controls, and simplify the README.

AirPods command handling is covered by simulated desktop controls; physical ear-detection testing is still pending.

## [1.2.0](https://github.com/wedoso/Vibloom/compare/v1.1.0...v1.2.0) (2026-09-24)

### Features

- Add Hong Xi as the default Live2D companion, with saved model selection and Hiyori still available.
- Add six music-aware personality gestures, blush/star-eye expressions and an interactive reaction button.
- Match the entire Hong Xi listening room to her powder-blue sweater, navy plaid and silver headphones, including consistent A/B colors and themed dialogs.
- Preserve audio, comparison, lyrics, queue and camera state when switching companions; retain explicitly saved Hiyori preferences.

### Fixes

- Configure Hong Xi blinking and recover cleanly from model loading failures.
- Keep update dialogs centered across the full window and prevent header typography from leaking into their controls.
- Update vulnerable js-yaml and qs production dependencies and make release-metadata tests follow the package version.

## [1.1.0](https://github.com/wedoso/Vibloom/compare/v1.0.1...v1.1.0) (2026-08-11)

### Features and fixes

- Add branded version checks and desktop automatic updates.
- Track pointer gaze across the full viewport.
- Keep macOS playback alive when closing the window and build both Mac architectures in parallel.

## [1.0.1](https://github.com/wedoso/Vibloom/compare/v1.0.0...v1.0.1) (2026-08-11)

### Fixes

- Require Developer ID signing and Apple notarization for every public macOS package.
- Validate the packaged app with strict code-signing, stapler, and Gatekeeper checks before publishing installers.
