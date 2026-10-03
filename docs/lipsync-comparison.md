# Local HeadAudio / MotionSync comparison

Branch: `codex/lipsync-comparison`. This is a browser-only experiment. No backend, Python helper, production selection, or new library-analysis schema is involved.

## Start

```sh
npm run lab
```

Open `http://127.0.0.1:5184/lipsync-lab.html`. Select a local audio file, choose a 1–60 second excerpt, then analyze both systems. For a complete song, leave “歌曲：先分离人声” selected. If a clean vocal stem is available, select “已分离人声：直接分析”. Both renderers follow the same HTML audio element's clock. Pause before changing original/stem monitoring. Reports and stems are downloaded locally.

`npm run lab:build` includes both app and experiment entries in `dist`. Normal `npm run build` does not include the experiment page. `npm run lab:smoke` checks the built experiment in sandboxed Electron (the application remains pure frontend). Nothing is merged or released by these commands.

## What the experiment compares

- HeadAudio 0.1.0 with the existing `model-en-mixed.bin` and current vowel stabilization.
- Official Cubism MotionSync Plugin for Web R2, CRI Core 5.0.4, called directly through its documented Core API in an isolated classic Worker. No proprietary runtime modification.
- CRI identity mappings expose A/E/I/O/U/Silence strengths. These are blended mapping outputs, **not calibrated probabilities**.
- Both receive the exact same mono downmix of the same stereo 44.1 kHz PCM. Demucs runs once when needed.
- Each model renders in a same-origin iframe to isolate the Cubism WebGL shader singleton. The frames receive poses from the parent; neither creates its own audio player or playback clock.
- Both use a shared RMS jaw timeline, the same visual transition filter, and the existing `MusicLipSync` rig mapping. This isolates mouth shape recognition. It is not a comparison of each tool's independent jaw algorithm. Hong Xi's vowel-dependent aperture still differs with the selected shape; the input jaw is identical.
- MotionSync's native smoothing is adjustable (default 60); blend ratio is 1. Default viseme scales are all 1. An explicitly labeled optional preset uses the official Kei vowels example's scales, reordered to A/E/I/O/U/Silence: `.3 / 6 / 1 / 8 / 1.5 / 1`.
- CRI timestamps use actual consumed sample counts. No arbitrary advance compensates for classifier latency. HeadAudio retains its upstream event timestamps. Both are sampled at 50 Hz for playback. Analysis of the final partial window uses zero padding, with the exported/playable duration unchanged.
- HeadAudio's additional consonants remain visible as raw labels, but the render comparison uses the five vowel shapes supported by both pipelines. This is not a complete Mandarin phoneme recognizer comparison.
- Silence closes the jaw. Neither path is allowed to add an opening floor or invent geometry for unbound model parameters.
- Analysis times include worker/model initialization and describe one offline clip; they are not real-time latency measurements or general performance benchmarks. Total includes separation where selected.

## Evaluation

Try several excerpts with correct listening context: sustained notes, quick lyrics, “我/哦/呜”, “衣/雨”, compound finals, b/p/m closures, and instrumental gaps. For each mismatch, record a timestamp and the word sung, then rate “HeadAudio 更准”, “MotionSync 更准”, “差不多”, or “都不准”. Replay the marked positions and export the JSON report. Compare identical excerpts and settings. Changing settings requires rerunning analysis; the result caption preserves settings actually used.

No automatic accuracy percentage is reported without manually labeled reference shapes. Official sample speech verifies execution, not accuracy on Chinese singing. No production choice is made by this experiment. User music and marks remain in memory until explicitly exported; changing file or analyzing a new run clears marks.

## Runtime provenance

Official download: https://cubism.live2d.com/motion-sync-plugin/bin/CubismSdkMotionSyncPluginForWeb-5-r.2.zip

Upstream API / Framework reference: https://github.com/Live2D/CubismWebMotionSyncComponents

Core SHA-256 (`live2dcubismmotionsynccore.min.js`): `60e2a8ba9b422a0f8a3d7e066739352e9b903cc1011339984ad922e80a3cd19a`

The runtime is governed by the Live2D Proprietary Software License, not this repository's MIT license. Its license reference and redistributable file list are preserved beside the runtime. The adaptation code in `public/lipsync-lab/motionsync.worker.js` belongs to this project. Official sample model/audio files are not bundled in the experiment.
