import { useEffect, useRef } from "react";
import { createMediaSessionAnchor } from "./mediaSessionAnchor";
import { bindMediaSession, type MediaControls, mediaMetadataDetails, updateMediaPosition } from "./mediaSession";
import { bindMediaSessionLyrics, type MediaLyric } from "./mediaSessionLyrics";

type MediaState = {
  enabled: boolean;
  title: string;
  album: string;
  artwork?: string;
  isPlaying: boolean;
  duration: number;
  position: number;
  lyrics?: readonly MediaLyric[];
};

export function useMediaSession(state: MediaState, controls: MediaControls) {
  const controlsRef = useRef(controls);
  const anchorRef = useRef<ReturnType<typeof createMediaSessionAnchor> | null>(null);
  const lyricUpdates = useRef<ReturnType<typeof bindMediaSessionLyrics> | null>(null);
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
    navigator.mediaSession.metadata = new MediaMetadata(mediaMetadataDetails(state.title, state.album, state.artwork));
  }, [state.enabled, state.title, state.album, state.artwork]);

  useEffect(() => {
    const metadata = navigator.mediaSession?.metadata;
    if (!state.enabled || !state.lyrics || !metadata) return;
    const updates = bindMediaSessionLyrics(metadata, state.lyrics, () => controlsRef.current.getTime(), state.duration, state.isPlaying);
    lyricUpdates.current = updates;
    const wake = () => updates.refresh();
    window.addEventListener("pageshow", wake);
    return () => { updates.dispose(); lyricUpdates.current = null; window.removeEventListener("pageshow", wake); };
  }, [state.enabled, state.lyrics, state.title, state.album, state.artwork, state.duration, state.isPlaying]);

  // Seeks update immediately, including while paused. Playback polling above
  // also runs without React rendering or requestAnimationFrame in the background.
  useEffect(() => { lyricUpdates.current?.refresh(); }, [state.position]);

  useEffect(() => {
    if (!state.enabled || !navigator.mediaSession) return;
    navigator.mediaSession.playbackState = state.isPlaying ? "playing" : "paused";
    updateMediaPosition(navigator.mediaSession, state.duration, controlsRef.current.getTime());
  }, [state.enabled, state.isPlaying, state.duration, state.position]);
}
