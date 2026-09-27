# Agent flow: plan → build

The editor never calls a model itself. Every AI request becomes a **pending turn**. Any agent answers it through
`window.fusion.bridge`: the in-app providers (Claude, DeepSeek, Mistral), a Playwright script, or an MCP client.
Scene planning and building use the same mechanism, so an external agent can drive the whole flow.

```
landing prompt ──► plan turn ──► doc.scenes (storyboard, user edits) ──► Build
                                                   │
             setup turn (global look, once) ◄──────┘
                     │
             scene turn s1 ─► scene turn s2 ─► …   (one at a time, each auto-kept = one undo step)
```

## Pending turns

`fusion.bridge.pending()` returns one entry per turn that is waiting for an answer:

| field | |
|---|---|
| `turnId` | pass to `respond` |
| `kind` | `"plan"` · `"setup"` · `"scene"` · `"edit"` |
| `prompt` | edit: the user's words. plan: `IDEA/LENGTH/FORMAT/LOOK/ATTACHED IMAGES` lines. scene: `Build scene 2 of 5 — "…" (4–8 s): <brief>` |
| `outline`, `inspect`, `scope`, `docValid` | the document outline, the full JSON of scoped layers, the ids, and whether the doc validates |
| `settings` | plan only: `{ length (0 = your call), aspect, look, assets }` |
| `plan` | setup/scene: `{ look, scenes }` — the whole plan |
| `scene` | scene turns and scene-scoped edits: `{ id, title, start, dur, brief, index, count, prefix, prev?, next? }` |
| `window` | `[start, end]` of the scene in comp seconds |

A queued scene is read when its turn is created, so edits the user makes to later scenes while earlier ones build
are used.

## Answering

```js
fusion.bridge.respond(turnId, { message, ops?, chips?, plan?, delayMs? })
```

- **plan**: `plan: { scenes: [{ title, dur, brief, id? }…], look? }` (a bare array works too). The scenes are
  normalised (ids `s1…`, durations clamped, fitted to the requested length, laid end to end) and committed as one
  step. They are stored in `doc.scenes`, which also sets `comp.dur` and the format. An agent that answers a plan turn with
  plain `ops` and no `plan` is treated as an ordinary edit, so older agents keep working.
- **setup**: `ops` that set the global look: `brand` (palette tokens, font), `comp` finishing (`bg`, `motionBlur`,
  `post`, `env`), one shared camera (`cam`, `comp/cam`), and optionally a full-length base background. The editor then
  forces `comp.dur`, `w` and `h` to the plan.
- **scene**: `ops` that build exactly that scene. The editor guarantees namespacing:
  - every layer the ops create gets the id prefix `<sceneId>-`. References such as `parent`, `after`, paths and
    `comp/cam` are renamed with it;
  - new layers without `in`/`out` get the scene window. If the scene moved while it was building, its layers move
    with it;
  - behaviours added to shared layers (e.g. `cam/beh/shake`) become `cam/beh/<sceneId>-shake`, clamped to the window;
  - ops that touch another scene's layers are dropped;
  - a rebuild first deletes the scene's layers and its behaviours on shared layers;
  - the transaction ends with `scenes/<id>/status = "done"`.

  Scene and setup turns are **auto-kept**: after streaming, the valid ops are committed as one transaction, and an
  undo returns the scene to `planned`. Invalid ops are skipped individually. A scene where every op is invalid is an
  error, and the build pauses.
- **edit**: unchanged. The ops stream into a live preview that the user reviews (Keep / Discard, untick single ops).
  An edit scoped to a scene ("Refine" on a built card) also prefixes new layer ids.

## Driving the flow

```js
fusion.director.plan(idea?, { length?, aspect?, look? })  // queue a plan turn (the landing page does this)
fusion.director.build(ids?)       // setup (once) + every unbuilt scene, in order
fusion.director.rebuild("s2")     // clear s2's layers and build it again from its current brief
fusion.director.pause()           // finish the current scene, then stop
fusion.director.editScene("s3", { brief, title, dur })   // one undo step; later scenes and built layers re-time
fusion.director.state()           // { phase: idle|planning|ready|building|paused|done, queue, setupDone, look, … }
fusion.bridge.connect(name)       // an external agent takes over from the in-app provider
```

Example: a minimal external agent

```js
const f = window.fusion;
f.bridge.connect("My agent");
setInterval(async () => {
  for (const t of f.bridge.pending()) {
    if (t.kind === "plan") await f.bridge.respond(t.turnId, { message: "…", plan: { look: "…", scenes: [...] } });
    else await f.bridge.respond(t.turnId, { message: "…", ops: await myModel(t) });
  }
}, 500);
```

## In-app providers

`src/editor/agentProvider.ts` is a bridge client like any other. Keys live in `motion/.env`. They are never
`VITE_`-prefixed, so they never reach the browser. The dev server proxies `/api/anthropic`, `/api/agentrouter` and
`/api/mistral` and attaches the key server-side. It re-reads `.env` on every request, so no restart is needed.
`GET /api/ai/providers` returns only booleans. On load the editor auto-connects the best provider that has a key, in
this order: Claude (`ANTHROPIC_API_KEY`, model `claude-opus-5-5`), then DeepSeek (`AGENTROUTER_API_KEY`), then
Mistral (`MISTRAL_API_KEY`). It does not auto-connect in automated browsers unless the URL has `?ai=auto`. `?ai=off`
disables it, and `?ai=<id>` picks a provider.

For each turn the provider calls the model with a system prompt for that kind (`src/ai/prompts.ts`), parses the JSON
leniently, and validates the ops exactly as the editor will, scene prefixing included. If any op is rejected, it makes
one repair round-trip with the compact validator messages (`src/ai/repair.ts`) before answering. Claude requests are
streamed. Claude always thinks, so effort is the control: medium for plans, scenes and edits, low for setup and
repairs. Scene builds allow up to 64k output tokens.
