import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Stage } from "../../render/stage";
import { evaluate, trackValue } from "../../runtime/evaluate";
import { applyTxn, type Op } from "../../fmd/ops";
import { useStore, displayDoc, useDisplayDoc } from "../store";
import { playhead } from "../playhead";
import { onFontsChanged } from "../../render/glyphs";
import { onAssetsChanged, importAsset } from "../../assets/assets";
import { setChannelOps, findLayer, localTime } from "../edit";
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
  const raf = useRef(0);
  const doc = useDisplayDoc();
  const view = useStore((s) => s.view);
  const selection = useStore((s) => s.selection);
  const preview = useStore((s) => s.preview);
  const mode = useStore((s) => s.mode);
  const [dropping, setDropping] = useState(false);
  const [menu, setMenu] = useState<null | "shape" | "device" | "cloner">(null);

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
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = stage.renderer.getSize(new THREE.Vector2());
    if (size.x !== W || size.y !== H || stage.renderer.getPixelRatio() !== dpr) stage.setSize(W, H, dpr);
    stage.textResolution = Math.max(1.5, dpr * 1.2);
    const aspect = d.comp.w / d.comp.h;
    const st = useStore.getState();
    const split = st.view === "split" && W > 700;
    const pad = { t: 48, b: 70, s: 20 };
    const area: Rect = split ? { x: W / 2 + 6, y: pad.t, w: W / 2 - pad.s - 6, h: H - pad.t - pad.b } : { x: pad.s, y: pad.t, w: W - pad.s * 2, h: H - pad.t - pad.b };
    const shot = fit(area, aspect);
    shotRect.current = shot;
    stage.sync(d, evaluate(d, playhead.get()));
    const r = stage.renderer;
    r.setScissorTest(false);
    r.setClearColor(0x0d0e12, 1);
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
    stage.render(toGL(shot));
    drawOverlay(stage, shot, st.selection, st.preview !== null);
  }

  function drawOverlay(stage: Stage, shot: Rect, sel: string[], previewing: boolean) {
    const ov = overlay.current;
    if (!ov) return;
    const boxes: string[] = [];
    const now = Date.now();
    const ai = useStore.getState().aiChanged;
    const ids = new Set(sel);
    if (previewing) for (const [id, ts] of Object.entries(ai)) if (now - ts < 6000) ids.add(id);
    for (const id of ids) {
      const b = stage.bounds(id);
      if (!b) continue;
      const isAi = !sel.includes(id);
      boxes.push(`<div class="selbox${isAi ? " ai" : ""}" style="left:${shot.x + b.x * shot.w}px;top:${shot.y + b.y * shot.h}px;width:${b.w * shot.w}px;height:${b.h * shot.h}px"><span class="lbl">${id}</span></div>`);
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
    const offs = [playhead.subscribe(requestRender), onFontsChanged(requestRender), onAssetsChanged(requestRender)];
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
    const id = pickAt(x, y);
    if (id !== hover.current) {
      hover.current = id;
      requestRender();
    }
    (e.currentTarget as HTMLElement).style.cursor = id ? "move" : inRect(x, y, sceneRect.current) ? "grab" : "default";
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

  const importFiles = async (files: FileList | File[], at?: { x: number; y: number }) => {
    const st = useStore.getState();
    const imgs = [...files].filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return st.toast("Drop PNG, JPG, WebP or SVG images", "error");
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
