import { create } from "zustand";
import { applyTxn, applyPrims, type Op, type Source, type Txn } from "../fmd/ops";
import type { Doc } from "../fmd/schema";
import { blankTemplate } from "../templates";
import { playhead } from "./playhead";

export type Mode = "novice" | "pro";
export type Tab = "assistant" | "inspect" | "json" | "history";
export type View = "shot" | "split";

export interface Chip { label: string; ops?: Op[]; prompt?: string; hint?: string }
export interface Turn {
  id: string;
  role: "user" | "agent" | "system";
  text: string;
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
  agent: { name: string; since: number } | null;
  aiChanged: Record<string, number>;
  notice: { text: string; kind?: "info" | "error"; id: number } | null;
  exportOpen: boolean;
  helpOpen: boolean;
  version: number;
}

interface Actions {
  loadDoc(doc: Doc, opts?: { keepHistory?: boolean }): void;
  commit(ops: Op[], opts: { source: Source; intent?: string }): { ok: boolean; errors: string[]; txn?: Txn };
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
  ops.forEach((op, i) => {
    if (!accepted[i]) return;
    const r = applyTxn(cur, [op], { source: "ai", validate: false });
    if (r.ok) cur = r.doc;
    else opErrors[i] = r.errors[0]?.replace(/^op 1 \(\w+\): /, "") ?? "failed";
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
  aiChanged: {},
  notice: null,
  exportOpen: false,
  helpOpen: false,
  version: 0,

  loadDoc(doc, opts) {
    playhead.setDuration(doc.comp.dur);
    set((s) => ({ doc, past: opts?.keepHistory ? s.past : [], future: opts?.keepHistory ? s.future : [], transient: null, preview: null, selection: [], keySel: null, version: s.version + 1 }));
  },

  commit(ops, opts) {
    const s = get();
    // an unresolved AI preview is kept before a manual edit lands on top of it
    if (s.preview && opts.source !== "ai") get().keepPreview();
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
    return { ok: true, errors: [], txn: r.txn };
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
    const r = get().commit(ops, { source: "ai", intent: turn?.text?.split("\n")[0].slice(0, 80) || "AI edit" });
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

/** The document every view should draw: an in-flight drag, else an AI preview, else the committed doc. */
export function useDisplayDoc(): Doc {
  return useStore((s) => s.transient ?? s.preview?.doc ?? s.doc);
}
export function displayDoc(): Doc {
  const s = useStore.getState();
  return s.transient ?? s.preview?.doc ?? s.doc;
}
