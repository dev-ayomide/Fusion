import { create } from "zustand";
import { applyTxn, applyPrims, validate, type Op, type Source, type Txn } from "../fmd/ops";
import type { Doc } from "../fmd/schema";
import { blankTemplate } from "../templates";
import { playhead } from "./playhead";

export type Mode = "novice" | "pro";
export type Tab = "assistant" | "inspect" | "json" | "history";
export type View = "shot" | "split";

export interface Chip { label: string; ops?: Op[]; prompt?: string; hint?: string }
/** What a pending turn asks for: a scene plan, the global look, one scene's layers, or a free edit. */
export type TurnKind = "plan" | "setup" | "scene" | "edit";
export interface Turn {
  id: string;
  role: "user" | "agent" | "system";
  text: string;
  kind?: TurnKind;
  /** scene this turn builds (kind "scene") or is scoped to (kind "edit") */
  sceneId?: string;
  /** the scene window the agent was given, comp seconds */
  window?: [number, number];
  /** a short heading for build turns ("Scene 2 · The drop") */
  title?: string;
  /** build turns keep their ops automatically when they finish streaming */
  autoKeep?: boolean;
  /** history label for the kept transaction */
  intent?: string;
  scope?: string[];
  status?: "waiting" | "streaming" | "review" | "kept" | "discarded" | "error" | "info";
  ops?: Op[];
  accepted?: boolean[];
  opErrors?: (string | null)[];
  chips?: Chip[];
  txnId?: string;
  agent?: string;
  tokens?: { in: number; out: number };
  context?: string;
  ts: number;
}

export interface Preview { turnId: string; ops: Op[]; accepted: boolean[]; doc: Doc; opErrors: (string | null)[]; valid: string[] }

export interface KeySel { layer: string; channel: string; index: number }

/** The plan → build flow ("director"): global choices and the build queue. */
export interface Director {
  /** the user's original idea */
  idea: string;
  /** one-line art direction (palette, type, mood) */
  look: string;
  /** requested length in seconds; 0 = let the AI decide */
  length: number;
  aspect: string;
  phase: "idle" | "planning" | "ready" | "building" | "paused" | "done";
  /** scene ids still to build, in order */
  queue: string[];
  /** the build turn in flight */
  turnId: string | null;
  setupDone: boolean;
  error?: string;
}
export const freshDirector = (): Director => ({ idea: "", look: "", length: 0, aspect: "16:9", phase: "idle", queue: [], turnId: null, setupDone: false });

interface State {
  screen: "start" | "editor";
  doc: Doc;
  past: Txn[];
  future: Txn[];
  transient: Doc | null;
  preview: Preview | null;
  selection: string[];
  keySel: KeySel | null;
  mode: Mode;
  tab: Tab;
  view: View;
  expanded: Record<string, boolean>;
  turns: Turn[];
  agent: { name: string; since: number; provider?: string } | null;
  director: Director;
  /** which in-app AI providers have a key on the dev server (null = not checked yet) */
  providers: Record<string, boolean> | null;
  /** scene currently being built — shown as status "building" in the display doc */
  building: string | null;
  /** scene the composer is scoped to ("refine this scene") */
  chatScene: string | null;
  aiChanged: Record<string, number>;
  notice: { text: string; kind?: "info" | "error"; id: number } | null;
  exportOpen: boolean;
  helpOpen: boolean;
  /** timeline shows the value graph of the selected channel instead of the dopesheet (AE ⇧F3) */
  graphOpen: boolean;
  version: number;
}

interface Actions {
  loadDoc(doc: Doc, opts?: { keepHistory?: boolean }): void;
  /** `preserve`: land underneath an open AI preview instead of keeping it first (plan edits during a build) */
  commit(ops: Op[], opts: { source: Source; intent?: string; preserve?: boolean }): { ok: boolean; errors: string[]; txn?: Txn };
  setDirector(patch: Partial<Director>): void;
  undo(): void;
  redo(): void;
  undoTo(txnId: string): void;
  setTransient(doc: Doc | null): void;
  select(ids: string[], additive?: boolean): void;
  setKeySel(k: KeySel | null): void;
  setMode(m: Mode): void;
  setTab(t: Tab): void;
  setView(v: View): void;
  toggleExpanded(id: string): void;
  toast(text: string, kind?: "info" | "error"): void;
  set<K extends keyof State>(k: K, v: State[K]): void;
  // AI turns
  addTurn(t: Omit<Turn, "id" | "ts"> & { id?: string }): string;
  patchTurn(id: string, patch: Partial<Turn>): void;
  startPreview(turnId: string, ops: Op[]): void;
  togglePreviewOp(i: number): void;
  keepPreview(): void;
  discardPreview(): void;
}

export type Store = State & Actions;

let turnSeq = 0;
const now = () => Date.now();

