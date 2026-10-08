# 浏览器 remaster 实现

分支：`codex/web-deshimmer`。当前引擎：`web-deshimmer-3`。

在 Player 的 A 卡片右上角点击魔杖 **Remaster A**，打开独立预设面板。17 个预设可以按 Shimmer、Full stack、Resonance、Targeted、Delivery 浏览，选中后显示说明，点击 **Create version B**；已有 B 时按钮为 **Replace version B**。主页面不常驻预设、说明或参数面板。

处理时点击 **Keep listening** 或关闭面板即可继续播放和切换 A/B，A 卡片底部只显示紧凑进度；点击它可重新打开并取消。完成后面板自动收起，切换 B 比较，点击 B 右上角下载图标 **Download B** 下载 24-bit PCM WAV。B 的更多菜单提供文件替换和移除。自动缓存开启时，结果存入本设备，下次访问恢复。面板支持 Esc、焦点恢复、窄屏滚动和两套人物配色。

## 架构

TypeScript 负责应用、Worker 协议、进度和谐波轨迹/族匹配；C++ 编译的 WASM 执行主要数值循环。普通构建和运行均无需 Python、C++ 编译器、模型或音频上传。

- `presets.ts`：17 个独立配方，固定 Python 版本的全新 UI 默认状态；不继承上一个配方的参数。
- `dsp.ts` / `nativeRepair.ts`：全局声道对齐、频谱平衡、离线最小统计降噪、shimmer / 共振 inpainting、Bark/ATH 与时间掩蔽、Dynamic Spectral Carver、NumPy seed 0 PCG64 随机相位、三轮 STFT projection。窗长 2048、hop 512。
- `tonal.ts` / `nativePeaks.ts`：4096 点窗、16384 点 FFT；原生峰值和 Hann lobe 检测，TypeScript 保留 Hungarian 轨迹匹配、谐波族及置信度判断、连续相位修复。固定旋转表预计算，峰值显著性用线性时间的单调栈计算。
- `master.ts` / `nativeLimiter.ts` / `wav.ts`：参考 RBJ 响度归一化、DC 去除、20 Hz 零相位高通；原生 81-tap FIR 的 4× 重采样、通道联动 PDR limiter；与 libsndfile 一致的 PCM24 量化。峰值窗口保留 Python 实现的实际行为，4× 峰值仅作估计。
- `wasm/`：固定 SciPy 版本的 ducc 实数 FFT、频谱、峰值、相关性和限幅内核；标准 SIMD 编译开启，禁止 fast-math、浮点融合和 relaxed SIMD。FFT 本身保留参考标量算法。
- `renderRemaster.ts` / `remaster.worker.ts`：两秒 PCM 分块传输，一次一个块在途，保留播放器 A 的 AudioBuffer。完整输入收齐后离线处理，数值工作在 Worker 中执行。
- `processingQueue.ts` / `LibraryApp.tsx`：重任务串行化；取消、切歌、手动替换 B 使旧任务失效并终止 Worker。身份检查、处理和解码成功后才提交 B；缓存失败保留会话结果及下载。
- `RemasterDialog.tsx` / `ComparisonActions.tsx`：按需打开的预设选择和处理状态面板；B 下载及更多操作。面板关闭不取消处理，处理成功后收起；使用现有颜色和字体变量。

输出保持已解码 A 的采样数、通道数和采样率。源文件采样率可能被 AudioContext 解码改变。

## 速度与一致性

M2 Max / macOS 27.0.1 / Electron 43.3.0、full-safe、44.1 kHz 立体声、相同合成 Float32 PCM：

| 长度 | v2 Web | 当前 v3 Web | Python（无 Numba） |
| --- | --- | --- | --- |
| 3 分钟 | 40.7 秒 | **13.8 秒** | 18.4 秒 |
| 4 分钟 | 54.5 秒 | **18.4 秒** | 24.3 秒 |

v3 约为 v2 的 3 倍处理速度，本次耗时比 Python 少约 24–25%。完整应用内 5 分钟合成音乐＋噪声测试约 **22.47 秒**，约 13.4 倍实时速度；主线程 16 ms 定时器最大间隔约 27.4 ms。处理计时包含 WAV 生成，不含源解码、B 解码和缓存。各长度单次测量；不代表真实歌曲、所有配方或设备的保证。详细方法和证据见 [优化报告](remaster-optimization.zh-CN.md)。

完整默认 Python 链 17×11 共 **187/187** 组达到原定数值容差；真实 Worker 的 **51/51** WAV 与 Node 逐字节相同。参考阶段、门限未降低。当前是固定版本和测试范围内的数值等价，不能承诺任意输入及依赖版本逐字节一致。历史 v2 方法见 [等价报告](remaster-equivalence.zh-CN.md)。

## 内存与范围

为加速 projection，首次修复后缓存 Float32 目标幅度，后续三轮直接使用。缓存最多 256 MiB，且估算的频谱工作集须 ≤448 MiB；不满足时自动逐轮重算，两条路径有逐样本一致测试。缓存路径第一轮后释放源 PCM，再分配第二个重建缓冲。

WASM 线性内存初始 2 MiB、上限 512 MiB。阶段释放后若堆超过 64 MiB，以已经编译的模块创建新实例，让旧堆可被回收。没有保存整曲复数 STFT 或整曲 4× 过采样数组。目标幅度缓存增加内存以换取速度；该预算不代表整个进程的内存上限。现有 A、新旧 B、JS PCM、WAV、浏览器内部副本和谐波修正数组仍可能共存。

WAV 的整曲 PCM 在修复结束后才分配，避免与频谱大堆同时存在。成功、取消和失败均终止 Worker；清空队列/重置库释放 A/B 音频引用，旧 React 回调通过 getter 读取音频而不保留旧 PCM。下载 URL 到期或卸载时回收。实测 4 分钟 full-safe 的 WASM 堆高水位约 328 MiB，阶段释放后当前实例恢复到 2 MiB；整体进程占用更高。重复处理、异常、边界和越界检查见 [内存审计](remaster-memory.zh-CN.md)。

输入限于 mono/stereo、8–96 kHz、12 分钟且解码 PCM ≤128 MiB。谐波轨迹最多 500,000 个观测点，匹配矩阵最多 1,000,000 单元、邻接关系最多 1,000,000 条、累计候选族网格最多 2,000,000 单元；超限明确提示缩短片段。普通 Delivery 需要超过 9 个样本以执行参考高通。尚未验证手机内存压力或真实歌曲盲听。当前没有接入 Suno-Song-Remaster 的完整母带链。

## 开发验证

`npm run check`：lint、类型检查、生产构建及 **77 项测试**。独立 Python golden fixtures 不依赖运行时 Python。`npm run desktop:smoke:remaster` 验证真实 Worker、同步播放、下载、取消及故障恢复、缓存失败回退与重开。长曲使用 `VIBLOOM_REMASTER_SECONDS=300`。

内核构建、固定来源、许可证与内存策略见 [WASM 说明](../src/audio/remaster/wasm/README.md)。普通构建直接使用提交的二进制，无须 SDK。
