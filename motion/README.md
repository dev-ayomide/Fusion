# Fusion Motion

An AI-native motion-graphics editor. A whole video is one JSON document (FMD); the browser evaluates it
live with Three.js; people and AI agents edit it with the same small, reviewable, undoable ops.
Standalone: no Remotion, not part of the root workspaces.

```bash
cd motion
npm install
npm run dev        # http://localhost:5180
npm test           # 62 unit + property tests (schema, ops/inverses, evaluator)
npm run e2e        # Playwright: 30 end-to-end tests (editor, AI bridge, export)
npm run bench      # token benchmark → docs/TOKENS.md
npx tsx e2e/record-session.ts out/   # records the full user lifecycle to out/session.webm
```

## What's in the box

- **Start screen** — describe the video, attach a logo/screenshots, or pick a template (thumbnails are rendered live).
- **Simple mode** — chat, vibe sliders (energy · bounce · depth), zero-token tweak chips, one-click entrance/loop/exit presets.
- **Pro mode** — layers panel, keyframe stopwatch on every channel (auto-key), behaviour cards with spring/ease/params,
  bake-to-keys, expressions, parenting, 3D depth-sort switch, JSON editor, "what the AI sees" outline.
- **Viewport** — click to select, drag to move (auto-keys if the channel is keyed), double-click text to edit,
  drop images (onto a device to use as its screen), Shot/Split view with an orbitable scene camera and the shot frustum.
- **Timeline** — canvas dopesheet: layer bars (drag, trim edges), behaviour clips coloured by kind (drag, resize),
  key lanes (drag, double-click to add, ⌫ to delete), snapping to playhead/edges/frames (Alt to disable),
  ⌘-wheel zoom, pinned orange camera lane, playhead outside React.
- **Assistant** — prompts become pending turns carrying only the outline + scoped layers. Any agent answers through
  `window.fusion.bridge`; ops stream into a live preview with a per-op accept/reject diff card; one undo per turn.
  Paste ops from any AI in Pro mode.
- **Export** — MP4/WebM at 720p/1080p/4K, rendered frame-by-frame in the browser by the preview renderer
  (mediabunny + WebCodecs; picks H.264 where the browser has it, else AV1/VP9).
- **History / undo** — every change (you, AI, slider, JSON edit) is one transaction; jump back from the History tab.
- Autosave to localStorage, assets in IndexedDB.

## Layout

```
src/fmd/       schema (Zod 4), catalog, paths, ops engine (macros → set/del/ord, inverses, validation), outline
src/runtime/   ease + normalized spring, seeded noise, expression interpreter, evaluate(doc, t)
src/render/    Stage: SDF quad material, per-glyph text, PBR device mockups, cloners, gradient, camera, picking
src/editor/    store (op log, preview, transient drags), playhead, bridge, components (Viewport, Timeline, Inspector, Assistant, …)
src/export/    mediabunny exporter
e2e/           Playwright suites, session recorder, fixtures
docs/          PLAN-v2 (verbatim), PLAN-DELTA, FMD-SPEC, TOKENS
```

Keyboard: Space play · ←/→ frame · ⌘Z/⇧⌘Z · ⌫ delete · ⌘D duplicate · T/R/E add text/rect/ellipse ·
[ ] in/out to playhead · S split · P simple/pro · / ask AI · ? all shortcuts.

## Not yet (next slices)

In-app model provider + MCP endpoint (the bridge API is the contract), graph editor with bezier handles,
audio lane, Figma import, Lottie export, WebGPU. See `docs/PLAN-DELTA.md`.
