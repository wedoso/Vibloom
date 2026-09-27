import { useEffect, useRef } from "react";
import { createMediaSessionAnchor } from "./mediaSessionAnchor";
import { bindMediaSession, type MediaControls, updateMediaPosition } from "./mediaSession";

type MediaState = {
  enabled: boolean;
  title: string;
  album: string;
  isPlaying: boolean;
  duration: number;
  position: number;
};

export function useMediaSession(state: MediaState, controls: MediaControls) {
  const controlsRef = useRef(controls);
  const anchorRef = useRef<ReturnType<typeof createMediaSessionAnchor> | null>(null);
  useEffect(() => { controlsRef.current = controls; });

  useEffect(() => {
    if (!state.enabled || !navigator.mediaSession) return;
    const unbind = bindMediaSession(navigator.mediaSession, {
      play: () => controlsRef.current.play(),
      pause: () => controlsRef.current.pause(),
      next: () => controlsRef.current.next(),
      previous: () => controlsRef.current.previous(),
      seek: (time) => controlsRef.current.seek(time),
      getTime: () => controlsRef.current.getTime(),
      onError: () => controlsRef.current.onError(),
    });
    const anchor = createMediaSessionAnchor(
      () => { void Promise.resolve(controlsRef.current.play()).catch(() => controlsRef.current.onError()); },
      () => controlsRef.current.pause(),
      () => controlsRef.current.onError(),
    );
    anchorRef.current = anchor;
    return () => { anchor.dispose(); anchorRef.current = null; unbind(); };
  }, [state.enabled]);

  useEffect(() => {
    anchorRef.current?.setPlaying(state.isPlaying);
  }, [state.enabled, state.isPlaying]);

  useEffect(() => {
    if (!state.enabled || !navigator.mediaSession || typeof MediaMetadata === "undefined") return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: state.title, artist: "Vibloom", album: state.album });
  }, [state.enabled, state.title, state.album]);

  useEffect(() => {
    if (!state.enabled || !navigator.mediaSession) return;
    navigator.mediaSession.playbackState = state.isPlaying ? "playing" : "paused";
    updateMediaPosition(navigator.mediaSession, state.duration, controlsRef.current.getTime());
  }, [state.enabled, state.isPlaying, state.duration, state.position]);
}
