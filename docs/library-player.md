# Vibloom local library and playlist specification

Status: approved for implementation on 2026-08-08.

## Product direction

Vibloom expands from a one-track visual player into a local-first music library without turning Hiyori into a decorative mascot. The experience has two progressive states:

1. An empty library uses the existing Hiyori-first Listening Room and one import surface.
2. Once music is indexed, the homepage becomes a player-first listening console. Player and Library are two work surfaces inside one persistent shell; Hiyori, the active audio engine, queue, and transport never remount during navigation.

The application remains a static GitHub Pages deployment. Audio, lyrics, indexes, playlists, cache data, and playback state stay inside the browser origin.

## Supported browsers

The required desktop support baseline is the current and previous stable releases of Chrome, Safari, and Firefox at release time.

The common path must use feature-detected APIs available in all three families:

- `<input type="file" multiple>` for multi-file import.
- `<input type="file" webkitdirectory multiple>` for folder import, with multi-file import as the fallback.
- IndexedDB for library metadata, playlists, queue state, lyrics text, and playback resume state.
- Origin Private File System (OPFS) for browser-owned cached audio. Automatic caching is enabled by default and can be disabled or cleared from Storage.
- Web Audio for decoding, analysis, playback, and the existing synchronized A/B workspace.
- `navigator.storage.estimate()` for usage reporting and `navigator.storage.persist()` as a best-effort durability request.

`showDirectoryPicker()` and persisted `FileSystemDirectoryHandle` values are Chrome enhancements only. No primary workflow, visible label, or persisted record may depend on them. Safari and Firefox restore cached tracks directly and otherwise use an explicit user-gesture reconnect flow.

Private browsing or unavailable storage falls back to session-only playback without blocking imports.

## Information architecture

### Empty library

- Preserve the existing editorial introduction and unframed Hiyori stage.
- Replace the single-file invitation with one Import music menu containing Add files and Add folder.
- Accept drag and drop for one or many files. When Chrome or Safari exposes directory entries, recursively read a dropped folder and preserve its relative paths; Firefox keeps the visible folder-picker fallback when directory drag data is unavailable.
- When a stored library exists but sources are unavailable, offer Continue last session and Reconnect music.
- Do not render an empty navigation rail, empty track table, or duplicate uploader.

### Loaded player

- Compact left rail: Player, Library, Queue, and Storage. These change only the center work surface or open a sheet.
- Center Player surface: Hiyori remains visually centered. The current library track is version A with a real decoded waveform; version B is only a quiet secondary action until selected, then appears as an equal decoded waveform.
- The waveform surface, bars, played range, and playhead inherit the same exact source color as the solid music field and timed lyrics: A uses `rgb(84 127 121)` and B uses `rgb(200 95 109)`.
- Center Library surface: search, Play all, Shuffle, track list, source state, lyric state, and contextual actions.
- Right: a protected 380–420 px Hiyori stage that remains mounted in Player and Library and defaults to full-body containment.
- Bottom: the only playback transport, with persistent previous/play/next, shuffle, repeat, millisecond seek while comparing, volume, and queue controls. No second timeline or playback strip is rendered in the Player surface.
- Switching Player/Library, opening sheets, or adding B must not pause A or recreate its scheduled BufferSource.
- A/B are decoded once and scheduled against the same `AudioContext.currentTime`; source changes only use the existing short gain handoff to prevent clicks, with no media-element chasing or scene fade.
- Keyboard shortcuts are global outside form controls: Space toggles playback, F toggles Focus, Escape exits Focus/sheets, 1 or A selects source A, 2 or B selects source B, and Left/Right seeks five seconds.
- Focus always exposes a high-contrast Exit focus control. F enters and exits Focus; Escape remains an exit alternative.
- Homepage import, Player, Library, Focus enter, and Focus exit reuse the opaque scene curtain from the original listening room. The destination layout is committed only after the curtain covers the Live2D canvas, then held for four paint frames before reveal so camera repositioning and WebGL buffer clearing are never visible.
- The Pixi rig receives an explicit layout key for Player, Library, and Focus. Model scale, rig position, portrait offset, and camera zoom snap synchronously during the covered commit and must remain numerically stable after reveal.
- Focus hides the persistent canvas only while the curtain is fully covering and reveals the music disc at its final center; it must not run a separate post-commit disc translation.
- When lower-stage information intersects the portrait, the last 58 px of canvas pixels dissolve through an alpha mask instead of cutting Hiyori's legs at a hard edge.
- Queue and Storage stay mounted while closed and animate as edge sheets; reduced-motion users receive the same state change without decorative motion.
- Director, Portrait, Wide, and wheel-controlled Manual framing remain available outside Focus and expose their selected state.

