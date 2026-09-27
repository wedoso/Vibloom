declare module "@met4citizen/headaudio/modules/processor.mjs" {
  export class Processor {
    constructor(options: { sampleRate: number; parameterData?: Record<string, number> }, worklet: { port: { postMessage: (event: { event: string; viseme?: number; t: number; d?: number }) => void } });
    _onmessage(message: { data: { event: string; model: unknown[] } }): void;
    process(samples: Float32Array): void;
  }
}
declare module "@met4citizen/headaudio/modules/training.mjs" {
  export class Training { loadModel(url: string): Promise<{ model: unknown[] }> }
}
