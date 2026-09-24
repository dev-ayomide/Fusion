# Fusion Motion — architecture

This document explains how the pieces connect and marks what is real, what is partial, and what is a placeholder.
Legend used throughout: **Real** = implemented and covered by tests · **Partial** = works but limited ·
**Placeholder** = a stand-in so the UI behaves sensibly · **Not built** = planned, no code yet.

---

## 1. The idea in one picture

The whole video is one JSON document. Nothing else stores state. Every view reads the document, and every edit (a mouse drag, an inspector field, a slider, a pasted op, an AI turn) is expressed as **ops** that go through a single engine.

```mermaid
flowchart LR
  subgraph Writers["Who changes the video"]
    U1[Viewport drag]
    U2[Inspector field / keyframe ◆]
    U3[Timeline drag]
    U4[Vibe slider / 0-token chip]
    U5[JSON editor]
    AI[AI agent via bridge]:::ext
  end
  OPS["Ops (macros)<br/>set · del · ord · key · add · trim · bake · style"]
  ENG["Ops engine<br/>expand → primitives → validate → inverse"]
  DOC[("FMD document<br/>(single source of truth)")]
  EVAL["evaluate(doc, t)<br/>pure function"]
  STAGE["Stage (Three.js)"]
  subgraph Readers["What reads it"]
    R1[Viewport]
    R2[Export encoder]
    R3[Timeline / Inspector / JSON]
    R4["outline() for the AI"]
  end
  U1 & U2 & U3 & U4 & U5 & AI --> OPS --> ENG --> DOC
  DOC --> EVAL --> STAGE --> R1 & R2
  DOC --> R3 & R4
  classDef ext stroke-dasharray: 5 5
```

The AI box is dashed because there is **no model call inside the app yet**. The bridge is real, and any agent can drive it. In the recorded session that agent was Claude, working from outside the page.

---

## 2. Module map

```mermaid
flowchart TB
  subgraph fmd["src/fmd — the format (pure TS, no DOM)"]
    schema[schema.ts<br/>Zod 4 types]
    catalog[catalog.ts<br/>22 behaviours]
    paths[paths.ts<br/>path grammar]
    ops[ops.ts<br/>macros, txns, inverses, validate]
    outline[outline.ts<br/>outline / inspect / catalog]
  end
  subgraph runtime["src/runtime — the math (pure TS)"]
    ease[ease.ts<br/>cubic, named, spring]
    noise[noise.ts<br/>seeded]
    expr[expr.ts<br/>AST interpreter]
    evaluate[evaluate.ts<br/>channels, glyphs, clones, camera, bake]
  end
  subgraph render["src/render — pixels (Three.js)"]
    stage[stage.ts<br/>views, sync, render, pick, bounds]
    materials[materials.ts<br/>SDF quad + gradient shaders]
    glyphs[glyphs.ts<br/>fonts, glyph textures, layout]
    device[device.ts<br/>extruded phone/browser]
  end
  subgraph editor["src/editor — the app (React 19 + zustand)"]
    store[store.ts<br/>doc, past/future, preview, transient]
    playhead[playhead.ts<br/>time outside React]
    bridge[bridge.ts<br/>window.fusion]
    create[create.ts / edit.ts<br/>op builders]
    persist[persist.ts<br/>autosave]
    comps[components/*<br/>Viewport Timeline Inspector Assistant Panels Shell]
  end
  assets[src/assets<br/>IndexedDB + textures]
  exporter[src/export<br/>mediabunny]
  templates[src/templates]

  schema --> ops
  catalog --> ops
  paths --> ops
  ops -. bake sampler registered at load .-> evaluate
  ease & noise & expr --> evaluate
  catalog --> evaluate
  evaluate --> stage
  materials & glyphs & device --> stage
  assets --> stage
  ops --> store
  store --> comps
  playhead --> comps
  stage --> comps
  evaluate --> exporter
  stage --> exporter
  outline --> bridge
  store --> bridge
  templates --> comps
```

Dependency rule: `fmd` and `runtime` never import React, Three or the DOM, so the same code can run in a worker, on a server, or inside an MCP server later. `render` knows Three but not React. `editor` is the only place that knows about React.

