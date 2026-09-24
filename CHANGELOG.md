# Changelog

Notable changes to Vibloom are recorded here. This file is maintained by Release Please from Conventional Commit messages merged into `main`.

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
