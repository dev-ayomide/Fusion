import { useEffect } from "react";
import { useStore } from "./store";
import { playhead } from "./playhead";
import { TopBar, ExportDialog, HelpDialog } from "./components/Shell";
import { StartScreen } from "./components/Landing";
import { Viewport } from "./components/Viewport";
import { Timeline } from "./components/Timeline";
import { Inspector } from "./components/Inspector";
import { Assistant } from "./components/Assistant";
import { LayersPanel, JsonPanel, HistoryPanel } from "./components/Panels";
import { createLayerOps } from "./create";
import { deleteOps, duplicateOps, easeKeyOps, findLayer } from "./edit";
import type { Tab } from "./store";

function RightPanel() {
  const tab = useStore((s) => s.tab);
  const mode = useStore((s) => s.mode);
  const pending = useStore((s) => s.turns.filter((t) => t.status === "review").length);
  const tabs: { id: Tab; label: string }[] = [
    { id: "assistant", label: "Assistant" },
    { id: "inspect", label: mode === "pro" ? "Inspect" : "Edit" },
    ...(mode === "pro" ? [{ id: "json" as Tab, label: "JSON" }] : []),
    { id: "history", label: "History" },
  ];
  return (
    <aside className="panel right" aria-label="Assistant and inspector">
      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => useStore.getState().setTab(t.id)} data-testid={`tab-${t.id}`}>
            {t.label}
            {t.id === "assistant" && pending > 0 && <span className="count">{pending}</span>}
          </button>
        ))}
      </div>
      <div className="tabpanel scroll" style={{ display: tab === "inspect" ? "block" : "none" }}>
        {tab === "inspect" && <Inspector />}
      </div>
      {tab === "assistant" && <Assistant />}
      {tab === "json" && <JsonPanel />}
      {tab === "history" && <HistoryPanel />}
    </aside>
  );
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState();
      if (st.screen !== "editor") return;
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        if (typing) return;
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        st.redo();
        return;
      }
      if (typing) return;
      const fps = st.doc.comp.fps;
      const t = playhead.get();
      const one = st.selection.length === 1 ? findLayer(st.doc, st.selection[0]) : undefined;
      const add = (kind: Parameters<typeof createLayerOps>[1]) => {
        const { ops, id } = createLayerOps(st.doc, kind, t);
        if (st.commit(ops, { source: "you", intent: `Added ${id}` }).ok) st.select([id]);
      };
      // After Effects keyframe assistants and navigation
      if (e.key === "F9") {
        e.preventDefault();
        const k = st.keySel;
        if (!k) return st.toast("Select a keyframe first (Pro mode, expand a layer)");
        const mode = mod && e.shiftKey ? "out" : e.shiftKey ? "in" : "easy";
        const ops = easeKeyOps(st.doc, k, mode);
        if (ops.length) st.commit(ops, { source: "you", intent: mode === "easy" ? "Easy Ease" : mode === "in" ? "Easy Ease In" : "Easy Ease Out" });
        return;
      }
      if (e.key === "F3" && e.shiftKey) {
        e.preventDefault();
        st.set("graphOpen", !st.graphOpen);
        return;
      }
      switch (true) {
        case (e.key === "j" || e.key === "k") && !mod: {
          // previous / next keyframe of the selection (or of everything)
          const ids = st.selection.length ? st.selection : st.doc.layers.map((l) => l.id);
          const times = new Set<number>();
          for (const L of st.doc.layers) if (ids.includes(L.id)) for (const tr of Object.values(L.keys ?? {})) for (const kf of tr) times.add(Math.round(((L.in ?? 0) + kf[0]) * fps) / fps);
          const sorted = [...times].sort((x, y) => x - y);
          const target = e.key === "k" ? sorted.find((x) => x > t + 1e-4) : [...sorted].reverse().find((x) => x < t - 1e-4);
          if (target !== undefined) {
            playhead.pause();
            playhead.set(target);
          }
          break;
        }
        case e.key === "u" && !mod: {
          // reveal animated properties of the selection (AE: U)
          if (st.mode !== "pro") st.setMode("pro");
          const keyed = st.doc.layers.filter((l) => st.selection.includes(l.id) && Object.keys(l.keys ?? {}).length);
          const open = keyed.some((l) => !st.expanded[l.id]);
          for (const l of keyed) if (!!st.expanded[l.id] !== open) st.toggleExpanded(l.id);
          break;
        }
        case e.code === "Space":
          e.preventDefault();
          playhead.toggle();
          break;
        case e.key === "ArrowRight":
          e.preventDefault();
          playhead.pause();
          playhead.set(Math.round((t + (e.shiftKey ? 10 : 1) / fps) * fps) / fps);
          break;
        case e.key === "ArrowLeft":
          e.preventDefault();
          playhead.pause();
          playhead.set(Math.max(0, Math.round((t - (e.shiftKey ? 10 : 1) / fps) * fps) / fps));
          break;
        case e.key === "Home":
          playhead.set(0);
          break;
        case e.key === "End":
          playhead.set(st.doc.comp.dur);
          break;
        case e.key === "Backspace" || e.key === "Delete": {
          e.preventDefault();
          const k = st.keySel;
          if (k) {
            const L = findLayer(st.doc, k.layer);
            const tr = L?.keys?.[k.channel];
            if (L && tr) {
              const ops = tr.length > 1 ? [{ op: "key" as const, path: `${L.id}/keys/${k.channel}`, keys: tr.filter((_, i) => i !== k.index) as [number, number, string?][] }] : [{ op: "del" as const, path: `${L.id}/keys/${k.channel}` }];
              st.commit(ops, { source: "you", intent: `Deleted ${k.channel} key` });
              st.setKeySel(null);
            }
          } else if (st.selection.length) {
            st.commit(deleteOps(st.doc, st.selection), { source: "you", intent: `Deleted ${st.selection.join(", ")}` });
            st.select([]);
          }
          break;
        }
        case mod && e.key.toLowerCase() === "d": {
          e.preventDefault();
          if (one) {
            const d = duplicateOps(st.doc, one.id);
            if (d && st.commit(d.ops, { source: "you", intent: `Duplicated ${one.id}` }).ok) st.select([d.newId]);
          }
          break;
        }
        case mod && e.key.toLowerCase() === "e":
          e.preventDefault();
          st.set("exportOpen", true);
          break;
        case mod:
          break;
        case e.key === "t":
          add("text");
          break;
        case e.key === "r":
          add("rect");
          break;
        case e.key === "e":
          add("ellipse");
          break;
        case e.key === "s":
          st.setView(st.view === "split" ? "shot" : "split");
          break;
        case e.key === "p":
          st.setMode(st.mode === "pro" ? "novice" : "pro");
          break;
        case e.key === "[" && !!one: {
          const d = Math.round((t - (one!.in ?? 0)) * 1000) / 1000;
          st.commit([{ op: "set", path: `${one!.id}/in`, value: Math.max(0, (one!.in ?? 0) + d) }], { source: "you", intent: `${one!.id} starts at playhead` });
          break;
        }
        case e.key === "]" && !!one:
          st.commit([{ op: "set", path: `${one!.id}/out`, value: Math.round(Math.max(t, (one!.in ?? 0) + 0.1) * 1000) / 1000 }], { source: "you", intent: `${one!.id} ends at playhead` });
          break;
        case e.key === "/":
          e.preventDefault();
          st.setTab("assistant");
          setTimeout(() => document.getElementById("prompt")?.focus(), 20);
          break;
        case e.key === "?":
          st.set("helpOpen", true);
          break;
        case e.key === "Escape":
          st.select([]);
          st.set("helpOpen", false);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

function Toast() {
  const n = useStore((s) => s.notice);
  if (!n) return null;
  return (
    <div className={`toast${n.kind === "error" ? " error" : ""}`} role="status" data-testid="toast">
      {n.text}
    </div>
  );
}

export function App() {
  const screen = useStore((s) => s.screen);
  const mode = useStore((s) => s.mode);
  const exportOpen = useStore((s) => s.exportOpen);
  const helpOpen = useStore((s) => s.helpOpen);
  useShortcuts();
  if (screen === "start")
    return (
      <>
        <StartScreen />
        <Toast />
      </>
    );
  return (
    <div className={`app ${mode}`} data-testid="editor">
      <TopBar />
      <div className="main">
        <LayersPanel />
        <Viewport />
        <RightPanel />
      </div>
      <Timeline />
      {exportOpen && <ExportDialog />}
      {helpOpen && <HelpDialog />}
      <Toast />
    </div>
  );
}