One deliberate back-edge: `ops.ts` needs to sample behaviours to `bake` them. Importing `evaluate.ts` there would create a cycle, so `evaluate.ts` registers the sampler with `ops.ts` when it loads (`registerBakeSampler`).

---

## 3. The document (FMD v0.1)

```mermaid
classDiagram
  class Doc {
    v: 1
    name
    comp: w h fps dur bg cam
    brand: font, colors{name→hex}
    assets{id→src mime w h}
    markers[]
    style: energy bounce depth speed
    bindings[]
    layers[] back→front
  }
  class Layer {
    id  (immutable)
    type
    in / out  (comp seconds)
    parent
    pos rot scale opacity depth hidden locked
    keys{channel→[[t,v,ease]]}
    beh[]
    expr{channel→string}
  }
  class Beh { id use at dur ease bounce ...params }
  class Binding { from: style.x ; path ; lo ; hi }
  Doc "1" --> "*" Layer
  Doc "1" --> "*" Binding
  Layer "1" --> "*" Beh
  Layer <|-- gradient
  Layer <|-- text
  Layer <|-- shape
  Layer <|-- image
  Layer <|-- device
  Layer <|-- cloner
  Layer <|-- camera
  Layer <|-- group
```

- **Space:** the origin is at the comp centre, Y points up, and +Z points toward the camera. Units are pixels. The default camera sits at the fit distance (z = 1713 for 1080p at 35°), so 1 unit = 1 px at z = 0.
- **Time:** `in` and `out` are comp seconds. Everything inside a layer uses layer-local time, starting at zero at `in`: behaviour `at`, key times and expression `t`. Moving a layer is therefore one `set` on `in`.
- **Colours:** either `#rrggbb` or a named brand token like `$accent`. Changing a brand colour re-themes every layer that uses it.

Full field list: `docs/FMD-SPEC.md`.

---

## 4. The edit pipeline (every change goes through this)

```mermaid
sequenceDiagram
  autonumber
  participant W as Writer (UI / slider / AI)
  participant S as store.commit()
  participant E as ops.applyTxn()
  participant X as expand()
  participant V as validate()
  participant D as doc + history

  W->>S: ops[] + {source, intent}
  S->>E: applyTxn(doc, ops)
  E->>E: structuredClone(doc)
  loop each macro op
    E->>X: expand(op) → primitives (set/del/ord)
    X-->>E: + detach-binding prims if a bound path was hand-edited
    E->>E: apply prim, record inverse from preimage
  end
  E->>V: Zod schema + semantic checks
  alt invalid
    V-->>S: errors (repairable text), doc untouched
  else valid
    E-->>S: new doc + Txn{prims, inverse, intent, source}
    S->>D: doc = new, past.push(txn), future = []
  end
```

What makes this pipeline trustworthy:

| Property | How | Status |
|---|---|---|
| One gesture = one undo step | The UI previews through a *transient* doc and commits once, on release | **Real** |
| Exact undo/redo | Inverse primitives come from the preimage. A property test runs random op sequences 600 times and checks that undo restores the document exactly | **Real** |
| Models never do arithmetic | `set … delta`; `key` sorts and quantises; `trim` keeps the animation in place | **Real** |
| Sliders never clobber hand edits | Any direct `set` on a bound path removes that binding in the same transaction | **Real** |
| Deleting a layer leaves no dangling refs | `del` of a layer also unparents its children and clears `comp.cam` | **Real** |
| Readable errors for repair | e.g. `did you mean typeUp?`, `unknown brand color $x (have …)`, `… bake "in" or delete the keys` | **Real** |
| Collaboration (Yjs) | The op shape was designed to map onto Yjs | **Not built** |

---

## 5. How a frame is computed

`evaluate(doc, t)` is a pure function: the same document and time always give the same frame. This is why scrubbing, playback and export can never disagree.

