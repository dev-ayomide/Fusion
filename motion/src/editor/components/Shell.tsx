import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useStore } from "../store";
import { getSaveState, subscribeSaveState } from "../persist";
import { BrandMark } from "./Brand";
import { exportVideo, downloadBlob, type ExportResult } from "../../export/export";
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
      <button className="tb-home" onClick={() => st.set("screen", "start")} title="All videos" aria-label="Back to your videos" data-testid="home">
        <BrandMark size={22} />
        <span className="tb-home-label">Your videos</span>
      </button>
      <span className="tb-sep" aria-hidden="true">/</span>
      <input
        className="projname tb-name"
        aria-label="Project name"
        key={doc.name}
        defaultValue={doc.name ?? "Untitled"}
        size={Math.min(36, Math.max(8, (doc.name ?? "Untitled").length + 1))}
        onBlur={(e) => {
          const v = e.target.value.trim() || "Untitled";
          if (v !== (doc.name ?? "Untitled")) st.commit([{ op: "set", path: "name", value: v }], { source: "you", intent: `Renamed project` });
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            (e.target as HTMLInputElement).value = doc.name ?? "Untitled";
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      <SaveBadge />
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

function SaveBadge() {
  const state = useSyncExternalStore(subscribeSaveState, getSaveState, getSaveState);
  if (state === "idle") return null;
  return (
    <span className={`tb-save ${state}`} role="status" aria-live="polite" title="Your videos are saved in this browser">
      {state === "saving" ? "Saving…" : "Saved"}
    </span>
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !progress && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [progress]);
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
            <video src={result.url} controls autoPlay loop muted={!result.audio} playsInline data-testid="export-video" />
            <div className="hint mono" data-testid="export-info">
              {result.ext.replace(".", "").toUpperCase()} · {result.codec.toUpperCase()} · {result.width}×{result.height} · {result.frames} frames · {(result.blob.size / 1024 / 1024).toFixed(2)} MB · {(result.ms / 1000).toFixed(1)}s to render
              {result.audio && ` · ${result.audio.codec.toUpperCase()} audio (${result.audio.tracks} track${result.audio.tracks > 1 ? "s" : ""})`}
            </div>
            {result.audioNote && <div className="warn" data-testid="export-audio-note">{result.audioNote}</div>}
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