### Responsive behavior

- At tablet width the rail becomes a drawer and the track list keeps priority over secondary metadata.
- On mobile the Now Listening stage leads, the library is a full-height sheet, the queue is a bottom sheet, and a compact transport remains fixed.
- Folder hierarchy is best-effort on mobile; a flat imported playlist must remain fully usable.

## Data model

```text
Library
  sources[]
  tracks[]
  playlists[]
  session

Source
  id
  kind: files | directory | cache
  label
  relativeRoot?
  handle?                 # enhancement only
  reconnectState

Track
  id
  fingerprint
  name
  normalizedName
  relativePath?
  size
  lastModified
  duration?
  sourceId
  availability
  persistence
  lyrics?
  comparison?: { name, size, lastModified, duration, availability, persistence }

Playlist
  id
  name
  entries[]: { trackId, order }

PlaybackSession
  queue[]
  history[]
  currentTrackId?
  currentTime
  shuffle
  repeat: off | all | one
  volume
```

Track identity uses a stable fingerprint derived from normalized relative path or name, size, and last-modified time. Reconnecting a folder remaps files to existing records instead of rebuilding playlist IDs.

## Track state semantics

Availability and persistence are independent dimensions.

Availability:

- `available`: the current File, handle, or cached blob can be opened.
- `reconnect`: metadata exists but a user gesture is required to restore the source.
- `missing`: a reconnected source was checked and the file is absent.
- `session`: the File is usable only while the current page session remains alive.

Persistence:

- `cached`: audio is copied into OPFS and can resume without the original file. This is the default for newly imported tracks and their Version B files when space is available.
- `indexed`: metadata and relationships are saved, but audio is not copied.

Lyrics are stored as a separate matched/unmatched state. In addition to automatic basename matching during import, every track exposes Attach lyrics / Replace lyrics / Remove lyrics actions, and the current-track lyric panel exposes the same controls. The complete parsed LRC is rendered; the active line scrolls to the viewport center and receives timestamp-relative progress coloring in both Player and Focus. Progress uses the exact music-field source color: `rgb(84 127 121)` for A and `rgb(200 95 109)` for B. A successful replacement updates only that track's parsed lines and filename; removal clears only that association. UI copy must not expose IndexedDB, OPFS, or FileSystemHandle names.

## Import and indexing

1. Collect supported audio and `.lrc` files from the picker or drop operation.
2. Preserve `webkitRelativePath` from a folder picker or recursively derived dropped-folder paths when available; otherwise create a flat import source.
3. Filter unsupported files and enforce the existing per-file safety limit.
4. Normalize Unicode filenames before matching and deduplication.
5. Pair LRC and audio by normalized basename within the closest relative directory.
6. Deduplicate by fingerprint while preserving existing track and playlist IDs.
7. Store metadata immediately and copy accepted audio into browser storage by default after a quota check; never decode every track during import.
8. Decode the selected track on demand and prefetch at most the next queue item.

Version B belongs to its Version A library record. Its filename, size, duration, availability, and persistence state survive refresh, and the library displays a Version B tag. Replacing B replaces that association and cached blob; removing B removes both without affecting A.

An import summary reports accepted audio, matched lyrics, duplicates, ignored files, and errors.

## Queue behavior

- Play all builds a queue from the current filtered/sorted view.
- Activating a track starts it and creates a queue from its current list context.
- Play next inserts after the active queue entry; Add to queue appends.
- Reordering a queue does not mutate its source playlist.
- Shuffle uses a permutation bag so a track is not repeated within one cycle.
- Previous follows actual playback history, including shuffled playback.
- Repeat cycles through off, all, and one.
- Natural track end advances the queue; a failed/missing item is skipped with a visible notice.
- Queue, history, active track, time, mode, and volume are persisted with throttled writes.

Adding version B leaves the queue, version A, and current time untouched. B joins the existing transport at the shared playhead. Returning to Library changes only the work surface; version B remains ready until the user changes version A or removes B.

## Persistence and cache policy

Metadata persistence and audio caching are automatic. **Automatically keep new music** defaults on and applies to both a library master and its Version B; turning it off keeps existing cached copies but stops future automatic writes.

