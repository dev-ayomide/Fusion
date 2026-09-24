import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { playhead } from "../playhead";
import { TEMPLATES } from "../../templates";
import { Stage } from "../../render/stage";
import { fontsReady, ensureFont } from "../../render/glyphs";
import { importAsset } from "../../assets/assets";
import { exportVideo, downloadBlob, type ExportResult } from "../../export/export";
import { savedProject, clearSaved, restoreAssets } from "../persist";
import { sendPrompt } from "../bridge";
import type { Doc } from "../../fmd/schema";
import { Icon, Seg } from "./ui";

/* ------------------------------ top bar ----------------------------- */
export function TopBar() {
  const doc = useStore((s) => s.doc);
  const mode = useStore((s) => s.mode);
  const canUndo = useStore((s) => s.past.length > 0 || !!s.preview);
  const canRedo = useStore((s) => s.future.length > 0);
  const st = useStore.getState();
  return (
    <header className="topbar">
      <button className="brand" onClick={() => st.set("screen", "start")} title="Back to projects">
        <span className="brand-mark" />
        Fusion Motion
      </button>
      <input
        className="projname"
        aria-label="Project name"
        key={doc.name}
        defaultValue={doc.name ?? "Untitled"}
        onBlur={(e) => e.target.value !== doc.name && st.commit([{ op: "set", path: "name", value: e.target.value }], { source: "you", intent: `Renamed project` })}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
      <button className="iconbtn" disabled={!canUndo} onClick={() => st.undo()} title="Undo (⌘Z)" aria-label="Undo"><Icon name="undo" /></button>
      <button className="iconbtn" disabled={!canRedo} onClick={() => st.redo()} title="Redo (⇧⌘Z)" aria-label="Redo"><Icon name="redo" /></button>
      <div className="spacer" />
      <div title={mode === "novice" ? "Novice: chat, presets and vibe sliders" : "Pro: layers, keyframes, behaviors, expressions, JSON"}>
        <Seg value={mode} label="Editor mode" options={[{ v: "novice", l: "Simple" }, { v: "pro", l: "Pro" }]} onChange={(m) => st.setMode(m)} />
      </div>
      <button className="iconbtn" onClick={() => st.set("helpOpen", true)} title="Keyboard shortcuts (?)" aria-label="Shortcuts"><Icon name="help" /></button>
      <button className="btn primary" onClick={() => st.set("exportOpen", true)} data-testid="export-open">
        <Icon name="export" sm /> Export
      </button>
    </header>
  );
}

/* ---------------------------- start screen --------------------------- */
function useThumbnails(): Record<string, string> {
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const canvas = document.createElement("canvas");
      const stage = new Stage(canvas, { preserveDrawingBuffer: true });
      stage.setSize(480, 270, 1);
      stage.textResolution = 1;
      const docs = TEMPLATES.map((t) => t.make());
      for (const d of docs) for (const L of d.layers) if (L.type === "text") ensureFont(L.font ?? d.brand.font, L.weight ?? 600);
      await fontsReady();
      await new Promise((r) => setTimeout(r, 150));
      const out: Record<string, string> = {};
      TEMPLATES.forEach((t, i) => {
        const d = docs[i];
        const at = t.id === "blank" ? 0 : Math.min(d.comp.dur - 0.2, 3.6);
        stage.renderFrame(d, at, { samples: 1 });
        stage.renderFrame(d, at, { samples: 1 });
        out[t.id] = canvas.toDataURL("image/jpeg", 0.85);
      });
      stage.dispose();
      if (!cancelled) setThumbs(out);
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return thumbs;
}