```mermaid
flowchart TB
  T[time t] --> L{"for each layer:<br/>local = t − in"}
  L --> CH["for each channel<br/>pos.x … opacity, size, r, spin, fov …"]
  CH --> TR["track = keys(ch, local) or static field"]
  TR --> ADD["acc = track + Σ add-behaviours in window<br/>(float, wiggle, spin, pulse, sway, shake)"]
  ADD --> OWN{"own-behaviour<br/>writes ch?"}
  OWN -- yes --> OW["result = owner(track, eased progress)<br/>latest owner whose at ≤ local"]
  OWN -- no --> AC[result = acc]
  OW & AC --> EX{"expr on ch?"}
  EX -- yes --> EV["result = expr({t, value, base, …})<br/>falls back on error"]
  EX -- no --> OUT[channel value]
  EV --> OUT
  L --> GL["text: per-glyph<br/>text behaviours (by char/word/line, stagger)<br/>+ selectors (weight × add)"]
  L --> CL["cloner: per-clone layout<br/>radial/grid/linear + reveal + delay/noise/wave fx"]
  L --> CAM["active camera → pos, rot, fov"]
  OUT & GL & CL & CAM --> F["Frame {layers[], camera, byId}"]
```

- Springs use a closed-form damped oscillator, normalized so `ease(0)=0` and `ease(1)=1` exactly. `bounce` is a real parameter, which is what the Bounce slider binds to.
- Noise is seeded by layer id, behaviour id and index, and sampled in seconds rather than frames, so it's deterministic.
- Expressions are parsed into an AST and interpreted. There is no `eval`, and globals are unreachable (tested).

---

## 6. Rendering

```mermaid
flowchart LR
  F[Frame] --> SYNC["Stage.sync(doc, frame)"]
  SYNC --> REC["reconcile views by layer id<br/>create / dispose / reparent"]
  REC --> XF["set transforms<br/>renderOrder: flat layers = doc order,<br/>adjacent 3D layers share an order → depth sort"]
  XF --> CONTENT["update content per view"]
  CONTENT --> Q["QuadView: shape/image<br/>SDF rounded-rect/ellipse shader"]
  CONTENT --> TXT["TextView: one quad per glyph<br/>canvas glyph textures at 1.5–3× res"]
  CONTENT --> DEV["DeviceView: extruded PBR body<br/>+ screen quad + island/dots"]
  CONTENT --> CLN["ClonerView: quad per clone<br/>billboard + orient"]
  CONTENT --> GRD["GradientView: full-screen shader<br/>+ display-space grain"]
  Q & TXT & DEV & CLN & GRD --> R["WebGLRenderer.render<br/>(scissored into the comp rect)"]
```

- **One stage, three uses:**
  - the Viewport's shot view;
  - Split view, where the same scene is rendered again from an orbit camera with a grid, the comp frame and a `CameraHelper`;
  - the exporter, which uses its own off-screen Stage.
- **Picking:** a raycast finds the front-most mesh by render order. **Bounds:** projected Box3 → selection boxes in the viewport.
- **Performance:** the viewport renders on demand, on playhead, doc, selection, font or asset changes. The playhead never goes through React.

---

## 7. Editor state and what the screen shows

```mermaid
flowchart LR
  subgraph store["zustand store"]
    DOC[(doc — committed)]
    PREV[preview — AI turn under review]
    TRN[transient — mid-drag / mid-scrub]
    HIST[past / future txns]
    UI[selection, mode, tab, view, turns, agent]
  end
  DOC --> PICK{"displayDoc =<br/>transient ?? preview.doc ?? doc"}
  PREV --> PICK
  TRN --> PICK
  PICK --> VIEWS[Viewport · Timeline · Inspector · JSON]
  PH[(playhead — module, not React)] --> VIEWS
```

- **Transient:** holds the live result while you drag or scrub. Release commits exactly one transaction.
- **Preview:** holds an AI turn's changes until you Keep or Discard them. Making any manual edit first auto-keeps the preview, so work is never silently lost.
- **Playhead:** a plain module with subscribers and a rAF loop. Only the timecode label and the ruler canvas update each frame.

---

## 8. The AI turn (bridge)

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant A as Assistant panel
  participant B as bridge (window.fusion)
  participant G as Agent (external today)
  participant S as store

  User->>A: prompt (+ selected layers = scope)
  A->>B: sendPrompt()
  B->>S: user turn + agent turn {status: waiting, context: outline + inspect(scope)}
  Note over G: today: Claude via Playwright, or any script<br/>later: in-app provider / MCP client
  G->>B: bridge.connect("Claude"), bridge.pending()
  B-->>G: {turnId, prompt, scope, outline, inspect}
  G->>B: bridge.respond(turnId, {message, ops, chips})
  loop one op at a time (streaming)
    B->>S: startPreview(ops so far)
    S->>S: buildPreview: apply each op, reject only ops that ADD validation errors
  end
  B->>S: status: review
  User->>A: untick ops · Keep / Discard
  A->>S: keepPreview() → commit(accepted ops, source "ai") = one undo step
  User->>A: click chip with ops → commit directly, 0 model tokens
