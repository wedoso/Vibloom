# Track A Remaster 可行性分析

后续实现：用户选择了浏览器原生重写，参见 [当前实现与范围](web-deshimmer.zh-CN.md)。以下保留为实施前的可行性分析。

分析日期：2026-10-07（America/Los_Angeles）。本次只做代码与架构分析，未实现处理功能，未运行上游音频处理或实测音质、耗时和峰值内存。

审阅版本：

- Vibloom：`5052d4fb57ad063ee7543c4b0887b58b77786814`。
- deshimmer：`fea2cca81da613ec8a3aca4962a359e060eab9d9`。
- Suno-Song-Remaster：`862a0aa7a686be3bc7e420d108f4e3e4e050bb1f`。

## 结论

用户要求的“给 A 应用预设 → 处理结果作为 B 同步试听 → 下载处理结果”可行。播放器和持久化机制已经覆盖后半段；需要新增离线处理、预设、任务管理及 WAV 导出。

建议分两步：先接入 Suno-Song-Remaster 的母带处理思路，覆盖 Web、macOS、Windows；随后在桌面端接入 deshimmer 的 Python 核心，提供 AI 音频伪影清理，并允许“清理 → 母带处理”的组合预设。若首版必须同时包含两个项目的实际算法，优先做桌面版本。