export function StartScreen() {
  const thumbs = useThumbnails();
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const saved = savedProject();
  const open = (doc: Doc) => {
    const st = useStore.getState();
    st.loadDoc(doc);
    st.set("screen", "editor");
    playhead.set(0);
  };
  const begin = async () => {
    const tpl = TEMPLATES.find((t) => t.id === "blank")!;
    const doc = tpl.make();
    doc.name = text.trim().split(/[.,\n]/)[0].slice(0, 40) || "Untitled";
    open(doc);
    const st = useStore.getState();
    const ops = [];
    for (const f of files) {
      const { id, entry } = await importAsset(f, Object.keys(st.doc.assets).concat(ops.map((o) => o.path.split("/")[1])));
      ops.push({ op: "set" as const, path: `assets/${id}`, value: entry });
    }
    if (ops.length) st.commit(ops, { source: "you", intent: `Imported ${ops.length} image${ops.length > 1 ? "s" : ""}` });
    st.setTab("assistant");
    if (text.trim()) sendPrompt(text.trim());
  };
  return (
    <div className="start" data-testid="start">
      <div className="start-inner">
        <div className="brand" style={{ fontSize: 15 }}>
          <span className="brand-mark" /> Fusion Motion
        </div>
        <div>
          <h1>Motion graphics you can talk to.</h1>
          <p className="lede">Describe it, drop in your logo or app screenshots, and the AI builds an editable timeline — not a video you can't change. Tweak it with sliders, or open Pro mode for keyframes.</p>
        </div>
        <div className="prompt-card">
          <textarea
            placeholder="A 6-second launch promo for my budgeting app. Dark, premium, phone floating in 3D, headline “Money, made calm.”"
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label="Describe your video"
            onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && begin()}
          />
          <div className="prompt-row">
            <label className="attach">
              <input type="file" accept="image/*" multiple hidden onChange={(e) => setFiles([...files, ...[...(e.target.files ?? [])]])} data-testid="start-upload" />
              <Icon name="image" sm /> Add logo or screenshots
            </label>
            <div className="thumbs">
              {files.map((f, i) => (
                <img key={i} src={URL.createObjectURL(f)} alt={f.name} title={f.name} />
              ))}
            </div>
            <div className="spacer" />
            <span className="faint" style={{ fontSize: 12 }}>⌘↵</span>
            <button className="btn ai" onClick={begin} disabled={!text.trim() && !files.length} data-testid="start-create">
              <Icon name="sparkle" sm /> Create with AI
            </button>
          </div>
        </div>
        {saved && (
          <div className="resume">
            <Icon name="frame" />
            <div style={{ flex: 1 }}>
              <b>{saved.doc.name ?? "Untitled"}</b>
              <div className="faint" style={{ fontSize: 12 }}>
                Last edited {new Date(saved.savedAt).toLocaleString()} · {saved.doc.layers.length} layers
              </div>
            </div>
            <button className="btn sm" onClick={() => { clearSaved(); location.reload(); }}>Forget</button>
            <button className="btn sm primary" onClick={() => { open(saved.doc); void restoreAssets(saved.doc); }} data-testid="resume">Continue</button>
          </div>
        )}
        <div className="section-h">
          <h2>Or start from a template</h2>
          <span className="faint" style={{ fontSize: 12 }}>Every template is plain JSON you can reshape</span>
        </div>
        <div className="tpl-grid">
          {TEMPLATES.map((t) => (
            <button key={t.id} className="tpl" onClick={() => open(t.make())} data-testid={`tpl-${t.id}`}>
              <div className="thumb" style={{ backgroundImage: thumbs[t.id] ? `url(${thumbs[t.id]})` : undefined }} />
              <div className="meta">
                <b>{t.title}</b>
                <span>{t.blurb}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ export ------------------------------ */
export function ExportDialog() {
  const doc = useStore((s) => s.doc);
  const [format, setFormat] = useState<"mp4" | "webm">("mp4");
  const [height, setHeight] = useState(1080);
  const [quality, setQuality] = useState<"standard" | "high">("high");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<(ExportResult & { url: string }) | null>(null);
  const [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);
  const close = () => {
    abort.current?.abort();
    useStore.getState().set("exportOpen", false);
  };
  const run = async () => {
    setError("");
    setResult(null);
    setProgress({ done: 0, total: 1 });
    abort.current = new AbortController();
    try {
      const st = useStore.getState();
      if (st.preview) st.keepPreview();
      const r = await exportVideo(useStore.getState().doc, { format, height, quality, onProgress: (done, total) => setProgress({ done, total }), signal: abort.current.signal });
      const url = URL.createObjectURL(r.blob);
      setResult({ ...r, url });
      (window as unknown as { __lastExport: ExportResult }).__lastExport = r;
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setProgress(null);
    }
  };
  const w = Math.round((height * doc.comp.w) / doc.comp.h / 2) * 2;
  const fname = `${(doc.name ?? "fusion-motion").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && !progress && close()}>
      <div className="dialog" role="dialog" aria-label="Export video" data-testid="export-dialog">
        <div style={{ display: "flex", alignItems: "center" }}>
          <h2>Export video</h2>
          <div className="spacer" />
          <button className="iconbtn" onClick={close} aria-label="Close"><Icon name="x" /></button>
        </div>
        {!result && (
          <>
            <div className="row">
              <span className="muted">Format</span>
              <Seg value={format} options={[{ v: "mp4", l: "MP4" }, { v: "webm", l: "WebM" }]} onChange={setFormat} />
            </div>
            <div className="row">
              <span className="muted">Resolution</span>
              <Seg value={String(height) as "1080"} options={[{ v: "720", l: "720p" }, { v: "1080", l: "1080p" }, { v: "2160", l: "4K" }]} onChange={(v) => setHeight(Number(v))} />
            </div>
            <div className="row">
              <span className="muted">Quality</span>
              <Seg value={quality} options={[{ v: "standard", l: "Standard" }, { v: "high", l: "High" }]} onChange={setQuality} />
            </div>
            <div className="hint">
              {w}×{Math.round(height / 2) * 2} · {doc.comp.fps} fps · {doc.comp.dur}s · {Math.round(doc.comp.dur * doc.comp.fps)} frames. Rendered frame-by-frame in your browser with the same renderer as the preview — nothing is uploaded.
            </div>
          </>
        )}
        {progress && (
          <div style={{ display: "grid", gap: 6 }}>
            <div className="progress"><i style={{ width: `${(progress.done / progress.total) * 100}%` }} /></div>
            <span className="faint mono" style={{ fontSize: 11 }}>
              Frame {progress.done} / {progress.total}
            </span>
          </div>
        )}
        {error && <div className="warn" style={{ color: "var(--danger)" }}>{error}</div>}
        {result && (
          <>
            <video src={result.url} controls autoPlay loop muted playsInline data-testid="export-video" />
            <div className="hint mono" data-testid="export-info">
              {result.ext.replace(".", "").toUpperCase()} · {result.codec.toUpperCase()} · {result.width}×{result.height} · {result.frames} frames · {(result.blob.size / 1024 / 1024).toFixed(2)} MB · {(result.ms / 1000).toFixed(1)}s to render
            </div>
          </>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          {result ? (
            <>
              <button className="btn" onClick={() => setResult(null)}>Export again</button>
              <button className="btn primary" onClick={() => downloadBlob(result.blob, fname + result.ext)} data-testid="download">
                <Icon name="export" sm /> Download
              </button>
            </>
          ) : progress ? (
            <button className="btn" onClick={() => abort.current?.abort()}>Cancel</button>
          ) : (
            <button className="btn primary" onClick={run} data-testid="export-run">
              Render {format.toUpperCase()}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ help -------------------------------- */
const KEYS: [string, string][] = [
  ["Space", "Play / pause"],
  ["← / →", "Previous / next frame (⇧ ×10)"],
  ["Home / End", "Start / end"],
  ["⌘Z / ⇧⌘Z", "Undo / redo"],
  ["⌫", "Delete selected layer or key"],
  ["⌘D", "Duplicate layer"],
  ["T", "Add text"],
  ["R / E", "Add rectangle / ellipse"],
  ["[ / ]", "Move layer start / end to playhead"],
  ["S", "Toggle split view"],
  ["P", "Toggle Simple / Pro"],
  ["F9", "Easy Ease the selected key (⇧F9 in · ⌘⇧F9 out)"],
  ["⇧F3", "Graph editor"],
  ["J / K", "Previous / next keyframe"],
  ["U", "Reveal animated properties"],
  ["/", "Ask the AI"],
  ["Esc", "Deselect"],
  ["?", "This list"],
];
export function HelpDialog() {
  return (
    <div className="scrim" onClick={() => useStore.getState().set("helpOpen", false)}>
      <div className="dialog" role="dialog" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <h2>Keyboard shortcuts</h2>
          <div className="spacer" />
          <button className="iconbtn" onClick={() => useStore.getState().set("helpOpen", false)} aria-label="Close"><Icon name="x" /></button>
        </div>
        <div className="help-grid">
          {KEYS.map(([k, v]) => (
            <div key={k}>
              <span>{v}</span>
              <span className="kbd">{k}</span>
            </div>
          ))}
        </div>
        <div className="hint">Numbers: drag the ↔ handle next to any field to scrub · Shift ×10 · Alt ×0.1. Timeline: ⌘ + wheel zooms, Alt while dragging disables snapping.</div>
      </div>
    </div>
  );
}
