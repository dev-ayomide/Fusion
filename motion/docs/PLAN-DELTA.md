# Fusion Motion: execution plan (v2 adopted as the source of truth)

## Context
This replaces Fusion's Remotion code-gen loop with an AI-native motion editor. One seekable JSON document (FMD) is evaluated live. The AI edits it through small typed ops. It lives in a standalone `motion/` folder with no Remotion, serving both novices and pros.

I've read `FUSION-MOTION-PLAN-v2.md` in full (upload at `/root/.claude/uploads/.../71394a83-FUSION-MOTION-PLAN-v2.md`). **Verdict: use it as-is.** It fixes every weak spot in my v1: the composition rule, layer-local time, three primitive ops, spring semantics, selectors, bindings, and current library choices. What follows is only the small delta needed to start executing, not a competing plan.

## Delta on top of v2

### A. Split v2 phase 2 so a working version lands sooner
v2's phase 2 bundles graph editors, auto-key, ripple edits and more. That's too much before anyone can use the thing.
- **Slice 1:**
  - v2 phase 1 in full.
  - Editor core: viewport (single/split), canvas dopesheet with behavior clips + key diamonds, pinned **camera lane**, layers, properties, JSON pane, transactional undo/redo.
  - v2 phase 3's agent core: `outline/inspect/apply/catalog`, one op per tool call, diff cards with per-op accept/reject.
  - Style sliders over bindings.
- **Slice 2:** value/speed graph editor, handles and tangent modes, auto-key switch, marquee/multi-select stagger, **audio lane** (needs asset upload and decode), version history UI, MCP endpoint, chips.
- v2 phases 4–7 are unchanged.

### B. Phase 0 mockup starts from the prototype I already built
`scratchpad/fusion-motion-studio.html` is a working mini-evaluator in about 900 lines, with no JS errors in a Playwright screenshot. It already has:
- closed-form springs, keys and behaviors
- a radial cloner in perspective and a split scene/shot view with frustum
- a canvas timeline with drag-to-retime
- chat that streams ops live, per-turn Keep/Revert, vibe sliders, a JSON pane, history/undo, and Novice/Pro modes

Upgrading it to v2 means:
- readable keys and named brand colors
- Y-up centered space, with the camera at fit distance z=1713
- layer-local time
- `set/del/ord` primitives with `/` paths, and macros expanding before the log
- behavior clips drawn as green action bars
- an orange camera lane plus a placeholder audio lane
- per-op accept/reject diff cards
- post-generation chips

Committed as `motion/design/mockup.html` and published as an artifact for sign-off.

### C. Spec fixes to make while writing `FMD-SPEC.md` (small inconsistencies in v2)
1. **The `rise` binding points at a param that doesn't exist.** The sample binds `style.bounce` → `phone/beh/rise/bounce`, but `rise` has no `bounce` param; bounce sits inside `ease: "spring(0.9,0.4)"`. Fix: behaviors take `dur` + `bounce` as real params, and the ease is derived from them. Bindings then target params, never strings.
2. **Selector `offset` direction is undefined.** The title sample relies on it. Define it AE-style: `w(u) = shape((u − start − offset)/(end − start))`, clamped. `add` is multiplied by `(1 − w)`, so offset 0→1 reveals left to right. Add one golden test.
3. **Fonts:** "one HarfBuzz build everywhere" is the right goal, but it's too heavy for slice 1. Slice 1 ships bundled font files and troika layout, plus a golden line-break test. HarfBuzz (wasm) comes with the instanced SDF glyph work in phase 4.
4. **Y-up vs 2D sources:** every importer (SVG paste, Figma, Lottie) flips Y exactly once in the importer. The runtime never branches on this.
5. **Versions:** pin at scaffold time with `npm view` (three / postprocessing peer check included). Don't copy the numbers from either plan.

### D. Answers to v2's open questions (recommendations; 4 is your call)
1. Browser-first: yes.
2. Market it as "2D+3D motion for product promos": yes.
3. Figma: keep the full import in phase 4, but ship **SVG paste import in slice 1**. It's nearly free and covers "Copy as SVG" from Figma.
4. Seat pricing with fair-use AI fits the cost structure. Your decision; it doesn't block engineering.
5. Publish FMD openly at the end of slice 2, alongside the MCP endpoint.

## Layout (per v2 §8: standalone, copied reuse)
```
motion/
  package.json   three (WebGL), troika-three-text, zustand + immer, zod 4, ai 7, hono, mediabunny, vite, react 19, vitest, fast-check
  src/fmd/       zod schema, migrate(), path grammar, macros → set/del/ord, applyTxn + inverse
  src/runtime/   compile (memo per layer) → evaluate(t); eases, spring(dur,bounce), springFollow pieces, seeded simplex, sel weights, own/add/expr pipeline
  src/render/    FrameState → Three scene diff (ortho/perspective), device mockup, text, shape, image
  src/editor/    store (txn log, transient playhead), Timeline canvas (clips, keys, camera lane), Viewport, Layers, Properties, Chat + diff cards, JsonPane, Style sliders
  src/ui/        ~15 shadcn files copied from client/src/components/ui
  api/server.ts  Hono: POST /api/motion/agent (ToolLoopAgent, streamed tool calls); provider switch copied from server/src/lib/gateway.ts
  bench/         token harness: 20 fixtures × tokenizer counts, scripted edit turns
  fixtures/      promo.json, 24hdump.json, ipod-dial.json
  docs/          PLAN-v2.md (verbatim), PLAN-DELTA.md (this), FMD-SPEC.md
  design/        mockup.html
```

## Execution order (commit + push to `claude/serene-noether-9vk9r3` after each)
1. `motion/docs/PLAN-v2.md` (verbatim copy of the upload) + `PLAN-DELTA.md`.
2. Phase 0: `FMD-SPEC.md` v0.1 (v2 §3–4 + fixes C1–C4 + behavior catalog with `mode/writes/bake`), `design/mockup.html` (B), `bench/` harness. Publish the mockup, wait for sign-off.
3. Slice 1 in order: fmd → runtime → render → editor → agent, with tests at each layer.

## Verification
- **vitest:** eases and `spring(dur,bounce)` endpoints exact. `springFollow` velocity is continuous across pieces. Noise is deterministic per seed. Selector offset golden test. `own`/`add` exclusivity and validator rejections. A binding detaches on a direct `set`. `applyTxn ∘ inverse = identity` (fast-check). Macros emit only `set/del/ord`.
- **Playwright** (`/opt/pw-browsers/chromium`): fixture screenshots at fixed `t`. A perf trace on a 200-layer doc: evaluate < 2 ms, scrub < 16 ms.
- **bench:** token table per fixture and per edit macro. Targets: one-field edit ≈ 24 tokens with the tool wrapper; first-draft turn ≤ 2.5k out.
- **Manual:** `cd motion && npm run dev` → prompt a promo → ops stream in as clips → accept/reject one op → hand-edit a key → move a style slider (the hand-edited key survives) → undo.
