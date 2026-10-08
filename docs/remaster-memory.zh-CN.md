# Remaster 内存审计

2026-10-07，分支 `codex/web-deshimmer`，引擎 `web-deshimmer-3`。测试设备：Apple M2 Max / macOS 27.0.1；应用测试使用 Electron 43.3.0，独立原生生命周期测试使用 Node 25.2.1。

**已修复多处资源保留问题。在本次重复处理、取消、失败和边界测试中，未发现持续增长的音频缓冲泄漏，也没有检测到原生越界或未定义行为。** 处理峰值仍然较高；这些结果不构成所有输入、设备或应用功能都不会耗尽内存的保证。测量和源文件哈希保存在 [结果文件](remaster-memory-results.json)。

## 修复内容

| 位置 | 问题与修复 |
| --- | --- |
| React / 人声口型回调 | 堆快照显示旧 `prepare` 回调通过 React 的上一版属性保留 A 的 AudioBuffer，清空队列后仍可达。改为只保存时长和音频引擎 getter，在用户操作或真正开始任务时读取缓冲。 |
| 播放器 | 停止源节点时清空 `source.buffer`；清空队列、重置库时释放 A/B、波形和比较文件引用；关闭引擎时断开节点、清空缓冲并关闭 AudioContext。 |
| Worker | 成功、取消、错误及初始 `postMessage` 同步抛错都走清理：移除消息/错误/abort 回调并终止 Worker。初始化发送失败也能释放串行任务槽。 |
| 原生阶段 | 频谱、对齐、限幅在 `finally` 销毁上下文并检查大堆回收；峰值分析器 dispose 后清空 WASM exports 引用，避免对象继续保留旧大堆。超过 64 MiB 的已释放堆用新 2 MiB 实例替换，复用已编译模块。 |
| WAV 分配 | 完整修复结束后才创建 WAV 的整曲 PCM，避免频谱缓存运行期间额外共存一份整曲数组。44.1 kHz 立体声 3–4 分钟输入可推迟约 61–81 MiB 的分配。写入后立即清空临时 planar 数组引用。 |
| 谐波分析 | 除 500,000 个观测点限制外，增加匹配矩阵 1,000,000 单元、邻接关系 1,000,000 条、累计候选族网格 2,000,000 单元预算。在大型矩阵分配前明确报错，要求缩短片段。 |
| 下载 | 下载 Blob URL 保留 30 秒供浏览器完成下载，随后 revoke；组件卸载也清除计时器并 revoke 尚未到期的 URL。 |
| 人声任务记录 | 替换/删除 B 时丢弃旧 B 的分析记录并取消对应任务；重置库/卸载时取消所有人声任务并清空记录。取消后的迟到进度、结果和读取不能重新发布旧记录。 |

仍有意保留当前 A/B 的已解码缓冲用于即时比较、播放。库内原文件和缓存结果也按产品功能保留；OPFS/IndexedDB 的持久文件不是 JS 内存泄漏。单独提交的库内人声准备任务可在清空播放队列后继续，重置库会取消它们。

## 实际应用重复测试

使用隔离的新配置目录和 60 秒、44.1 kHz 立体声合成音乐＋噪声，连续六次 full-safe 重建 B，并测试实际 PCM24 下载、初始化发送异常、三次取消、移除 B、清空队列、重新载入 A/B 和重置库。

通过 WeakRef 统计所有解码产生的 AudioBuffer，测试工具不持有它们的强引用；各检查点执行多轮 Chromium/V8 GC，验证对象是否可回收，而不是要求浏览器立刻回收。

| 检查点 | 仍可达的 AudioBuffer | 活跃 remaster Worker |
| --- | --- | --- |
| 只载入 A | 1 | 0 |
| 每次完成并替换 B | 2：当前 A 和当前 B | 0 |
| 初始化发送失败、三次取消后 | 2：原有 A/B | 0 |
| 删除 B 后 | 1 | 0 |
| 清空队列后 | 0 | 0 |
| 重新载入 A/B 后 | 2 | 0 |
| 重置库后 | 0 | 0 |

所有 11 个创建的 remaster Worker 均已终止。下载文件验证为 PCM24；计时器到期后 URL 已回收，清空队列和重置检查点的 URL 计数为 0。连续替换没有积累旧 B 音频，保留的 JS 堆达到稳定区间。

