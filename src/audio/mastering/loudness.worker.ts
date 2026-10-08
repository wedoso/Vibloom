import { integratedLufs, normalizationGain } from "./loudness";
self.onmessage = (event: MessageEvent<{ channels: Float32Array[]; rate: number; target?: number }>) => {
  try {
    const { channels, rate, target } = event.data, lufs = integratedLufs(channels,rate);
    if(target !== undefined) { const gain=normalizationGain(lufs,target); for(const channel of channels) for(let i=0;i<channel.length;i++) channel[i]*=gain; }
    self.postMessage({ lufs, channels: target === undefined ? undefined : channels }, target === undefined ? [] : channels.map(c=>c.buffer));
  } catch(error) { self.postMessage({ error: error instanceof Error ? error.message : "Loudness analysis failed." }); }
};
