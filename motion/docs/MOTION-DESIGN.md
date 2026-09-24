# Motion design — what makes it look premium, and how Fusion supports it

This is a working reference for the engine, the editor and the AI: the concepts professional motion designers
rely on, how After Effects exposes them, and where each lives in Fusion Motion. The gap analysis was done against
the "Pear" breakdown (a 2×2 of four scenes from a premium app-launch ad) that we set out to replicate.

The web was not reachable from the build environment, so this document is written from craft knowledge
(the Disney/Thomas & Johnston principles, AE conventions, standard motion-graphics practice) rather than from new research.

---

## 1. The principles that matter most for UI and product motion

| # | Principle | What it means on screen | How Fusion expresses it |
|---|---|---|---|
| 1 | **Easing (slow in / slow out)** | Nothing starts or stops at full speed. Linear motion reads as mechanical. | Per-key eases, named curves, `cubic()`, `spring()`; graph editor with Easy Ease (F9) |
| 2 | **Timing & spacing** | Duration sets weight: small UI 150–350 ms, cards 400–700 ms, hero moves 800–1400 ms, camera 2–6 s. Spacing (how far per frame) shows the ease. | Frame-snapped timeline; speed graph; spacing ghosts |
| 3 | **Anticipation** | A small move opposite to the action before it happens (pull back before a throw). | `anticipate` ease, `back` ease, or two keys |
| 4 | **Overshoot / follow-through** | Things arrive past their mark and settle. Springs do this physically. | `spring(dur, bounce)`, `back`, bounce slider |
| 5 | **Overlapping action & offset (stagger)** | Parts of a group start at slightly different times, so the eye reads one gesture instead of a block. | `stagger` on text, cloner `delay` effector, clip offsets |
| 6 | **Secondary motion** | Smaller motions that support the main one: a float, a drift, a sway, parallax. | add-behaviours (float, sway, wiggle, drift), noise effector |
| 7 | **Arcs** | Natural motion follows curves, not straight lines. | 3D rotation + position keys; orbit; path layers |
| 8 | **Staging & hierarchy** | One focal point at a time. Everything else waits, dims or blurs. | Blur/defocus, opacity, depth of field, vignette |
| 9 | **Squash & stretch (subtle)** | Scale a little along the motion axis on fast moves. | scale keys / expressions |
| 10 | **Exaggeration, restrained** | In product work: slightly bigger, slightly faster than real, never cartoonish. | energy / bounce / depth vibe sliders |
| 11 | **Solid drawing → solid 3D** | Consistent light, reflections and shadows that make objects feel physical. | PBR materials, HDRI environment, soft shadows |
| 12 | **Appeal** | Colour, type and composition done with taste. | brand tokens, curated fonts, post (grade, grain, bloom) |

### Easing vocabulary (what designers mean when they say it)

- **Ease out** (decelerate): entrances. Fast start, soft landing. Default for anything appearing.
- **Ease in** (accelerate): exits. Soft start, leaves quickly.
- **Ease in-out**: moves between two on-screen positions, and camera moves.
- **Easy Ease** in AE: bezier with 33.33% influence on both handles → `cubic(0.333,0,0.667,1)`.
- **Expo / "snappy"**: aggressive ease-out used in premium UI promos (`cubic(0.16,1,0.3,1)`): the element travels 80% of the distance in ~20% of the time, then glides.
- **Hold**: an instant jump (stepped keys, used for cuts and typing).
- **Spring**: physically based overshoot, defined by stiffness/damping or duration and bounce.
- The **speed graph** shows velocity: a good ease-out has a tall spike at the start that decays to zero. A "hitch" (speed dropping to zero mid-move) is the most common amateur mistake.

---

## 2. Techniques that separate "premium" from "template"

These are what the Pear reference uses in almost every shot.

1. **Motion blur.** Real cameras smear fast motion. AE's switch uses a 180° shutter with 16 samples. Without it, fast moves strobe and look cheap. Fusion now renders true temporal motion blur by sampling the pure `evaluate(doc, t)` several times across the shutter interval and averaging.
2. **Blur and defocus transitions.** Elements "rack focus" in: they start blurred and large, then sharpen as they settle. Transitions blur the outgoing shot while the incoming one sharpens.
3. **Depth.** A layered foreground, midground and background, parallax, 3D camera moves, and soft shadows under floating cards.
4. **Glass / frosted UI.** Cards that blur what's behind them (backdrop blur), with a thin bright rim and a soft inner highlight.
5. **Photographic or photoreal plates.** Sky, grass, mountains. Real imagery grounds the synthetic UI.
6. **Physical 3D hero objects.** A chrome pear balloon, 3D sports props, reflective materials under an HDRI.
7. **Kinetic typography.** Mixed fonts (a clean sans plus an expressive script word), word-by-word reveals, write-on strokes, colour accents on key words.
8. **Counters and data.** Numbers that roll up ($180 → $357), charts whose line draws on (trim paths).
9. **UI state choreography.** Typing into a field ($0 → $5 → $50), a button that fills, a list selection that slides.
10. **Light.** Bloom and glow on bright accents, a radial light burst behind a word, subtle vignette and grain to unify.
11. **Pacing and cuts.** Shots of 0.8–2 s, cut on motion, holding briefly on the payoff frame. A strong ease-out end pose on each cut.
12. **Consistency.** One accent colour (lime), one corner-radius family, one shadow style, one easing family across the piece.

