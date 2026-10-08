// Optional maintainer build. Normal npm builds use the checked-in WASM asset.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const sdk=process.env.WASI_SDK_DIR;
if(!sdk)throw new Error('Set WASI_SDK_DIR to wasi-sdk 34.0 (https://github.com/WebAssembly/wasi-sdk/releases/tag/wasi-sdk-34).');
const output=path.join(root,'src/audio/remaster/wasm/fft-kernel.wasm');
execFileSync(path.join(sdk,'bin/clang++'),['-std=c++17','-O3','-nostartfiles','-ffp-contract=off','-fno-exceptions','-DDUCC0_NO_SIMD','-msimd128','-DDUCC0_NO_LOWLEVEL_THREADING',
 '-Isrc/audio/remaster/wasm/vendor','src/audio/remaster/wasm/fft-kernel.cpp','src/audio/remaster/wasm/repair-kernel.cpp','src/audio/remaster/wasm/tonal-kernel.cpp','src/audio/remaster/wasm/alignment-kernel.cpp','src/audio/remaster/wasm/limiter-kernel.cpp','-Wl,--no-entry','-Wl,--export=init_fft','-Wl,--export=buffer','-Wl,--export=forward','-Wl,--export=inverse',...['repair_create','repair_buffer','repair_init','repair_cache_budget','repair_balance','repair_balance_end','repair_noise','repair_noise_end','repair_begin','repair_frames','repair_end','repair_destroy','peaks_create','peaks_buffer','peaks_analyze','peaks_destroy','alignment_create','alignment_buffer','alignment_run','alignment_destroy','limiter_create','limiter_buffer','limiter_run','limiter_finish','limiter_measure','limiter_destroy'].map(name=>`-Wl,--export=${name}`),'-Wl,--strip-all','-Wl,--initial-memory=2097152','-Wl,--max-memory=536870912','-o',output],{cwd:root,stdio:'inherit'});
const bytes=readFileSync(output);console.log(JSON.stringify({bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}));
