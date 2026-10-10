import { measurePcmLoudness } from "../pcm/processPcm";
/** Retain a 400 ms filter window and transfer one copied chunk at a time. */
export const measureLoudness = measurePcmLoudness;
