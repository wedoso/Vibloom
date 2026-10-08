# 浏览器 remaster 性能优化报告

2026-10-07，分支 `codex/web-deshimmer`，当前引擎 **web-deshimmer-3**。

本文及冻结结果记录性能优化时的版本。后续资源生命周期修复、最新回归和内存测量见 [内存审计](remaster-memory.zh-CN.md)；保留本次测速和源文件哈希作为历史证据。

**相同 3–4 分钟输入，处理速度约为 v2 的 3 倍，本次耗时比未启用 Numba 的 Python 少约 24–25%。** 完整处理链、预设和原定等价容差保持不变。

## 同输入测速

Apple M2 Max / macOS 27.0.1 / Electron 43.3.0，full-safe 配方，44.1 kHz 立体声合成音频；前后版本和 Python 使用相同 Float32 PCM，SHA-256 一致。

| 长度 | v2 Web | v3 Web | Python | v3 / v2 速度倍数 |
| --- | --- | --- | --- | --- |
| 3 分钟 | 40.678 秒 | **13.840 秒** | 18.389 秒 | **2.94×** |
| 4 分钟 | 54.509 秒 | **18.435 秒** | 24.289 秒 | **2.96×** |

每个长度单次顺序测量，避免同时争抢 CPU。Web 使用真实编译 Worker，并包含分块传输；两端计入完整修复、两次响度测量和 PCM24 WAV 生成，排除源读取/解码、运行时启动、B 解码和缓存。Python 3.14.5 / NumPy 2.5.3 / SciPy 1.18.1，未启用 Numba。不能用该表推断真实歌曲、其他预设或设备的速度，也没有比较 Numba 优化后的 Python。

另一次真实应用内测试处理 300 秒合成音乐＋噪声立体声，full-safe、44.1 kHz 解码，耗时 **22.47 秒**，约 **13.4 倍实时速度**；主线程 16 ms 定时器最大间隔 **27.4 ms**。A/B 长度一致，播放切换、PCM24 下载、取消与故障保留 B、缓存失败回退/重试、缓存重开、切歌和手动 B 替换均通过。定时器结果不代表全面 UI 或播放无掉帧认证。

## 实现变更

TypeScript 继续管理应用、传输、进度、轨迹匹配和谐波族判断。C++/WASM 执行主要数值循环，普通构建直接使用提交的二进制，不引入运行时 Python 或编译器。

| 部分 | 优化 |
| --- | --- |
| 频谱修复 | 逐帧分析、降噪、共振/shimmer inpainting、Bark/ATH、carver、PCG64 和重建在同一原生上下文中运行，每批最多 512 帧；频谱不再逐帧搬进搬出 WASM。 |
| 三轮 projection | 首次修复后缓存 Float32 目标幅度，后续三轮复用；不重复做同一套检测和随机重合成。不需要的幅度/PSD 统计也跳过，保留必要的 FFT、相位替换和 overlap-add。 |
| 声道对齐 | 全局大尺寸相关性 FFT 迁入原生实数 FFT，保留先搜索全局最大值、再判断 3 ms 接受范围的逻辑。 |
| 谐波峰值 | FFT、旋转、prominence 和 Hann lobe 拟合在原生执行，仅返回稀疏候选峰。固定旋转表预计算；单调栈线性求取 prominence 的左右最低值，替代重复向两边扫描。 |
| Delivery | 4× FIR 插值、通道联动 PDR limiter、回采样和峰值估计迁入 WASM，使用有界环形缓冲，不分配整曲 4× PCM。响度和高通保持参考行为。 |
| SIMD / 精度 | 使用 `-msimd128` 开启标准 SIMD/自动向量化，FFT 本身保留 ducc 标量算法；禁用 fast-math、浮点融合及 relaxed SIMD，保留 Float32 舍入点和 Float64 分析。 |

