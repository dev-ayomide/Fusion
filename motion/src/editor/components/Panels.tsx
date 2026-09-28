import { useEffect, useState } from "react";
import { insertTime } from "../reveal";
import { Doc as DocSchema, type Doc } from "../../fmd/schema";
import { validate, type Op } from "../../fmd/ops";
import { outline } from "../../fmd/outline";
import { assetUrl, importAsset } from "../../assets/assets";
import { useStore, useDisplayDoc } from "../store";
import { createLayerOps } from "../create";
import { findLayer, layerLabel } from "../edit";
import { Icon, TYPE_ICON } from "./ui";
import { estTokens } from "../bridge";

/* ------------------------------ layers ------------------------------ */
export function LayersPanel() {
  const doc = useDisplayDoc();
  const sel = useStore((s) => s.selection);
  const ai = useStore((s) => s.aiChanged);
  const [dragId, setDragId] = useState<string | null>(null);
  const now = Date.now();
  const ordered = [...doc.layers].reverse();
  const depthOf = (id: string): number => {
    const L = findLayer(doc, id);
    return L?.parent ? 1 + depthOf(L.parent) : 0;
  };
  const upload = async (files: FileList | null) => {
    if (!files) return;
    for (const f of [...files]) {
      if (!f.type.startsWith("image/")) continue;
      const st = useStore.getState();
      const { id, entry } = await importAsset(f, Object.keys(st.doc.assets));
      st.commit([{ op: "set", path: `assets/${id}`, value: entry }], { source: "you", intent: `Imported ${f.name}` });
    }
  };
  return (
    <aside className="panel left" aria-label="Layers and assets">
      <div className="panel-h">
        <span>Layers</span>
        <span>{doc.layers.length}</span>
      </div>
      <div className="scroll" style={{ padding: "0 6px 8px", flex: 1 }}>
        {ordered.map((L) => (
          <div
            key={L.id}
            role="button"
            tabIndex={0}
            draggable
            data-testid={`layer-${L.id}`}
            className={`layer-row${sel.includes(L.id) ? " sel" : ""}${now - (ai[L.id] ?? 0) < 4000 ? " ai" : ""}`}
            style={{ paddingLeft: 8 + depthOf(L.id) * 14, opacity: dragId === L.id ? 0.4 : 1 }}
            onClick={(e) => useStore.getState().select([L.id], e.shiftKey)}
            onKeyDown={(e) => e.key === "Enter" && useStore.getState().select([L.id])}
            onDragStart={() => setDragId(L.id)}
            onDragEnd={() => setDragId(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (!dragId || dragId === L.id) return;
              // dropped on a row = go just in front of it (lists are front-first)
              useStore.getState().commit([{ op: "ord", id: dragId, after: L.id }], { source: "you", intent: `Moved ${dragId} above ${L.id}` });
            }}
          >
            <span className="tbadge"><Icon name={TYPE_ICON[L.type]} sm /></span>
            <span className="nm">{layerLabel(L)}</span>
            <span className="ty">{L.type}</span>
            <button
              className={`iconbtn eye${L.hidden ? " off" : ""}`}
              style={{ width: 22, height: 22 }}
              aria-label={L.hidden ? `Show ${L.id}` : `Hide ${L.id}`}
              onClick={(e) => {
                e.stopPropagation();
                useStore.getState().commit([L.hidden ? { op: "del", path: `${L.id}/hidden` } : { op: "set", path: `${L.id}/hidden`, value: true }], { source: "you", intent: `${L.hidden ? "Showed" : "Hid"} ${L.id}` });
              }}
            >
              <Icon name={L.hidden ? "eyeoff" : "eye"} sm />
            </button>
          </div>
        ))}
      </div>
      <div className="panel-h">
        <span>Assets</span>
        <span>{Object.values(doc.assets).filter((a) => !a.mime.startsWith("audio/")).length}</span>
      </div>
      <div className="assets">
        {Object.entries(doc.assets).filter(([, a]) => !a.mime.startsWith("audio/")).map(([id, a]) => (
          <button
            key={id}
            className="asset"
            style={{ backgroundImage: assetUrl(id) ? `url(${assetUrl(id)})` : undefined }}
            title={`${a.name ?? id} — click to add, or drop onto a device`}
            onClick={() => {
              const st = useStore.getState();
              const selDev = st.selection.map((s) => findLayer(st.doc, s)).find((l) => l?.type === "device");
              const ops: Op[] = selDev ? [{ op: "set", path: `${selDev.id}/screen`, value: id }] : createLayerOps(st.doc, "image", insertTime(), { asset: id }).ops;
              st.commit(ops, { source: "you", intent: selDev ? `${id} on ${selDev.id} screen` : `Added ${id}` });
            }}
          >
            <span>{a.name ?? id}</span>
          </button>
        ))}
      </div>
      <label className="dropzone">
        <input type="file" accept="image/*" multiple hidden onChange={(e) => upload(e.target.files)} />
        <Icon name="upload" sm /> Upload images
      </label>
    </aside>
  );
}