Suno 的 AI Fix 是五段 EQ 配方；deshimmer 是频谱伪影修复。它们可以互补，但不能把前者当作后者的替代。依据：[Suno 的 EQ 预设及离线链](https://github.com/SUP3RMASS1VE/Suno-Song-Remaster/blob/862a0aa7a686be3bc7e420d108f4e3e4e050bb1f/src/renderer.js#L674)、[deshimmer 核心](https://github.com/TheApeMachine/deshimmer/blob/fea2cca81da613ec8a3aca4962a359e060eab9d9/master.py)。

**后续偏好更新：**用户更重视 deshimmer 的多个预设。因此实施优先级建议调整为“桌面接入原 deshimmer 核心和预设 → 生成 B / 下载 → 再补通用母带和 Web 方案”。本报告早先建议的少量保守配方和关闭额外阶段是首版简化选项，不再作为默认范围；应优先保留选定上游版本的预设处理行为，并明确显示其用途。

## 现有架构能复用的部分

| 现有位置 | 当前能力 | 集成方式 |
| --- | --- | --- |
| `src/audio/SynchronizedAudioEngine.ts` | `getBuffer(0)` / `setBuffer(1, buffer)`，同一个 AudioContext 时钟、18 ms A/B 切换 | A 作为只读输入，完成后安装 B；处理链无需加入实时播放器 |
| `src/LibraryApp.tsx:780` | B 解码、波形、加入正在播放的时间线 | 抽出接收处理结果的共同入口，复用状态与调度 |
| `src/LibraryApp.tsx:1574` | B 导入、配额检查、缓存与关联 | 新入口接受明确的源 trackId、已解码 buffer 和生成文件 |
| `src/domain/library.ts` | 每首歌一个 `TrackComparison` | 增加可选的 remaster 来源、预设、参数、引擎版本和测量结果 |
| `src/platform/libraryPlatform.ts` | Blob/File 存储接口 | 生成 WAV 可直接进入现有缓存 |
| `src/platform/browserLibraryPlatform.ts` | IndexedDB 元数据 + OPFS 音频 | 延续“保留在设备上”和刷新恢复行为 |
| `src/audio/vocals/` | 后台任务、取消、进度、源身份校验 | 复用任务管理模式，新增 remaster 任务；不复用人声分离算法 |
| `src/LibraryApp.tsx:1266` | 歌词 Blob 下载 | 复用下载方式；音频仍需新增编码器与桌面验证 |

Web 是静态 React/Vite；Electron 加载同一套前端。当前桌面 preload 只暴露更新 API，音频和库仍使用浏览器实现，并不存在现成的 Python 后端或原生音频导出桥。详见 `docs/architecture.md`、`desktop/main.mjs`、`desktop/preload.cjs`。

## 两个项目分别如何接入

### Suno-Song-Remaster：集成成本中等，适合首版

上游使用 JavaScript、Web Audio、OfflineAudioContext 和原生 JS WAV 编码，没有音频处理运行时依赖。可抽取 EQ、温和压缩、低频清理、立体声处理、响度归一化和最终峰值控制；UI、播放器、批量队列、编辑器不需要引入。[技术栈与功能说明](https://github.com/SUP3RMASS1VE/Suno-Song-Remaster/blob/862a0aa7a686be3bc7e420d108f4e3e4e050bb1f/README.md)、[WAV 编码器](https://github.com/SUP3RMASS1VE/Suno-Song-Remaster/blob/862a0aa7a686be3bc7e420d108f4e3e4e050bb1f/src/wavEncoder.js)。

上游 `renderer.js` 有 2789 行，处理函数依赖全局 `state`，预设切换直接修改 DOM。它不是可以直接安装使用的独立 DSP SDK。应抽出显式接收 `inputBuffer + settings` 的模块，再接入 React。

需要修正或验证的具体问题：

- `lufs.js` 的相对门限先对 LUFS 的 dB 值做算术平均，而不是先汇总线性能量；44.1 kHz 的高架滤波系数与 48 kHz 相同，其他采样率直接使用 48 kHz 系数。因此不能照搬其标准符合性声明。首版限定并正确处理 44.1/48 kHz，使用参考测量验证。[响度源码](https://github.com/SUP3RMASS1VE/Suno-Song-Remaster/blob/862a0aa7a686be3bc7e420d108f4e3e4e050bb1f/src/lufs.js)。
- `truePeakClip()` 在四倍上采样域硬削波、降采样后再钳制样本，没有对最终文件再次测量 true peak。由代码可推断其最终 dBTP 上限仍需验证，不能仅凭函数名保证；硬削波也可能增加失真。[峰值处理源码](https://github.com/SUP3RMASS1VE/Suno-Song-Remaster/blob/862a0aa7a686be3bc7e420d108f4e3e4e050bb1f/src/renderer.js#L1492)。
- 渲染结果与 A 长度相同，不等于其瞬态位置一定相同。压缩、重采样及任何带 lookahead 的新实现均要用脉冲测试确认整体延迟，补偿可确认的算法延迟，避免尾部截断。

### deshimmer：桌面可行，Web 原样接入成本高

上游已有可调用的 `process_audio(x, sr, params=..., master_params=...)`，返回 PCM 与测量信息。这里的 API 是 Python 函数，不是 HTTP 服务。可以跳过 Gradio、自动寻参、诊断图和实时播放器。[Python API](https://github.com/TheApeMachine/deshimmer/blob/fea2cca81da613ec8a3aca4962a359e060eab9d9/deshimmer_api.py)。

建议桌面端新增受控 IPC，由 Electron 主进程启动独立本地处理进程。通过 jobId、固定参数结构、进度消息及临时 PCM/WAV 文件交互；音频始终留在设备。Python 核心及其传递依赖要一起打包，不能只复制 `deshimmer_api.py` 和 `master.py`。

核心依赖包括 NumPy、SciPy、SoundFile；Numba 提供加速，pyloudnorm 提供 LUFS 测量。直接采用上游 requirements 会额外引入 Gradio、绘图、Optuna 等本次不需要的内容，应按实际 import 裁剪并锁定版本。[依赖清单](https://github.com/TheApeMachine/deshimmer/blob/fea2cca81da613ec8a3aca4962a359e060eab9d9/requirements.txt)、[核心及默认参数](https://github.com/TheApeMachine/deshimmer/blob/fea2cca81da613ec8a3aca4962a359e060eab9d9/master.py)。

主要工作量是 macOS ARM64 / Windows x64 的运行时打包、签名、临时文件生命周期、取消与长音频内存。建议打包后用户不必自行安装 Python；处理可执行文件作为资源放在 ASAR 外，并纳入现有签名发布流程。

静态 Web 无法直接运行这个 Python 核心。移植到 JS/WASM，或评估浏览器 Python 环境都需要另做原型；Numba 加速、SciPy 依赖和内存成本尚未验证，不建议列入首版。云端服务会改变当前“音频不上传”的产品约定，也不符合本次默认方案。

## 推荐的最小功能范围

首版只处理当前 Track A，每次生成一个完整版本 B。预设可先设为 Neutral、Warm、Vocal、AI Fix；每个预设应包含完整母带参数，而不只是上游 EQ 的五个增益值。以上名称和组合属于建议，具体参数要试听确认。

桌面第二步加入 Gentle Cleanup、Balanced Cleanup、Cleanup + Master。清理和母带处理顺序为：

```text
Track A 的只读 PCM
    → 可选 deshimmer 清理（关闭其交付母带阶段）
    → EQ / 温和压缩 / 可选立体声处理
    → 测量并调整响度
    → 最终峰值控制与复测
    → WAV 文件
    ├─ 安装到 Track B → 现有同步试听
    ├─ 现有设备缓存与歌曲关联
    └─ 下载同一份 WAV
```

deshimmer 的内置预设位于 `ui_gradio.py`；`ui_presets.json` 含个人自定义配方，其中一个开启 `delta_listen`，输出会是差分信号。不能直接把该 JSON 当成产品预设列表。上游预设还是对当前参数的局部更新；接入时必须从固定默认值生成完整参数快照，并强制普通结果 `delta_listen=false`。[预设源码](https://github.com/TheApeMachine/deshimmer/blob/fea2cca81da613ec8a3aca4962a359e060eab9d9/ui_gradio.py#L522)、[自定义预设](https://github.com/TheApeMachine/deshimmer/blob/fea2cca81da613ec8a3aca4962a359e060eab9d9/ui_presets.json)。

当前 deshimmer 的 `tonal_repair` 默认为 0.5，清理首版建议显式关闭音高修复、高频重合成、随机相位重合成等额外阶段；这属于 Vibloom 自己定义的保守清理配方，不应宣称与上游默认完整处理等价。

用户流程建议：打开 A → Remaster → 选择预设 → “Apply to B” → 展示处理状态 → 成功后显示 B 和下载按钮。默认继续听 A，由用户切换到 B。若已有 B，按钮明确显示“Replace B”；旧 B 保留至新结果成功。

下载优先支持 WAV 24-bit、44.1/48 kHz；无需首版引入 MP3 编码器。播放器 A 的 buffer 已按解码上下文采样率生成，不能把其 `sampleRate` 当作原始文件采样率。若需要保留源采样率，必须另做源信息读取和解码策略。

为保证试听、下载与刷新恢复使用同一处理结果，建议先生成最终 WAV，解码后安装 B，缓存和下载共享这一文件。后续如需降低额外解码成本，再优化直接安装 PCM 的路径，并验证量化与采样率差异。

## 必须处理的工程边界

1. **结果归属和竞争：**任务固定 trackId、源指纹、预设参数及 B 修订号。用户切歌后，结果只能保存到原歌曲；不能调用当前只以“当前歌曲”为目标的 `loadComparisonFile()`。手动替换 B、取消、删除歌曲或重新 Apply 后，过期任务不得安装或覆盖新 B。
2. **原音保护：**不得原地修改 A，亦不得把播放中的 channel ArrayBuffer 直接 transfer 给 Worker。仅复制必要 PCM；失败时保留现有 A/B 和缓存，生成文件先放临时位置，成功后提交关联。
3. **时间对齐：**保留时长和首尾位置；对整体算法延迟做实测与补偿。滤波本身造成的频率相关相位变化属于处理结果，不能用一个整体偏移消除。共享时钟只保证播放同步，不会自动修复处理产生的延迟。
4. **缓存身份：**新 B 清除旧 B 的 vocalAnalysis，并给生成文件新的稳定身份；否则现有 lip-sync 缓存可能误用。remaster 参数与版本保存于 comparison 的可选字段，兼容旧库。
5. **资源预算：**五分钟 48 kHz 双声道 float32 PCM 约 115 MB；一份四倍采样 PCM 约 461 MB。A/B、多次渲染、测量中间数组及编码可能使内存超过 1 GB。这是数组体积估算，不是实测。当前 300 MB 文件限制不能约束解码内存，长音频需另定时长/PCM 预算。
6. **响应与取消：**OfflineAudioContext 适合离线渲染，但不能假设它可在普通 Worker 中运行；LUFS 循环和 WAV 编码可放 Worker。单次离线渲染无法保证立即中止，取消至少要阻止结果提交并释放后续资源；需要硬取消时评估分块或隔离处理环境。桌面 Python 子进程可终止并清理临时文件。
7. **共享重任务资源：**与现有人声分离协调，避免同一时间运行多个大 PCM 任务；单独的任务队列不会自动限制两个功能的总内存。
8. **试听响度：**建议可选的等响度 A/B 监听，减少“更响就更好”的比较偏差。只调整监听增益，不改下载文件；如首版加入，需要扩展当前引擎只切换 0/1 增益的行为。

## 建议代码边界与实施顺序

- `src/audio/remaster/`：完整预设、纯参数处理入口、测量、编码 Worker、任务状态和取消。
- `src/LibraryApp.tsx`：Remaster 入口与安装 B 的编排；把上传 B 与生成 B 共用的安装逻辑抽出，避免继续堆积 DSP。
- `src/domain/library.ts`：可选 remaster 来源和参数记录。
- `src/platform/`：处理能力检测与导出接口；桌面能力由实际桥存在与否判断，不能仅依赖当前固定为 web 的默认 platform。
- `desktop/`：第二步新增受限 remaster IPC、子进程控制与资源打包；保留现有隔离配置。

实施顺序：先打通一个保守预设的 A → WAV → B → 下载闭环；再完善四个母带预设、测量与资源控制；最后接入桌面 deshimmer 清理及组合预设。无需加入批处理、编辑器、自定义调参、自动优化和独立播放器。

验收重点：脉冲对齐与尾部、静音与短音频、mono/stereo、44.1/48 kHz、最终 WAV 峰值与响度参考交叉检查；切歌/取消/重新 Apply/手动替换 B 的任务竞争；缓存失败仍可下载、刷新后 B 恢复、桌面打包后的保存行为、长曲内存，以及真实 Suno 曲目的人声/镲片/空间感试听。处理是否改善音质取决于素材和配方，尚待音频样本验证。

## 上游许可信息

deshimmer README 声明 MIT；Suno README 与 package.json 声明 ISC。本次审阅的两份 checkout 均未找到独立 LICENSE 文件。实际复制代码前需整理可核实的版权声明与完整许可文本，并逐项核对打包的第三方依赖；这是分发准备事项，不影响本次架构结论。[deshimmer 声明](https://github.com/TheApeMachine/deshimmer/blob/fea2cca81da613ec8a3aca4962a359e060eab9d9/README.md)、[Suno 声明](https://github.com/SUP3RMASS1VE/Suno-Song-Remaster/blob/862a0aa7a686be3bc7e420d108f4e3e4e050bb1f/package.json)。

## GitHub 替代项目检索补充

检索日期：2026-10-07。下列适配判断基于项目文档和部分源码审阅，未进行音质或集成实测；“接入更简单”不代表“清理效果更好”。

| 项目 | 能力和预设 | 对 Vibloom 的判断 |
| --- | --- | --- |
| [audiojs/denoise](https://github.com/audiojs/denoise) | MIT 声明，JS 模块；谱减、Wiener、OM-LSA、de-ess、de-click、de-clip 等，浏览器示例；mono Float32Array 接口 | 最适合评估 Web 通用修复。需要自己定义音乐预设和立体声策略；不能直接复现 deshimmer 的 swish / 持续共振 / shimmer 组合 |
| [vbasky/cathar](https://github.com/vbasky/cathar) | MIT OR Apache-2.0；Rust 库和独立 CLI，提供 JSON 多阶段 chain 预设 | 桌面通用修复候选，依赖打包相对 Python 科学计算栈更直接。不是现成 Suno 专用预设集，也未发现可直接采用的官方浏览器 WASM 接口 |
| [relationsuno/Spectral-Lifter](https://github.com/relationsuno/Spectral-Lifter) | MIT；Python 的谱减和高频动态抑制，Gradio 一键处理 | 题材接近，但 UI 未提供同等多预设；README 声明神经上采样被撤下，审阅源码的 neural pass 也是空操作。依赖仍包含 Torch，未形成比 deshimmer 明显更省事的方案 |
| [henricksmedia/shimmer](https://github.com/henricksmedia/shimmer) | 专门清理 AI 音乐并母带处理，Python/FastAPI；2.x 使用处理卡片替代旧预设 | 功能接近，但当前不是允许自由集成的开源库；其许可证明确要求嵌入其他软件取得书面许可，因此不作为当前直接集成候选 |
| [JusperLee/Apollo](https://github.com/JusperLee/Apollo) | 面向有损压缩音乐修复的研究模型 | 更适合另做模型修复实验，不是 deshimmer 多预设 DSP 引擎的直接替代 |

源码审阅锁定：audiojs/denoise `d6f351310cc713947cf8b0bac4ed4c83e4116610`；cathar `f2c2842f89084589d069e5a8a0b61311aa70d928`；Spectral-Lifter `77f6319e83afba4a455fd7e4175eaa2e72fc2501`。[JS 接口与依赖](https://github.com/audiojs/denoise/blob/d6f351310cc713947cf8b0bac4ed4c83e4116610/package.json)、[Rust chain 实现](https://github.com/vbasky/cathar/blob/f2c2842f89084589d069e5a8a0b61311aa70d928/crates/cathar-cli/src/main.rs)、[Spectral-Lifter 上采样实现](https://github.com/relationsuno/Spectral-Lifter/blob/77f6319e83afba4a455fd7e4175eaa2e72fc2501/core/upscaling.py)、[Shimmer 当前许可](https://github.com/henricksmedia/shimmer/blob/main/LICENSE)。

原 deshimmer 在已审阅版本中有 17 个内置菜单项（含 bypass）：轻/标准/强 shimmer、噪声重合成、轻/强 denoise、轻/强 de-resonator、保守/强 full stack、两种交付响度、两种频段实验、两种 Suno/Udio whine 配方。保留这些预设名称和配方，不需要引入 Gradio UI 或 Optuna 优化器。个人 JSON 预设可以后续导入，但 diff 输出必须与正常 B 音频区分。

综合判断：偏好原预设时，优先包装原 deshimmer 引擎；追求 Web 统一运行时，优先原型评估 audiojs/denoise 的小模块，并明确这些是 Vibloom 新定义的通用修复预设，不是 deshimmer 同名等效版本。

## 原 deshimmer 迁移到 Web 的路径

逻辑可以迁移。没有发现核心算法必须依赖服务端、GPU 或外部模型权重；障碍是 Python 科学计算运行时与浏览器的差异，以及整曲处理的资源预算。原预设是参数配方，可以连同阶段顺序迁移；仅迁移参数、换用另一套降噪算法不能视为等效实现。

两条路线：

1. **Pyodide + Worker 做兼容性原型。**Pyodide 官方包列表包含 NumPy、SciPy、SoundFile，可以在 Worker 运行 Python，因此可以尝试保留原处理代码。当前内置列表未发现 Numba，不能假设原 JIT 可用；上游有 ImportError fallback，但纯 Python 循环耗时必须实测。pyloudnorm 及其具体版本的加载也需要验证，不能让缺失依赖后静默降级到 RMS 来冒充 LUFS。优点是更容易保留完整处理行为和预设；不足是运行时下载、初始化、跨语言复制及内存。[官方包列表](https://pyodide.org/en/stable/usage/packages-in-pyodide.html)、[Worker 用法](https://pyodide.org/en/stable/usage/webworker.html)。
2. **TypeScript 编排 + JS/WASM DSP 做正式移植。**重写 STFT/iSTFT、频谱中值和时间统计、降噪/共振/shimmer 各阶段及随机相位、重采样、母带处理；复杂的 tonal tracking/repair 还涉及指派算法和样条重建。可用 Rust/C++ 编译 WASM 实现计算核心，由 Worker 调用。适合共用 Web 与 Electron 的处理引擎，但不是几段 Web Audio EQ 能完成的工作；数值与音质一致性要以固定版本 Python 输出为参考验证。

资源估算补充：按 5 分钟、48 kHz、双声道、FFT=2048、hop=512，单份 complex64 STFT 矩阵约 461 MB；上游还有 `Z_orig` 副本、幅值、PSD、增益图及投影过程临时数组。即使不做四倍峰值采样，整曲原样搬入浏览器也可能有很高内存。此为数组体积估算，未做运行实测。

分块改造需保留跨块状态、重叠上下文、全曲统计与重建边界；tonal tracking 和反复谱投影不能简单按独立小片运行后拼接就保证原效果。短预览适合验证，但完整渲染的正确性和资源占用必须单独验证。

建议先用 Pyodide 对原引擎、全部 17 个内置菜单项做短音频兼容性验证，再对代表性预设做整曲耗时/内存测试。若能满足产品预算，可以保留此路线；若不能，使用该原型与桌面 Python 结果作为 JS/WASM 移植的参考。产品流程仍是 A → 后台离线处理 → B → WAV，不要求实时处理。

单线程 WASM/Worker 可作为静态部署起点；多线程共享内存通常要求 cross-origin isolation，需另核对托管能力。[浏览器要求](https://developer.mozilla.org/en-US/docs/Web/API/WorkerGlobalScope/crossOriginIsolated)。
