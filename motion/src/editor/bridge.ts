import { useStore, type Chip, type Turn, type TurnKind } from "./store";
import { outline, inspect, catalog } from "../fmd/outline";
import type { Op } from "../fmd/ops";
import { validate } from "../fmd/ops";
import { Doc, type Scene } from "../fmd/schema";
import { playhead } from "./playhead";
import { TEMPLATES } from "../templates";
import { importAsset } from "../assets/assets";
import { ASPECTS, clearSceneOps, normalizeScenes, planEditOps, planSummary, prefixSceneOps, sceneLayerIds, scenePrefix, sceneTotal } from "../ai/plan";
import * as director from "../ai/director";

/**
 * Agent bridge. The editor never calls a model itself: a prompt becomes a pending turn with
 * the context an agent needs (outline + only the scoped layers), and any agent — the in-app
 * providers, an MCP client, a script, a test — answers with ops. Everything an agent can do goes
 * through the same op log as a person. See docs/AGENT-FLOW.md for the plan → build protocol.
 */
export const estTokens = (s: string) => Math.max(1, Math.round(s.length / 3.8));

export interface PendingScene extends Scene {
  index: number;
  count: number;
  /** every new layer id must start with this */
  prefix: string;
  /** neighbours, for continuity */
  prev?: { title: string; brief: string };
  next?: { title: string; brief: string };
}

export interface PendingTurn {
  turnId: string;
  /** "edit" (free request) · "plan" (propose scenes) · "setup" (global look) · "scene" (build one scene) */
  kind: TurnKind;
  prompt: string;
  scope: string[];
  outline: string;
  inspect: string;
  docValid: boolean;
  /** plan turns: the user's global choices (length 0 = up to you) */
  settings?: { length: number; aspect: string; look: string; assets: string[] };
  /** setup/scene turns: the whole plan and its art direction */
  plan?: { look: string; scenes: Scene[] };
  /** scene turns (and edits scoped to a scene) */
  scene?: PendingScene;
  /** scene window in comp seconds [start, end) */
  window?: [number, number];
}

export interface AgentResponse {
  message: string;
  ops?: Op[];
  chips?: Chip[];
  /** plan turns: the proposed scenes ({title, dur, brief, id?}) and an optional one-line look */
  plan?: { scenes: unknown; look?: string } | unknown[];
  delayMs?: number;
}

/** A free-form request from the composer. Scoped to the selection, or to a scene being refined. */
export function sendPrompt(text: string, opts: { sceneId?: string | null } = {}): string {
  const st = useStore.getState();
  const sceneId = opts.sceneId === undefined ? st.chatScene : opts.sceneId;
  const scene = sceneId ? st.doc.scenes.find((s) => s.id === sceneId) : undefined;
  const scope = scene && !st.selection.length ? sceneLayerIds(st.doc, scene.id) : [...st.selection];
  st.addTurn({ role: "user", text, scope: scene ? [] : scope, sceneId: scene?.id });
  const doc = st.doc;
  const ctx = `${outline(doc)}${scope.length ? "\n\n" + inspect(doc, scope) : ""}`;
  const agentName = st.agent?.name;
  return st.addTurn({
    role: "agent",
    kind: "edit",
    sceneId: scene?.id,
    window: scene ? [scene.start, scene.start + scene.dur] : undefined,
    text: agentName ? "" : NOT_CONNECTED,
    status: "waiting",
    scope,
    context: ctx,
    agent: agentName,
    tokens: { in: estTokens(ctx + text), out: 0 },
  });
}

export const NOT_CONNECTED = "No AI agent is connected yet. Your request is queued — connect an agent (window.fusion.bridge) or paste ops below.";

function sceneCtx(scenes: Scene[], id: string): PendingScene | undefined {
  const i = scenes.findIndex((s) => s.id === id);
  if (i < 0) return undefined;
  const pick = (s?: Scene) => (s ? { title: s.title, brief: s.brief } : undefined);
  return { ...scenes[i], index: i, count: scenes.length, prefix: scenePrefix(id), prev: pick(scenes[i - 1]), next: pick(scenes[i + 1]) };
}

