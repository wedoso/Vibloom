# Web / Python remaster 速度对照

> v2 历史测速；当前 v3 已进一步提速，见 [性能优化报告](remaster-optimization.zh-CN.md)。

2026-10-07，Apple M2 Max / macOS 27.0.1。当前 Web 引擎 `web-deshimmer-2`，实际编译的 Electron 43.3.0 浏览器 Worker；Python 3.14.5、NumPy 2.5.3、SciPy 1.18.1，固定上游 `fea2cca81da613ec8a3aca4962a359e060eab9d9`，未启用 Numba。

**本次 full-safe 预设测试中，Python 约快 2.2 倍。Web 处理 3–4 分钟输入约需 41–55 秒。**

| 音频长度 | Web Worker | Python | Python 速度倍数 |
| --- | --- | --- | --- |
| 3 分钟 | 40.7 秒 | 18.3 秒 | 2.22× |
| 4 分钟 | 54.5 秒 | 24.3 秒 | 2.25× |

两端读取同一份 44.1 kHz 立体声 Float32 PCM，使用同一个 full-safe 配方，包含完整默认修复链、两次响度测量和 24-bit WAV 生成；计时不含源文件读取/解码、运行时启动、B 解码和缓存。Web 计时包含分块复制与 Worker 传输，Python WAV 写入内存。两端顺序执行，避免同时争抢 CPU。每个时长只测一次，使用双音加随机噪声的合成信号；实际歌曲、其他预设和设备可能有不同耗时。

结果与前一次实际应用内 5 分钟 full-safe 处理约 69 秒相符。输入哈希、原始计时、响度和 WAV 字节数保存在 [测量证据](remaster-speed-results.json)。本地基准脚本和 PCM 保存在忽略的 `outputs/remaster-speed/`。

当前 Web 只有 FFT 使用 WASM，多数检测、轨迹处理和缓冲扫描仍在 TypeScript 中。Python 使用 NumPy/SciPy 的本机批量数值计算，本次更快。未测开启 Numba 的 Python，也未测试手机或低性能电脑。
