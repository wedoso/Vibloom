# Vibloom desktop builds

Vibloom uses Electron as a secure desktop shell around the same React/Vite renderer deployed to the web. Windows, macOS, and the static website share the player, library, storage contract, lyrics, and Live2D code.

## Local development

Install dependencies and open the Electron app with Vite hot reload:

```bash
npm ci
npm run desktop:dev
```

Run the production renderer inside Electron without opening a visible window:

```bash
npm run desktop:smoke
```

The smoke check verifies the custom `vibloom://app` origin, React mount, Live2D renderer, IndexedDB, and OPFS support in Electron.

Build an unpacked application for local inspection:

```bash
npm run desktop:dir
```

Build a macOS ARM64 DMG and ZIP on macOS:

```bash
npm run desktop:package:mac
```

Build a Windows x64 NSIS installer on Windows:

```bash
npm run desktop:package:win
```

Artifacts are written to `release/` and are intentionally excluded from Git.

## CI/CD releases

`.github/workflows/desktop-release.yml` has three paths:

- Pull requests and pushes to `main` run lint, tests, the web build, a headless Electron smoke test, and a production dependency audit.
- A manual **Desktop CI and Release** run packages unsigned macOS and Windows installers and exposes them as downloadable workflow artifacts for 30 days.
- Pushing a version tag such as `v1.1.0` packages both platforms and uploads the installers to a GitHub Release.

The workflow creates macOS x64 and ARM64 DMG/ZIP files and a Windows x64 NSIS installer.

## Optional code signing

Unsigned workflow artifacts are useful for internal testing but operating systems can show trust warnings. Configure these GitHub Actions secrets before public distribution:

### macOS

- `MAC_CSC_LINK`: base64 data or a private URL for the Developer ID Application certificate (`.p12`).
- `MAC_CSC_KEY_PASSWORD`: certificate password.
- `APPLE_ID`: Apple developer account email for notarization.
- `APPLE_APP_SPECIFIC_PASSWORD`: app-specific Apple password.
- `APPLE_TEAM_ID`: Apple Developer team ID.

### Windows

- `WIN_CSC_LINK`: base64 data or a private URL for the Windows code-signing certificate (`.pfx`/`.p12`).
- `WIN_CSC_KEY_PASSWORD`: certificate password.

When signing secrets are absent, packaging remains functional and produces unsigned installers.

## Desktop security boundary

The renderer has Node integration disabled, context isolation enabled, and Chromium sandboxing enabled. It receives no general-purpose filesystem or IPC API. A standard, secure custom protocol serves only files inside the packaged `dist/` directory; navigation, new windows, webviews, and permission requests are denied.

This preserves browser-level isolation while giving IndexedDB and OPFS a stable application origin. Future native file access should be added through narrow, validated preload methods rather than exposing Node or Electron APIs directly.
