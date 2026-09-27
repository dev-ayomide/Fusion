import { useStore, type Director } from "../editor/store";
import { estTokens, NOT_CONNECTED } from "../editor/bridge";
import type { Scene } from "../fmd/schema";
import { fitScenes, layoutScenes, planEditOps, sceneTotal } from "./plan";

/**
 * The director runs the plan → build flow on top of the bridge:
 *   1. a "plan" turn — the agent proposes every scene of the video (doc.scenes);
 *   2. the user edits the storyboard (briefs, durations, order), then Build;
 *   3. a "setup" turn — the global look (comp finishing, brand palette, fonts, camera) once;
 *   4. one "scene" turn per scene, in order, each auto-kept as one undoable step.
 * Turns are ordinary pending turns, so the in-app providers and external agents drive the same flow.
 * A queued scene is read when its turn comes, so edits made while earlier scenes build are used.
 */

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const st = () => useStore.getState();

function agentFields() {
  const name = st().agent?.name;
  return { agent: name, text: name ? "" : NOT_CONNECTED };
}

function describeSettings(d: Director) {
  return [`LENGTH: ${d.length ? `${d.length} s` : "your call (usually 12–30 s)"}`, `FORMAT: ${d.aspect}`, `LOOK: ${d.look || "your call"}`].join("\n");
}

/** Ask the agent for a scene plan of the whole video. */
export function requestPlan(idea?: string, settings: { length?: number; aspect?: string; look?: string } = {}): string {
  const s = st();
  const d = s.director;
  const text = (idea ?? d.idea).trim();
  const regenerate = !!s.doc.scenes.length;
  s.setDirector({ idea: d.idea || text, ...settings, phase: "planning", error: undefined, queue: [], turnId: null });
  s.addTurn({ role: "user", text: regenerate && !idea ? "Regenerate the scene plan" : text, kind: "plan" });
  const nd = st().director;
  const assets = Object.entries(s.doc.assets).map(([k, a]) => `${k} (${a.mime}${a.w ? ` ${a.w}x${a.h}` : ""})`);
  const ctx = `IDEA: ${nd.idea}${regenerate && idea && idea !== nd.idea ? `\nDIRECTION: ${idea}` : ""}\n${describeSettings(nd)}${assets.length ? `\nATTACHED IMAGES: ${assets.join(", ")}` : ""}${regenerate ? `\nCURRENT PLAN (propose a fresh take):\n${s.doc.scenes.map((sc, i) => `${i + 1}. ${sc.title} (${sc.dur}s): ${sc.brief}`).join("\n")}` : ""}`;
  return s.addTurn({ role: "agent", kind: "plan", title: "Scene plan", status: "waiting", context: ctx, tokens: { in: estTokens(ctx), out: 0 }, ...agentFields() });
}

/** Build the given scenes (default: every scene not built yet), one at a time. */
export function startBuild(ids?: string[]) {
  const s = st();
  const scenes = s.doc.scenes;
  if (!scenes.length) return s.toast("Plan some scenes first");
  const queue = ids ?? scenes.filter((sc) => sc.status !== "done").map((sc) => sc.id);
  if (!queue.length) return s.toast("Every scene is built — rebuild one from its card");
  s.setDirector({ phase: "building", queue, error: undefined });
  schedule();
}

export function rebuildScene(id: string) {
  const d = st().director;
  if (d.phase === "building") {
    if (!d.queue.includes(id)) st().setDirector({ queue: [...d.queue, id] });
    return;
  }
  startBuild([id]);
}

export function pauseBuild() {
  const d = st().director;
  if (d.phase === "building") st().setDirector({ phase: "paused" });
}

/* ------------------------------ plan edits ------------------------------ */

/** Commit a new scene list (laid out end to end) as one undoable step, under any in-flight build. */
export function commitPlan(next: Scene[], intent: string) {
  const s = st();
  const ops = planEditOps(s.doc, layoutScenes(next));
  const r = s.commit(ops, { source: "you", intent, preserve: true });
  if (!r.ok) s.toast(r.errors[0], "error");
  return r;
}

export function editScene(id: string, patch: Partial<Pick<Scene, "title" | "brief" | "dur">>) {
  const scenes = st().doc.scenes;
  const i = scenes.findIndex((x) => x.id === id);
  if (i < 0) return;
  const cur = scenes[i];
  const clean: Partial<Scene> = {};
  if (patch.title !== undefined && patch.title.trim() && patch.title !== cur.title) clean.title = patch.title.trim().slice(0, 60);
  if (patch.brief !== undefined && patch.brief !== cur.brief) clean.brief = patch.brief.slice(0, 1200);
  if (patch.dur !== undefined && isFinite(patch.dur)) {
    const dur = Math.min(60, Math.max(0.5, r3(patch.dur)));
    if (dur !== cur.dur) clean.dur = dur;
  }
  if (!Object.keys(clean).length) return;
  const what = clean.dur !== undefined ? "duration" : clean.title !== undefined ? "title" : "brief";
  return commitPlan(
    scenes.map((x) => (x.id === id ? { ...x, ...clean } : x)),
    `Scene ${i + 1} ${what}`,
  );
}