---

## 3. After Effects concepts and their Fusion equivalents

The goal is that an AE user recognises every control.

| After Effects | Fusion Motion |
|---|---|
| Composition settings (size, fps, duration, bg) | Composition inspector (nothing selected) |
| Layers: solid, text, shape, footage, null, camera, light, adjustment, precomp | `shape`, `text`, `image`, `group` (null), `camera`, `adjust` (adjustment layer), `mesh`/`device` (3D), `html` (UI card), `path` (shape stroke), `sky` |
| Transform: Anchor, Position (P), Scale (S), Rotation (R), Opacity (T) | Transform section; **U** reveals animated properties. P/S/R/T are *not* mapped: those keys already add layers / toggle views in Fusion |
| Stopwatch, keyframes, Keyframe Interpolation (linear/bezier/hold) | ◆ stopwatch on every property; per-key ease incl. `hold`; AE keyframe glyphs (◇ linear, ⧗ ease, ■ hold, ● bézier, per side) |
| Easy Ease (F9), Ease In (⇧F9), Ease Out (⌘⇧F9) | Same shortcuts on the selected key |
| Graph editor: value graph, speed graph, influence handles | Graph editor (⇧F3): value graph with draggable bézier handles → `cubic(x1,y1,x2,y2)`. *No speed graph yet* |
| Motion blur layer switch + comp motion-blur button, shutter angle/phase/samples | Layer `motionBlur` switch + comp `motionBlur { angle, samples }` |
| 3D layer switch, camera, depth of field | `depth` switch, camera with dolly/orbit/truck and `target`; no true depth of field (animate `blur` instead) |
| Effects & Presets: Gaussian Blur, Glow, Drop Shadow, Fill, Tint, Brightness/Contrast, Hue/Saturation, Vignette, Noise | Effect Controls section: `blur`, per-layer motion blur, `shadow`, `glass`; `glow` on path strokes; adjustment layers and comp post (`exposure`, `contrast`, `saturation`, `fade` + cloud `dissolve`, `vignette`, `grain`, `bloom`) |
| Masks and track mattes | `clip` on groups: children are cut to the group's rounded rectangle |
| Trim Paths | `path` layer with `trimStart`/`trimEnd` channels |
| Text animators with range selectors | `anim` selectors + text behaviours (`typeUp`, `cascade`, …) |
| Source Text numbers (expressions) | text `value` channel shown through `{value}` with `format` (decimals, thousands); html cards use `{{name:2}}` bound to keyable `vars.name` |
| Expressions: `wiggle()`, `loopOut()`, `time` | wiggle/float behaviours, expression language with `t`, `noise()` |
| Parenting / pick-whip | `parent` field, parent dropdown |
| Precomps | *not yet* (clip groups cover most uses) |

---

## 4. Gap analysis against the Pear reference (before this round)

| Needed in the reference | Status before | What was built |
|---|---|---|
| Motion blur on fast moves | missing | Temporal motion blur (comp + layer switch) |
| Gaussian blur / rack focus per layer, animated | missing | `blur` channel on every layer (multi-pass compositor) |
| Frosted glass cards over imagery | missing | `glass` on shapes/html: backdrop blur + rim |
| Soft drop shadows | missing | `shadow` on quads (SDF shadow, keyable) |
| Glow / bloom, light burst | missing | Comp bloom; path `glow`; the light burst is a blurred shape |
| Grade, vignette, grain on the whole frame | grain only (on the bg) | Post stage: exposure, contrast, saturation, vignette, grain |
| Card that grows with content clipped inside | missing | `clip` groups (stencil masks) |
| Real UI states (trade form, chat bubbles, insights card) | canvas-drawn placeholder only | `html` layer: HTML/CSS rasterised through SVG foreignObject with embedded fonts, `{{name}}` bindings |
| White-outs, fog / cloud dissolves | missing | adjustment layer `fade` + `fadeColor`, `dissolve` for cloud-shaped fog |
| 3D phone with UI on screen | flat device mockup | `slab` mesh body + html screen and bubbles parented in 3D |
| Rolling number counters | missing | keyable text `value` via `{value}` + `format`; keyable html `vars` |
| Chart line that draws on | missing | `path` layer with trim |
| Mixed-font words (script accent) | one font per layer | `spans: [{ text, font, weight, color, size }]` on text layers |
| Write-on script reveal | missing | per-glyph `wipe` in selectors |
| Chrome 3D hero object | device only | `mesh` layer: primitives, spline-lathed pear/balloon with foil crinkles, `slab` (phone bodies), PBR presets (chrome, foil, metal, gold, glass, plastic, matte, clay, emissive) under @pmndrs HDRIs |
| 3D sports props around it | shapes only | 24 bundled 3D-rendered Fluent emoji (`lib://emoji3d/…`, asset library menu) as images or cloner children, plus 3D primitives |
| Photographic sky / field / mountains | gradient only | `sky` layer: perspective cumulus, sun, heightfield-lit mountains, meadow, stars. Procedural: it reads as a place but not as a photo (see QUALITY.md). Bring-your-own photos work as `image` layers |
| Graph editor, Easy Ease, speed graph | named eases only | Value-graph editor + F9 family (no speed graph) |

Remaining gaps after this round are tracked in `docs/QUALITY.md`.
