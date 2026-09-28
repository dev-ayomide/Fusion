import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Stage } from "../../render/stage";
import { evaluate, trackValue } from "../../runtime/evaluate";
import { applyTxn, type Op } from "../../fmd/ops";
import { useStore, displayDoc, useDisplayDoc } from "../store";
import { playhead } from "../playhead";
import { onFontsChanged } from "../../render/glyphs";
import { onEnvReady } from "../../render/env";
import { onHtmlReady } from "../../render/html";
import { onAssetsChanged, importAsset, LIBRARY, libraryUrl, isAudioFile } from "../../assets/assets";
import { uploadAudio } from "../../audio/actions";
import { setChannelOps, findLayer, localTime, uniqueId } from "../edit";
import { createLayerOps, type NewKind } from "../create";
import { Icon } from "./ui";

interface Rect { x: number; y: number; w: number; h: number }

/** Fit the comp aspect into an area (CSS px), leaving room for the toolbars. */
function fit(area: Rect, aspect: number): Rect {
  let w = area.w, h = w / aspect;
  if (h > area.h) {
    h = area.h;
    w = h * aspect;
  }
  return { x: area.x + (area.w - w) / 2, y: area.y + (area.h - h) / 2, w, h };
}

export function Viewport() {
  const wrap = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const shotRect = useRef<Rect>({ x: 0, y: 0, w: 1, h: 1 });
  const sceneRect = useRef<Rect | null>(null);
  const sceneCam = useRef(new THREE.PerspectiveCamera(40, 1, 1, 60000));
  const orbit = useRef({ theta: 0.75, phi: 1.2, r: 4200, target: new THREE.Vector3(0, 0, 0) });
  const hover = useRef<string | null>(null);
  /** the layer being resized from a corner handle, and its current scale (shown in the label) */
  const resizing = useRef<{ id: string; scale: number } | null>(null);
  const raf = useRef(0);
  const doc = useDisplayDoc();
  const view = useStore((s) => s.view);
  const selection = useStore((s) => s.selection);
  const preview = useStore((s) => s.preview);
  const mode = useStore((s) => s.mode);
  const [dropping, setDropping] = useState(false);
  const [menu, setMenu] = useState<null | "shape" | "device" | "cloner" | "fx" | "lib">(null);

  /**
   * Dynamic resolution while playing: time between drawn frames drives a render-scale in
   * 0.4…1 (in 0.1 steps, so render targets aren't reallocated every frame). Paused frames
   * always render at full quality, so what you stop on is exactly what exports.
   */
  const perf = useRef({ scale: 1, last: 0, ema: 16 });
  const requestRender = () => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      draw();
    });
  };

  function draw() {
    const stage = stageRef.current;
    const el = wrap.current;
    if (!stage || !el) return;
    const d = displayDoc();
    const W = el.clientWidth, H = el.clientHeight;
    const playing = playhead.isPlaying();
    const now = performance.now();
    const pf = perf.current;
    if (playing && pf.last) {
      pf.ema = pf.ema * 0.8 + Math.min(500, now - pf.last) * 0.2;
      if (pf.ema > 40 && pf.scale > 0.4) pf.scale = Math.round((pf.scale - 0.1) * 10) / 10;
      else if (pf.ema < 24 && pf.scale < 1) pf.scale = Math.round((pf.scale + 0.1) * 10) / 10;
    }
    pf.last = playing ? now : 0;
    const baseDpr = Math.min(2, window.devicePixelRatio || 1);
    const dpr = baseDpr * (playing ? pf.scale : 1);
    const size = stage.renderer.getSize(new THREE.Vector2());
    if (size.x !== W || size.y !== H || stage.renderer.getPixelRatio() !== dpr) stage.setSize(W, H, dpr);
    stage.textResolution = Math.max(1.5, baseDpr * 1.2); // glyphs don't re-rasterise when the scale moves
    const aspect = d.comp.w / d.comp.h;
    const st = useStore.getState();
    const split = st.view === "split" && W > 700;
    const pad = { t: 48, b: 70, s: 20 };
    const area: Rect = split ? { x: W / 2 + 6, y: pad.t, w: W / 2 - pad.s - 6, h: H - pad.t - pad.b } : { x: pad.s, y: pad.t, w: W - pad.s * 2, h: H - pad.t - pad.b };
    const shot = fit(area, aspect);
    shotRect.current = shot;
    const t = playhead.get();
    stage.sync(d, evaluate(d, t));
    const r = stage.renderer;
    r.setScissorTest(false);
    r.setClearColor(0xf4f3f6, 1);
    r.clear();
    const toGL = (rc: Rect) => ({ x: rc.x, y: H - rc.y - rc.h, w: rc.w, h: rc.h });
    if (split) {
      const sr: Rect = { x: pad.s, y: pad.t, w: W / 2 - pad.s - 6, h: H - pad.t - pad.b };
      sceneRect.current = sr;
      const o = orbit.current;
      const cam = sceneCam.current;
      cam.aspect = sr.w / sr.h;
      cam.position.set(o.target.x + o.r * Math.sin(o.phi) * Math.sin(o.theta), o.target.y + o.r * Math.cos(o.phi), o.target.z + o.r * Math.sin(o.phi) * Math.cos(o.theta));
      cam.lookAt(o.target);
      cam.updateProjectionMatrix();
      stage.renderSceneView(cam, toGL(sr));
    } else sceneRect.current = null;
    stage.renderFrame(d, t, { rect: toGL(shot), samples: playing ? (perf.current.scale < 0.8 ? 1 : 4) : undefined });
    drawOverlay(stage, shot, st.selection, st.preview !== null);
  }

  function drawOverlay(stage: Stage, shot: Rect, sel: string[], previewing: boolean) {
    const ov = overlay.current;
    if (!ov) return;
    const boxes: string[] = [`<div class="shotframe" style="left:${shot.x}px;top:${shot.y}px;width:${shot.w}px;height:${shot.h}px"></div>`];
    const now = Date.now();
    const ai = useStore.getState().aiChanged;
    const ids = new Set(sel);
    if (previewing) for (const [id, ts] of Object.entries(ai)) if (now - ts < 6000) ids.add(id);
    for (const id of ids) {
      const b = stage.bounds(id);
      if (!b) continue;
      const isAi = !sel.includes(id);
      const rz = resizing.current?.id === id ? ` · ${Math.round(resizing.current.scale * 100)}%` : "";
      boxes.push(`<div class="selbox${isAi ? " ai" : ""}" style="left:${shot.x + b.x * shot.w}px;top:${shot.y + b.y * shot.h}px;width:${b.w * shot.w}px;height:${b.h * shot.h}px"><span class="lbl">${id}${rz}</span><i class="h tl"></i><i class="h tr"></i><i class="h bl"></i><i class="h br"></i></div>`);
    }
    if (hover.current && !ids.has(hover.current) && !playhead.isPlaying()) {
      const b = stage.bounds(hover.current);
      if (b) boxes.push(`<div class="hoverbox" style="left:${shot.x + b.x * shot.w}px;top:${shot.y + b.y * shot.h}px;width:${b.w * shot.w}px;height:${b.h * shot.h}px"></div>`);
    }
    ov.innerHTML = boxes.join("");
  }

  useEffect(() => {
    const stage = new Stage(canvasRef.current!, { preserveDrawingBuffer: true });
    stageRef.current = stage;
    (window as unknown as { __stage: Stage }).__stage = stage;
    // geometry hook for tests: screen-space centre of a layer as the shot camera sees it
    (window as unknown as Record<string, unknown>).__viewport = {
      center: (id: string) => {
        const b = stageRef.current?.bounds(id);
        const r = wrap.current?.getBoundingClientRect();
        const s = shotRect.current;
        if (!b || !r) return null;
        return { x: r.left + s.x + (b.x + b.w / 2) * s.w, y: r.top + s.y + (b.y + b.h / 2) * s.h };
      },
    };
    const offs = [playhead.subscribe(requestRender), playhead.subscribePlaying(requestRender), onFontsChanged(requestRender), onAssetsChanged(requestRender), onEnvReady(requestRender), onHtmlReady(requestRender)];
    const ro = new ResizeObserver(requestRender);
    ro.observe(wrap.current!);
    requestRender();
    return () => {
      offs.forEach((f) => f());
      ro.disconnect();
      cancelAnimationFrame(raf.current);
      stage.dispose();
      stageRef.current = null;
    };
  }, []);
  useEffect(requestRender, [doc, view, selection, preview, mode]);

  /* ---------------------------- pointer ---------------------------- */
  const inRect = (x: number, y: number, r: Rect | null) => !!r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  const pickAt = (x: number, y: number): string | null => {
    const s = shotRect.current;
    const stage = stageRef.current;
    if (!stage || !inRect(x, y, s)) return null;
    const id = stage.pick(((x - s.x) / s.w) * 2 - 1, -(((y - s.y) / s.h) * 2 - 1));
    const L = id ? findLayer(displayDoc(), id) : null;
    return L && !L.locked ? id : null;
  };
  /** A corner handle of a selected layer under (x, y): the layer and its on-screen centre. */
  const handleAt = (x: number, y: number): { id: string; cx: number; cy: number; corner: "nwse" | "nesw" } | null => {
    const stage = stageRef.current;
    const s = shotRect.current;
    if (!stage || playhead.isPlaying()) return null;
    for (const id of useStore.getState().selection) {
      const L = findLayer(displayDoc(), id);
      if (!L || L.locked || L.type === "gradient" || L.type === "camera" || L.type === "sky" || L.type === "adjust") continue;
      const b = stage.bounds(id);
      if (!b) continue;
      const x0 = s.x + b.x * s.w, y0 = s.y + b.y * s.h, x1 = x0 + b.w * s.w, y1 = y0 + b.h * s.h;
      for (const [hx, hy, corner] of [[x0, y0, "nwse"], [x1, y1, "nwse"], [x1, y0, "nesw"], [x0, y1, "nesw"]] as const)
        if (Math.abs(x - hx) <= 9 && Math.abs(y - hy) <= 9) return { id, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, corner };
    }
    return null;
  };

  const local = (e: { clientX: number; clientY: number }) => {
    const r = wrap.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    setMenu(null);
    const { x, y } = local(e);
    const st = useStore.getState();
    if (inRect(x, y, sceneRect.current)) {
      // orbit the scene camera
      const o = orbit.current;
      const x0 = e.clientX, y0 = e.clientY, th0 = o.theta, ph0 = o.phi;
      const move = (ev: PointerEvent) => {
        o.theta = th0 - (ev.clientX - x0) * 0.006;
        o.phi = Math.min(3.0, Math.max(0.15, ph0 - (ev.clientY - y0) * 0.006));
        requestRender();
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      return;
    }
    // drag a corner handle to resize, keeping proportions, around the layer's centre
    const hd = handleAt(x, y);
    if (hd) {
      const base = st.doc;
      const L = findLayer(base, hd.id)!;
      const t = playhead.get();
      const s0 = trackValue(base, L, "scale", localTime(base, L, t)) || 1;
      const d0 = Math.max(4, Math.hypot(x - hd.cx, y - hd.cy));
      let ops: Op[] = [];
      (e.target as Element).setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => {
        const p = local(ev);
        const raw = Math.max(0.05, s0 * (Math.hypot(p.x - hd.cx, p.y - hd.cy) / d0));
        const sc = ev.altKey ? Math.round(raw * 1000) / 1000 : Math.round(raw * 100) / 100;
        resizing.current = { id: hd.id, scale: sc };
        ops = setChannelOps(base, L, "scale", sc, t);
        const r = applyTxn(base, ops, { source: "you", validate: false });
        if (r.ok) useStore.getState().setTransient(r.doc);
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        resizing.current = null;
        if (ops.length) {
          const r = useStore.getState().commit(ops, { source: "you", intent: `Resized ${hd.id}` });
          if (!r.ok) useStore.getState().toast(r.errors[0], "error");
        }
        useStore.getState().setTransient(null);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      return;
    }
    const id = pickAt(x, y);
    if (!id) {
      if (!e.shiftKey) st.select([]);
      return;
    }
    const alreadySel = st.selection.includes(id);
    if (e.shiftKey) st.select([id], true);
    else if (!alreadySel) st.select([id]);
    const ids = e.shiftKey ? useStore.getState().selection : alreadySel ? st.selection : [id];
    const base = st.doc;
    const t = playhead.get();
    const stage = stageRef.current!;
    const k = stage.worldPerScreen(shotRect.current.h);
    const x0 = e.clientX, y0 = e.clientY;
    let moved = false;
    let ops: Op[] = [];
    (e.target as Element).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) * k, dy = -(ev.clientY - y0) * k;
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 3) return;
      moved = true;
      ops = [];
      for (const lid of ids) {
        const L = findLayer(base, lid);
        if (!L || L.type === "gradient" || L.type === "camera" || L.locked) continue;
        const loc = localTime(base, L, t);
        const snap = (v: number) => (ev.altKey ? v : Math.round(v));
        ops.push(...setChannelOps(base, L, "pos.x", snap(trackValue(base, L, "pos.x", loc) + dx), t));
        ops.push(...setChannelOps(base, L, "pos.y", snap(trackValue(base, L, "pos.y", loc) + dy), t));
      }
      const r = applyTxn(base, ops, { source: "you", validate: false });
      if (r.ok) useStore.getState().setTransient(r.doc);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (moved && ops.length) {
        const r = useStore.getState().commit(ops, { source: "you", intent: `Moved ${ids.join(", ")}` });
        if (!r.ok) useStore.getState().toast(r.errors[0], "error");
      }
      useStore.getState().setTransient(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (e.buttons) return;
    const { x, y } = local(e);
    const hd = handleAt(x, y);
    const id = pickAt(x, y);
    if (id !== hover.current) {
      hover.current = id;
      requestRender();
    }
    (e.currentTarget as HTMLElement).style.cursor = hd ? `${hd.corner}-resize` : id ? "move" : inRect(x, y, sceneRect.current) ? "grab" : "default";
  };

  const onWheel = (e: React.WheelEvent) => {
    const { x, y } = local(e);
    if (inRect(x, y, sceneRect.current)) {
      orbit.current.r = Math.min(20000, Math.max(600, orbit.current.r * (1 + e.deltaY * 0.001)));
      requestRender();
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const { x, y } = local(e);
    const id = pickAt(x, y);
    if (!id) return;
    const L = findLayer(displayDoc(), id);
    useStore.getState().select([id]);
    useStore.getState().setTab("inspect");
    if (L?.type === "text") setTimeout(() => (document.getElementById("insp-text") as HTMLTextAreaElement | null)?.focus(), 50);
  };

  /* ------------------------------ add ------------------------------ */
  const add = (kind: NewKind, asset?: string) => {
    setMenu(null);
    const st = useStore.getState();
    const { ops, id } = createLayerOps(st.doc, kind, playhead.get(), { asset });
    const r = st.commit(ops, { source: "you", intent: `Added ${id}` });
    if (r.ok) {
      st.select([id]);
      if (st.mode === "pro" || kind === "text") st.setTab("inspect");
    } else st.toast(r.errors[0], "error");
  };

  const addLibrary = (pack: string, name: string) => {
    setMenu(null);
    const st = useStore.getState();
    const id = st.doc.assets[name] ? name : uniqueId(st.doc, name);
    const entry = { src: `lib://${pack}/${name}`, mime: "image/webp", name };
    const doc1 = { ...st.doc, assets: { ...st.doc.assets, [id]: entry } };
    const c = createLayerOps(doc1, "image", playhead.get(), { asset: id });
    const layer = (c.ops[0] as { layer: Record<string, unknown> }).layer;
    layer.w = 260;
    delete layer.radius;
    const r = st.commit([{ op: "set", path: `assets/${id}`, value: entry }, ...c.ops], { source: "you", intent: `Added ${name}` });
    if (r.ok) st.select([c.id]);
    else st.toast(r.errors[0], "error");
  };

  const importFiles = async (files: FileList | File[], at?: { x: number; y: number }) => {
    const st = useStore.getState();
    const songs = [...files].filter((f) => isAudioFile(f));
    for (const f of songs) {
      try {
        if (await uploadAudio(f, null)) st.toast(`Added ${f.name} as music`);
      } catch (e) {
        st.toast((e as Error).message, "error");
      }
    }
    const imgs = [...files].filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return songs.length ? undefined : st.toast("Drop images (PNG, JPG, WebP, SVG) or music (MP3, WAV, M4A)", "error");
    const target = at ? pickAt(at.x, at.y) : null;
    const targetL = target ? findLayer(st.doc, target) : null;
    for (const f of imgs) {
      const doc0 = useStore.getState().doc;
      const { id, entry } = await importAsset(f, Object.keys(doc0.assets));
      const ops: Op[] = [{ op: "set", path: `assets/${id}`, value: entry }];
      if (targetL?.type === "device") {
        ops.push({ op: "set", path: `${targetL.id}/screen`, value: id });
        useStore.getState().commit(ops, { source: "you", intent: `Put ${f.name} on ${targetL.id}'s screen` });
        useStore.getState().toast(`Placed ${f.name} on the ${targetL.id} screen`);
      } else {
        const c = createLayerOps({ ...doc0, assets: { ...doc0.assets, [id]: entry } }, "image", playhead.get(), { asset: id });
        const r = useStore.getState().commit([...ops, ...c.ops], { source: "you", intent: `Added image ${f.name}` });
        if (r.ok) useStore.getState().select([c.id]);
      }
    }
  };

  const pickImage = (then: (id: string) => void) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/*";
    inp.onchange = async () => {
      const f = inp.files?.[0];
      if (!f) return;
      const st = useStore.getState();
      const { id, entry } = await importAsset(f, Object.keys(st.doc.assets));
      st.commit([{ op: "set", path: `assets/${id}`, value: entry }], { source: "you", intent: `Imported ${f.name}` });
      then(id);
    };
    inp.click();
  };

  return (
    <section
      className="viewport"
      ref={wrap}
      aria-label="Preview"
      onDragOver={(e) => {
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDropping(false);
        importFiles(e.dataTransfer.files, local(e));
      }}
    >
      <canvas ref={canvasRef} data-testid="viewport-canvas" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onWheel={onWheel} onDoubleClick={onDoubleClick} />
      <div ref={overlay} className="tl-overlay" />
      <div className="vtop">
        <div className="seg" role="group" aria-label="View">
          <button aria-pressed={view === "shot"} onClick={() => useStore.getState().setView("shot")} title="Camera output only">
            Shot
          </button>
          <button aria-pressed={view === "split"} onClick={() => useStore.getState().setView("split")} title="Scene camera + shot side by side (S)">
            Split
          </button>
        </div>
        <span className="vbadge">
          {doc.comp.w}×{doc.comp.h} · {doc.comp.fps} fps
        </span>
        {view === "split" && <span className="vbadge">Drag to orbit the scene · wheel to zoom</span>}
        <div className="spacer" />
        {preview && (
          <div className="vbadge" style={{ color: "var(--ai)", borderColor: "var(--ai)", display: "flex", gap: 8, alignItems: "center" }}>
            Previewing AI changes
            <button className="btn sm ai" onClick={() => useStore.getState().keepPreview()}>
              Keep
            </button>
            <button className="btn sm" onClick={() => useStore.getState().discardPreview()}>
              Discard
            </button>
          </div>
        )}
      </div>
      <div className="dock" role="toolbar" aria-label="Add to scene">
        <button className="iconbtn on" title="Select & move (V)" aria-label="Select">
          <Icon name="select" />
        </button>
        <button className="iconbtn" title="Text (T)" aria-label="Add text" onClick={() => add("text")}>
          <Icon name="text" />
        </button>
        <div style={{ position: "relative" }}>
          <button className="iconbtn" title="Shape (R)" aria-label="Add shape" onClick={() => setMenu(menu === "shape" ? null : "shape")}>
            <Icon name="rect" />
          </button>
          {menu === "shape" && (
            <div className="menu">
              <button onClick={() => add("rect")}><Icon name="rect" sm /> Rectangle <span className="hint">R</span></button>
              <button onClick={() => add("ellipse")}><Icon name="ellipse" sm /> Ellipse <span className="hint">E</span></button>
            </div>
          )}
        </div>
        <button className="iconbtn" title="Image" aria-label="Add image" onClick={() => pickImage((id) => add("image", id))}>
          <Icon name="image" />
        </button>
        <div style={{ position: "relative" }}>
          <button className="iconbtn" title="Device mockup" aria-label="Add device" onClick={() => setMenu(menu === "device" ? null : "device")}>
            <Icon name="device" />
          </button>
          {menu === "device" && (
            <div className="menu">
              <button onClick={() => add("device")}><Icon name="device" sm /> iPhone</button>
              <button onClick={() => add("browser")}><Icon name="frame" sm /> Browser window</button>
            </div>
          )}
        </div>
        <div style={{ position: "relative" }}>
          <button className="iconbtn" title="Cloner" aria-label="Add cloner" onClick={() => setMenu(menu === "cloner" ? null : "cloner")}>
            <Icon name="cloner" />
          </button>
          {menu === "cloner" && (
            <div className="menu">
              <button onClick={() => add("cloner")}><Icon name="ellipse" sm /> Ring <span className="hint">radial</span></button>
              <button onClick={() => add("grid")}><Icon name="cloner" sm /> Grid <span className="hint">wave</span></button>
            </div>
          )}
        </div>
        <div style={{ position: "relative" }}>
          <button className="iconbtn" title="Effects, UI and 3D" aria-label="Add effect layer" onClick={() => setMenu(menu === "fx" ? null : "fx")}>
            <Icon name="sparkle" />
          </button>
          {menu === "fx" && (
            <div className="menu">
              <button onClick={() => add("card")}><Icon name="rect" sm /> Glass UI card <span className="hint">counter</span></button>
              <button onClick={() => add("chart")}><Icon name="graph" sm /> Line chart <span className="hint">trim</span></button>
              <button onClick={() => add("object")}><Icon name="ellipse" sm /> 3D object <span className="hint">chrome</span></button>
              <button onClick={() => add("sky")}><Icon name="gradient" sm /> Sky &amp; landscape</button>
              <button onClick={() => add("fade")}><Icon name="frame" sm /> Fade / white-out <span className="hint">adjust</span></button>
            </div>
          )}
        </div>
        <div style={{ position: "relative" }}>
          <button className="iconbtn" title="Asset library: 3D emoji" aria-label="Asset library" onClick={() => setMenu(menu === "lib" ? null : "lib")}>
            <Icon name="wand" />
          </button>
          {menu === "lib" && (
            <div className="menu lib-grid" data-testid="asset-library">
              <div className="hint" style={{ gridColumn: "1 / -1", padding: "2px 4px 6px" }}>3D objects · Fluent Emoji (MIT)</div>
              {LIBRARY.emoji3d.names.map((n) => (
                <button key={n} title={n} aria-label={`Add ${n}`} onClick={() => addLibrary("emoji3d", n)}>
                  <img src={libraryUrl(`lib://emoji3d/${n}`) ?? ""} alt="" width={40} height={40} />
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="div" />
        <button
          className="ask"
          onClick={() => {
            useStore.getState().setTab("assistant");
            setTimeout(() => document.getElementById("prompt")?.focus(), 30);
          }}
        >
          <Icon name="sparkle" /> Ask AI
        </button>
      </div>
      {dropping && <div className="drop-hint">Drop images — onto a device to use as its screen</div>}
    </section>
  );
}
