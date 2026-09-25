# Fusion Motion — plan v2 (reviewed and refined, 24 Sep 2026)

This revises the v1 plan after: fetching mo1.app and its careers pages, pulling five of @KMkota0's demo videos through the fxtwitter API and frame-sampling them, and four Grok 4.7 research passes (mo1 deep-dive, tech-stack verification, schema/op-format critique, competitor + editor-UX survey). Everything marked **CHANGED** differs from v1. Everything marked **CONFIRMED** survived review.

---

## 0. Verdict on the v1 plan

The core bet is right and is now better supported than when it was written:

- **CONFIRMED — Approach D (own compact document + op log + pure evaluator + Three.js).** Nobody in the market combines "one seekable JSON scene, novice prompt, pro graph editor, every AI change a reversible typed op". Figma Motion owns UI already in Figma, Jitter owns fast marketing variants, Cavalry (now free under Canva) owns procedural 2D, mo1/Remotion/Motion Studio own people who want source code. The opening is narrow but real.
- **CONFIRMED — the token-efficiency thesis.** mo1's own "mo1pro is my new religion" tweet is the argument in video form: the Blender version of "24hdump" needed a graph editor with hundreds of camera keys; the mo1 version is six named tracks, green `Enter` action clips, and one orange camera lane.
- **CONFIRMED — canvas dopesheet, DOM chrome, playhead outside React.** Theatre.js is the documented failure mode (DOM/SVG keys; maintainer wanted to redraw the sequence editor in Three.js and never did; FPS bugs open in 2025). Figma Motion's own beta note warns of timeline performance issues.

What was wrong or stale in v1 (details in §2–§4):

1. **Library pins are outdated**: `mp4-muxer`/`webm-muxer` are deprecated (use `mediabunny`), AI SDK is at **v7** not 6, **Zod 4** not 3.25, Three is **0.186** and `postprocessing` does not yet peer with it, `lottie-web` is unmaintained, Theatre.js is dead at 0.7.2.
2. **Several "supported" features are narrower than assumed**: no `VideoEncoder alpha:"keep"` in Chromium (mediabunny fakes VP9 alpha with a second stream), ProRes 4444 encode is server-only, `InstancedMesh` has per-instance color but **not opacity** (use `BatchedMesh`), troika has no per-glyph motion channel (need instanced SDF glyphs), default Rapier is only locally deterministic, `three/webgpu` is still officially experimental and breaks troika + EffectComposer.
3. **The schema's single-letter keys don't save tokens.** Measured with `o200k_base`: `"t":` is 3 tokens, `"type":` is 2. Renaming all short keys to readable ones costs **+4 tokens on the whole sample doc**, and removes ambiguity (`t` meant both type and time). Minifying saves 178.
4. **v1 had no composition rule** for what happens when `k`, `b`, and `expr` touch the same channel, and behavior `at` was comp-absolute (the sample double-counts: `in: 0.3` + rise `at: 0.3`).
5. **v1's op set mixed intent ops into the undo/CRDT log.** Intent ops must macro-expand to three primitives before entering the log.
6. **Sample doc had geometry bugs**: title `y = -390` is below center in a Y-up world; a 35° camera at z=1400 sees only 883 px of a 1080 comp (fit is z≈1713).
7. **Springs as keyframe easing were under-specified**: a free oscillator given `x0,v0` cannot hit an arbitrary next key. Two different operations are needed (normalized `spring(dur,bounce)` ease vs. a `springFollow` owner behavior).

---

## 1. What we actually learned from mo1 (verified from videos + site + careers pages)