export function moveScene(id: string, dir: -1 | 1) {
  const scenes = [...st().doc.scenes];
  const i = scenes.findIndex((x) => x.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= scenes.length) return;
  [scenes[i], scenes[j]] = [scenes[j], scenes[i]];
  return commitPlan(scenes, `Moved “${scenes[j].title}” ${dir < 0 ? "earlier" : "later"}`);
}

export function deleteScene(id: string) {
  const s = st();
  const sc = s.doc.scenes.find((x) => x.id === id);
  if (!sc) return;
  if (s.building === id) return s.toast("That scene is building right now — pause first");
  const r = commitPlan(
    s.doc.scenes.filter((x) => x.id !== id),
    `Deleted scene “${sc.title}”`,
  );
  const d = st().director;
  if (d.queue.includes(id)) st().setDirector({ queue: d.queue.filter((x) => x !== id) });
  return r;
}

export function addScene(afterId?: string) {
  const s = st();
  const scenes = [...s.doc.scenes];
  let k = scenes.length + 1;
  while (scenes.some((x) => x.id === `s${k}`)) k++;
  const sc: Scene = { id: `s${k}`, title: "New scene", start: 0, dur: 3, brief: "", status: "planned" };
  const i = afterId ? scenes.findIndex((x) => x.id === afterId) + 1 : scenes.length;
  scenes.splice(i, 0, sc);
  commitPlan(scenes, "Added a scene");
  const d = st().director;
  if (d.phase === "building") st().setDirector({ queue: [...d.queue, sc.id] });
  return sc.id;
}

/** Rescale every scene to a new total length (the "Length" control). */
export function fitLength(length: number) {
  const s = st();
  s.setDirector({ length });
  if (!length || !s.doc.scenes.length) return;
  if (Math.abs(sceneTotal(s.doc.scenes) - length) < 0.01) return;
  commitPlan(fitScenes(s.doc.scenes, length), `Fit the plan to ${length}s`);
}

/* ------------------------------ build loop ------------------------------ */

function sendSetup() {
  const s = st();
  const d = s.director;
  const scenes = s.doc.scenes;
  const ctx = `Set up the global look before scene 1 is built.\nIDEA: ${d.idea}\n${describeSettings(d)}\nTOTAL: ${sceneTotal(scenes)} s\nSCENES:\n${scenes.map((sc, i) => `${i + 1}. ${sc.title} (${sc.start}–${r3(sc.start + sc.dur)} s): ${sc.brief}`).join("\n")}`;
  const id = s.addTurn({ role: "agent", kind: "setup", title: "Look & setup", intent: "Set up the look", autoKeep: true, status: "waiting", context: ctx, tokens: { in: estTokens(ctx), out: 0 }, ...agentFields() });
  s.setDirector({ turnId: id });
}

function sendScene(id: string) {
  const s = st();
  const i = s.doc.scenes.findIndex((x) => x.id === id);
  const sc = s.doc.scenes[i];
  const end = r3(sc.start + sc.dur);
  const ctx = `Build scene ${i + 1} of ${s.doc.scenes.length} — "${sc.title}" (${sc.start}–${end} s): ${sc.brief}`;
  s.set("building", id);
  const turnId = s.addTurn({
    role: "agent",
    kind: "scene",
    sceneId: id,
    window: [sc.start, end],
    title: `Scene ${i + 1} · ${sc.title}`,
    intent: `Built scene ${i + 1} · ${sc.title}`,
    autoKeep: true,
    status: "waiting",
    context: ctx,
    tokens: { in: estTokens(ctx), out: 0 },
    ...agentFields(),
  });
  s.setDirector({ turnId });
}

let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    pump();
  });
}

function pump() {
  const s = st();
  const d = s.director;
  if (d.turnId) {
    const t = s.turns.find((x) => x.id === d.turnId);
    if (t && (t.status === "waiting" || t.status === "streaming" || t.status === "review")) return;
    const ok = !!t && (t.status === "kept" || (t.status === "info" && t.kind === "setup"));
    const patch: Partial<Director> = { turnId: null };
    if (ok && t!.kind === "setup") patch.setupDone = true;
    if (ok && t!.kind === "scene") patch.queue = d.queue.filter((x) => x !== t!.sceneId);
    if (!ok) {
      patch.phase = "paused";
      patch.error = !t ? "The build turn disappeared." : t.status === "discarded" ? "Build paused — the last step was discarded." : t.status === "info" ? "The agent returned no changes for that scene." : (t.text.split("\n").filter(Boolean).at(-1) ?? "The agent hit an error.");
    }
    s.set("building", null);
    s.setDirector(patch);
    if (!ok) return;
  }
  const d2 = st().director;
  if (d2.phase !== "building") return;
  const doc = st().doc;
  if (!d2.setupDone && !doc.scenes.some((x) => x.status === "done")) return sendSetup();
  const next = d2.queue.find((id) => doc.scenes.some((x) => x.id === id));
  if (!next) {
    st().setDirector({ phase: "done", queue: [] });
    st().toast("Video built — press Space to play it");
    return;
  }
  sendScene(next);
}

let installed = false;
export function installDirector() {
  if (installed) return;
  installed = true;
  useStore.subscribe((s, prev) => {
    if (s.turns !== prev.turns || s.director.phase !== prev.director.phase) schedule();
  });
}
