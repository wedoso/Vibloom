export function makeWaveformPeaks(buffer: AudioBuffer, count = 144) {
  const peaks = new Array(count).fill(0.08);
  const channels = Math.min(buffer.numberOfChannels, 2);
  const block = Math.max(1, Math.floor(buffer.length / count));
  for (let index = 0; index < count; index += 1) {
    let max = 0;
    const start = index * block;
    const end = Math.min(buffer.length, start + block);
    const stride = Math.max(1, Math.floor((end - start) / 160));
    for (let channel = 0; channel < channels; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let sample = start; sample < end; sample += stride) max = Math.max(max, Math.abs(data[sample]));
    }
    peaks[index] = Math.max(0.08, Math.min(1, Math.sqrt(max)));
  }
  return peaks;
}

export function readAudioFile(file: File, onProgress: (progress: number) => void) {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 52));
    };
    reader.onload = () => reader.result instanceof ArrayBuffer
      ? resolve(reader.result)
      : reject(new Error("The audio file could not be read."));
    reader.onerror = () => reject(reader.error ?? new Error("The audio file could not be read."));
    reader.onabort = () => reject(new DOMException("File reading was cancelled.", "AbortError"));
    reader.readAsArrayBuffer(file);
  });
}