function pendingOf(t: Turn, turns: Turn[]): PendingTurn {
  const st = useStore.getState();
  const doc = st.doc;
  const kind = t.kind ?? "edit";
  const user = turns[turns.indexOf(t) - 1];
  const scene = t.sceneId ? sceneCtx(doc.scenes, t.sceneId) : undefined;
  const base: PendingTurn = {
    turnId: t.id,
    kind,
    prompt: kind === "edit" ? (user?.text ?? "") : t.context ?? "",
    scope: t.scope ?? [],
    outline: outline(doc),
    inspect: inspect(doc, t.scope ?? []),
    docValid: validate(doc).length === 0,
  };
  const d = st.director;
  if (kind === "plan") base.settings = { length: d.length, aspect: d.aspect, look: d.look, assets: Object.keys(doc.assets) };
  if (kind === "setup" || kind === "scene") base.plan = { look: d.look, scenes: doc.scenes };
  if (scene) {
    base.scene = scene;
    base.window = [scene.start, Math.round((scene.start + scene.dur) * 1000) / 1000];
    if (kind === "scene") base.prompt = `Build scene ${scene.index + 1} of ${scene.count} — "${scene.title}" (${base.window[0]}–${base.window[1]} s): ${scene.brief}`;
  }
  return base;
}

function pending(): PendingTurn[] {
  const st = useStore.getState();
  return st.turns.filter((t) => t.role === "agent" && t.status === "waiting").map((t) => pendingOf(t, st.turns));
}

/**
 * The ops that actually land for a turn. Scene builds are namespaced to the scene (new layer ids get
 * the scene prefix, references follow), clipped to its window, cleared first when rebuilding, and
 * finish by marking the scene done. Returns the ops plus, for each, the index of the agent op it
 * came from (−1 for ops the editor added) so errors can be traced back.
 */
export function prepareTurnOps(turn: Pick<Turn, "kind" | "sceneId" | "window">, ops: Op[], doc = useStore.getState().doc): { ops: Op[]; from: number[] } {
  const kind = turn.kind ?? "edit";
  const scene = turn.sceneId ? doc.scenes.find((s) => s.id === turn.sceneId) : undefined;
  if (kind === "setup") {
    const out: Op[] = [...ops];
    const tail: Op[] = [];
    const [w, h] = ASPECTS[useStore.getState().director.aspect] ?? [doc.comp.w, doc.comp.h];
    if (doc.scenes.length) tail.push({ op: "set", path: "comp/dur", value: sceneTotal(doc.scenes) });
    tail.push({ op: "set", path: "comp/w", value: w }, { op: "set", path: "comp/h", value: h });
    return { ops: [...out, ...tail], from: [...ops.map((_, i) => i), ...tail.map(() => -1)] };
  }
  if (!scene || (kind !== "scene" && kind !== "edit")) return { ops, from: ops.map((_, i) => i) };
  const end = Math.round((scene.start + scene.dur) * 1000) / 1000;
  const shift = turn.window ? Math.round((scene.start - turn.window[0]) * 1000) / 1000 : 0;
  const p = prefixSceneOps(doc, ops, { sceneId: scene.id, start: scene.start, end, shift, others: doc.scenes.filter((s) => s.id !== scene.id).map((s) => s.id) });
  const head = kind === "scene" ? clearSceneOps(doc, scene.id) : [];
  const out: Op[] = [...head];
  const from: number[] = head.map(() => -1);
  p.ops.forEach((op, i) => {
    if (op) {
      out.push(op);
      from.push(i);
    }
  });
  if (kind === "scene") {
    out.push({ op: "set", path: `scenes/${scene.id}/status`, value: "done" });
    from.push(-1);
  }
  return { ops: out, from };
}