该测试保留了实际 Live2D 界面，因此 Chromium backing storage 和进程工作集还包括模型、纹理、渲染资源等。结果文件记录的是整个 renderer 指标，不能把它们全部归因于 remaster。

## 原生堆、边界与异常退出

独立 Node 测试在同一运行时反复创建和释放峰值分析器，向频谱及限幅阶段注入异常，共四轮。强制 GC 后 ArrayBuffer 保留量没有逐轮增长；已 dispose 的峰值分析器不再保留旧 WASM 实例。

在 8/96 kHz 和 mono/stereo 四个输入边界，测试最大允许长度或 128 MiB PCM 上限的原生修复分配，包括两个重建 bank 的分配。最高线性内存为 **384.8 MiB**，均低于 512 MiB 限制；清理后当前实例恢复到 2 MiB。这是边界分配测试，没有把四首边界长曲都完整处理一遍。

另一个完整 4 分钟、44.1 kHz 立体声 full-safe 测试结果：

| 指标 | 实测 |
| --- | --- |
| WASM 线性内存高水位 | **328.2 MiB** |
| 原生修复阶段结束后当前 WASM 堆 | **2 MiB** |
| 输入、WAV 和任务引用释放并 GC 后，Node 所统计 ArrayBuffer 总量 | 约 **27 KiB**，回到测试工具基线附近 |
| 阶段检查点中最大的独立 Node 进程 RSS | 约 **824 MiB** |

328 MiB 是 WASM 堆大小，**不是整个应用内存峰值**。独立 Node 的 RSS 包含 TypeScript 测试加载器、JS 数组、原始输入、尚未回收的旧堆及分配器缓存；这里只在阶段检查点采样，连续峰值可能更高。实际应用还会叠加旧 B、文件/解码副本、React、Live2D 和 GPU 资源。

资源释放指的是解除引用、销毁上下文、终止 Worker，使内存可回收。JS/WebAudio GC 和操作系统分配器可能延迟归还页面，所以任务完成后 RSS 没有立即降回初始值，本身不能作为泄漏证据。当前策略没有承诺整个进程 ≤512 MiB。

## 越界与回归检查

- 用实际 C++ 内核源码运行 AddressSanitizer / UndefinedBehaviorSanitizer：**96 个用例通过**，覆盖四种采样率、mono/stereo、短于窗长/边界/非整帧长度以及缓存与重算路径；包括频谱、峰值、声道相关性和限幅。此检查没有启用 LeakSanitizer，也不是所有输入的形式化安全证明。
- `npm run check`：lint、类型检查、生产构建和 **77 项测试通过**，包括 Worker 初始化异常清理、引擎关闭、谐波分配预算、独立 Python golden fixtures、缓存/重算精确相等以及人声任务取消/丢弃记录。
- 内存生命周期和 WAV 分配调整后，真实 Worker **51/51** WAV 与既有 Node 参考输出 SHA-256 相同。C++ 数值源码和 WASM 二进制未变；WASM SHA-256 为 `b383bf482a097c3b30bd3146d5e9472cd7dbb6972766529559f4eb19a9abaf96`。

尚未做移动端内存压力测试，也没有对所有真实歌曲或与正在运行的 Demucs 分离任务组合进行穷举。现有 remaster 和人声重计算共用串行队列；浏览器仍可能因设备整体可用内存不足而结束页面。较密集的谐波素材超预算会明确失败并保留旧 B，数值验收门限没有放宽。

## 复现

```sh
npm run check
node_modules/.bin/electron scripts/check-remaster-memory.mjs
node --expose-gc scripts/check-remaster-native-memory.mjs
node --expose-gc scripts/check-remaster-long-memory.mjs
```

结果写入忽略的 `outputs/remaster-memory/`。应用脚本默认重复六轮，`VIBLOOM_MEMORY_ROUNDS=1` 可缩短为单轮。Sanitizer 需要开发机上的 clang++，普通应用运行不需要编译器：

```sh
clang++ -std=c++17 -O1 -g -fno-omit-frame-pointer \
  -fsanitize=address,undefined -ffp-contract=off \
  -DDUCC0_NO_SIMD -DDUCC0_NO_LOWLEVEL_THREADING \
  -Isrc/audio/remaster/wasm/vendor \
  scripts/check-remaster-sanitizer.cpp \
  src/audio/remaster/wasm/fft-kernel.cpp \
  -o outputs/remaster-memory/native-sanitizer
outputs/remaster-memory/native-sanitizer
```
