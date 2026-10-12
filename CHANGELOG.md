# Changelog

Notable changes to Vibloom are recorded here. Release entries summarize the changes shipped from `main`.

## [1.13.0](https://github.com/wedoso/Vibloom/compare/v1.12.0...v1.13.0) (2026-10-12)

- Add Beta lock-screen and Bluetooth car lyrics on mobile through the system artist field; device support varies.
- Give the companion more Player space when lyrics are missing, while keeping an LRC/TXT upload shortcut.
- Match mobile song titles to desktop by removing leading track numbers from display names.

## [1.12.0](https://github.com/wedoso/Vibloom/compare/v1.11.2...v1.12.0) (2026-10-11)

- Hold and drag songs to reorder mobile albums, with edge scrolling and saved order in portrait and landscape.
- Check for desktop app updates automatically at startup and every six hours, while keeping manual checks and user-controlled downloads.

## [1.11.2](https://github.com/wedoso/Vibloom/compare/v1.11.1...v1.11.2) (2026-10-11)

- Unify desktop and mobile lip sync on the lightweight local Spleeter/MotionSync pipeline, with GPU acceleration and CPU fallback.
- Keep sustained vowels open through brief analysis gaps without shifting mouth timing or adding a setting.
- Keep preparation progress clear and steady, and prevent model menus from closing during lyric scrolling.

## [1.11.1](https://github.com/wedoso/Vibloom/compare/v1.11.0...v1.11.1) (2026-10-11)

- Fix iPhone vocal-analysis crashes with a lightweight local model, GPU acceleration, CPU fallback, and bounded GPU resource lifetimes.
- Remove duplicate vocal progress icons from the mobile Player while preserving background task access in Library.
- Reduce lip-sync animation lag across desktop and mobile by removing repeated smoothing and sampling mouth poses on the render frame.

## [1.11.0](https://github.com/wedoso/Vibloom/compare/v1.10.0...v1.11.0) (2026-10-10)

- Add a dedicated mobile listening room with portrait and landscape layouts, direct seeking, A/B comparison, synchronized lyrics, compact lyric editing, and Live2D pinch zoom and camera controls.
- Prepare vocal lip sync on mobile with progress visible outside the panel; support background playback and album artwork in system media controls where the browser allows it.
- Align desktop Library status icons and simplify song actions; keep Player and Library model zoom framing consistent.
- Improve playback and large-library rendering, reuse decoded audio and vocal workers, and reduce processing memory while preserving audio and mouth-animation results.
- Load saved vocal timing on demand, recover temporary read failures automatically, prevent stale saves and cancelled jobs from replacing newer data, and keep completed lip-sync controls free of redundant status text.

## [1.10.0](https://github.com/wedoso/Vibloom/compare/v1.9.0...v1.10.0) (2026-10-08)

- Compare up to nine tracks with number shortcuts, compact cards and one-click cleanup.
- Preview EQ and mastering presets live; chain EQ, Mastering and Audio Repair into downloadable tracks.
- See when preview changes become audible and follow per-track vocal preparation with automatic lip-sync activation.
- Reorder album tracks, show album artwork during playback, and enjoy more compact panels and themed menus.

## [1.9.0](https://github.com/wedoso/Vibloom/compare/v1.8.1...v1.9.0) (2026-10-07)

- Remaster Track A locally with 17 deshimmer presets for shimmer cleanup, denoise, resonance reduction and delivery targets. Compare the processed audio in B and download 24-bit PCM WAV; automatically cached results restore on the next visit.
- Browse presets in a dedicated, responsive panel opened from A's wand icon. Keep listening while processing, reopen compact progress to cancel, and use B's download and more controls without adding a permanent tools panel to the listening room.
- Run spectral repair, FFT, peak analysis and limiting in a Worker with a C++/WASM SIMD kernel. Preserve the fixed Python reference's default processing stages and verify outputs with frozen reference fixtures and Worker comparisons.
- Share one heavy processing queue with vocal preparation. Release old audio references, native working heaps and completed workers; add allocation budgets and clean up replaced B analyses, library reset and download URLs.

## [1.8.1](https://github.com/wedoso/Vibloom/compare/v1.8.0...v1.8.1) (2026-10-07)

- Keep All songs / Albums and New album inside the Library after music is imported. The empty homepage retains its original Import your music entry.
- Clarify that the Hong Xi (红奚) Live2D model and associated assets are excluded from the MIT source-code license and require prior permission for commercial use; bundle the usage notice with the model.

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
