import { useStore, type Chip } from "./store";
import { outline, inspect, catalog } from "../fmd/outline";
import type { Op } from "../fmd/ops";
import { validate } from "../fmd/ops";
import { playhead } from "./playhead";
import { TEMPLATES } from "../templates";
import { importAsset } from "../assets/assets";

/**
 * Agent bridge. The editor never calls a model itself: a prompt becomes a pending turn with
 * the context an agent needs (outline + only the scoped layers), and any agent — an in-app
 * provider later, an MCP client, or a test harness — answers with ops. Everything an agent
 * can do goes through the same op log as a person.
 */
export const estTokens = (s: string) => Math.max(1, Math.round(s.length / 3.8));

export interface PendingTurn { turnId: string; prompt: string; scope: string[]; outline: string; inspect: string; docValid: boolean }

export function sendPrompt(text: string): string {
  const st = useStore.getState();
  const scope = [...st.selection];
  st.addTurn({ role: "user", text, scope });
  const doc = st.doc;
  const ctx = `${outline(doc)}${scope.length ? "\n\n" + inspect(doc, scope) : ""}`;
  const agentName = st.agent?.name;
  return st.addTurn({
    role: "agent",
    text: agentName ? "" : "No AI agent is connected yet. Your request is queued — connect an agent (window.fusion.bridge) or paste ops below.",
    status: "waiting",
    scope,
    context: ctx,
    agent: agentName,
    tokens: { in: estTokens(ctx + text), out: 0 },
  });
}

function pending(): PendingTurn[] {
  const st = useStore.getState();
  return st.turns
    .filter((t) => t.role === "agent" && t.status === "waiting")
    .map((t) => {
      const i = st.turns.indexOf(t);
      const user = st.turns[i - 1];
      return { turnId: t.id, prompt: user?.text ?? "", scope: t.scope ?? [], outline: outline(st.doc), inspect: inspect(st.doc, t.scope ?? []), docValid: validate(st.doc).length === 0 };
    });
}

/** Stream an agent's ops into a reviewable preview, one op at a time. */
export async function respond(turnId: string, r: { message: string; ops?: Op[]; chips?: Chip[]; delayMs?: number }) {
  const st = useStore.getState();
  const turn = st.turns.find((t) => t.id === turnId);
  if (!turn) throw new Error(`no turn ${turnId}`);
  if (st.preview) st.keepPreview();
  const ops = r.ops ?? [];
  const out = estTokens(JSON.stringify(ops) + r.message);
  st.patchTurn(turnId, { status: ops.length ? "streaming" : "info", text: r.message, ops: [], agent: st.agent?.name ?? turn.agent, tokens: { in: turn.tokens?.in ?? 0, out } });
  const delay = r.delayMs ?? 140;
  for (let i = 0; i < ops.length; i++) {
    const so = ops.slice(0, i + 1);
    useStore.getState().startPreview(turnId, so);
    const pv = useStore.getState().preview!;
    useStore.getState().patchTurn(turnId, { ops: so, accepted: pv.accepted, opErrors: pv.opErrors });
    if (delay) await new Promise((res) => setTimeout(res, delay));
  }
  useStore.getState().patchTurn(turnId, { status: ops.length ? "review" : "info", chips: r.chips });
}

export function installBridge() {
  const api = {
    version: "0.1",
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
    importAssetFromUrl: async (url: string, name: string) => {
      const blob = await (await fetch(url)).blob();
      const file = new File([blob], name, { type: blob.type });
      const { id, entry } = await importAsset(file, Object.keys(useStore.getState().doc.assets));
      useStore.getState().commit([{ op: "set", path: `assets/${id}`, value: entry }], { source: "you", intent: `Imported ${name}` });
      return id;
    },
    time: { get: playhead.get, set: playhead.set, play: playhead.play, pause: playhead.pause },
    bridge: {
      connect(name: string) {
        useStore.getState().set("agent", { name, since: Date.now() });
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
  return api;
}