- IndexedDB stores schemas, metadata, playlists, queue/session state, handles when supported, and parsed/source LRC text.
- OPFS stores cached audio under deterministic track IDs.
- FileReader reports byte-level reading progress; the selected track then exposes separate decoding and caching states with file size throughout the load.
- Cache writes report progress and handle quota errors without corrupting metadata.
- Request persistent storage before automatic or manually requested cache writes.
- Estimate usage before a batch cache operation and warn when the requested copy is likely to exceed available quota.
- Clearing site data or using browser privacy controls may remove all origin storage; the application must never promise permanent retention.

Storage actions:

- Clear queue only: remove queue/history and keep library/cache.
- Clear cached audio: remove OPFS audio and mark affected tracks indexed/reconnect while retaining playlists and lyrics.
- Remove missing records: remove only confirmed absent track records.
- Reset Vibloom: delete IndexedDB data, OPFS content, handles, settings, and the active session after confirmation.

## Resume and reconnect

On launch:

1. Restore metadata, playlists, queue, modes, volume, and last position.
2. Resolve cached tracks first.
3. Restore a cached Version B from the deterministic companion key for its Version A record.
4. Otherwise show one calm Reconnect music action.
5. Match the newly selected files to stored fingerprints and retain playlist positions.
6. Keep unmatched records visible as missing until the user removes them.

Autoplay is never attempted on page load. Resume restores context and waits for a user play gesture.

## Accessibility and performance

- Every icon action has an accessible name and a minimum 40 px target on touch layouts.
- Track status is conveyed by text, not color alone.
- Search, track list, queue, import summary, and destructive confirmations are keyboard accessible.
- Reduced motion preserves state changes while removing decorative transitions.
- UI text uses the original multilingual main stack: SF Pro / Segoe followed by PingFang, Hiragino Sans, Yu Gothic, and Noto Sans CJK; editorial headings use Georgia followed by Songti, Hiragino Mincho, Yu Mincho, and Noto Serif CJK.
- Only the current and next tracks may hold decoded AudioBuffers.
- Large indexing and OPFS work should yield between batches and move to a worker when profiling shows main-thread stalls.

## Acceptance criteria

- Import the complete `Name Beyond the Night` folder and create a ten-track ordered library.
- Play through a natural track end and advance to the next track.
- Verify Shuffle does not repeat within one cycle and Previous follows history.
- Match an LRC when one is supplied beside its audio file.
- Attach and replace an `.lrc` on an individual track, refresh, and verify the association remains.
- Refresh and restore the queue, active track, time, modes, and volume without autoplay.
- Import with the default cache setting, refresh, and play the new track without reconnecting the original folder.
- Add Version B, verify its tag on Version A's library row, refresh, and restore both decoded sources without another file selection.
- Clear cached audio without deleting the playlist.
- Reconnect a source and preserve track IDs/order.
- Verify empty, loaded, queue, storage, missing-source, A/B, focus, tablet, and mobile states.
- Verify Player → Library → Player while audio is playing: media identity and playhead must continue without a pause event.
- Verify Player/Library and both Focus directions reveal only after the scene curtain covers Hiyori; no visible character translation is allowed.
- Verify homepage folder import also displays the scene curtain before the player shell appears.
- Verify direct folder drop recursively imports nested audio/LRC files in Chrome and Safari, with the folder-picker fallback available in Firefox.
- Verify the music disc center remains constant in every sampled frame after both Focus reveals and only one Live2D canvas exists.
- Verify each waveform section, lyric progress, and music disc resolve to the same A/B source color.
- Verify F both enters and exits Focus, Escape exits Focus, and the visible exit control meets readable contrast.
- Verify the active lyric center differs from its viewport center by no more than 1 CSS pixel after a timestamp change.
- Verify adjacent library state pills have identical 72×22px geometry, 9px type, line height, radius, and padding.
- Verify Queue and Storage animate in and out, remain non-interactive while closed, and become immediate under reduced motion.
- Verify the storage sheet has no text inside the capacity bar and every action remains a full-width, non-overflowing row.
- Verify Hiyori's hair and shoes are both visible at default desktop framing.
- Verify Player renders exactly one playback transport while retaining two synchronized waveforms when B exists.
- Run the common flow in Chromium, Firefox, and WebKit, plus a real Safari smoke test when available.
