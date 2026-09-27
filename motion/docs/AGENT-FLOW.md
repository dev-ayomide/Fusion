# Agent flow — plan → storyboard → build

How a prompt becomes a video. The editor never calls a model itself: every step is a **pending turn**
on `window.fusion.bridge`, and whoever is connected answers it — the in-app providers
(`src/editor/agentProvider.ts`), an MCP client, a script, or a Playwright test. The sequencing lives in
`src/ai/director.ts`; prompts in `src/ai/prompts.ts`.

```
landing prompt ──► plan turn ──► storyboard (user edits) ──► Build
                                                              │
                         setup turn (look, palette, camera) ◄─┘
                                      │
                         scene turn s1 ─► s2 ─► … ─► done   (each auto-kept, one undo step)
```

## 1. Plan

`startProject(text)` (landing) or `fusion.director.plan(idea?, settings?)` opens a `kind: "plan"` turn.
Its `settings` carry the user's choices: `length` (s, `0` = agent's call), `aspect`, `look`, attached asset ids.

Answer with scenes only — no ops:

```js
fusion.bridge.respond(turnId, {
  message: "Three acts: night, drop, sunrise.",
  plan: { look: "Midnight blue, hot orange sun", scenes: [
    { title: "Night", dur: 3, brief: "Stars and an aurora." },
    { title: "Drop",  dur: 3, brief: "Names slam on the beat." },
  ] },
});
```

Scenes are normalised (ids `s1…`, laid end to end, clamped durations) and written to `doc.scenes`;
`comp.dur` follows the total. Nothing is built yet.

## 2. Storyboard

The left column shows every scene as an editable card: title, brief, duration, reorder, add, delete,
plus global Length / Format / Look. Each edit is one undoable commit (`director.editScene`,
`moveScene`, `addScene`, `deleteScene`, `fitLength`). **Regenerate** asks for a fresh plan.
Nothing is generated until the user presses **Build video**.

## 3. Build

`fusion.director.build(ids?)` queues every scene not yet `done`, then:

1. **setup** (once, before the first scene): a `kind: "setup"` turn with `plan` = the whole
   storyboard. Answer with global ops — comp finishing, `brand/colors`, fonts, a shared camera.
2. **scene**, one at a time, in storyboard order. The pending turn carries:
   - `scene`: `{ id, title, brief, index, count, prefix, prev?, next? }`
   - `window`: `[start, end)` in comp seconds.

   Every new layer id must start with `scene.prefix` (e.g. `s2-`); ids without it are prefixed for
   you, and other scenes' layers are off-limits. Keep timing inside `window`.

Build turns are auto-kept (`autoKeep`), each as a single undo step. A queued scene is read **when its
turn comes**, so edits made to later scenes while earlier ones build are used. If a turn errors, is
discarded, or returns no ops, the build **pauses** with the reason; **Resume build** continues from there.
`fusion.director.rebuild(id)` clears a scene's layers and builds it again; `pause()` stops after the
current scene.

## 4. Edits

Free-form requests from the composer are `kind: "edit"` turns: `outline` + `inspect` of the scoped
layers. Refining a storyboard card scopes the request to that scene (`scene`, `window` set, the scene's
layers in `inspect`). Edit turns are previewed as a diff card the user keeps or discards.

## Replies

| turn   | reply                                        | review              |
| ------ | -------------------------------------------- | ------------------- |
| plan   | `{ message, plan: { scenes, look? } }`       | storyboard          |
| setup  | `{ message, ops }`                           | auto-kept           |
| scene  | `{ message, ops, chips? }`                   | auto-kept           |
| edit   | `{ message, ops, chips? }`                   | diff card, per-op   |

`chips` are up to two follow-ups: `{ label, prompt }` (asks the AI) or `{ label, ops }` (applied
instantly, no model call).

## In-app providers

`autoConnect()` runs on load and connects the first provider whose key is present on the dev server
(`motion/.env`, read on every request — no restart): **Claude** (`ANTHROPIC_API_KEY`) › **DeepSeek via
AgentRouter** (`AGENTROUTER_API_KEY`) › **Mistral** (`MISTRAL_API_KEY`). Keys never reach the browser:
the Vite proxy attaches them. `?ai=<id>` picks one, `?ai=off` disables it; automated browsers skip
auto-connect unless `?ai=auto`. Any external `bridge.connect(name)` takes over from an in-app provider.