```

Turn lifecycle:

```mermaid
stateDiagram-v2
  [*] --> waiting: prompt sent
  waiting --> streaming: agent responds with ops
  waiting --> info: agent responds, no ops
  streaming --> review: all ops arrived
  review --> kept: Keep (≥1 op accepted)
  review --> discarded: Discard / undo / nothing accepted
  kept --> [*]
  discarded --> [*]
```

Pro mode also has **Paste ops**, which runs the same review flow with no agent at all.

---

## 9. Export

```mermaid
sequenceDiagram
  participant UI as Export dialog
  participant X as exportVideo()
  participant M as mediabunny
  participant ST as off-screen Stage
  UI->>X: format, height, quality
  X->>M: getFirstEncodableVideoCodec(mp4: avc→hevc→av1→vp9 | webm: vp9→av1→vp8)
  X->>X: wait for fonts + asset textures
  X->>M: Output + CanvasSource(bitrate = w·h·fps·0.12 bpp)
  loop every frame i
    X->>ST: sync(doc, evaluate(doc, i/fps)); render()
    X->>M: source.add(t, 1/fps)
  end
  X->>M: finalize()
  M-->>UI: Blob → preview player + Download
```

Frames come from the same function as the preview, so they match exactly and none can be dropped.

- **This sandbox:** its Chromium has no H.264 encoder, so MP4 export chose AV1.
- **Normal Chrome:** picks H.264.

---

## 10. Testing and tooling

```mermaid
flowchart LR
  U["vitest — 62 tests<br/>ease/spring/noise/expr, composition,<br/>paths, txns, validation,<br/>fast-check inverse + redo properties"] --> CI[(green)]
  E["Playwright — 30 tests<br/>start screen, inspector/undo, viewport drag/pick,<br/>timeline drags/keys/scrub, sliders+bindings,<br/>JSON, history, shortcuts, persistence,<br/>AI bridge review/discard/paste, WebM+MP4 export"] --> CI
  R["record-session.ts<br/>scripted full lifecycle → session.webm"] --> V[(video)]
  B["bench/tokens.ts<br/>o200k counts vs Remotion scenes"] --> T[(docs/TOKENS.md)]
