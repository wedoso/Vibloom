# Browser remaster native kernel

`fft-kernel.wasm` is the historical asset name. It now includes the FFT,
offline spectral stages, peak analysis, global channel correlation and linked
4x FIR/PDR limiter. TypeScript manages transport, trajectories/families and UI.

The double-precision FFT uses the pinned SciPy ducc revision
`e4e854eaa8f18d807cd3496028e257e36caa93cc`, `subprojects/duccfft/`.
Only the 11 required headers are vendored, selecting BSD-3-Clause. Original
notices are retained. Two exception paths in `infra/error_handling.h::fail__`
and `infra/aligned_array.h::ralloc` were replaced with abort for the browser.

Compilation enables standard WASM SIMD/autovectorization (`-msimd128`), but
keeps the ducc algorithm scalar (`DUCC0_NO_SIMD`), float contraction disabled,
and no fast-math or relaxed SIMD. Float32 stores intentionally preserve
reference rounding. PCG64 uses exact unsigned 128-bit integer arithmetic.
No threads or GPU are required. Unused WASI host-I/O imports trap.

Native spectral projection caches Float32 target magnitudes when the cache
is <=256 MiB and the estimated live spectral working set is <=448 MiB.
Source PCM is freed after the first pass on that path, before allocating the
second output. Larger inputs recompute targets; both paths are covered by an
exact sample-equality test. No complex whole-song STFT or 4x song is retained.

Linear memory starts at 2 MiB and may grow to 512 MiB. After freeing a native
stage, heaps larger than 64 MiB are replaced by a fresh instance using the
already compiled module. This makes the released heap collectible before the
next stage; no old native context/view survives the replacement. Actual process
memory also includes decoded A/B, JS PCM/WAV and optional tonal arrays.

Normal npm builds bundle the checked-in artifact. No Python or compiler is
needed to build/run the app. Optional maintainer rebuild:

```sh
WASI_SDK_DIR=/absolute/path/wasi-sdk-34.0 node scripts/build-remaster-fft.mjs
```

Compiler: [wasi-sdk 34.0](https://github.com/WebAssembly/wasi-sdk/releases/tag/wasi-sdk-34).
Binary SHA-256: `b383bf482a097c3b30bd3146d5e9472cd7dbb6972766529559f4eb19a9abaf96`. Re-run the Python parity and compiled Worker checks
after changing numerical code. The statically linked WASI/libc++/compiler-rt
licenses and ducc/pyloudnorm notices ship in `public/remaster-NOTICES.txt`.