这次使用 CPU WASM，尚未引入 GPU 或共享内存线程。选择依据是已有热点采样、Float64/门限一致性要求和现有静态部署；不表示已经证明它比所有可能的 GPU、线程或原生实现都快。

## 资源预算

目标幅度缓存最多 **256 MiB**，且估算的频谱阶段工作集须 ≤**448 MiB**；不满足条件就逐轮重算。缓存路径第一轮结束即释放源 PCM，再分配第二个重建缓冲，避免源 PCM、两个输出和缓存同时存活。缓存路径和重算路径有逐样本一致测试。

WASM 线性内存初始 **2 MiB**、上限 **512 MiB**。释放较大阶段后，如果堆超过 **64 MiB**，用已经编译的模块创建新实例，让旧堆可被回收；不重新下载/编译。这些数字不是整体进程内存上限，浏览器回收也并非立即发生。播放器 A、新旧 B、JS PCM、WAV、解码副本、谐波数组会增加峰值内存。缓存换取速度，较长输入的重算路径会更慢；未做手机内存压力验证。

现有输入限制保持为 mono/stereo、8–96 kHz、12 分钟且解码 PCM ≤128 MiB，谐波观测最多 500,000 个。内核 **274,006 字节**，gzip 约 **94.3 KB**。WASM 编译/来源/许可证见 [内核说明](../src/audio/remaster/wasm/README.md)。

## 一致性与回归

- **187/187** 组完整 Python 默认链对照达到原定容差，含 17 个预设、8/44.1/48/96 kHz、非 hop 整帧长度、静音/纯音/噪声/瞬态/游移谐波/朗读语音/交付压力。
- 其中 **155/187** 最大 PCM 差 ≤2 个 PCM24 量化单位；最差非空残差 SNR **75.36 dB**，最大响度差约 **0.00043 LU**，有效频段差约 **0.00063 dB**；有信号通道的测得时差为 0。
- 最终内核的 187 个 WAV 与已测量的缓存版 WAV 逐字节一致，后续内存生命周期和冗余统计优化没有改变样本。
- 编译后的真实 Worker **51/51** WAV 与 Node 输出 SHA-256 一致。
- `npm run check`：lint、类型检查、构建和 **74 项测试通过**，包括独立冻结的 Python golden fixtures，以及缓存/重算的精确相等测试。
- 可复用测速脚本以 2 秒输入完成端到端自检；其参考始终来自干净、固定版本的上游 checkout。

Python checkout 未修改，enhance、tonal repair、projection、Delivery 均未移除，也没有放宽验收标准。参考固定为 `fea2cca81da613ec8a3aca4962a359e060eab9d9`，具体依赖版本和方法见 [v2 等价基线](remaster-equivalence.zh-CN.md)。

这是测试范围内的数值等价，不保证任意输入或其他依赖版本逐字节一致；未做真实歌曲盲听、移动端压力和 GPU/多线程性能对照。参数、源文件/输入哈希、完整测量、最终 WAV 哈希、测速和 Worker 证据见 [冻结结果](remaster-optimization-results.json)。

## 复现

沿用 [参考环境准备步骤](remaster-equivalence.zh-CN.md#复现)，再执行：

```sh
npm run check
.cache/remaster-parity-venv/bin/python scripts/compare-remaster.py --upstream .cache/deshimmer-reference --extended --output outputs/remaster-v3
node_modules/.bin/electron scripts/check-remaster-worker-parity.mjs outputs/remaster-v3
.cache/remaster-parity-venv/bin/python scripts/benchmark-remaster.py --upstream .cache/deshimmer-reference --output outputs/remaster-v3-speed
VIBLOOM_REMASTER_SECONDS=300 npm run desktop:smoke:remaster
```

测速默认 full-safe 和 180/240 秒，支持 `--preset delivery`、`--seconds 60 180 240`。工具输入为合成 PCM，不包含导入文件的解码成本。本次完整运行文件保存在忽略的 `outputs/remaster-speed/`，冻结证据提交到 docs。
