import { updateMediaPosition } from "./mediaSession";

export type MediaPositionSnapshot = {
  trackId?: string; title: string; album: string; duration: number;
  isPlaying: boolean; positionRevision?: number;
};

/** System UIs extrapolate from the last position. UI painting need not produce
 * a native update on every frame; transport changes still publish immediately. */
export function createMediaPositionPublisher(session: MediaSession, getTime: () => number, now = () => performance.now(), isAdvancing?: () => boolean) {
  let last: (MediaPositionSnapshot & { time: number; at: number }) | null = null;
  return {
    update(state: MediaPositionSnapshot, force = false) {
      const at = now(), time = getTime();
      state = { ...state, isPlaying: state.isPlaying && (isAdvancing?.() ?? true) };
      const playbackState = state.isPlaying ? "playing" : "paused";
      if (session.playbackState !== playbackState) session.playbackState = playbackState;
      const changed = !last || state.trackId !== last.trackId || state.title !== last.title || state.album !== last.album
        || state.duration !== last.duration || state.isPlaying !== last.isPlaying || state.positionRevision !== last.positionRevision;
      const expected = last ? Math.min(state.duration, last.time + (last.isPlaying ? Math.max(0, at - last.at) / 1000 : 0)) : time;
      const jumped = Math.abs(time - expected) > (state.isPlaying ? .25 : .005);
      if (!force && !changed && !jumped && last && (at - last.at < 1000 || !state.isPlaying)) return;
      updateMediaPosition(session, state.duration, time);
      last = { ...state, time, at };
    },
  };
}
