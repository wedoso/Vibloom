# Audio processing

Vibloom processes audio locally in both the browser and desktop app. See the
[README](../README.md) for the listening workflow and
[architecture](architecture.md) for module ownership.

## Workflow

Track 1 is the original; tracks 2–9 hold imported or generated versions. Every
card exposes EQ / Mastering, Audio Repair and vocal preparation. Select a source,
a treatment and an output slot, then create a version. Completion preserves the
current audible track and playback intent; select the output yourself to compare.
Generated versions can be used as inputs for later processing or downloaded.

A typical chain is **Audio Repair → EQ → Mastering**. Each output records its
parent and a settings snapshot. New versions start with a fresh Flat EQ draft
because earlier processing is already included in their audio. Replacing an
occupied slot is explicit; cancellation or failure preserves its previous file.
The original and selected comparison cannot be overwritten.

## EQ and Mastering

Five native Web Audio bands at 80 Hz, 250 Hz, 1 kHz, 4 kHz and 12 kHz provide
Flat, Vocal Boost, Bass Boost, Bright, Warm and AI Fix presets. Manual gain
adjustment is available from −12 to +12 dB. EQ-only preserves the decoded input's
sample rate, frame count and channels, and exports PCM24 WAV.

Mastering adds low-end cleanup, mud / harshness cuts, air, glue compression,
stereo width, centered bass, input gain, loudness normalization and peak limiting.
It exports 44.1 or 48 kHz WAV with 16-bit TPDF dither or 24-bit PCM. Opening the
Mastering tab does not enable its processing; **Include mastering** or an explicit
control change does. **Suno defaults** loads the upstream configuration.

Preview uses a temporary graph on the source track and the existing audio clock.
It does not start paused playback. The status light shows **Preparing**, **Applying**,
**Applied** or **Bypassed**; application is acknowledged against audio output time.
Closing, creating a version or switching tracks ends preview and releases its
nodes and pending analysis. Full-song export measures loudness after processing;
live preview measures the source, so the two paths can have different dynamics.

## Audio Repair

The deshimmer port provides 17 presets grouped by Shimmer, Full stack, Resonance,
Targeted and Delivery, including Bypass. TypeScript and a SIMD C++ / WASM Worker
handle spectral cleanup, noise, resonance and harmonic artifacts. No runtime
Python or server is required. Outputs are PCM24 WAV.

Delivery presets also normalize loudness and protect peaks, overlapping with
Mastering's final-output controls. These use different algorithms. Prefer a
non-Delivery repair preset when Mastering will handle final loudness and limiting;
repeated limiting can change the music's dynamics.

## Playback and resources

Both platforms support nine slots. Only the audible source runs continuously;
transitions start the next source on the same clock, crossfade and stop the old
one. Cold versions decode on demand while current audio continues. Collapsed
comparison cards release their waveform rendering after the layout transition.

Decoded PCM has a 256 MiB soft LRU target. Original, audible, preview-return and
fading sources are protected; processing inputs can increase residency. This is
not a total process-memory cap. Heavy exports, imports and vocal preparation share
a queue; live preview remains independent. Full Mastering's oversampling can
allocate substantial additional memory.

Inputs support mono / stereo, 8–96 kHz, up to 12 minutes and 128 MiB decoded PCM.
**Clear** cancels comparison work and releases comparison files, buffers, download
URLs and analyses, retaining the original and shared model weights. Closing a
preview releases its graph; completing or cancelling worker jobs terminates them.

## Validation

Reference implementations are pinned to deshimmer
[`fea2cca`](https://github.com/TheApeMachine/deshimmer/tree/fea2cca81da613ec8a3aca4962a359e060eab9d9)
and Suno-Song-Remaster
[`862a0aa`](https://github.com/SUP3RMASS1VE/Suno-Song-Remaster/tree/862a0aa7a686be3bc7e420d108f4e3e4e050bb1f).
Independent source fixtures and reproducible checks live in `tests/` and `scripts/`.
EQ / Mastering compare each native preview and export path against its upstream
counterpart; deshimmer checks full-pipeline PCM, loudness and spectral tolerances.
Cross-browser byte-identical output is not promised; random dither can differ.

Run `npm run check`, `npm run check:eq`, `npm run check:mastering`,
`npm run desktop:smoke:multi` or `npm run desktop:smoke:library` as appropriate.
Benchmarks and audit reports are generated locally under ignored `outputs/`.
Third-party notices and the WASM build guide remain in the repository.
