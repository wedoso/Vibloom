The browser remaster pipeline is a TypeScript/C++ WASM port of the selected presets and
default processing stages of TheApeMachine/deshimmer, pinned to
fea2cca81da613ec8a3aca4962a359e060eab9d9:
https://github.com/TheApeMachine/deshimmer
Its README declares the MIT license. No Python runtime/source is bundled.

The WASM remaster kernel uses ducc FFT from SciPy e4e854eaa8f18d807cd3496028e257e36caa93cc.
The selected license is BSD-3-Clause; see wasm/vendor/LICENSE.md, the original
notices in the required headers, and wasm/README.md for browser adaptations.
The binary notices are included in public/remaster-NOTICES.txt for distribution.

The RBJ/DeMan K-weighting and loudness equations follow pyloudnorm:
https://github.com/csteinmetz1/pyloudnorm
Pyloudnorm is MIT-licensed. Its Python package is not bundled. The TypeScript
implementation reproduces the fixed reference's RBJ normalization and separately
uses DeMan for displayed loudness measurements.

See docs/remaster-equivalence.zh-CN.md for numerical equivalence measurements,
the fixed reference versions and the limits of the tested scope.
