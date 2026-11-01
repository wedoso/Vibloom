import { useEffect, useRef } from "react";
import { createMediaSessionAnchor, createMediaMetadataObserver, needsMediaSessionAnchor } from "./mediaSessionAnchor";
import { bindMediaSession, type MediaControls, mediaMetadataDetails } from "./mediaSession";
import { bindMediaSessionLyrics, mediaLyricArtist, type MediaLyric } from "./mediaSessionLyrics";
import { createMediaPositionPublisher } from "./mediaPositionPublisher";
import { prepareMediaArtwork } from "./mediaArtwork";

type MediaState = {
  enabled: boolean;
  trackId?: string;
  positionRevision?: number;
  title: string;
  album: string;
  artwork?: string;
  isPlaying: boolean;
  duration: number;
  position: number;
  lyrics?: readonly MediaLyric[];
  systemLyricsEnabled?: boolean;
};

export function useMediaSession(state: MediaState, controls: MediaControls) {
  const systemLyricsActive = state.systemLyricsEnabled !== false && !!state.lyrics?.length;
  const controlsRef = useRef(controls);
  const anchorRef = useRef<ReturnType<typeof createMediaSessionAnchor> | null>(null);
  const lyricUpdates = useRef<ReturnType<typeof bindMediaSessionLyrics> | null>(null);
  const positionUpdates = useRef<ReturnType<typeof createMediaPositionPublisher> | null>(null);
  const stateRef = useRef({ ...state, systemLyricsActive });
  const artworkRef = useRef<{ source: string; image: MediaImage } | null>(null);
  useEffect(() => { controlsRef.current = controls; stateRef.current = { ...state, systemLyricsActive }; });

  useEffect(() => {
    if (!state.enabled || !navigator.mediaSession) return;
    const positions = createMediaPositionPublisher(navigator.mediaSession, () => controlsRef.current.getTime(), undefined, () => controlsRef.current.isAdvancing?.() ?? stateRef.current.isPlaying);
    positionUpdates.current = positions;
    const wake = () => {
      // A changed lyric already forces its matching position. Otherwise publish
      // explicitly so small paused seeks and lifecycle wakes bypass throttling.
      if (!lyricUpdates.current?.refresh()) positions.update(stateRef.current, true);
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("pageshow", wake);
    const unbind = bindMediaSession(navigator.mediaSession, {
      play: () => controlsRef.current.play(),
      pause: () => controlsRef.current.pause(),
      next: () => controlsRef.current.next(),
      previous: () => controlsRef.current.previous(),
      seek: async (time) => {
        await controlsRef.current.seek(time);
        // System controls can seek while visual rendering is suspended. Read
        // the completed audio seek, without waiting for a React state update.
        if (positionUpdates.current === positions) wake();
      },
      getTime: () => controlsRef.current.getTime(),
      onError: () => controlsRef.current.onError(),
    });
    const audioSession = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    const anchor = needsMediaSessionAnchor(navigator.userAgent ?? "", audioSession?.type === "playback") ? createMediaSessionAnchor(
      () => { void Promise.resolve(controlsRef.current.play()).catch(() => controlsRef.current.onError()); },
      () => controlsRef.current.pause(),
      () => controlsRef.current.onError(),
    ) : null;
    const metadataObserver = anchor ? null : createMediaMetadataObserver();
    anchorRef.current = anchor;
    return () => {
      document.removeEventListener("visibilitychange", wake); window.removeEventListener("pageshow", wake);
      positionUpdates.current = null; anchor?.dispose(); metadataObserver?.dispose(); anchorRef.current = null; unbind();
    };
  }, [state.enabled]);

  // Restore the original mobile system-publishing cadence while lyrics are on.
  // Keep this timer separate so toggling lyrics never rebinds/reset metadata,
  // artwork, or the audio-session carrier.
  useEffect(() => {
    if (!state.enabled || !navigator.mediaSession) return;
    const interval = state.isPlaying && systemLyricsActive ? 100 : 1000;
    const timer = window.setInterval(() => {
      // Catch up to the heard line if its boundary callback was delayed. When
      // it changes, the callback below forces one position publication first.
      lyricUpdates.current?.refresh();
      positionUpdates.current?.update(stateRef.current);
    }, interval);
    return () => window.clearInterval(timer);
  }, [state.enabled, state.isPlaying, systemLyricsActive]);

  useEffect(() => {
    anchorRef.current?.setPlaying(state.isPlaying);
  }, [state.enabled, state.isPlaying]);

  useEffect(() => {
    if (!state.enabled || !navigator.mediaSession || typeof MediaMetadata === "undefined") return;
    const artwork = artworkRef.current && artworkRef.current.source === state.artwork ? artworkRef.current.image : undefined;
    const details = mediaMetadataDetails(state.title, state.album, artwork);
    details.artist = mediaLyricArtist(stateRef.current.systemLyricsEnabled === false ? [] : stateRef.current.lyrics ?? [], controlsRef.current.getTime(), stateRef.current.duration);
    navigator.mediaSession.metadata = new MediaMetadata(details);
    positionUpdates.current?.update(stateRef.current, true);
  }, [state.enabled, state.trackId, state.title, state.album, state.artwork]);

  useEffect(() => {
    if (!state.enabled || !navigator.mediaSession || !state.artwork) return;
    const source = state.artwork;
    if (artworkRef.current?.source === source) return;
    const controller = new AbortController();
    void prepareMediaArtwork(source, controller.signal).then(image => {
      if (controller.signal.aborted || stateRef.current.artwork !== source) return;
      artworkRef.current = { source, image };
      const metadata = navigator.mediaSession?.metadata;
      // Preserve the live lyric and metadata object while the cover arrives.
      if (metadata) {
        metadata.artwork = [image];
        positionUpdates.current?.update(stateRef.current, true);
      }
    }).catch(() => { /* Unsupported covers must not interrupt music or publish the original large image. */ });
    return () => controller.abort();
  }, [state.enabled, state.artwork]);

  useEffect(() => {
    const metadata = navigator.mediaSession?.metadata;
    if (!state.enabled || !metadata) return;
    const updates = bindMediaSessionLyrics(metadata, state.systemLyricsEnabled === false ? [] : state.lyrics ?? [], () => controlsRef.current.getTime(), state.duration, state.systemLyricsEnabled !== false && state.isPlaying, document,
      // Push the heard position with each changed lyric, even inside the normal
      // heartbeat interval. Do not throttle this wakeup behind progress updates.
      () => positionUpdates.current?.update(stateRef.current, true));
    lyricUpdates.current = updates;
    const wake = () => updates.refresh();
    window.addEventListener("pageshow", wake);
    return () => { updates.dispose(); lyricUpdates.current = null; window.removeEventListener("pageshow", wake); };
  }, [state.enabled, state.trackId, state.systemLyricsEnabled, state.lyrics, state.title, state.album, state.artwork, state.duration, state.isPlaying]);

  // Seeks update immediately, including while paused. Playback polling above
  // also runs without React rendering or requestAnimationFrame in the background.
  useEffect(() => { lyricUpdates.current?.refresh(); }, [state.position, state.positionRevision]);

  useEffect(() => {
    if (!state.enabled || !navigator.mediaSession) return;
    positionUpdates.current?.update(stateRef.current);
  }, [state.enabled, state.trackId, state.title, state.album, state.isPlaying, state.duration, state.position, state.positionRevision, systemLyricsActive]);
}
