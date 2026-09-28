import { Processor } from "@met4citizen/headaudio/modules/processor.mjs";
import { Training } from "@met4citizen/headaudio/modules/training.mjs";
import modelUrl from "@met4citizen/headaudio/dist/model-en-mixed.bin?url";
import { VOCAL_FRAME_RATE, VOCAL_SAMPLE_RATE } from "./envelope";

let prototypes: Promise<{ model: unknown[] }> | undefined;

/** Run the upstream MFCC/prototype classifier offline on the isolated voice.
 * Preserve the upstream feature timestamps. Jaw onset comes directly from RMS;
 * stable vowel boundaries are aligned to nearby acoustic rises after analysis.
 * The bundled speech model estimates visemes; it is not a singing transcript.
 */
export async function vocalVisemes(left: Float32Array, right: Float32Array) {
  const { model } = await (prototypes ??= new Training().loadModel(modelUrl));
  const frames = new Uint8Array(Math.ceil(left.length / VOCAL_SAMPLE_RATE * VOCAL_FRAME_RATE)).fill(14);
  const events: Array<{ time: number; viseme: number }> = [];
  const processor = new Processor({ sampleRate: VOCAL_SAMPLE_RATE, parameterData: { silMode: 0, vadGateActiveDb: -55, vadGateInactiveDb: -60 } }, {
    port: { postMessage: (event) => {
      if (event.event === "viseme" || event.event === "ended") events.push({
        time: Math.max(0, event.t),
        viseme: event.viseme ?? 14,
      });
    } },
  });
  processor._onmessage({ data: { event: "model", model } });
  const mono = new Float32Array(left.length);
  for (let i = 0; i < mono.length; i++) mono[i] = (left[i] + right[i]) / 2;
  processor.process(mono);
  let cursor = 0, viseme = 14;
  for (let frame = 0; frame < frames.length; frame++) {
    while (cursor < events.length && events[cursor].time <= frame / VOCAL_FRAME_RATE) viseme = events[cursor++].viseme;
    frames[frame] = viseme;
  }
  return frames;
}
