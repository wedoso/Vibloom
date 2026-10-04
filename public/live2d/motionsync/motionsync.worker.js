/* Production vocal shape adapter. Calls the unmodified official MotionSync Core API.
 * One context per clip; identity mappings expose A/E/I/O/U/Silence strengths,
 * not calibrated phoneme probabilities. Timing uses consumed PCM samples.
 */
importScripts("live2dcubismmotionsynccore.min.js");

self.onmessage = ({ data }) => {
  const { ToPointer: ptr, CubismMotionSyncEngine: engine, Context } = Live2DCubismMotionSyncCore;
  const allocations = [];
  const allocate = (bytes) => { const address = ptr.Malloc(bytes); allocations.push(address); return address; };
  let context;
  let initialized = false;
  try {
    initialized = engine.csmMotionSyncInitializeEngine(0) === 1;
    if (!initialized) throw new Error("MotionSync Core 初始化失败。");
    const ids = ["A", "E", "I", "O", "U", "Silence"];
    const mappingList = allocate(ids.length * 24);
    ids.forEach((id, i) => {
      const mappingPtr = allocate(24);
      const fields = ptr.ConvertMappingInfoCriToFloat32Array(new Float32Array(6), mappingPtr,
        id, ids, ids.map((_, j) => Number(i === j)), ids.length, 1, 1);
      allocations.push(fields[0], fields[1], fields[2]);
      for (let j = 0; j < 6; j++) {
        if (j === 4) ptr.AddValuePtrFloat(mappingList, i * 24 + j * 4, fields[j]);
        else ptr.AddValuePtrInt32(mappingList, i * 24 + j * 4, fields[j]);
      }
    });
    const contextConfig = allocate(8);
    ptr.ConvertContextConfigCriToInt32Array(new Int32Array(2), contextConfig, 44100, 32);
    context = new Context();
    context.csmMotionSyncCreate(contextConfig, mappingList, ids.length);
    const required = context.csmMotionSyncGetRequireSampleCount();
    if (!Number.isInteger(required) || required <= 0) throw new Error("MotionSync 无法建立音频分析上下文。");
    const config = allocate(12);
    ptr.ConvertAnalysisConfigToFloat32Array(new Float32Array(3), config, 1, 60, 0);
    // Smoothing is an int32 field in the native ABI, despite the Float32Array
    // converter's representation. Match the official Framework adapter.
    ptr.AddValuePtrInt32(config, 4, 60);
    const resultPtr = allocate(12);
    const result = ptr.ConvertAnalysisResultToInt32Array(new Int32Array(3), resultPtr, ids.length);
    const valuesPtr = result[0];
    allocations.push(valuesPtr);
    // Stream one native analysis window at a time, bounding Core heap usage.
    // The final incomplete window is zero-padded without extending the clip.
    const pcmPtr = allocate(required * 4);
    // Save five normalized weights per 50 Hz frame as bytes, rather than a
    // growing native-rate event list or only the strongest vowel. Zero-order
    // sampling uses consumed PCM timestamps, without advance or lookahead.
    const frameCount = Math.ceil(data.mono.length / 882);
    const vowels = new Uint8Array(frameCount * 5);
    let consumed = 0, frame = 0;
    let current = [0, 0, 0, 0, 0];
    const writeFrame = () => {
      const total = current.reduce((sum, value) => sum + value, 0);
      if (total > 1e-6) for (let i = 0; i < 5; i++) vowels[frame * 5 + i] = Math.round(current[i] / total * 255);
      frame++;
    };
    while (consumed < data.mono.length) {
      for (let i = 0; i < required; i++) ptr.AddValuePtrFloat(pcmPtr, i * 4, data.mono[consumed + i] ?? 0);
      const ok = context.csmMotionSyncAnalyze(pcmPtr, required, resultPtr, config);
      if (ok !== 1) throw new Error("MotionSync 分析失败。");
      const count = ptr.GetProcessedSampleCountFromAnalysisResult(resultPtr + 8);
      if (!Number.isInteger(count) || count <= 0 || count > required) throw new Error("MotionSync 返回了无效的音频进度。");
      consumed += count;
      const values = ptr.GetValuesFromAnalysisResult(valuesPtr, ids.length);
      if (!values.every(Number.isFinite)) throw new Error("MotionSync 返回了无效嘴形。");
      while (frame < frameCount && frame * 882 < consumed) writeFrame();
      current = values.slice(0, 5).map(value => Math.max(0, Math.min(1, value)));
    }
    while (frame < frameCount) writeFrame();
    self.postMessage({ type: "result", vowels }, [vowels.buffer]);
  } catch (error) {
    self.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
  } finally {
    context?.csmMotionSyncDelete();
    for (const address of allocations.reverse()) if (address) ptr.Free(address);
    if (initialized) engine.csmMotionSyncDisposeEngine();
  }
};