```

Test-only hooks exposed on `window`:
- `fusion` (the bridge);
- `__store` (read-only store access);
- `__timeline` and `__viewport` (screen geometry, so tests and agents can drive the canvases);
- `__stage`;
- `__lastExport`.

---

## 11. Real vs placeholder — the full ledger

### Real (implemented and tested)
- **FMD schema and validation:** all 8 layer types, brand tokens, assets, bindings, semantic checks.
- **Ops engine:** macros → primitives, exact inverses, one transaction per apply, binding detach, safe layer delete.
- **Evaluator:**
  - keys with per-segment easing, and 22 behaviours (own/add/text);
  - the composition rule, and expressions;
  - text units and selectors;
  - cloners (radial/grid/linear with delay/noise/wave);
  - camera fit, dolly/truck/orbit/shake;
  - bake.
- **Renderer:**
  - SDF shapes and images, per-glyph text, and a PBR device mockup with a real screen image;
  - cloners, a gradient background with grain, and 3D depth sorting;
  - picking, bounds, and split view with a camera helper.
- **Editor:**
  - viewport selection and drag-to-move with auto-key, image drop (onto a device = its screen), and the add toolbar;
  - a canvas timeline: bars, clips, keys, trim, snapping, zoom, and the camera lane;
  - the inspector: keyframe stopwatch, behaviour cards, novice presets, cloner/device/gradient/comp/brand settings, and expressions;
  - JSON edit/apply, history jump, undo/redo, keyboard shortcuts, the start screen with rendered template thumbnails, and autosave.
- **AI bridge:** pending turns with scoped context, streamed per-op review, partial accept, discard, chips with ops, paste ops.
- **Export:** MP4/WebM at 720p/1080p/4K through mediabunny. Tested at 720p for both containers; 1080p verified in the recording.

### Partial
| Area | What works | What's missing |
|---|---|---|
| Token numbers in the UI | Diff cards and the JSON tab show `≈` counts | They're estimates (`chars / 3.8`, `bridge.ts`). Real tokenizer counts exist only in `bench/tokens.ts` |
| Style **speed** | In the schema, the ops and the slider list | Nothing binds to it yet, so the slider stays hidden |
| **Markers** | In the schema; drawn on the ruler; used as snap targets | No UI to add them; no audio beat detection |
| **Group** layers | Render as transform parents | Can only be created through JSON or an agent (no toolbar button) |
| **Text selectors** (`anim`) | Evaluated and rendered (logo template) | Editable only in JSON |
| Font consistency | Bundled fonts plus a canvas-measured layout | No HarfBuzz, so line breaks may differ slightly between machines |
| Persistence | The document (localStorage) and assets (IndexedDB) | Undo history and chat aren't saved; single project only |
| Fit/performance | Smooth for the templates (~12 layers) | Not yet measured against the plan's 200-layer / 10k-instance budget; cloners are one mesh per item, not instanced |

### Placeholder (stand-ins by design)
| Placeholder | Where | Replaced by |
|---|---|---|
| **The AI itself.** No model is called in the app. Prompts wait for an agent on `window.fusion.bridge`; in the recording that was me (Claude) sending ops I wrote | `bridge.ts`, `e2e/orbit-script.ts` | An in-app provider (AI SDK `ToolLoopAgent` with `outline/inspect/apply/catalog` tools) and/or an MCP endpoint. The bridge's `pending/respond` is already the contract |
| "What the AI saw … plus a cached system prompt" | Assistant | There is no system prompt yet; it will exist when the provider does |
| Built-in demo phone/browser screen ("Ledger" UI) | `device.ts placeholderScreen` | The user's screenshot, whenever `screen` is set |
| Grey box for a missing or loading image | `stage.ts QuadView` | The real texture once it loads (export waits for all of them) |
| Dock "Select" button | `Viewport.tsx` | Always on; there is no other tool mode yet |
| `migrate()` | `persist.ts` | A no-op until v2 of the format exists |
| Start-screen project name = first clause of the prompt | `Shell.tsx` | The agent renames it (it did, to "Orbit launch") |

### Not built (planned)
- **Integrations:** the server/API (`api/` from the plan: no Hono server exists; the app is 100% client-side), the model provider, the MCP endpoint.
- **Editor features:**
  - a graph editor (value/speed curves, bezier handles), multi-select stagger and marquee;
  - audio lane and waveform, video layers, 3D meshes/glTF, particles;
  - post-FX (bloom/DOF/motion blur);
  - Lottie import/export, Figma import, AE `.jsx`, glTF export;
  - ProRes/alpha export.
- **Platform:** WebGPU, Yjs collaboration, instanced cloners.
- **Reuse from the old Fusion app:** none. The plan said to copy shadcn/ui, `AgentThoughts`, `AudioWaveform` and the gateway. To keep `motion/` light I hand-wrote the UI in plain CSS instead, and there is no server, so no gateway. `immer` is installed but unused (the store uses `structuredClone`); it can be removed.

---

## 12. How this relates to the rest of the repo

```mermaid
flowchart LR
  subgraph old["Existing Fusion (untouched)"]
    C[client/ :8080] --> SV[server/ :3001<br/>Remotion agent] --> RM[remotion/<br/>TSX scenes → MP4]
  end
  subgraph new["motion/ (standalone)"]
    M[Vite app :5180<br/>FMD + Three.js + mediabunny]
  end
  old -. no imports, no shared runtime .- new
  M -. future: server + provider + MCP .-> P[(model provider)]:::ext
  classDef ext stroke-dasharray: 5 5
```

`motion/` has its own `package.json`, isn't in the root workspaces, and imports nothing from `client/`, `server/` or `remotion/`. The only shared file is `CLAUDE.md`, which has a pointer section. The token benchmark reads `remotion/src/scenes` purely to compare costs.
