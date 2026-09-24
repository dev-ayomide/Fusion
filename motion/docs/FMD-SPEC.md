# FMD v0.1 — Fusion Motion Document

One JSON document describes an entire motion-graphics video. The browser evaluates it as a
pure function `evaluate(doc, t) → frame` and draws it with Three.js; the same function renders
the preview, scrubbing and export. People and AI agents edit it with the same small ops.

Source of truth for the schema: `src/fmd/schema.ts` (Zod 4). Behaviour catalog: `src/fmd/catalog.ts`.

## 1. Space and time

- **Space:** origin at the comp centre, **Y up**, +Z toward the camera, units are pixels.
  The default camera (vertical FOV 35°) sits at the *fit distance* `z = (h/2) / tan(fov/2)`
  (1713 for 1080p), so 1 unit = 1 px at z = 0. Importers of Y-down sources (SVG, Figma, Lottie) flip Y once.
- **Time:** `in` / `out` are comp seconds. **Everything inside a layer is layer-local** (zero at `in`):
  behaviour `at`, key times, expression `t`. Moving a layer is one `set` on `in`; duplicates keep their choreography.

## 2. Document

```jsonc
{
  "v": 1, "name": "Orbit launch",
  "comp":   { "w": 1920, "h": 1080, "fps": 30, "dur": 7, "bg": "$paper", "cam": "shot" },
  "brand":  { "font": "Inter Variable", "colors": { "accent": "#6ea8ff", "ink": "#f4f6ff", "paper": "#060a18" } },
  "assets": { "orbit-app": { "src": "asset://sha256/…", "mime": "image/png", "w": 780, "h": 1688 } },
  "markers": [],
  "style":  { "energy": 0.5, "bounce": 0.5, "depth": 0.7, "speed": 0.5 },
  "bindings": [{ "from": "style.bounce", "path": "phone/beh/rise/bounce", "lo": 0.05, "hi": 0.7 }],
  "layers": [ … back to front … ]
}
```