function applyPlan(turnId: string, r: AgentResponse) {
  const st = useStore.getState();
  const d = st.director;
  const raw = Array.isArray(r.plan) ? r.plan : (r.plan as { scenes?: unknown } | undefined)?.scenes ?? r.plan;
  const look = !Array.isArray(r.plan) && typeof (r.plan as { look?: unknown })?.look === "string" ? ((r.plan as { look: string }).look as string) : d.look;
  const scenes = normalizeScenes(raw, { length: d.length || undefined });
  if (!scenes.length) {
    st.patchTurn(turnId, { status: "error", text: r.message ? `${r.message}\n\nThe plan had no scenes.` : "The plan had no scenes — try regenerating." });
    st.setDirector({ phase: "idle" });
    return;
  }
  const ops = planEditOps(st.doc, scenes);
  const [w, h] = ASPECTS[d.aspect] ?? [st.doc.comp.w, st.doc.comp.h];
  if (w !== st.doc.comp.w) ops.push({ op: "set", path: "comp/w", value: w });
  if (h !== st.doc.comp.h) ops.push({ op: "set", path: "comp/h", value: h });
  const res = st.commit(ops, { source: "ai", intent: `Scene plan · ${planSummary(scenes)}` });
  if (!res.ok) {
    st.patchTurn(turnId, { status: "error", text: `The plan could not be applied: ${res.errors[0]}` });
    st.setDirector({ phase: "idle" });
    return;
  }
  st.patchTurn(turnId, { status: "kept", text: r.message, txnId: res.txn?.id, agent: st.agent?.name, tokens: { in: st.turns.find((t) => t.id === turnId)?.tokens?.in ?? 0, out: estTokens(JSON.stringify(r.plan ?? "") + r.message) } });
  st.setDirector({ phase: "ready", look, error: undefined, length: d.length });
  playhead.set(0);
}

/** Stream an agent's ops into a reviewable preview, one op at a time. */
export async function respond(turnId: string, r: AgentResponse) {
  const st = useStore.getState();
  let turn = st.turns.find((t) => t.id === turnId);
  if (!turn) throw new Error(`no turn ${turnId}`);
  if (turn.status !== "waiting" && turn.status !== "streaming") throw new Error(`turn ${turnId} is already answered (${turn.status})`);
  if (turn.kind === "plan") {
    if (r.plan !== undefined || !r.ops?.length) return applyPlan(turnId, r);
    // an agent that doesn't know about plans answered with ops: treat it as an ordinary edit
    st.patchTurn(turnId, { kind: "edit", title: undefined });
    st.setDirector({ phase: st.doc.scenes.length ? "ready" : "idle" });
    turn = { ...turn, kind: "edit" };
  }
  if (st.preview && st.preview.turnId !== turnId) st.keepPreview();
  const raw = r.ops ?? [];
  const { ops, from } = prepareTurnOps(turn, raw);
  const out = estTokens(JSON.stringify(raw) + r.message);
  st.patchTurn(turnId, { status: ops.length ? "streaming" : "info", text: r.message, ops: [], agent: st.agent?.name ?? turn.agent, tokens: { in: turn.tokens?.in ?? 0, out } });
  const delay = r.delayMs ?? 140;
  for (let i = 0; i < ops.length; i++) {
    const so = ops.slice(0, i + 1);
    useStore.getState().startPreview(turnId, so);
    const pv = useStore.getState().preview!;
    useStore.getState().patchTurn(turnId, { ops: so, accepted: pv.accepted, opErrors: pv.opErrors });
    if (delay) await new Promise((res) => setTimeout(res, delay));
  }
  const s2 = useStore.getState();
  // the user may have discarded (undo) mid-stream
  if (s2.turns.find((t) => t.id === turnId)?.status !== "streaming" && ops.length) return;
  s2.patchTurn(turnId, { status: ops.length ? "review" : "info", chips: r.chips?.slice(0, 3) });
  if (turn.autoKeep && ops.length) {
    const pv = s2.preview;
    const landed = pv && pv.turnId === turnId ? pv.opErrors.filter((e, i) => !e && from[i] >= 0).length : 0;
    if (!landed && turn.kind === "scene") {
      s2.discardPreview();
      s2.patchTurn(turnId, { status: "error", text: `${r.message ? r.message + "\n\n" : ""}None of the agent's changes were valid for this scene.` });
      return;
    }
    s2.keepPreview();
  }
}

