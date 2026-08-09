# Pages

## / (Vibloom listening room)
Entry: `src/main.tsx`
Dependencies:
- `src/App.tsx`
  - `src/Live2DStage.tsx`
    - `src/audioVisual.ts`
    - `public/live2d/hiyori/**`
  - `src/audioVisual.ts`
  - `src/index.css`

The same page transitions between welcome, solo, and A/B states without remounting the Live2D stage.
