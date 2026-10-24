# <img src="public/vibloom-icon.png" width="40" height="40" alt="" /> Vibloom

Your music library, brought to life.

A private music player for desktop and mobile browsers, macOS, and Windows. Listen, compare mixes, improve audio, and bring songs to life with lyrics and Live2D companions. No account, uploads, or analytics; your music stays on your device.

[Open the web player](https://wedoso.github.io/Vibloom/) · [Download the desktop app](https://github.com/wedoso/Vibloom/releases/latest)

![Vibloom welcome screen](docs/assets/landing.png)

## Features

- **Local library:** import music and matching LRC/TXT lyrics, organize albums with covers, search, manage the queue, and resume playback. Hold and drag to reorder mobile albums. Song titles hide track-number prefixes; storage controls manage cached audio and reconnect files.
- **Synchronized comparison:** switch between the original and alternate versions at the same playback position. Desktop uses waveform cards with up to nine tracks; mobile offers a compact A/B view.
- **Audio processing on desktop:** preview EQ and mastering, apply Audio Repair presets, chain treatments into comparison tracks, and export WAV files. Desktop web and Electron share the processing implementation.
- **Lyrics:** follow synchronized lyrics, open the editor directly from Player, and export LRC or plain TXT. TXT removes timestamps and metadata while retaining lyric lines and translations. Without lyrics, mobile Player gives more space to the companion while keeping an upload shortcut.
- **Lock-screen / car lyrics (Beta):** a saved toggle in mobile Listening options publishes each timed lyric line in the system artist field while keeping the song title and cover. System progress updates are throttled and covers use a compact JPEG for better receiver compatibility. Display and background updates depend on the browser, OS, and Bluetooth receiver; iPhone/Tesla behavior needs device verification for each release.
- **Live2D companions:** Hong Xi and Hiyori with camera controls, Focus mode, and reactive backgrounds. All platforms share local Spleeter/MotionSync lip sync with GPU acceleration, CPU fallback, clear progress, and smoother sustained vowels.
- **Offline web access:** after Storage reports readiness, reopen the player and play cached songs without a network connection. App updates wait for confirmation while playback is paused.
- **Playback recovery and help:** bounded audio-device recovery prevents interrupted playback from waiting indefinitely. Persistent failure details offer retry/reconnect actions, with a private diagnostic report in Storage.
- **Playback controls:** shuffle, repeat, volume, direct seeking, and system media controls. Installed apps check for updates automatically and retain manual checking. Background playback depends on the platform; macOS keeps playing when the app window closes.

![Waveform cards with chained audio processing](docs/assets/processing-chain.png)

## Desktop and mobile

| | Desktop web / app | Mobile web |
| --- | --- | --- |
| Comparison | Original + up to eight versions | Original A + comparison B |
| Audio tools | EQ, Mastering, Audio Repair | Use desktop for processing |
| Layout | Waveform cards, Library, Queue, Storage | Touch layouts for portrait and landscape, compact drawers, bottom playback controls |
| Companion and lyrics | Camera controls, vocal lip sync, lyric editing | Camera controls, pinch zoom, vocal lip sync, compact lyric editing |

Mobile devices automatically open the dedicated mobile interface. Desktop browsers and Electron retain the desktop interface. Browser previews can use `?ui=mobile` or `?ui=desktop`; the two interfaces keep separate local libraries.

On iPhone/iPad, choose **Import your music → Choose files**, then browse **iCloud Drive** or **On My iPhone** in Files. Folder selection and audio formats depend on the browser and OS. Cached music is not a backup: browser storage can be cleared, so keep your original files.

## Quick start

1. Import music, optionally with same-named `.lrc` or `.txt` files. Create albums or add songs to Queue.
2. Open Player and add a comparison. On desktop, use the EQ or Audio Repair controls to create another version; on mobile, import a comparison into B.
3. Prepare vocal lip sync with the microphone control. Import matching lyrics with your music, or attach them from the song's lyric actions.

### Lyrics and car display

On mobile, tap **Edit lyrics** in Player, or open **Listening options → Lyrics** to edit timing and use **Export TXT / Export LRC**. The editor's **More lyric actions** menu also exports either format. On desktop, Player keeps **Edit** beside a **⋯** menu for exports, replacement and removal; Focus mode keeps only **⋯**, with editing as its first item. Songs without lyrics show **Import lyrics**. The Library song's **Lyrics…** menu also opens the editor. TXT works without timing; LRC requires timed lyrics.

**Listening options → Lock-screen & car lyrics** enables or disables system lyric publishing on mobile and remembers your choice. In-app lyrics continue to work with this switch off. Car lyrics use the system artist field because browsers cannot directly control a Bluetooth receiver's lyric display.

System lyric changes publish independently of the 1 Hz progress updates, including short lines and after seeking. On supported Safari versions, an empty, paused media element supplies metadata notifications without playing a second audio stream. Lock-screen and receiver delivery still need physical-device verification.

On desktop, Shuffle plays each queued song once per cycle. Added songs join the current cycle and **Play next** takes priority. Queue keeps listing already-played songs after a cycle ends; enable **Repeat all** for continuous shuffled playback, including a one-song queue.

### Offline access and playback help

Open the production web player online and wait for **Storage → Offline access → Ready to open offline**. You can then reopen the same URL offline, use the companions, and play songs kept on that device. First-time vocal preparation still needs a connection to download its model. Browser storage may be evicted, so retain your original music and lyrics.

Web updates appear in Storage and apply only when you choose **Update & reload** with playback paused. Offline setup requires HTTPS or localhost; it is disabled in the development server and Electron, whose app resources are already bundled.

If playback fails, open the visible error or **Storage → Playback status & help**. Retry restores the audio connection; missing or unreadable files can be reconnected by importing their originals. **Copy diagnostics** includes app version, audio state, and recent playback stages, excluding song names, paths, lyrics, and audio. Nothing is uploaded automatically.

Wireless output progress uses the browser's reported output timing when available. Safari's mobile playback session avoids a separate silent audio element competing for system controls. AirPlay/HomePod buffering and audibility still depend on iOS, the receiver, and the network; the browser cannot confirm that a remote speaker is emitting sound. Diagnostics include reported output latency to help investigate mismatches.

Desktop shortcuts: `Space` plays/pauses, `←` / `→` seeks five seconds, `1`–`9` switches tracks, and `F` / `Esc` enters/leaves Focus mode.

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

`npm run build` creates the static site and its offline worker in `dist/`. Use `npm run preview` to test the production build locally. `npm run desktop:package` builds desktop installers in `release/`.

Focused integration checks include `npm run desktop:smoke:playback`, `npm run desktop:smoke:shuffle`, `npm run desktop:smoke:wireless`, `npm run desktop:smoke:lyrics-export`, `npm run desktop:smoke:media-publishing`, and `npm run desktop:smoke:offline`. Shuffle checks cover queue edits, restored sessions and repeat modes. Wireless checks exercise rapid system-lyric updates and delayed output timing without a competing audio stream. The offline check disables the network and HTTP cache, tests both layouts under a deployment subpath, and exercises updates, diagnostics, and retry. These browser checks cannot replace physical iPhone/Bluetooth receiver testing.

Source lives in `src/`, `desktop/`, and `build-tools/`; `build/` contains required signing entitlements. Keep reusable checks and fixtures in `scripts/` and `tests/`. Generated builds, installers, screenshots/reports (`outputs/`), downloaded model caches (`.cache/`), and local design context are excluded from Git. Do not commit dependencies or generated release assets.

Changes go through a checked pull request to `main`. Releases use a version PR when Release Please is configured, or the documented manual version/tag process; see [CI/CD releases](docs/desktop.md#cicd-releases).

See [player and Library](docs/library-player.md), [mobile UI](docs/mobile-ui.md), [audio processing](docs/audio-processing.md), [desktop builds](docs/desktop.md), [architecture](docs/architecture.md), and [version history](CHANGELOG.md).

## License

Source code: [MIT](LICENSE). Audio Repair follows [TheApeMachine/deshimmer](https://github.com/TheApeMachine/deshimmer); EQ follows [SUP3RMASS1VE/Suno-Song-Remaster](https://github.com/SUP3RMASS1VE/Suno-Song-Remaster). Third-party terms are retained in the [EQ](public/eq-NOTICES.txt), [audio runtime](public/remaster-NOTICES.txt), and [vocal model](public/vocal-NOTICES.txt) notices. Hiyori and Live2D runtimes have separate terms: [Hiyori](public/live2d/hiyori/LICENSE-HIYORI.txt), [MotionSync](public/live2d/motionsync/LICENSE.md).

**Hong Xi's model, artwork, textures, expressions, and related assets are not covered by MIT. Commercial use requires prior permission from the rights holder.** Repository distribution does not grant that permission; see the [model usage notice](public/live2d/hong-xi/NOTICE.md).