export function installBridge() {
  const api = {
    version: "0.2",
    doc: () => useStore.getState().doc,
    outline: () => outline(useStore.getState().doc),
    inspect: (ids: string[]) => inspect(useStore.getState().doc, ids),
    catalog: (q?: string) => catalog(q),
    validate: () => validate(useStore.getState().doc),
    /** Commit ops directly (no review) — for scripts and trusted agents. */
    apply: (ops: Op[], intent?: string) => useStore.getState().commit(ops, { source: "ai", intent }),
    prompt: (text: string) => sendPrompt(text),
    select: (ids: string[]) => useStore.getState().select(ids),
    keep: () => useStore.getState().keepPreview(),
    discard: () => useStore.getState().discardPreview(),
    undo: () => useStore.getState().undo(),
    redo: () => useStore.getState().redo(),
    loadTemplate: (id: string) => {
      const t = TEMPLATES.find((x) => x.id === id);
      if (!t) throw new Error("no template " + id);
      useStore.getState().loadDoc(t.make());
      useStore.getState().set("screen", "editor");
    },
    /** Open any FMD document (object or URL). It is schema-checked; invalid docs throw with the reasons. */
    loadDoc: async (src: unknown) => {
      const raw = typeof src === "string" ? await (await fetch(src)).json() : src;
      const r = Doc.safeParse(raw);
      if (!r.success) throw new Error(r.error.issues.slice(0, 5).map((i) => `${i.path.join("/")}: ${i.message}`).join("; "));
      useStore.getState().loadDoc(r.data);
      useStore.getState().set("screen", "editor");
      return validate(r.data);
    },
    importAssetFromUrl: async (url: string, name: string) => {
      const blob = await (await fetch(url)).blob();
      const file = new File([blob], name, { type: blob.type });
      const { id, entry } = await importAsset(file, Object.keys(useStore.getState().doc.assets));
      useStore.getState().commit([{ op: "set", path: `assets/${id}`, value: entry }], { source: "you", intent: `Imported ${name}` });
      return id;
    },
    time: { get: playhead.get, set: playhead.set, play: playhead.play, pause: playhead.pause },
    /** The plan → build flow (docs/AGENT-FLOW.md). */
    director: {
      state: () => useStore.getState().director,
      scenes: () => useStore.getState().doc.scenes,
      plan: (idea?: string, settings?: { length?: number; aspect?: string; look?: string }) => director.requestPlan(idea, settings),
      build: (ids?: string[]) => director.startBuild(ids),
      rebuild: (id: string) => director.rebuildScene(id),
      pause: () => director.pauseBuild(),
      editScene: (id: string, patch: Partial<Pick<Scene, "title" | "brief" | "dur">>) => director.editScene(id, patch),
    },
    bridge: {
      /** `provider` is set by the in-app providers; any other caller (a script, MCP, a test) takes over from them. */
      connect(name: string, opts?: { provider?: string }) {
        useStore.getState().set("agent", { name, since: Date.now(), provider: opts?.provider });
        // requests queued before an agent connected are now addressed to it
        for (const t of useStore.getState().turns) if (t.status === "waiting") useStore.getState().patchTurn(t.id, { text: "", agent: name });
        return true;
      },
      disconnect() {
        useStore.getState().set("agent", null);
      },
      pending,
      respond,
    },
  };
  (window as unknown as { fusion: typeof api }).fusion = api;
  director.installDirector();
  return api;
}
