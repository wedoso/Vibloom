# Extractable components

## Live2DStage
- Source: `src/Live2DStage.tsx`
- Category: basic
- Description: persistent transparent Live2D listening companion layer with status capsule.
- Extractable props: variant, trackLabel, activeSource, isComparing, isPlaying
- Hardcoded: Hiyori official model asset, canvas host, ambient orbit layers

## TrackSlot
- Source: inline in `src/App.tsx`
- Category: basic
- Description: A/B audio file card with ready, active, loading, and empty states.
- Extractable props: label, fileName, duration, size, active, status
- Hardcoded: local-only upload affordance, track color semantics

## Transport
- Source: inline in `src/App.tsx`
- Category: basic
- Description: synchronized timeline, A/B selector, playback, seek, loop, and volume controls.
- Extractable props: activeSource, playing, looping, currentTime, duration, volume
- Hardcoded: keyboard bindings and synchronized-clock semantics

## AppShell
- Source: `src/App.tsx`
- Category: layout
- Description: header, listening scene, workspace, shortcut rail, and privacy footer.
- Extractable props: none
- Hardcoded: Vibloom branding and local-processing message