/** Apply accepted ops one at a time so a single bad op is reported without sinking the rest. */
export function buildPreview(doc: Doc, ops: Op[], accepted: boolean[]): { doc: Doc; opErrors: (string | null)[]; valid: string[] } {
  let cur = doc;
  const opErrors: (string | null)[] = ops.map(() => null);
  let known = new Set(validate(cur));
  ops.forEach((op, i) => {
    if (!accepted[i]) return;
    const r = applyTxn(cur, [op], { source: "ai", validate: false });
    if (!r.ok) {
      opErrors[i] = r.errors[0]?.replace(/^op 1 \(\w+\): /, "") ?? "failed";
      return;
    }
    // an op is rejected only for problems it introduces, so one bad op can't sink the rest
    const after = validate(r.doc);
    const introduced = after.filter((e) => !known.has(e));
    if (introduced.length) {
      opErrors[i] = introduced[0];
      return;
    }
    cur = r.doc;
    known = new Set(after);
  });
  const final = applyTxn(doc, ops.filter((_, i) => accepted[i] && !opErrors[i]), { source: "ai" });
  return { doc: final.ok ? final.doc : cur, opErrors, valid: final.ok ? [] : final.errors };
}

export const useStore = create<Store>((set, get) => ({
  screen: "start",
  doc: blankTemplate(),
  past: [],
  future: [],
  transient: null,
  preview: null,
  selection: [],
  keySel: null,
  mode: "novice",
  tab: "assistant",
  view: "shot",
  expanded: {},
  turns: [],
  agent: null,
  director: freshDirector(),
  providers: null,
  building: null,
  chatScene: null,
  aiChanged: {},
  notice: null,
  exportOpen: false,
  helpOpen: false,
  graphOpen: false,
  version: 0,

  loadDoc(doc, opts) {
    playhead.setDuration(doc.comp.dur);
    set((s) =>
      opts?.keepHistory
        ? { doc, transient: null, preview: null, selection: [], keySel: null, version: s.version + 1 }
        : // a different document: its own history, conversation and plan state
          { doc, past: [], future: [], transient: null, preview: null, selection: [], keySel: null, version: s.version + 1, turns: [], director: freshDirector(), building: null, chatScene: null },
    );
  },

  commit(ops, opts) {
    const s = get();
    // an unresolved AI preview is kept before a manual edit lands on top of it
    if (s.preview && opts.source !== "ai" && !opts.preserve) get().keepPreview();
    const base = get().doc;
    const r = applyTxn(base, ops, opts);
    if (!r.ok || !r.txn) {
      return { ok: false, errors: r.errors };
    }
    if (JSON.stringify(r.doc) === JSON.stringify(base)) {
      set({ transient: null });
      return { ok: true, errors: [], txn: r.txn };
    }
    playhead.setDuration(r.doc.comp.dur);
    set((st) => ({ doc: r.doc, past: [...st.past, r.txn!].slice(-300), future: [], transient: null, version: st.version + 1 }));
    // an open preview is rebuilt on top of the new base so it never shows a stale document
    const pv = get().preview;
    if (pv && opts.preserve) set({ preview: { ...pv, ...buildPreview(r.doc, pv.ops, pv.accepted) } });
    return { ok: true, errors: [], txn: r.txn };
  },
  setDirector(patch) {
    set((s) => ({ director: { ...s.director, ...patch } }));
  },

  undo() {
    const s = get();
    if (s.preview) return get().discardPreview();
    const txn = s.past[s.past.length - 1];
    if (!txn) return;
    const doc = applyPrims(s.doc, txn.inverse);
    playhead.setDuration(doc.comp.dur);
    set((st) => ({ doc, past: st.past.slice(0, -1), future: [txn, ...st.future], selection: st.selection.filter((id) => doc.layers.some((l) => l.id === id)), keySel: null, version: st.version + 1 }));
    get().toast(`Undid: ${txn.intent}`);
  },

  redo() {
    const s = get();
    const txn = s.future[0];
    if (!txn) return;
    const doc = applyPrims(s.doc, txn.prims);
    playhead.setDuration(doc.comp.dur);
    set((st) => ({ doc, past: [...st.past, txn], future: st.future.slice(1), version: st.version + 1 }));
    get().toast(`Redid: ${txn.intent}`);
  },

  undoTo(txnId) {
    const s = get();
    const i = s.past.findIndex((t) => t.id === txnId);
    if (i < 0) return;
    let doc = s.doc;
    const undone = s.past.slice(i + 1).reverse();
    for (const t of undone) doc = applyPrims(doc, t.inverse);
    playhead.setDuration(doc.comp.dur);
    set((st) => ({ doc, past: st.past.slice(0, i + 1), future: [...undone, ...st.future], version: st.version + 1 }));
  },

  setTransient(doc) {
    set({ transient: doc });
  },

  select(ids, additive) {
    set((s) => ({ selection: additive ? [...new Set([...s.selection.filter((x) => !ids.includes(x) || ids.length !== 1), ...ids.filter((x) => !s.selection.includes(x))])] : ids, keySel: null }));
  },
  setKeySel(k) {
    set({ keySel: k });
  },
  setMode(m) {
    set((s) => ({ mode: m, tab: m === "novice" && s.tab === "json" ? "assistant" : s.tab }));
  },
  setTab(t) {
    set({ tab: t });
  },
  setView(v) {
    set({ view: v });
  },
  toggleExpanded(id) {
    set((s) => ({ expanded: { ...s.expanded, [id]: !s.expanded[id] } }));
  },
  toast(text, kind = "info") {
    const id = now();
    set({ notice: { text, kind, id } });
    setTimeout(() => {
      if (get().notice?.id === id) set({ notice: null });
    }, 3200);
  },
  set(k, v) {
    set({ [k]: v } as Partial<State>);
  },

  addTurn(t) {
    const id = t.id ?? `turn${++turnSeq}`;
    set((s) => ({ turns: [...s.turns, { ...t, id, ts: now() }] }));
    return id;
  },
  patchTurn(id, patch) {
    set((s) => ({ turns: s.turns.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
  },

  startPreview(turnId, ops) {
    const accepted = ops.map(() => true);
    const p = buildPreview(get().doc, ops, accepted);
    const stamp = now();
    const changed: Record<string, number> = {};
    for (const op of ops) for (const id of opLayers(op, get().doc)) changed[id] = stamp;
    set((s) => ({ preview: { turnId, ops, accepted, ...p }, aiChanged: { ...s.aiChanged, ...changed } }));
    playhead.setDuration(p.doc.comp.dur);
  },
  togglePreviewOp(i) {
    const s = get();
    if (!s.preview) return;
    const accepted = s.preview.accepted.map((a, j) => (j === i ? !a : a));
    const p = buildPreview(s.doc, s.preview.ops, accepted);
    set({ preview: { ...s.preview, accepted, ...p } });
    get().patchTurn(s.preview.turnId, { accepted, opErrors: p.opErrors });
  },
  keepPreview() {
    const s = get();
    const pv = s.preview;
    if (!pv) return;
    const turn = s.turns.find((t) => t.id === pv.turnId);
    const ops = pv.ops.filter((_, i) => pv.accepted[i] && !pv.opErrors[i]);
    set({ preview: null });
    if (!ops.length) {
      get().patchTurn(pv.turnId, { status: "discarded" });
      return;
    }
    const r = get().commit(ops, { source: "ai", intent: turn?.intent ?? (turn?.text?.split("\n")[0].slice(0, 80) || "AI edit") });
    get().patchTurn(pv.turnId, r.ok ? { status: "kept", txnId: r.txn!.id } : { status: "error", text: (turn?.text ?? "") + "\n\n" + r.errors.join("\n") });
  },
  discardPreview() {
    const pv = get().preview;
    if (!pv) return;
    set({ preview: null });
    playhead.setDuration(get().doc.comp.dur);
    get().patchTurn(pv.turnId, { status: "discarded" });
  },
}));

/** Layer ids an op touches (for the "changed by AI" glow). */
export function opLayers(op: Op, doc: Doc): string[] {
  switch (op.op) {
    case "add":
      return [op.id];
    case "ord":
    case "trim":
      return [op.id];
    case "style":
      return doc.bindings.filter((b) => b.from === `style.${op.key}`).map((b) => b.path.split("/")[0]);
    default: {
      const first = op.path.split("/")[0];
      if (first === "brand") return doc.layers.map((l) => l.id);
      return doc.layers.some((l) => l.id === first) ? [first] : [];
    }
  }
}

/**
 * The scene being built shows as `status: "building"`. It is a live overlay, not an op: the build's
 * own transaction then records planned → done, so one undo returns the scene to "planned".
 */
let overlayMemo: { base: Doc; id: string; out: Doc } | null = null;
function withBuilding(base: Doc, id: string | null): Doc {
  if (!id || !base.scenes.some((sc) => sc.id === id)) return base;
  if (overlayMemo && overlayMemo.base === base && overlayMemo.id === id) return overlayMemo.out;
  const out = { ...base, scenes: base.scenes.map((sc) => (sc.id === id ? { ...sc, status: "building" as const } : sc)) };
  overlayMemo = { base, id, out };
  return out;
}

/** The document every view should draw: an in-flight drag, else an AI preview, else the committed doc. */
export function useDisplayDoc(): Doc {
  return useStore((s) => withBuilding(s.transient ?? s.preview?.doc ?? s.doc, s.building));
}
export function displayDoc(): Doc {
  const s = useStore.getState();
  return withBuilding(s.transient ?? s.preview?.doc ?? s.doc, s.building);
}