- Colours are lowercase `#rrggbb` or a **named brand token** `$accent` (names, not indices — models don't shift them).
- Readable keys everywhere (`type`, `text`, `colors`); defaults are omitted; the wire format is minified.

## 3. Layers

Common fields: `id` (immutable, `[a-zA-Z][\w-]*`), `name`, `in`, `out`, `parent` (transform only, cycles rejected),
`hidden`, `locked`, `pos [x,y,z]`, `rot [x,y,z]` (degrees), `scale`, `opacity`, `depth` (3D depth-sort switch),
`keys`, `beh`, `expr`.

| type | fields |
|---|---|
| `gradient` | `colors` (2–4), `kind` linear/radial, `angle`, `noise` (film grain) — screen-space background |
| `text` | `text` (`\n` for lines), `size`, `font`, `weight`, `color`, `align`, `tracking`, `lineHeight`, `anim` (selectors) |
| `shape` | `shape` rect/ellipse, `w`, `h`, `radius`, `fill`, `stroke`, `strokeWidth` |
| `image` | `src` (asset id), `w`, `h?`, `radius` |
| `device` | `model` iphone/browser, `screen` (asset id; built-in demo if absent), `w`, `color` |
| `cloner` | `mode` radial/grid/linear, `n`, `r`, `cols`, `gap`, `spin`, `billboard`, `orient`, `child {kind, shape, w, h, radius, fill, colors, src, text}`, `reveal {dur, bounce, at}`, `fx` effectors |
| `camera` | `fov`, `target?`; `comp.cam` picks the active one |
| `group` | transform-only parent |

Cloner effectors (`fx`): `delay {step}` staggers the reveal by index; `noise {amp:[x,y,z], freq, seed}` seeded drift;
`wave {amp, freq, phase}` travelling sine.

## 4. Animation and the composition rule

Every numeric channel (`pos.x pos.y pos.z rot.x rot.y rot.z scale opacity` + type channels such as `size`, `w`, `r`, `spin`, `fov`)
is computed as:

```
track  = keys(channel, t)  if a key track exists, else the static field
acc    = track + Σ add-behaviours active at t          (float, wiggle, spin, pulse, sway, shake)
result = owner(t, track)   if an own-behaviour writes the channel, else acc
result = expr({ t, value: result, base: track, … })   if an expression exists
```

- **Keys:** `"keys": { "rot.y": [[t, value, ease?], …] }` — the ease shapes the segment *arriving* at that key.
- **Behaviours** (`beh`): `{ id, use, at, dur, ease?, bounce?, …params }`, parametric until explicitly baked.
  - `own` behaviours are exclusive per channel while their windows overlap (an enter and a later exit may share a channel).
    Before `at` an owner holds its *from* pose; after `at + dur` it rests on the track.
  - `add` behaviours stack on the track and are identity outside their window (loops default to `dur: 999`).
  - `text` behaviours (`typeUp`, `bounceIn`, `cascade`, `typewriter`) drive per-glyph channels with `by` char/word/line and `stagger`.
  - An owner plus keys on the same channel is rejected — the validator suggests `bake`.
- **Selectors** (`text.anim`): `{ id, sel: {by, shape: ramp|smooth|full, start, end, offset}, add: {pos, rot, scale, opacity} }`.
  Weight per unit `w = shape(clamp((u − start − offset) / (end − start)))`, `u` = unit index / (count − 1); `add` is applied × `w`.
  Animating `offset` from `-(end−start)` to `1` reveals left-to-right.
- **Expressions:** a small AST language (no `eval`): arithmetic, comparisons, `&& || ! ?:`, `sin cos tan abs min max floor ceil round sqrt pow clamp lerp noise(seed,x) step smooth`, names `t value base i n w h fps pi`. Bad expressions fall back to the value; the frame still renders.

### Easing

`linear in out inOut back anticipate hold elastic bounce`, `cubic(x1,y1,x2,y2)`, and **`spring(dur, bounce)`** — a damped
oscillator normalised so `ease(0)=0`, `ease(1)=1` exactly (bounce 0 = critical, → 1 = springier). A behaviour with `bounce`
and no `ease` uses `spring(dur, bounce)`, so `bounce` is a real parameter that sliders can bind to.

Noise is seeded (layer id ⊕ behaviour id ⊕ index) and sampled in seconds — never `Math.random`, never frame index —
so every frame is a pure function of `(doc, t)`.

## 5. Ops

The log stores **three primitives**, id-addressed:

```jsonc
{ "op": "set", "path": "phone/rot", "value": [0, -18, 0] }   // create or replace a leaf
{ "op": "del", "path": "bg" }
{ "op": "ord", "id": "sub", "after": "title" }                  // draw order; after: null = back
```

**Path grammar:** `/` separates segments, dots belong to channel names, no brackets, no indices except tuple components.
First segment is a root field (`comp brand assets markers style bindings name`) or a layer id.
Arrays of objects with ids (`beh`, `fx`, `anim`, `markers`, layers) are addressed by id: `title/beh/type/stagger`.
Tuples by axis: `phone/pos/y`.

**Macros** (what models and the UI write) expand to primitives before the log:

| macro | expands to |
|---|---|
| `{op:"set", path, delta}` | `set` with current + delta (no model arithmetic) |
| `{op:"key", path:"L/keys/ch", keys}` | `set` of the whole track, sorted, times quantised to ms |
| `{op:"add", id, after?, layer}` | `set id` + `ord` |
| `{op:"del", path:"layerId"}` | unparents children, clears `comp.cam` if needed, then `del` |
| `{op:"trim", id, delta}` | moves `in`, shifts local times back so the animation stays put |
| `{op:"bake", path:"L/beh/id"}` | sampled/exact key tracks + `del` of the behaviour |
| `{op:"style", key, value}` | `set style/key` + one `set` per binding of that slider |

- **One `apply` = one transaction = one undo step.** The engine computes inverses from the preimage; the model never writes them.
- A transaction is validated after expansion; any failure rolls the whole thing back with compact, repairable messages
  (`sub/color: unknown brand color $nope (have $accent, $ink, …)`, `did you mean typeUp?`).
- **Bindings:** `style.*` sliders write only their declared `bindings`. A direct `set` on a bound path detaches that binding,
  so a hand edit is never overwritten by a slider (and undo restores the binding).
- In a reviewed AI turn each op is applied in order and rejected only for errors *it introduces*, so one bad op can't sink the rest.

## 6. Agent surface

`window.fusion` (and later MCP) exposes: `outline()`, `inspect(ids)`, `catalog(query)`, `validate()`, `apply(ops, intent)`,
and the bridge: `bridge.connect(name)`, `bridge.pending()` → `{turnId, prompt, scope, outline, inspect}`,
`bridge.respond(turnId, {message, ops, chips})`. Responses stream into a preview the user reviews op by op.
Chips may carry ops (applied with no model call) or a follow-up prompt.

See `docs/TOKENS.md` for measured sizes.