/* ------------------------------- json ------------------------------- */
export function JsonPanel() {
  const doc = useDisplayDoc();
  const [view, setView] = useState<"json" | "outline">("json");
  const [text, setText] = useState(() => JSON.stringify(doc, null, 2));
  const [dirty, setDirty] = useState(false);
  const [errs, setErrs] = useState<string[]>([]);
  useEffect(() => {
    if (!dirty) setText(JSON.stringify(doc, null, 2));
  }, [doc, dirty]);
  const minified = JSON.stringify(doc);
  const apply = () => {
    let next: Doc;
    try {
      next = DocSchema.parse(JSON.parse(text));
    } catch (e) {
      setErrs([(e as Error).message.slice(0, 400)]);
      return;
    }
    const v = validate(next);
    if (v.length) return setErrs(v);
    // express the edit as ops so it lands in history and can be undone
    const cur = useStore.getState().doc;
    const ops: Op[] = [];
    for (const k of ["name", "comp", "brand", "assets", "markers", "style", "bindings"] as const)
      if (JSON.stringify(cur[k]) !== JSON.stringify(next[k])) ops.push({ op: "set", path: k, value: next[k] });
    for (const L of cur.layers) if (!next.layers.some((n) => n.id === L.id)) ops.push({ op: "del", path: L.id });
    for (const L of next.layers) {
      const old = cur.layers.find((c) => c.id === L.id);
      if (!old || JSON.stringify(old) !== JSON.stringify(L)) ops.push({ op: "set", path: L.id, value: L });
    }
    next.layers.forEach((L, i) => ops.push({ op: "ord", id: L.id, after: i === 0 ? null : next.layers[i - 1].id }));
    const r = useStore.getState().commit(ops, { source: "you", intent: "Edited JSON" });
    if (!r.ok) return setErrs(r.errors);
    setErrs([]);
    setDirty(false);
    useStore.getState().toast("JSON applied — one undo step");
  };
  return (
    <div className="tabpanel" data-testid="json-panel">
      <div className="json-meta">
        <div className="seg">
          <button aria-pressed={view === "json"} onClick={() => setView("json")}>Document</button>
          <button aria-pressed={view === "outline"} onClick={() => setView("outline")}>What the AI sees</button>
        </div>
        <span>{doc.layers.length} layers</span>
        <span>{(minified.length / 1024).toFixed(1)} KB</span>
        <span title="Estimated tokens for the whole video, minified">≈ {estTokens(minified).toLocaleString()} tok</span>
      </div>
      {view === "json" ? (
        <>
          <textarea
            className="json-edit"
            spellCheck={false}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setDirty(true);
            }}
            aria-label="Document JSON"
          />
          {errs.length > 0 && <div className="json-errs">{errs.map((e, i) => <div key={i}>{e}</div>)}</div>}
          <div style={{ display: "flex", gap: 8, padding: 10, borderTop: "1px solid var(--line)" }}>
            <button className="btn sm primary" disabled={!dirty} onClick={apply}>Apply JSON</button>
            <button className="btn sm" disabled={!dirty} onClick={() => { setDirty(false); setErrs([]); }}>Revert</button>
            <span className="spacer" />
            <button className="btn sm" onClick={() => navigator.clipboard?.writeText(JSON.stringify(doc, null, 2)).then(() => useStore.getState().toast("Copied document JSON"))}>
              <Icon name="copy" sm /> Copy
            </button>
          </div>
        </>
      ) : (
        <pre className="json-edit" style={{ whiteSpace: "pre-wrap" }}>{outline(doc)}{`\n\n≈ ${estTokens(outline(doc))} tokens — the model reads this, then asks for full JSON of only the layers it edits.`}</pre>
      )}
    </div>
  );
}

/* ------------------------------ history ----------------------------- */
export function HistoryPanel() {
  const past = useStore((s) => s.past);
  const future = useStore((s) => s.future);
  const fmt = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return (
    <div className="tabpanel">
      <div className="json-meta">
        <span>{past.length} steps · every change is a transaction of ops</span>
        <span className="spacer" />
        <button className="btn sm" disabled={!past.length} onClick={() => useStore.getState().undo()}><Icon name="undo" sm /> Undo</button>
        <button className="btn sm" disabled={!future.length} onClick={() => useStore.getState().redo()}><Icon name="redo" sm /> Redo</button>
      </div>
      <div className="scroll" style={{ padding: 12, display: "grid", gap: 6, alignContent: "start" }}>
        {[...future].reverse().map((t) => (
          <div key={t.id} className="hist-row future" title="Undone — redo to bring back">
            <span className={`src ${t.source}`}>{t.source}</span>
            <span>{t.intent}</span>
            <span className="faint mono" style={{ fontSize: 11 }}>{t.prims.length} ops</span>
          </div>
        ))}
        {[...past].reverse().map((t, i) => (
          <button key={t.id} className="hist-row" onClick={() => i > 0 && useStore.getState().undoTo(t.id)} title={i === 0 ? "Latest change" : "Undo everything after this"}>
            <span className={`src ${t.source}`}>{t.source === "ai" ? "AI" : t.source}</span>
            <span>{t.intent}</span>
            <span className="faint mono" style={{ fontSize: 11 }}>{fmt(t.ts)}</span>
          </button>
        ))}
        {!past.length && !future.length && <div className="hint">Nothing yet. Every edit — yours, the AI's, a slider — shows up here and can be undone.</div>}
      </div>
    </div>
  );
}
