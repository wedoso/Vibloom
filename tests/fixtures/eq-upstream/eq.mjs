// Verbatim upstream EQ definitions; Suno-Song-Remaster, ISC.
// Revision 862a0aa7a686be3bc7e420d108f4e3e4e050bb1f.
import { AUDIO_CONSTANTS } from './audioConstants.mjs';
export function configureEQNodes(nodes) {
  nodes.eqLow.type = 'lowshelf';
  nodes.eqLow.frequency.value = AUDIO_CONSTANTS.FREQ_LOW;

  nodes.eqLowMid.type = 'peaking';
  nodes.eqLowMid.frequency.value = AUDIO_CONSTANTS.FREQ_LOW_MID;
  nodes.eqLowMid.Q.value = 1;

  nodes.eqMid.type = 'peaking';
  nodes.eqMid.frequency.value = AUDIO_CONSTANTS.FREQ_MID;
  nodes.eqMid.Q.value = 1;

  nodes.eqHighMid.type = 'peaking';
  nodes.eqHighMid.frequency.value = AUDIO_CONSTANTS.FREQ_HIGH_MID;
  nodes.eqHighMid.Q.value = 1;

  nodes.eqHigh.type = 'highshelf';
  nodes.eqHigh.frequency.value = AUDIO_CONSTANTS.FREQ_HIGH;
}

export const eqPresets = {
  flat: { low: 0, lowMid: 0, mid: 0, highMid: 0, high: 0 },
  vocal: { low: -2, lowMid: -1, mid: 2, highMid: 3, high: 1 },
  bass: { low: 6, lowMid: 3, mid: 0, highMid: -1, high: -2 },
  bright: { low: -1, lowMid: 0, mid: 1, highMid: 3, high: 5 },
  warm: { low: 3, lowMid: 2, mid: 0, highMid: -2, high: -3 },
  suno: { low: 1, lowMid: -2, mid: 1, highMid: -1, high: 2 }
};
