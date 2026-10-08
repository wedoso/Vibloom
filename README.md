# <img src="public/vibloom-icon.png" width="40" height="40" alt="" /> Vibloom

Your music library, brought to life.

A private music player for the web, macOS, and Windows, with synchronized A/B comparison, timed lyrics, and Live2D companions. No account, uploads, or analytics; your music stays on your device.

[Open the web player](https://wedoso.github.io/Vibloom/) · [Download the desktop app](https://github.com/wedoso/Vibloom/releases/latest)

![Vibloom welcome screen](docs/assets/landing.png)

## Features

- **Local library:** choose or drag in audio files and nested folders, search, reorder the queue, shuffle, repeat, and resume your last position. Music is cached by default; manage local copies in **Storage**.
- **Virtual albums:** create collections with your own cover images. Select existing songs, drag library songs onto an album, or import new music directly into it. Albums and covers are saved locally.
- **Local remaster:** open the wand beside A to browse 17 deshimmer presets in a dedicated panel. Clean up shimmer, noise and ringing, or choose a delivery target; compare the result in B and download 24-bit WAV. Processing stays on-device, and the listening room keeps its uncluttered layout.
- **A/B comparison:** add a second version, switch instantly on one shared audio clock, and compare waveforms. Both versions can be kept on-device.
- **[Lyrics](docs/assets/lyrics-timing.png):** edit TXT/LRC text, insert or delete lines, and timestamp lyrics. Download TXT or synced LRC files. Same-named lyric files match during import or a later lyric-only drop; ambiguous matches require manual attachment.
- **Headset controls:** system play/pause and seek commands share the player's transport, preserving position and A/B synchronization. AirPods ear detection depends on device settings and OS/browser support; physical AirPods testing is still pending.
- **Live2D companions:** switch smoothly between Hong Xi and Hiyori; both respond to **Say hello**. Enjoy gestures, gaze, camera controls, and Focus mode. **[Prepare vocal lip sync](docs/assets/vocal-preparation.png)** from Player or enter **[Prepare lip sync](docs/assets/library-selection.png)** in **[Library](docs/assets/library.png)** to select songs; both views share background progress, then **Start singing**. Mouth opening follows vocal energy, with sustained, estimated vowel shapes; detail depends on the model’s mouth rig. First use downloads a 172 MiB model; results stay on-device.
- **Desktop updates:** click the version beside the logo to check for updates. On macOS, closing the window keeps music playing; `Command-Q` quits.

![Vibloom comparing two synchronized versions](docs/assets/listening-room.png)

## Quick start

1. Choose **Import your music**, then select files or a folder. Include matching `.lrc` or `.txt` files if available.
2. Play a song, arrange **Queue**, or add Version B to compare a second mix.
3. To remaster a song, click the wand at the top right of A, select a preset, then **Create version B**. Switch to B to listen and use its download icon to save the result.
4. In **Library**, choose **New album**, name it, choose a cover, and select songs. Open **Albums** to browse covers. Drag a song over the **Albums** tab to reveal its cards, then drop onto a card to add it. Imports into the selected album join it automatically.
5. For TXT lyrics, choose **Timestamp lyrics**; for LRC, choose **Edit timing**. Select a line to edit its text or insert/delete rows. Press `T` to timestamp and advance, or `S` to overwrite the selected time without advancing. `Command/Ctrl + Enter` also overwrites while typing. Outside text fields, `Space` plays/pauses and `Z` undoes. Drafts are saved with the track; export with **Download .txt** or **Save & download .lrc**.

| Shortcut | Action |
| --- | --- |
| `Space` | Play / pause |
| `←` / `→` | Seek five seconds |
| `1` / `2` or `A` / `B` | Switch comparison source |
| `F` / `Esc` | Toggle / leave Focus mode |

## Remaster A into B

Browse the preset library by **Shimmer**, **Full stack**, **Resonance**, **Targeted**, or **Delivery**. Each preset has a description; **Default shimmer** is the original starting recipe, while **Full stack · conservative** combines shimmer cleanup, light denoise and gentle resonance reduction. All 17 presets remain available under **All presets**, including Bypass for a reference copy.

![The remaster preset panel](docs/assets/remaster-presets.png)

Choose **Keep listening**, close the panel, or press `Esc` while processing to return to playback. A shows compact progress; click it to reopen the panel or cancel. A completed result appears in B, and **Download B** saves a 24-bit PCM WAV. If B already exists, the apply button explicitly says **Replace version B**; cancellation or processing failure keeps the previous B. B's more menu also lets you choose another file or remove it.

The TypeScript/C++ WASM engine runs in a Worker and shares a processing queue with vocal preparation. No audio upload, Python runtime or remaster model download is required. Input supports mono/stereo at 8–96 kHz, up to 12 minutes and 128 MiB of decoded PCM; dense tonal analysis has additional allocation budgets. Desktop memory measurements do not establish mobile support. See the [implementation and limits](docs/web-deshimmer.zh-CN.md), [Python equivalence](docs/remaster-equivalence.zh-CN.md), [performance measurements](docs/remaster-optimization.zh-CN.md), and [memory audit](docs/remaster-memory.zh-CN.md).

Common MP3, WAV, M4A/AAC, FLAC, OGG, Opus, WebM Audio, and AIFF files are accepted when supported by the runtime's decoder, up to 300 MB per file. Lyrics support UTF-8 and BOM-marked UTF-16. Browser storage may be cleared by private browsing, site-data cleanup, or storage pressure; reconnect source files when prompted.

## Development

Requires Node.js 22.13 or later.

```bash
git clone https://github.com/wedoso/Vibloom.git
cd Vibloom
npm ci
npm run dev             # Web development
npm run desktop:dev     # Electron development
npm run check           # Lint, tests, and production build
```

`npm run build` writes the static site to `dist/`. Desktop smoke tests use isolated profiles:

```bash
npm run desktop:smoke
npm run desktop:smoke:lyrics
npm run desktop:smoke:library
npm run desktop:smoke:media
npm run desktop:smoke:companions
npm run desktop:smoke:layout
npm run desktop:smoke:updates
npm run desktop:smoke:lipsync
npm run desktop:smoke:remaster
```

See [desktop builds and releases](docs/desktop.md), [player behavior](docs/library-player.md), and [architecture](docs/architecture.md) for details. Version history is in [CHANGELOG.md](CHANGELOG.md).

## License

Source code: [MIT](LICENSE). The remaster port follows [TheApeMachine/deshimmer](https://github.com/TheApeMachine/deshimmer); its FFT and loudness components retain their third-party notices, including BSD-3-Clause ducc and MIT pyloudnorm. Bundled native-runtime notices are in [remaster-NOTICES.txt](public/remaster-NOTICES.txt). Hiyori and the Cubism runtime retain their applicable Live2D terms; see [Hiyori's notice](public/live2d/hiyori/LICENSE-HIYORI.txt) and the [MotionSync runtime license](public/live2d/motionsync/LICENSE.md).

### Hong Xi Live2D model — commercial use requires permission

The Hong Xi (红奚) Live2D model and its associated artwork, textures, expressions, and model assets are **not covered by the MIT source-code license**. **Commercial use requires prior permission from the rights holder.** Including these assets in this repository or in Vibloom does not grant permission to sell them, include them in a commercial product or service, or otherwise use them commercially. See the [model's usage notice](public/live2d/hong-xi/NOTICE.md).

Hong Xi（红奚）Live2D 模型及其相关立绘、纹理、表情和模型素材不适用本项目的 MIT 源码许可证。**未经权利人事先授权，不得用于任何商业用途**，包括出售模型或素材、集成到商业产品或服务，以及其他商业使用。本仓库及应用中提供这些素材，不代表授予商业使用许可。
