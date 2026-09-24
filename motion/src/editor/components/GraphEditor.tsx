import { useEffect, useRef, useState } from "react";
import type { Layer } from "../../fmd/schema";
import { applyTxn, type Op } from "../../fmd/ops";
import { keyVal } from "../../runtime/evaluate";
import { cubicOf, withHandles } from "../../runtime/ease";
import { useStore } from "../store";

/**
 * After Effects-style value graph for one keyed channel. The curve is the channel's keyed value
 * over layer time; the selected key shows its bézier handles (the incoming handle belongs to the
 * segment arriving at the key, the outgoing one to the next segment). Dragging a handle rewrites
 * that segment's `cubic(…)` ease — live while dragging, one undo step on release.
 */
interface Props {
  L: Layer;
  ch: string;
  width: number;
  height: number;
  X: (t: number) => number;
  keyIndex: number | null;
}
type Handle = { seg: number; side: "out" | "in"; x: number; y: number };
const PADY = 22;

export function GraphEditor({ L, ch, width, height, X, keyIndex }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const handles = useRef<Handle[]>([]);
  const keysAt = useRef<{ x: number; y: number; i: number }[]>([]);
  const [drag, setDrag] = useState<Handle | null>(null);
  const tr = L.keys?.[ch] ?? [];
  const a = L.in ?? 0;

  // value range with a little headroom, so overshooting eases stay on screen
  let lo = Infinity, hi = -Infinity;
  const tEnd = tr.length ? tr[tr.length - 1][0] : 1;
  for (let i = 0; i <= 200; i++) {
    const v = keyVal(tr, (i / 200) * tEnd);
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  if (!(hi > lo)) [lo, hi] = [lo - 1, hi + 1];
  const pad = (hi - lo) * 0.12;
  lo -= pad;
  hi += pad;
  const Y = (v: number) => PADY + (1 - (v - lo) / (hi - lo)) * (height - PADY * 2);
  const V = (y: number) => lo + (1 - (y - PADY) / (height - PADY * 2)) * (hi - lo);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(width * dpr);
    c.height = Math.round(height * dpr);
    c.style.width = width + "px";
    c.style.height = height + "px";
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    // value grid
    ctx.font = "10px JetBrains Mono Variable, monospace";
    ctx.textBaseline = "middle";
    for (let k = 0; k <= 4; k++) {
      const v = lo + ((hi - lo) * k) / 4;
      ctx.fillStyle = "#1c1f25";
      ctx.fillRect(0, Math.round(Y(v)), width, 1);
      ctx.fillStyle = "#5b6270";
      ctx.fillText(String(Math.round(v * 100) / 100), 6, Y(v) - 7);
    }
    if (tr.length < 2) {
      ctx.fillStyle = "#737a86";
      ctx.fillText("Add at least two keyframes to shape the curve.", 16, height / 2);
      return;
    }
    // the curve
    ctx.strokeStyle = "#8c9bff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    const t0 = tr[0][0], t1 = tr[tr.length - 1][0];
    for (let i = 0; i <= 400; i++) {
      const t = t0 + ((t1 - t0) * i) / 400;
      const x = X(a + t), y = Y(keyVal(tr, t));
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.stroke();
    // handles of the selected key (AE shows them only on selection)
    handles.current = [];
    const hs: Handle[] = [];
    if (keyIndex !== null) {
      const segH = (seg: number, side: "out" | "in") => {
        const k0 = tr[seg - 1], k1 = tr[seg];
        const c4 = cubicOf(k1[2]);
        if (!c4) return;
        const [hx, hy] = side === "out" ? [c4[0], c4[1]] : [c4[2], c4[3]];
        hs.push({ seg, side, x: X(a + k0[0] + hx * (k1[0] - k0[0])), y: Y(k0[1] + hy * (k1[1] - k0[1])) });
      };
      if (keyIndex > 0) segH(keyIndex, "in");
      if (keyIndex < tr.length - 1) segH(keyIndex + 1, "out");
      for (const h of hs) {
        const k = h.side === "in" ? tr[h.seg] : tr[h.seg - 1];
        ctx.strokeStyle = "#f3b24a";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(X(a + k[0]), Y(k[1]));
        ctx.lineTo(h.x, h.y);
        ctx.stroke();
        ctx.fillStyle = "#f3b24a";
        ctx.beginPath();
        ctx.arc(h.x, h.y, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    handles.current = hs;
    // geometry hook for tests and agents driving the UI (screen coords of the handles)
    const rect = c.getBoundingClientRect();
    (window as unknown as Record<string, unknown>).__graph = { handles: () => hs.map((h) => ({ side: h.side, seg: h.seg, x: rect.left + h.x, y: rect.top + h.y })) };
    // keys
    keysAt.current = tr.map((k, i) => ({ x: X(a + k[0]), y: Y(k[1]), i }));
    for (const k of keysAt.current) {
      ctx.fillStyle = k.i === keyIndex ? "#ffffff" : "#f3b24a";
      ctx.fillRect(k.x - 4, k.y - 4, 8, 8);
    }
  });

  const pick = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const segOps = (h: Handle, x: number, y: number): Op[] | null => {
    const k0 = tr[h.seg - 1], k1 = tr[h.seg];
    const dt = k1[0] - k0[0], dv = k1[1] - k0[1];
    const u = (x - X(a + k0[0])) / Math.max(1e-6, X(a + k1[0]) - X(a + k0[0]));
    // flat segments have no value range to express a handle in; keep the handle's height
    const w = Math.abs(dv) < 1e-9 ? (h.side === "out" ? 0 : 1) : (V(y) - k0[1]) / dv;
    if (!(dt > 0)) return null;
    const next = tr.map((k) => [...k] as [number, number, string?]);
    next[h.seg][2] = withHandles(next[h.seg][2], { [h.side]: [u, Math.round(w * 1000) / 1000] });
    if (next[h.seg][2] === "linear") next[h.seg].length = 2;
    return [{ op: "key", path: `${L.id}/keys/${ch}`, keys: next }];
  };

  const onDown = (e: React.PointerEvent) => {
    const p = pick(e);
    const h = handles.current.find((q) => Math.hypot(q.x - p.x, q.y - p.y) < 9);
    if (h) {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      setDrag(h);
      return;
    }
    const k = keysAt.current.find((q) => Math.hypot(q.x - p.x, q.y - p.y) < 8);
    useStore.getState().setKeySel(k ? { layer: L.id, channel: ch, index: k.i } : null);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = pick(e);
    const ops = segOps(drag, p.x, p.y);
    const st = useStore.getState();
    if (ops) {
      const r = applyTxn(st.doc, ops, { source: "you", validate: false });
      if (r.ok) st.setTransient(r.doc);
    }
  };
  const onUp = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = pick(e);
    const ops = segOps(drag, p.x, p.y);
    const st = useStore.getState();
    st.setTransient(null);
    if (ops) st.commit(ops, { source: "you", intent: `Shaped ${L.id} ${ch} curve` });
    setDrag(null);
  };

  return <canvas ref={canvas} data-testid="graph-editor" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} style={{ display: "block", cursor: drag ? "grabbing" : "crosshair" }} />;
}
