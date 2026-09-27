export type MediaControls = {
  play: () => void | Promise<void>;
  pause: () => void;
  next: () => void | Promise<void>;
  previous: () => void | Promise<void>;
  seek: (time: number) => void | Promise<void>;
  getTime: () => number;
  onError: () => void;
};

// Route headset and OS commands to the same transport used by the player UI.
export function bindMediaSession(session: MediaSession, controls: MediaControls) {
  const invoke = (action: () => void | Promise<void>) => {
    try { void Promise.resolve(action()).catch(controls.onError); }
    catch { controls.onError(); }
  };
  const handlers: Partial<Record<MediaSessionAction, MediaSessionActionHandler>> = {
    play: () => { invoke(controls.play); },
    pause: () => controls.pause(),
    stop: () => controls.pause(),
    nexttrack: () => { invoke(controls.next); },
    previoustrack: () => { invoke(controls.previous); },
    seekto: ({ seekTime }) => {
      if (seekTime !== undefined && Number.isFinite(seekTime)) invoke(() => controls.seek(seekTime));
    },
    seekbackward: ({ seekOffset }) => { invoke(() => controls.seek(controls.getTime() - (seekOffset ?? 5))); },
    seekforward: ({ seekOffset }) => { invoke(() => controls.seek(controls.getTime() + (seekOffset ?? 5))); },
  };
  const registered: MediaSessionAction[] = [];
  for (const [action, handler] of Object.entries(handlers)) {
    try {
      session.setActionHandler(action as MediaSessionAction, handler);
      registered.push(action as MediaSessionAction);
    } catch { /* Some browsers support only a subset of media actions. */ }
  }
  return () => {
    for (const action of registered) session.setActionHandler(action, null);
    session.playbackState = "none";
    session.metadata = null;
    session.setPositionState?.();
  };
}

export function updateMediaPosition(session: MediaSession, duration: number, position: number) {
  if (!session.setPositionState) return;
  if (!Number.isFinite(duration) || duration <= 0) {
    session.setPositionState();
    return;
  }
  session.setPositionState({ duration, playbackRate: 1, position: Math.min(duration, Math.max(0, Number.isFinite(position) ? position : 0)) });
}