Sources: [mo1.app](https://mo1.app/), [mo1.app/careers](https://mo1.app/careers), [prod.mo1.app](https://prod.mo1.app/) (older app, still deployed), [github.com/mo1app](https://github.com/mo1app), tweets `1891857792731926932`, `2059300726501683590`, `2060018098434941420`, `2062547880460578968`, `2097648429727904197` via `api.fxtwitter.com`.

| Observed | Evidence | What we do with it |
|---|---|---|
| **Tracks are module instances, clips are named actions.** Labels read like intent: `lets`, `go`, `fade it in`, `slide it up`, `Spin Text`, `Cover BG`, `Cards Cloner`, `Instance 18`. Expanding `hour` shows one key diamond + a green `Enter` action bar. | practice.mo1pro video, mo1pro video frame at 6.6 s | **Behaviors render as clips** on the timeline with their `use` name, not as diamonds. Novices see verbs; pros expand to lanes. Already in v1, now explicitly the primary visual. |
| **One orange camera lane at the bottom, diamonds = shots.** In the Sep 2026 "paris-2026" demo the *entire* timeline is that lane + a green audio lane. Left pane shows the camera's dotted path with a yellow frustum. | ae_02/ae_04 frames | **CHANGED — add a dedicated camera lane** (pinned, bottom) in v1 of the editor, with shot keys and the path drawn in the scene view. |
| **Audio waveform always visible** (green lane). Marketing: "Soundwave always visible for easy visual sync." | practice + iPod videos | **CHANGED — move the audio lane from phase 6 to phase 2.** Fusion already has `AudioWaveform.tsx`; it's cheap and it's how people time motion. |
| **Split view**: free scene cam (grid, gizmos, frustum) left, shot output right. Three viewport buttons: hand / camera / grid. | all 2026 videos | Confirmed. |
| **Minimal inspector**: `SPHERE CLONER` → Name, Position, Rotation, Scale, Source module, Count, Radius, Scale, Billboard. | mo1pro 4.5 s | Confirmed: cloner as one layer with ~8 fields. Our `cloner` layer is that. |
| **Floating toolbar**: Select▾, Move, 3D, Text, Image, Shape▾. Left rail: Assets, Presets. Top-right axis gizmo. Start/End work-area fields. ✦ button next to zoom. | all videos | Confirmed. We add ✦ Ask AI in the same bar. |
| **Sep 2026 build is a desktop window** (macOS traffic lights, folder icon, `paris-2026` project). Site: "projects that live on your computer", "in-app git". Old app talked to a `127.0.0.1:7000` helper. | ae_* frames, prod.mo1.app runtime config | Decision for us (§8): browser-first with a document URL, plus an optional local folder mode later. Do not require a daemon for the AI loop. |
| **The AI agent writes TypeScript.** Only public demo: "Create a Type Cylinder module" → `manifest.json`, `module.ts`, `props.json` changed. Careers page: hiring for a "secure plugin system that runs isolated apps". | mo1.app hero section, /careers/product-engineer | **This is the gap.** Code = tokens + compile + sandbox + runtime errors. Our agent fills props and places actions on a schema-constrained doc; codegen is an escape hatch, never the default path. |
| **"Tween Overlaps"** = combine animations by overlapping clips, "no more parenting chains or modifiers". Blend math unpublished. The *older* editor rejected overlaps ("Trigger moved back"). | mo1.app, prod bundle strings | **CHANGED — make the blend rule explicit in the schema** (`own` vs `add`, §3.2). A named, predictable rule is easier for a model to write than a feature called "tween overlaps". |
| **POV camera** "without nulls and parenting". Old editor had focus modes target/contain/custom/skip + match-rotation. | mo1.app, prod bundle | Camera behaviors `dolly`, `orbit`, `lookAt(target)`, `frame(target, padding)` in the catalog. `frame` is the "contain" mode. |
| Stack he publishes: Nuxt, Three.js, **WebGPU + TSL** (`three-effects`: Photoshop-style stroke/shadow/glow on a Three.js group), JSON pipelines (`pipemagic`). Careers: "new rendering pipeline for our Three.js renderer" (WebGPU). | github.com/mo1app | Don't compete on shading in v1. Compete on the edit the model is allowed to make. Consider `three-effects` for layer styles later. |
| Distribution: invite-only, no docs, no pricing, no changelog, private Slack, "well funded", hiring in Amsterdam. ~200k views on best post. | careers, fxtwitter counts | Publishing our schema and op format *is* the product for an LLM-first tool. |

**Beyond mo1 (unchanged from v1, sharpened):** AI edits by op with inverse → partial accept/reject per op; semantic diffs ("12 keys moved +80 ms, spring stiffened") a marketer can read; one screen for novice and pro; product-marketing primitives built in; open exportable format; browser link you can send.

---

## 2. Stack corrections (verified Sep 2026)

| v1 said | Now | Action |
|---|---|---|
| `mp4-muxer` / `webm-muxer` | Both deprecated by the author. **`mediabunny` 1.59.1** (MPL-2.0). VP9 alpha works via `alpha:'keep'` on the video source (two-stream trick). ProRes 4444 **encode only in `@mediabunny/server`**. | Client: WebM alpha + MP4 H.264 via mediabunny. Server: ProRes via `@mediabunny/server` next to the Playwright renderer. |
| WebCodecs `VideoEncoder alpha:'keep'` | Still rejected by Chromium. | Never call it directly; let mediabunny split streams. |
| WebCodecs browser support | Chrome/Edge 94+, Firefox 130+ desktop, Safari 16.4+. Firefox Android no. | Fine. Don't promise Firefox Android. |
| `ai` 6 `ToolLoopAgent` | **AI SDK 7** (`ai@7.0.109`). `ToolLoopAgent` survives; adds `runtimeContext`, per-tool `contextSchema`, `toolApproval`. Stream parts `tool-input-start/delta/available`; deltas are raw JSON text. | Start on v7. Emit **one op per tool call** (or NDJSON) and apply on `tool-input-available` — never on a half-parsed array. |
| Zod 3.25 | **Zod 4**: `z.toJSONSchema()` native. AI SDK accepts 4. | Author the FMD schema in Zod 4. Hand-write the slim *tool* schema; park the full catalog behind `catalog()`. |
| Three.js WebGL, WebGPU "later" | **three 0.186**. `WebGPURenderer` officially still experimental; no `ShaderMaterial`/`onBeforeCompile`/`EffectComposer` on it. Troika's GLSL injection would not survive. | WebGLRenderer. WebGPU behind a flag; treat as a port, not a toggle. |
| `postprocessing` | 6.39.x peers `three <0.186`. No first-class motion blur. | Pin three 0.185.x until the peer bump, or defer post-FX. Motion blur = our own velocity pass later. |
| `InstancedMesh` for cloners | Per-instance **color only**, no opacity. `BatchedMesh.setColorAt(id, Vector4)` carries alpha and mixes geometries. | `InstancedMesh` when geometry identical & opacity uniform; `BatchedMesh` otherwise. |
| troika per-glyph ops | 0.52.5, maintained (slowly). `styleRanges` static only; **no per-glyph transform/opacity channel**. `glyphBounds` available after `synccomplete`. | Troika for readable text. **Instanced SDF glyph quads** (one instance per grapheme, fed by `glyphBounds`) for kinetic type. |
| Rapier deterministic | Default `rapier3d-compat` is only locally deterministic. Cross-platform = **`@dimforge/rapier3d-deterministic-compat`**. | Use the deterministic package in a worker, bake to keys. Same in phase 6 as v1. |
| Theatre.js "slow upstream" | Stopped at 0.7.2 (May 2024). Studio is AGPL. | Borrow nothing but the sheet/sequence JSON idea. |
| Lottie: `lottie-web` | 5.13.0 unmaintained. LAC spec 1.0.1. Players: **`@lottiefiles/dotlottie-web`** (ThorVG). Bodymovin: 3D layers, cameras, lights, most effects unsupported. | Import `.json` + `.lottie`; drop 3D/camera/lights from corpus; play with dotlottie-web. LottieFiles AE plugin does the AE re-import. |
| 3D export: nothing | **glTF + `KHR_animation_pointer`** (ratified) animates arbitrary properties. Three's loader doesn't play it by default; Needle plugin does. | Phase 7: glTF+pointer as the 3D export beside Lottie 2D. |
| zustand/immer, react-virtual, Hono | zustand 5.0.15 (`immer` separate dep), react-virtual 3.14 (set `useFlushSync:false` on React 19), Hono 4.13. | Keep. |

---

## 3. FMD v0.1 — the document, revised

### 3.1 Naming (CHANGED)

Readable field names everywhere, minified on the wire, defaults omitted. Keep short words that already tokenize as one unit (`id in at to fps fov pos rot dur src use ease`). `beh` stays as the one abbreviation (`behaviors` is four tokens). **No aliases** — two spellings split the model's output distribution and break prompt-cache prefixes. Brand colors are **named roles**, not `$c0..$cN` (the model shifts indices). Hex is 6 tokens; a token name is 1–2.

### 3.2 Composition rule (NEW — MUST)

```
track  = keys(channel, t)  if a key track exists, else the static field
acc    = track
for b in beh where b.mode == "add" and channel in b.writes:   acc = b.apply(acc, t, element)
result = owner.eval(t, base)  if an "own" behavior exists on the channel, else acc
result = expr({ t, value: result, base, i, n, w, h, fps })  if an expr exists
```

- The **catalog** declares per behavior `mode: "own" | "add"` and `writes: [channels]`. `rise` owns `pos.y` + `opacity`; `wiggle`, `float`, `noise` add.
- Validator rejects two owners of one channel, and rejects `own` + keys on the same channel (offers **bake**).
- Owner holds before `at` (its `from`) and after `at+dur` (rest pose). Additives are identity outside their window. Expression runs last and can read `value`.
- This *is* our explicit version of mo1's "tween overlaps".

### 3.3 Time (CHANGED — MUST)

`in`/`out` are comp seconds. **Everything inside a layer is layer-local (zero at `in`)**: behavior `at`, key `t`, expression `t`. Retime = one `set` on `in`. Duplicating a layer keeps its choreography. Comp `markers` (audio beats) are comp time and resolve to local `at` at apply time. Nested comps map through `in` + optional `timeMap`.

### 3.4 Space (NEW — MUST)

Origin at comp center, **Y up**, Z toward the camera, pixels, camera looks down −Z (Three native). Vertical FOV. Fit distance `z = (h/2)/tan(fov/2)` (1080 @ 35° → **1713**). Anchor in pixels from the layer box, default center. Ortho camera for flat comps.

### 3.5 Revised sample

```jsonc
{
  "v": 1,
  "comp": { "w": 1920, "h": 1080, "fps": 60, "dur": 6, "bg": "$paper", "cam": "shot", "space": "srgb" },
  "brand": { "font": "Inter", "colors": { "accent": "#6c5ce7", "ink": "#ffffff", "paper": "#12121a" } },
  "assets": { "app1": { "src": "asset://sha256/9f3a…", "mime": "image/png", "w": 1170, "h": 2532 },
              "logo": { "src": "asset://sha256/1c77…", "mime": "image/svg+xml" } },
  "markers": [{ "id": "drop", "t": 4.2 }],
  "style": { "energy": 0.6, "bounce": 0.4, "depth": 0.5, "speed": 1 },
  "bindings": [
    { "from": "style.bounce", "path": "phone/beh/rise/bounce" },
    { "from": "style.energy", "path": "orbit/fx/n1/amp", "map": "scale" }
  ],
  "layers": [
    { "id": "bg",    "type": "gradient", "colors": ["$paper", "#000000"], "noise": 0.04 },
    { "id": "shot",  "type": "camera", "fov": 35, "pos": [0, 0, 1713],
      "beh": [{ "id": "d1", "use": "dolly", "to": 1450, "at": 0, "dur": 6, "ease": "inOut" }] },
    { "id": "phone", "type": "device", "model": "iphone", "screen": "app1", "in": 0.3,
      "rot": [0, -18, 0],
      "beh": [{ "id": "rise", "use": "rise", "at": 0, "dur": 0.9, "ease": "spring(0.9,0.4)" }],
      "keys": { "rot.y": [[0.9, -18], [2.9, 12, "inOut"]] } },
    { "id": "orbit", "type": "cloner", "mode": "radial", "n": 12, "r": 520, "in": 1.0,
      "child": { "type": "image", "src": "logo", "size": 72 },
      "fx": [{ "id": "lag", "type": "delay", "step": 0.04 },
             { "id": "n1",  "type": "noise", "amp": [18, 18, 40], "freq": 0.4, "sel": { "by": "index", "shape": "full" } }],
      "keys": { "spin": [[0, 0], [5, 90]] } },
    { "id": "title", "type": "text", "text": "Ship faster.", "size": 128, "pos": [0, 390, 0], "in": 2.1,
      "anim": [{ "id": "in",
        "sel": { "by": "char", "shape": "ramp", "start": 0, "end": 0.12, "offset": { "keys": [[0, 0], [0.8, 1]] } },
        "add": { "pos": [0, 40, 0], "opacity": -1 } }] }
  ]
}
```

Measured (`o200k_base`): the v1 sample was 565 tokens pretty / 387 minified with short keys; 569 / 391 with readable keys. A 6-layer promo is realistically **450–550 minified, 700–1,000 pretty**.

### 3.6 Animation levels (refined)

1. `keys` — `{ "channel": [[t, v, ease?], …] }`. Stable key ids minted by the applier (`k1, k2…`), `t` quantized to ms. Pros and fine AI edits.
2. `beh` — parametric behaviors `{ id, use, at, dur, ease, …params }`. **Stay parametric**; eval builds a transient curve. **`bake` is an explicit op** (→ track replace + `del` behavior, one undo step). Catalog marks each behavior `bake: exact | sample | never` (`noise`/`wiggle` never).
3. `anim` — **selectors** (NEW): `sel` yields a weight `w∈[0,1]` per grapheme or clone (`by: char|word|line|index`, `shape: full|ramp|smooth|random|falloff|noise`, normalized `start/end/offset`), applied as `add`. This unifies AE text animators and C4D effectors. `typeUp` and friends expand to an `anim`. CPU eval writes instance matrices; the shader only shades.
4. `expr` — AST interpreter (no `eval`): arithmetic, comparisons, ternary, `sin cos abs min max floor clamp lerp noise(seed,t)`. Bound: `t value base i n w h fps`. Later `ref("phone","pos.x")` with declared edges + cycle check.

### 3.7 Easing and springs (CHANGED)

- Keyframe eases: `linear|in|out|inOut|back|elastic|bounce`, `cubic(x1,y1,x2,y2)`, **`spring(dur, bounce)`** — normalized so `ease(0)=0, ease(1)=1`, settled by segment end. Endpoints exact, O(1), seekable.
- **`springFollow`** is a separate *owner behavior* (physical `m,k,c`) that chases a piecewise-constant target. Compiled on edit into pieces `(t0, A, B, X, ω)` with incoming velocity from the previous piece's closed-form `v(tEnd)`. Seek = binary search + plug-in.
- Noise: `simplex(seed ⊕ layerId ⊕ fxId, i, t·freq)` in seconds. No `Math.random`, no frame index.

### 3.8 Novice sliders (CHANGED)

`style.{energy,bounce,depth,speed}` write only to declared **`bindings`**. A direct `set` on a bound path detaches the binding and keeps the value, so a pro hand-edit never gets clobbered. Behaviors opt in by naming which param a vibe may drive. `speed` binds to specific durations, never a global time-warp.

### 3.9 Six-month traps handled now

`migrate(doc)` on load, eval only sees the current version · assets by content hash with `{mime,w,h,duration}`, missing asset = placeholder + layer error, frame still renders · fonts by family/weight/style/source-hash with **one HarfBuzz build everywhere** (or line breaks and `by:"char"` drift across machines) · lowercase 6-digit sRGB, P3 held until export is wide-gamut · `parent` is transform-only, cycles rejected, time does not inherit · `comps: { main }` from day one, depth cap 4 · reserve `blend`, `trackMatte` · `particles` and shader effectors out of v0.

---

## 4. Ops v0.1 (CHANGED)

**The log stores three primitives**, id-addressed, never index-addressed:

```jsonc
{ "op": "set", "path": "phone/rot", "value": [0, -18, 0] }   // create or replace a leaf
{ "op": "del", "path": "bg" }
{ "op": "ord", "id": "sub", "after": "title" }                 // draw order
```

Path grammar: `/` separates segments; dots belong to channel names; no brackets. `phone/keys/rot.y/k3`, `phone/beh/rise/dur`, `title/anim/in/sel/offset`. Ids are immutable; `name` is the label. Apply computes the inverse from the preimage and stores it on the transaction — the model never emits inverses.

**LLM-facing macros expand to primitives before entering the log**, and the transaction keeps `intent` for the diff card:

```jsonc
{ "op": "set",  "path": "orbit/in", "delta": 0.3 }                    // retime, no model arithmetic
{ "op": "key",  "path": "phone/keys/rot.y", "keys": [[0.9,-18],[2.9,25,"inOut"]] }  // replaces whole track
{ "op": "add",  "id": "sub", "after": "title", "layer": { "type": "text", "text": "Now on iOS", "in": 2.8 } }
{ "op": "bake", "path": "phone/beh/rise" }
{ "op": "set",  "path": "brand/colors/accent", "value": "#ff5a1f" }  // "theme" is just set
```

- `key` **replaces the whole track** and is the only key edit the model may emit; the graph editor (which knows key ids) emits per-key `set`/`del`.
- **One `apply` = one transaction = one undo step.** Stream ops for preview; commit when Zod passes, else roll back. Repair loop (cap 2) stays off the undo stack.
- Yjs mapping: draw order `Y.Array<id>`, layer `Y.Map`, track = map of keyId→`{t,v,ease}`. Different leaves commute; one leaf LWW. Origin `ai:<turnId>` scopes undo.
- Why not RFC 6902: index paths the model miscounts, inserts don't commute, inverse needs preimage. Why not Merge Patch: arrays replaced wholesale, `null` can't mean null.

---

## 5. AI design — reality-checked

**Token budget (measured with o200k on the sample):**

| Payload | Tokens |
|---|---:|
| One `set` (+ tool wrapper) | 14 (~24) |
| `key` track replace / `add` layer | 25–80 |
| 5-line `outline()` | ~60 |
| 6-layer first draft, minified / pretty | 450–550 / 700–1,000 |
| Realistic first-draft **turn** (plan sentence + one repair) | 1.2k–2.5k out |
| Generated full JSON Schema if stuffed in the prompt | 2k–6k **in** — don't |

So v1's "~35 tokens per edit" holds for "make the title 140"; "~900 for a draft" is a fair doc budget but a low turn budget. **Input dwarfs output**: hand-write a slim tool schema, keep the catalog behind `catalog(query)`, `inspect()` returns one minified layer, and instruct the model to emit minified JSON. `look()` is the cost center (2–3 low-res frames, opt-in).

**Tools (AI SDK 7 `ToolLoopAgent`):** `outline()`, `inspect(ids)`, `apply(ops)` (one op or a small NDJSON batch per call, validated, transactional), `catalog(query)`, `look(t[])`, `propose(variants[])`. Each accepted `apply` = one version-history entry (Spline/mo1 pattern).

**Cost levers (unchanged):** selection-scoped context; stable cached prefix; model routing (small model for ops, strong model for first drafts and reference analysis); deterministic no-LLM fast paths (sliders, ⌘K commands, chips); streaming application per closed op.

**UX patterns proven by the field (LottieFiles Motion Copilot, FrameGenius, Figma agent, Spline V2, Cursor):** diff before/while applying with per-op accept/reject; plan-first only for destructive edits; post-generation **chips** (duration, stagger, bounce, intensity) so the second tweak isn't another prompt; "hold these, change those" prompts that retarget easing across a selection; variations side by side on a canvas, not in a chat transcript; agent sees the frame (`look`) and uses the same commands as the user.

**Measure:** tokens per *accepted* edit tagged by macro on 20 frozen fixtures, tokenized with each production tokenizer; A/B readable vs short keys on 50 prompts (expect token tie, validation win for readable).

**MCP surface (NEW):** Spline, LottieFiles (WebMCP), Figma and Remotion all expose agent entry points now. Because our API *is* ops, exposing `outline/inspect/apply/catalog` over MCP so Cursor / Claude Code / ChatGPT can drive a project is nearly free and is a distribution channel. Ship it in phase 3 alongside the in-app chat.

---

## 6. Editor — performance and UX (confirmed + additions)

Confirmed from v1: playhead in a mutable ref, zustand+immer with per-layer selectors, canvas dopesheet with static + overlay layers, DOM only for the name column (virtualized), render-on-demand viewport, incremental compile by content hash, workers for bake/import/export, preallocated typed arrays in the frame loop, 60 fps @ 200 layers / 10k instances budget in CI.

Additions from the survey (Entangle UI, `animation-timeline-control`, AE, Rive, Figma Motion, Motion Canvas):

- **Handles only on the selected key**; tangent modes auto/linear/step/aligned/mirrored; dragging a handle on auto promotes to aligned.
- **Value *and* speed graphs** (AE users constantly open the wrong one; give both, default value).
- Gestures: ruler or full-height playhead scrub with frame snap; Shift/Ctrl-click toggle; empty-space drag = marquee across tracks; Alt-drag on ruler = loop region; double-click empty = add key; ⌘C/V paste at playhead; wheel scroll, ⌘-wheel zoom around cursor.
- Snap in **pixels**, quantize on mouseup to time resolution. During drag evaluate from a transient time; commit one undo step on drop.
- Keep the `tracks` array referentially stable so the canvas doesn't redraw on unrelated React renders.
- **Auto-keyframe with a visible off switch** (Figma, Spline) so a nudge doesn't spray keys.
- **Ripple vs independent** when moving a beat/marker (Motion Canvas: Shift modifier).
- **Reusable named eases** as brand-level variables (AE users buy Flow/Kease because Easy Ease can't be saved).
- **Segment edges resize duration; multi-select proportional timing; stagger** (Jitter).
- **Pinned lanes**: camera lane (orange, shot keys) and audio lane (waveform + beat markers) at the bottom, mo1-style.
- Time display `ss:ff` alongside seconds.
- Preview renderer **is** the export renderer (Premation/Rive rule); scrub time is the same function as frame 0 of the MP4.

Progressive disclosure stays: bars (with behavior names) → property lanes → keyframes → graph editor.

---

## 7. Competitive position (Sep 2026)

| | Model | Threat to us | Our answer |
|---|---|---|---|
| **Figma Motion** (open beta Jun 2026) | Native timeline, presets/auto-key, springs, agent writes keys, Dev Mode JSON/motion.dev. Beta warns of perf issues. No 3D, no cloners, no runtime player. | Highest for UI promos already in Figma. | Figma import (frames → layers) + 3D/devices/cloners/camera + export they don't have. |
| **Jitter** + Superagents | Action segments, no dopesheet; AI brainstorm, custom effects, Magic Import, variants canvas; Lottie/MP4/ProRes. | High for fast marketing. | Same speed for novices, with a real dopesheet underneath and typed reversible AI ops. |
| **LottieFiles Motion Copilot** | LLM edits keys in Lottie Creator, undo, plan-and-approve, chips, WebMCP. | Medium (2D, Lottie-bound). | Same UX patterns, plus 3D, and Lottie is our *export* not our ceiling. |
| **Spline V2** (Aug 2026) | WebGPU, sidebar agent with editor tools + screenshots, version entry per prompt, MCP. | Medium (3D scene quality, not motion). | Motion-first document, cheaper edits, timeline depth. |
| **mo1** | Three.js modules as code, actions, camera lane, git, desktop, invite-only. | Medium (same audience of 3D-curious designers). | Schema-constrained ops instead of TypeScript; browser link; 2D+3D; published spec. |
| **Cavalry** (free, Canva) | Procedural behaviours, Auto-Animate per char/word/line, JSON `.cv`. | Low-medium (desktop, pro-only). | Our `sel` is their Auto-Animate as data; we add AI + web + 3D. |
| **Motion Studio** (motion.dev, 22 Sep 2026), **Remotion Studio** | Timeline that writes back to code. | Low (developers). | Non-developers can't use them. |
| **AE AI Assistant** (beta 8 Sep 2026) | Reorganize layers, expressions from prose. Not motion generation. | Trust benchmark, not a competitor. | AE stays the bar for graph editor / expressions / export fidelity. |
| **Fable** (shut down Nov 2024) | Competent web AE with no AI editing model. | Lesson. | The AI-op model *is* the product. |
| Startups: FrameGenius, OpenMotion, Vivipilot, iArt, Premation (OSS AE clone) | Prompt → editable doc with diff review; alpha WebM; own-key BYO model. | Signal the category is forming. | Move fast on the vertical slice; publish the format. |

---

## 8. Decisions (locked + new)

Locked from v1: standalone `motion/` folder, no Remotion, not in root workspaces; 2.5D first / 3D ready; novice and pro in the MVP sharing one op log; copy (never import) shadcn/ui, resizable panels, cmdk, playhead loop from `SingleSceneTimeline.tsx`, `AudioWaveform.tsx`, `AgentThoughts.tsx`, gateway/provider switch and prompt-loader patterns.

New:

1. **Readable schema keys, minified wire format, no aliases.**
2. **Composition rule `own | add | expr`, layer-local time, Y-up centered pixel space.**
3. **Three primitive ops in the log; macros expand; one apply = one transaction.**
4. **`spring(dur,bounce)` ease vs `springFollow` behavior; explicit `bake` op.**
5. **`sel` selectors unify text animators and cloner effectors.**
6. **`style` + `bindings` for vibe sliders.**
7. **Stack**: three 0.186 WebGL, troika + instanced SDF glyphs, `BatchedMesh` for cloners needing alpha, mediabunny, AI SDK 7, Zod 4, zustand 5, Hono 4, Playwright; WebGPU behind a flag; Rapier deterministic build in phase 6.
8. **Browser-first** with a shareable document URL. Optional "local folder + git" mode is a later pro feature, not a dependency of the AI loop.
9. **Camera lane and audio lane in phase 2.**
10. **MCP endpoint in phase 3.**

---

## 9. Roadmap v2

Vertical slice first: schema (group, text, shape, image, device, camera) → evaluator (keys + 8 behaviors + composition rule + `spring(dur,bounce)`) → Three ortho renderer → canvas timeline with behavior clips, camera lane, audio lane, properties, JSON pane → agent with `outline/inspect/apply/catalog` on AI SDK 7 → style sliders and pro key lanes over the same op log.

| Phase | Deliverable | Done when |
|---|---|---|
| **0 · Design + spec** | Interactive HTML mockup (novice ↔ pro, chat → op diff cards with per-op accept/reject → clips/keys update, live JSON pane, camera + audio lanes). `FMD-SPEC.md` v0.1 (this §3–§4) + behavior catalog with `mode/writes/bake`. **Token benchmark harness** (20 fixtures, o200k + production tokenizers). | You sign off on look, format, and the measured token table. |
| **1 · Runtime** | `fmd/` (Zod 4 schema, migrate, applyOps/invert, path grammar), `runtime/` (eases, springs, noise, selectors, composition, 12 behaviors), `render/` (text/shape/image/group/device/camera, ortho + perspective), `<Player>`. | Golden-value tests; `applyOps∘invert = id` property tests; fixtures at 60 fps. |
| **2 · Editor core** | Viewport (single/split, gizmo), canvas dopesheet + graph editor (value & speed), behavior clips, **camera lane, audio lane**, layers, properties, transactional undo/redo, version history, JSON pane. | 100 layers drag smoothly; perf budgets pass in CI. |
| **3 · AI** | `/api/motion/agent` (AI SDK 7 ToolLoopAgent, one op per call, streaming), selection scope, diff cards with accept/reject per op, chips, style sliders + bindings, **MCP endpoint**. | Promo from logo + screenshots ≤ 2.5k out tokens per turn; edits ≤ 100; schema-valid ≥ 97 % first try. |
| **4 · MoGraph + product kit** | Cloner (`InstancedMesh`/`BatchedMesh`), effectors with `sel`, instanced SDF glyph text choreography, devices, brand kit, templates, Figma frame import. | The "24hdump" and "iPod dial" mo1 shots can be recreated. |
| **5 · Export** | mediabunny WebM-alpha + MP4 in browser; headless Chromium render + `@mediabunny/server` ProRes 4444; Lottie 2D subset; multi-aspect batch (16:9, 9:16, 1:1, 4:5). | 1080p60 export matches viewport frame-for-frame. |
| **6 · Pro depth** | Expressions AST + `ref()`, precomps + `timeMap`, parenting, Rapier deterministic bake, post-FX (bloom/DOF), motion blur (velocity pass), beat markers + ripple edits, named eases. | Motion designers do full keyframe work without the AI. |
| **7 · Intelligence + interop** | Lottie/dotLottie import → corpus, eval harness with vision judge, reference video → doc, variations canvas, glTF `KHR_animation_pointer` export, AE `.jsx`, fine-tuning prep. | Eval score tracked per release. |

---

## 10. Open questions for you

1. **Desktop or browser first?** mo1 went desktop (local folder + git). I recommend browser-first with shareable URLs and an optional local-folder mode later; confirm.
2. **Brand as 2D+3D or "3D-first"?** mo1 and Spline own "3D is the medium". Our differentiator is one document for both; I'd market product-promo outcomes, not dimensionality.
3. **Figma import in phase 4** (frames → layers) — this is the direct counter to Figma Motion. Worth pulling earlier?
4. **Pricing model**: every AI competitor is credit-based (LottieFiles ~3 credits/prompt, Spline tiers, Rive $20 included). Our cost per edit is 10–50× lower; do we price on seats and make AI edits effectively unlimited as the headline?
5. **Publish the FMD spec openly** (as the moat for an LLM-first tool) or keep it internal until phase 5?

---

## Appendix A — mo1 frame notes (for the mockup)

- Window: dark, `←  project-name  📁` top-left; `Export` top-right (2026 desktop build adds macOS traffic lights, share/history icons).
- Viewport: three-button cluster top-left (hand, camera, grid); axis gizmo top-right; floating toolbar bottom-center `[▸ Select▾][✚ Move][◻ 3D][T][🖼][▭▾]`.
- Timeline header: `▌▌` play, `✦` + zoom slider, `Start 0.00  End 6.00`, optional mute icon.
- Tracks: blue rounded bars with `▸ name`; nested children indented; expanded track shows key diamond lane + green action clip labelled (`Enter`); `+` at bar end to add an action.
- Bottom pinned: orange camera lane with white diamonds; green audio waveform lane.
- Inspector: uppercase violet module title (`SPHERE CLONER`), Name, Position xyz, Rotation xyz, Scale xyz, then module params (Source module, Count slider, Radius, Scale, Billboard toggle).
- Left rail: `Assets`, `Presets`, `+` buttons.

## Appendix B — source index

mo1: https://mo1.app/ · https://mo1.app/careers · https://mo1.app/careers/product-engineer · https://mo1.app/careers/motion-product-designer · https://prod.mo1.app/ · https://github.com/mo1app · https://kmk0.com/ · https://xavier.xl.digital/about/ · https://www.dive.club/deep-dives/xavier-jack · tweets via https://api.fxtwitter.com/KMkota0/status/{1891857792731926932,2059300726501683590,2060018098434941420,2062547880460578968,2097648429727904197}

Stack: https://mediabunny.dev/guide/introduction · https://github.com/Vanilagy/mp4-muxer · https://issues.chromium.org/issues/370423037 · https://caniuse.com/mdn-api_videoencoder · https://www.npmjs.com/package/troika-three-text · https://threejs.org/manual/en/webgpurenderer · https://threejs.org/docs/pages/BatchedMesh.html · https://github.com/pmndrs/postprocessing · https://lottie.github.io/ · https://help.lottiefiles.com/supported-after-effects-features · https://github.com/theatre-js/theatre · https://www.npmjs.com/package/@dimforge/rapier3d-deterministic · https://vercel.com/blog/ai-sdk-7 · https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent · https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol · https://zod.dev/json-schema · https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_animation_pointer/README.md

Competitors: https://www.figma.com/blog/introducing-figma-motion/ · https://help.figma.com/hc/en-us/articles/41405906446999-Use-the-Figma-Motion-timeline · https://jitter.video/changelog/ · https://lottiefiles.com/ai · https://docs.lottiefiles.com/en/creator/13_ai-tools · https://blog.spline.design/spline-v2 · https://docs.spline.design/spline-ai/ai-agent · https://cavalry.studio/docs/nodes/behaviours/auto-animate/ · https://www.cgchannel.com/2026/04/canva-makes-motion-graphics-and-animation-app-cavalry-free/ · https://news.ycombinator.com/item?id=41850573 (Fable) · https://motion.dev/magazine/introducing-motion-studio · https://blog.adobe.com/en/publish/2026/09/08/generate-create-directly-in-your-timeline-with-new-ai-powered-innovations-in-premiere-after-effects · https://www.premation.com/vs/after-effects · https://framegenius.studio/ · https://openmotion.design/

Editor perf/UX: https://www.entangle-ui.dev/components/editor/timeline/ · https://github.com/ievgennaida/animation-timeline-control · https://github.com/theatre-js/theatre/issues/472 · https://github.com/theatre-js/theatre/issues/505 · https://www.figma.com/blog/keeping-figma-fast/ · https://motioncanvas.io/docs/time-events · https://www.reddit.com/r/AfterEffects/comments/1nq8xj7/ae_beginners_what_totally_messed_you_up_at_first/ · https://www.reddit.com/r/AfterEffects/comments/1kevig5/help_me_with_graph_editor/
