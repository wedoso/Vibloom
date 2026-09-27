declare module "demucs-web" {
  import type * as ort from "onnxruntime-web";
  type Stereo = { left: Float32Array; right: Float32Array };
  export class DemucsProcessor {
    constructor(options: {
      ort: typeof ort;
      sessionOptions?: ort.InferenceSession.SessionOptions;
      onProgress?: (info: { progress: number; currentSegment: number }) => void;
    });
    loadModel(buffer: ArrayBuffer): Promise<ort.InferenceSession>;
    separate(left: Float32Array, right: Float32Array): Promise<{
      vocals: Stereo; drums: Stereo; bass: Stereo; other: Stereo;
    }>;
  }
}
