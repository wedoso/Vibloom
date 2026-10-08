# Vocal separation fixture

`vocal-speech.wav` is the first four seconds of the John F. Kennedy inaugural
address recording used by [faster-whisper's test suite](https://github.com/SYSTRAN/faster-whisper/blob/ed9a06cd89a93e47838f564998a6c09b655d7f43/tests/data/jfk.flac).
The address was delivered on January 20, 1961 in Kennedy's official capacity as
US President. The clip contains spoken voice, not music.

Converted with FFmpeg to mono 44.1 kHz PCM16, using
`-t 4 -ac 1 -ar 44100 -af loudnorm=I=-18:TP=-2:LRA=11`.
The desktop lip-sync smoke test mixes this voice into a generated drum/tone bed
from seconds 4–8. Seconds 0–4 and 8–12 contain only that instrumental bed;
Version B contains only the bed. Inference uses real HTDemucs weights.

`remaster-reference.json.gz` contains four shared Float32 PCM inputs and sparse
PCM24 output samples from the **unaltered** Python deshimmer full pipeline at
`fea2cca81da613ec8a3aca4962a359e060eab9d9` (SciPy 1.18.1 / NumPy 2.5.3).
Generated with `scripts/compare-remaster.py` and `scripts/freeze-remaster-reference.py`.
The eight reference pairs cover enhancement, inpainting, offline denoise,
stationary floor, seeded phase, iterative projection, tonal repair and delivery.
The test validates input hashes and unshifted/unmatched waveform residuals against
these independent Python samples, rather than deriving expected values from Web.
The synthetic signals are generated locally; no user music is included.

The same Python golden fixture remains unchanged for the v3 C++/WASM optimization. The additional cache/recomputation test verifies exact sample equality between the fast and bounded-memory paths.
