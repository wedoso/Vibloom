# Independent Suno EQ oracle

Source: [SUP3RMASS1VE/Suno-Song-Remaster](https://github.com/SUP3RMASS1VE/Suno-Song-Remaster), revision `862a0aa7a686be3bc7e420d108f4e3e4e050bb1f` (declared ISC).

`eq.mjs` contains verbatim `configureEQNodes` and `eqPresets` definitions extracted from upstream `src/renderer.js`, with export declarations added. `audioConstants.mjs` and `wavEncoder.mjs` are upstream files with `.mjs` extensions and normalized whitespace. They are deliberately separate from production preset data, filter construction and the optimized planar WAV writer.

`npm run check:eq` creates an isolated Electron renderer, renders the reference's five filters, and compares every PCM bit and PCM24 WAV byte with production EQ. It excludes the upstream mastering chain's high-pass, compression, loudness normalization, limiting, polish and dither. No network or Python is needed to rerun the oracle.
