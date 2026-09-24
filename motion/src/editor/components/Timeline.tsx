import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Doc, Layer } from "../../fmd/schema";
import { applyTxn, type Op } from "../../fmd/ops";
import { CATALOG } from "../../fmd/catalog";
import { activeCamera, behDur, channel } from "../../runtime/evaluate";
import { useStore, useDisplayDoc } from "../store";
import { playhead, fmtTime } from "../playhead";
import { behColor, BEH_COLORS } from "../edit";
import { Icon, TYPE_ICON } from "./ui";
import { GraphEditor } from "./GraphEditor";
import { cubicOf } from "../../runtime/ease";

const ROW = 30;
const PAD = 12;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

type Row = { kind: "layer"; L: Layer; indent: number } | { kind: "channel"; L: Layer; ch: string };
type HitKind = "bar" | "barL" | "barR" | "clip" | "clipR" | "key";
interface Hit { kind: HitKind; x: number; y: number; w: number; h: number; id: string; beh?: string; ch?: string; idx?: number }
interface Win { start: number; pps: number }

function buildRows(doc: Doc, expanded: Record<string, boolean>, pro: boolean): Row[] {
  const rows: Row[] = [];
  const layers = doc.layers.filter((l) => l.type !== "camera");
  const childrenOf = (id: string | undefined) => layers.filter((l) => (l.parent ?? undefined) === id).reverse();
  const walk = (L: Layer, indent: number) => {
    rows.push({ kind: "layer", L, indent });
    if (pro && expanded[L.id]) for (const ch of Object.keys(L.keys ?? {})) rows.push({ kind: "channel", L, ch });
    for (const c of childrenOf(L.id)) walk(c, indent + 1);
  };
  // front-most first, like After Effects and Figma
  for (const L of [...layers].reverse()) if (!L.parent || !layers.some((p) => p.id === L.parent)) walk(L, 0);
  return rows;
}

function span(doc: Doc, L: Layer): [number, number] {
  return [L.in ?? 0, L.out ?? doc.comp.dur];
}

/** Clips inside a bar, each assigned a lane so overlapping behaviors stay readable. */
function clipLanes(doc: Doc, L: Layer) {
  const [a, b] = span(doc, L);
  const clips = (L.beh ?? []).map((bh) => {
    const t0 = Math.max(a, a + bh.at);
    const loop = CATALOG[bh.use]?.mode === "add" && behDur(bh) >= 900;
    const t1 = Math.min(b, a + bh.at + behDur(bh));
    return { bh, t0, t1: Math.max(t1, t0 + 0.02), loop, lane: 0 };
  });
  const ends: number[] = [];
  for (const c of [...clips].sort((x, y) => x.t0 - y.t0)) {
    let lane = ends.findIndex((e) => e <= c.t0 + 1e-6);
    if (lane < 0) lane = ends.length;
    ends[lane] = c.t1;
    c.lane = lane;
  }
  return { clips, lanes: Math.max(1, ends.length) };
}

function drawRows(ctx: CanvasRenderingContext2D, doc: Doc, rows: Row[], w: number, win: Win, sel: string[], ai: Record<string, number>, keySel: { layer: string; channel: string; index: number } | null, hits: Hit[], camLane = false) {
  const X = (t: number) => PAD + (t - win.start) * win.pps;
  const now = Date.now();
  ctx.font = "500 11px Inter Variable, system-ui, sans-serif";
  ctx.textBaseline = "middle";
  // grid
  const step = niceStep(win.pps);
  for (let t = Math.ceil(win.start / step) * step; X(t) < w; t += step) {
    ctx.fillStyle = Math.abs(t - Math.round(t)) < 1e-6 ? "#1e2127" : "#17191e";
    ctx.fillRect(Math.round(X(t)), 0, 1, rows.length * ROW);
  }
  const dur = doc.comp.dur;
  ctx.fillStyle = "rgba(0,0,0,.28)";
  ctx.fillRect(X(dur), 0, Math.max(0, w - X(dur)), rows.length * ROW);
  rows.forEach((row, i) => {
    const y = i * ROW;
    const L = row.L;
    const isSel = sel.includes(L.id);
    ctx.fillStyle = isSel && row.kind === "layer" ? "rgba(140,155,255,.07)" : "transparent";
    ctx.fillRect(0, y, w, ROW);
    ctx.fillStyle = "#1a1d22";
    ctx.fillRect(0, y + ROW - 1, w, 1);
    const [a, b] = span(doc, L);
    if (row.kind === "layer") {
      const x0 = X(a), x1 = X(b);
      const top = y + 4, h = ROW - 8;
      const base = camLane ? "rgba(255,159,67,.16)" : isSel ? "rgba(140,155,255,.30)" : "#232730";
      ctx.fillStyle = base;
      rr(ctx, x0, top, x1 - x0, h, 6);
      ctx.fill();
      if (isSel) {
        ctx.strokeStyle = "#8c9bff";
        ctx.lineWidth = 1.2;
        rr(ctx, x0 + 0.5, top + 0.5, x1 - x0 - 1, h - 1, 6);
        ctx.stroke();
      }
      hits.push({ kind: "bar", x: x0 + 6, y: top, w: Math.max(0, x1 - x0 - 12), h, id: L.id });
      if (!camLane) {
        hits.push({ kind: "barL", x: x0 - 4, y: top, w: 10, h, id: L.id });
        hits.push({ kind: "barR", x: x1 - 6, y: top, w: 10, h, id: L.id });
      }
      // behavior clips
      const { clips, lanes } = clipLanes(doc, L);
      const lh = (h - 4) / lanes;
      for (const c of clips) {
        const cx0 = X(c.t0), cx1 = X(c.t1);
        const cy = top + 2 + c.lane * lh;
        const col = behColor(c.bh.use);
        ctx.fillStyle = hexA(col, c.loop ? 0.22 : 0.85);
        rr(ctx, cx0 + 1, cy + 0.5, Math.max(4, cx1 - cx0 - 2), lh - 1, 4);
        ctx.fill();
        if (c.loop) {
          ctx.strokeStyle = hexA(col, 0.8);
          ctx.setLineDash([3, 3]);
          ctx.lineWidth = 1;
          rr(ctx, cx0 + 1.5, cy + 1, Math.max(4, cx1 - cx0 - 3), lh - 2, 4);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        if (cx1 - cx0 > 34 && lh > 9) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(cx0, cy, cx1 - cx0 - 4, lh);
          ctx.clip();
          ctx.fillStyle = c.loop ? col : "#0c0d10";
          ctx.font = `600 ${lh > 14 ? 11 : 9.5}px Inter Variable, system-ui, sans-serif`;
          ctx.fillText(CATALOG[c.bh.use]?.label ?? c.bh.use, cx0 + 7, cy + lh / 2 + 0.5);
          ctx.restore();
        }
        hits.push({ kind: "clip", x: cx0, y: cy, w: Math.max(4, cx1 - cx0 - 6), h: lh, id: L.id, beh: c.bh.id });
        if (!c.loop) hits.push({ kind: "clipR", x: cx1 - 6, y: cy, w: 8, h: lh, id: L.id, beh: c.bh.id });
      }
      // collapsed key ticks
      for (const tr of Object.values(L.keys ?? {}))
        for (const k of tr) {
          const kx = X(a + k[0]);
          ctx.fillStyle = "#f3b24a";
          diamond(ctx, kx, top + h - 2, 3);
        }
      const age = now - (ai[L.id] ?? 0);
      if (age < 5000) {
        const al = 1 - age / 5000;
        ctx.strokeStyle = `rgba(243,178,74,${al})`;
        ctx.lineWidth = 2;
        rr(ctx, x0 - 1, top - 1, x1 - x0 + 2, h + 2, 7);
        ctx.stroke();
      }
    } else {
      const tr = L.keys?.[row.ch] ?? [];
      ctx.strokeStyle = "#3a404b";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      tr.forEach((k, j) => (j ? ctx.lineTo(X(a + k[0]), y + ROW / 2) : ctx.moveTo(X(a + k[0]), y + ROW / 2)));
      ctx.stroke();
      tr.forEach((k, j) => {
        const kx = X(a + k[0]);
        const isK = keySel && keySel.layer === L.id && keySel.channel === row.ch && keySel.index === j;
        ctx.fillStyle = isK ? "#ffffff" : "#f3b24a";
        keyGlyph(ctx, kx, y + ROW / 2, isK ? 6.5 : 5.5, j > 0 ? interp(k[2], "in") : null, j < tr.length - 1 ? interp(tr[j + 1][2], "out") : null);
        if (win.pps > 60) {
          ctx.fillStyle = "#6b7280";
          ctx.font = "10px JetBrains Mono Variable, monospace";
          ctx.fillText(String(Math.round(k[1] * 100) / 100), kx + 9, y + ROW / 2 + 0.5);
        }
        hits.push({ kind: "key", x: kx - 7, y: y + 4, w: 14, h: ROW - 8, id: L.id, ch: row.ch, idx: j });
      });
    }
  });
}

function niceStep(pps: number): number {
  for (const s of [1 / 30, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30]) if (s * pps >= 42) return s;
  return 60;
}
function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, Math.max(0, w), Math.max(0, h), Math.min(r, Math.max(0, w) / 2, h / 2));
}
function diamond(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.lineTo(x + s, y);
  ctx.lineTo(x, y + s);
  ctx.lineTo(x - s, y);
  ctx.closePath();
  ctx.fill();
}
/** How one side of a key interpolates, for its AE-style glyph. */
type Interp = "linear" | "ease" | "hold" | "curve";
function interp(ease: string | undefined, side: "in" | "out"): Interp {
  if (ease === "hold") return side === "in" ? "hold" : "linear";
  const c = cubicOf(ease);
  if (!c) return "curve";
  const [hx, hy] = side === "in" ? [c[2], c[3]] : [c[0], c[1]];
  if (side === "in" ? Math.abs(hx - 1) < 0.02 && Math.abs(hy - 1) < 0.02 : hx < 0.02 && hy < 0.02) return "linear";
  return Math.abs(hy - (side === "in" ? 1 : 0)) < 0.02 ? "ease" : "curve";
}
/**
 * After Effects' keyframe icons, half per side: ◇ linear, ⧗ easy ease, ■ hold, ● bézier.
 * The left half is how the value arrives, the right half how it leaves.
 */
function keyGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, left: Interp | null, right: Interp | null) {
  const half = (kind: Interp | null, dir: -1 | 1) => {
    const k = kind ?? "linear";
    ctx.beginPath();
    if (k === "linear") {
      ctx.moveTo(x, y - s);
      ctx.lineTo(x + dir * s, y);
      ctx.lineTo(x, y + s);
    } else if (k === "ease") {
      ctx.moveTo(x, y - s * 0.25);
      ctx.lineTo(x + dir * s * 0.8, y - s);
      ctx.lineTo(x + dir * s * 0.8, y + s);
      ctx.lineTo(x, y + s * 0.25);
    } else if (k === "hold") {
      ctx.rect(dir < 0 ? x - s * 0.8 : x, y - s * 0.8, s * 0.8, s * 1.6);
    } else {
      ctx.arc(x, y, s * 0.85, -Math.PI / 2, Math.PI / 2, dir < 0);
    }
    ctx.closePath();
    ctx.fill();
  };
  half(left, -1);
  half(right, 1);
}
function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function fitCanvas(c: HTMLCanvasElement, w: number, h: number) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    c.style.width = w + "px";
    c.style.height = h + "px";
  }
  const ctx = c.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return ctx;
}

/* ------------------------------------------------------------------ */

export function Timeline() {
  const doc = useDisplayDoc();
  const mode = useStore((s) => s.mode);
  const sel = useStore((s) => s.selection);
  const expanded = useStore((s) => s.expanded);
  const keySel = useStore((s) => s.keySel);
  const graphOpen = useStore((s) => s.graphOpen);
  const ai = useStore((s) => s.aiChanged);
  const pro = mode === "pro";
  const rows = useMemo(() => buildRows(doc, expanded, pro), [doc, expanded, pro]);
  const cam = activeCamera(doc);
  const [height, setHeight] = useState(pro ? 320 : 280);
  const [width, setWidth] = useState(800);
  const [win, setWin] = useState<Win>({ start: 0, pps: 100 });
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const autoFit = useRef(true);
  const tracksWrap = useRef<HTMLDivElement>(null);
  const namesRef = useRef<HTMLDivElement>(null);
  const tracksCanvas = useRef<HTMLCanvasElement>(null);
  const camCanvas = useRef<HTMLCanvasElement>(null);
  const ruler = useRef<HTMLCanvasElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const tcRef = useRef<HTMLSpanElement>(null);
  const hits = useRef<Hit[]>([]);
  const camHits = useRef<Hit[]>([]);
  const namesW = pro ? 220 : 170;
  const X = (t: number) => PAD + (t - win.start) * win.pps;
  const T = (x: number) => (x - PAD) / win.pps + win.start;

  // fit the comp to the width until the user zooms
  useLayoutEffect(() => {
    const el = tracksWrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (autoFit.current) setWin({ start: 0, pps: Math.max(10, (width - PAD * 2 - 8) / doc.comp.dur) });
  }, [width, doc.comp.dur]);

  // tracks + camera lane (redrawn on data changes only)
  useEffect(() => {
    const c = tracksCanvas.current;
    if (!c) return;
    const ctx = fitCanvas(c, width, Math.max(rows.length * ROW, 10));
    hits.current = [];
    drawRows(ctx, doc, rows, width, win, sel, ai, keySel, hits.current);
    const cc = camCanvas.current;
    if (cc) {
      const cctx = fitCanvas(cc, width, ROW);
      camHits.current = [];
      if (cam) drawRows(cctx, doc, [{ kind: "layer", L: cam, indent: 0 }], width, win, sel, ai, keySel, camHits.current, true);
    }
  }, [doc, rows, width, win, sel, ai, keySel, cam]);

  // AI glow fades: redraw a few times while it's active
  useEffect(() => {
    const newest = Math.max(0, ...Object.values(ai));
    if (Date.now() - newest > 5000) return;
    const id = setInterval(() => setWin((w) => ({ ...w })), 250);
    const stop = setTimeout(() => clearInterval(id), 5200);
    return () => {
      clearInterval(id);
      clearTimeout(stop);
    };
  }, [ai]);

  // ruler + playhead (per frame, no React)
  useEffect(() => {
    const drawHead = () => {
      const t = playhead.get();
      const c = ruler.current;
      if (c) {
        const ctx = fitCanvas(c, width, 28);
        const step = niceStep(win.pps);
        ctx.font = "10.5px JetBrains Mono Variable, monospace";
        ctx.textBaseline = "middle";
        for (let s = Math.ceil(win.start / step) * step; X(s) < width; s += step) {
          const major = Math.abs(s / (step * 2) - Math.round(s / (step * 2))) < 1e-6 || step >= 1;
          ctx.fillStyle = major ? "#3a404b" : "#262a31";
          ctx.fillRect(Math.round(X(s)), major ? 14 : 20, 1, major ? 14 : 8);
          if (major) {
            ctx.fillStyle = "#737a86";
            ctx.fillText(step < 1 ? s.toFixed(2) : `${Math.round(s)}s`, X(s) + 4, 9);
          }
        }
        for (const m of doc.markers) {
          ctx.fillStyle = "#ff9f43";
          diamond(ctx, X(m.t), 22, 4);
        }
        const px = X(t);
        ctx.fillStyle = "#8c9bff";
        rr(ctx, px - 7, 3, 14, 16, 4);
        ctx.fill();
      }
      if (headRef.current) headRef.current.style.transform = `translateX(${X(t)}px)`;
      if (tcRef.current) tcRef.current.textContent = fmtTime(t, doc.comp.fps);
    };
    drawHead();
    const off = playhead.subscribe(drawHead);
    const off2 = playhead.subscribePlaying(() => setPlaying(playhead.isPlaying()));
    return () => {
      off();
      off2();
    };
  }, [width, win, doc]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => playhead.setLoop(loop), [loop]);

  // geometry hook for tests and agents that drive the UI (screen coords of rows, times, clips)
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__timeline = {
      x: (t: number) => (tracksCanvas.current?.getBoundingClientRect().left ?? 0) + X(t),
      rowY: (id: string, ch?: string) => {
        const i = rows.findIndex((r) => r.L.id === id && (ch ? r.kind === "channel" && r.ch === ch : r.kind === "layer"));
        const top = tracksCanvas.current?.getBoundingClientRect().top ?? 0;
        return i < 0 ? null : top + i * ROW + ROW / 2;
      },
      camY: () => {
        const r = camCanvas.current?.getBoundingClientRect();
        return r ? r.top + ROW / 2 : null;
      },
      pps: win.pps,
    };
  });

  /* ------------------------------ drag ------------------------------ */
  const snapTimes = (base: Doc, exclude: string): number[] => {
    const ts = [0, base.comp.dur, playhead.get(), ...base.markers.map((m) => m.t)];
    for (const L of base.layers) {
      if (L.id === exclude) continue;
      const [a, b] = span(base, L);
      ts.push(a, b);
      for (const bh of L.beh ?? []) ts.push(a + bh.at, a + bh.at + behDur(bh));
    }
    return ts;
  };
  const snap = (t: number, cands: number[], fps: number, free: boolean) => {
    if (free) return r3(t);
    let best = t, bd = 7 / win.pps;
    for (const c of cands) if (Math.abs(c - t) < bd) {
      bd = Math.abs(c - t);
      best = c;
    }
    return best === t ? r3(Math.round(t * fps) / fps) : r3(best);
  };

  const scrub = (clientX: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    playhead.pause();
    playhead.set(Math.max(0, Math.min(doc.comp.dur, snap(T(clientX - r.left), [], doc.comp.fps, false))));
  };

  const startScrub = (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    scrub(e.clientX, el);
    const move = (ev: PointerEvent) => scrub(ev.clientX, el);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onTrackDown = (e: React.PointerEvent, lane: "main" | "cam") => {
    const el = e.currentTarget as HTMLCanvasElement;
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const list = lane === "cam" ? camHits.current : hits.current;
    const hit = [...list].reverse().find((h) => x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h);
    const st = useStore.getState();
    if (!hit) {
      const row = lane === "cam" ? (cam ? { L: cam } : null) : rows[Math.floor(y / ROW)];
      if (row) st.select([row.L.id], e.shiftKey);
      else st.select([]);
      return startScrub(e);
    }
    const base = st.doc;
    const L = base.layers.find((l) => l.id === hit.id)!;
    if (!st.selection.includes(hit.id) || !e.shiftKey) st.select([hit.id], e.shiftKey);
    if (hit.kind === "key") st.setKeySel({ layer: hit.id, channel: hit.ch!, index: hit.idx! });
    else st.setKeySel(null);
    const t0 = T(x);
    const cands = snapTimes(base, hit.id);
    const [a, b] = span(base, L);
    const bh = hit.beh ? L.beh!.find((q) => q.id === hit.beh) : undefined;
    let ops: Op[] = [];
    let label = "";
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const tx = T(ev.clientX - r.left);
      const free = ev.altKey;
      const d = tx - t0;
      switch (hit.kind) {
        case "bar": {
          const nin = Math.max(0, snap(a + d, cands, base.comp.fps, free));
          const nout = L.out !== undefined ? r3(L.out + (nin - a)) : undefined;
          ops = [{ op: "set", path: `${L.id}/in`, value: nin }];
          if (nout !== undefined) ops.push({ op: "set", path: `${L.id}/out`, value: nout });
          label = `${L.id} in ${nin.toFixed(2)}s`;
          break;
        }
        case "barL": {
          const nin = Math.min(b - 0.1, Math.max(0, snap(a + d, cands, base.comp.fps, free)));
          ops = [{ op: "trim", id: L.id, delta: r3(nin - a) }];
          label = `trim in → ${nin.toFixed(2)}s`;
          break;
        }
        case "barR": {
          const nout = Math.max(a + 0.1, snap(b + d, cands, base.comp.fps, free));
          ops = [{ op: "set", path: `${L.id}/out`, value: r3(nout) }];
          label = `out → ${nout.toFixed(2)}s`;
          break;
        }
        case "clip": {
          const at = r3(Math.max(free ? -Infinity : 0, snap(a + bh!.at + d, cands, base.comp.fps, free) - a));
          ops = [{ op: "set", path: `${L.id}/beh/${bh!.id}/at`, value: at }];
          label = `${CATALOG[bh!.use]?.label ?? bh!.use} at ${(a + at).toFixed(2)}s`;
          break;
        }
        case "clipR": {
          const end = snap(a + bh!.at + behDur(bh!) + d, cands, base.comp.fps, free);
          const dur = Math.max(0.05, r3(end - a - bh!.at));
          ops = [{ op: "set", path: `${L.id}/beh/${bh!.id}/dur`, value: dur }];
          label = `${CATALOG[bh!.use]?.label ?? bh!.use} ${dur.toFixed(2)}s`;
          break;
        }
        case "key": {
          const tr = (L.keys?.[hit.ch!] ?? []).map((k) => [...k]) as [number, number, string?][];
          const nt = r3(snap(a + tr[hit.idx!][0] + d, cands, base.comp.fps, free) - a);
          tr[hit.idx!][0] = nt;
          ops = [{ op: "key", path: `${L.id}/keys/${hit.ch}`, keys: tr }];
          label = `${hit.ch} key → ${(a + nt).toFixed(2)}s`;
          break;
        }
      }
      const res = applyTxn(base, ops, { source: "you", validate: false });
      if (res.ok) useStore.getState().setTransient(res.doc);
      setTip({ x: ev.clientX - r.left, y: ev.clientY - r.top, text: label });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setTip(null);
      const s2 = useStore.getState();
      s2.setTransient(null);
      if (ops.length) {
        const res = s2.commit(ops, { source: "you", intent: label || "Timeline edit" });
        if (!res.ok) s2.toast(res.errors[0], "error");
        if (hit.kind === "key") {
          // follow the key to its new sorted position
          const nl = s2.doc.layers.find((l) => l.id === hit.id);
          const k = (ops[0] as unknown as { keys: [number, number][] }).keys[hit.idx!];
          const ni = nl?.keys?.[hit.ch!]?.findIndex((q) => q[0] === k[0]) ?? -1;
          if (ni >= 0) s2.setKeySel({ layer: hit.id, channel: hit.ch!, index: ni });
        }
      } else if (hit.kind === "clip" || hit.kind === "bar") {
        // a click (no drag) on a clip opens its settings
        if (hit.kind === "clip") s2.setTab("inspect");
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onTrackMove = (e: React.PointerEvent, lane: "main" | "cam") => {
    if (e.buttons) return;
    const el = e.currentTarget as HTMLCanvasElement;
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const list = lane === "cam" ? camHits.current : hits.current;
    const hit = [...list].reverse().find((h) => x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h);
    el.style.cursor = !hit ? "text" : hit.kind === "barL" || hit.kind === "barR" || hit.kind === "clipR" ? "ew-resize" : hit.kind === "key" ? "pointer" : "grab";
  };

  const onTrackDbl = (e: React.MouseEvent) => {
    const el = e.currentTarget as HTMLCanvasElement;
    const r = el.getBoundingClientRect();
    const row = rows[Math.floor((e.clientY - r.top) / ROW)];
    if (!row || row.kind !== "channel") return;
    const st = useStore.getState();
    const L = st.doc.layers.find((l) => l.id === row.L.id)!;
    const [a] = span(st.doc, L);
    const t = Math.max(0, r3(Math.round(T(e.clientX - r.left) * st.doc.comp.fps) / st.doc.comp.fps - a));
    const tr = (L.keys?.[row.ch] ?? []).map((k) => [...k]) as [number, number, string?][];
    tr.push([t, r3(channel(st.doc, L, row.ch, t))]);
    st.commit([{ op: "key", path: `${L.id}/keys/${row.ch}`, keys: tr }], { source: "you", intent: `Added ${row.ch} key` });
  };

  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const tAt = T(e.clientX - r.left);
      const pps = Math.min(2000, Math.max(8, win.pps * Math.exp(-e.deltaY * 0.002)));
      autoFit.current = false;
      setWin({ pps, start: Math.max(0, tAt - (e.clientX - r.left - PAD) / pps) });
    } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      autoFit.current = false;
      setWin((w) => ({ ...w, start: Math.max(0, w.start + (e.deltaX || e.deltaY) / w.pps) }));
    }
  };
  const zoom = (f: number) => {
    autoFit.current = false;
    const tc = playhead.get();
    const pps = Math.min(2000, Math.max(8, win.pps * f));
    setWin({ pps, start: Math.max(0, tc - (width / 2 - PAD) / pps) });
  };
  const fitAll = () => {
    autoFit.current = true;
    setWin({ start: 0, pps: Math.max(10, (width - PAD * 2 - 8) / doc.comp.dur) });
  };

  const startResize = (e: React.PointerEvent) => {
    const y0 = e.clientY, h0 = height;
    const move = (ev: PointerEvent) => setHeight(Math.min(window.innerHeight * 0.7, Math.max(150, h0 - (ev.clientY - y0))));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const st = useStore.getState();
  const toggleMB = () =>
    st.commit(doc.comp.motionBlur ? [{ op: "del", path: "comp/motionBlur" }] : [{ op: "set", path: "comp/motionBlur", value: { angle: 180, samples: 12 } }], {
      source: "you",
      intent: doc.comp.motionBlur ? "Motion blur off" : "Motion blur on",
    });
  // graph editor target: the selected key's channel, else the selected layer's first keyed channel
  const graphTarget = (() => {
    if (!graphOpen) return null;
    const L = keySel ? doc.layers.find((l) => l.id === keySel.layer) : doc.layers.find((l) => sel.includes(l.id) && Object.keys(l.keys ?? {}).length);
    const ch = keySel && L?.id === keySel.layer ? keySel.channel : Object.keys(L?.keys ?? {})[0];
    return L && ch && L.keys?.[ch] ? { L, ch, index: keySel && keySel.layer === L.id && keySel.channel === ch ? keySel.index : null } : null;
  })();
  return (
    <section className="timeline" style={{ height, ["--names" as string]: `${namesW}px` }} aria-label="Timeline">
      <div className="tl-resize" onPointerDown={startResize} title="Drag to resize" />
      <div className="tl-bar">
        <button className="play" onClick={() => playhead.toggle()} aria-label={playing ? "Pause" : "Play"} title="Play / pause (Space)">
          <Icon name={playing ? "pause" : "play"} />
        </button>
        <span className="tc" data-testid="timecode">
          <span ref={tcRef}>00:00:00</span> <span className="of">/ {fmtTime(doc.comp.dur, doc.comp.fps)}</span>
        </span>
        <button className={`iconbtn${loop ? " on" : ""}`} onClick={() => setLoop(!loop)} title="Loop playback" aria-label="Loop" style={{ width: 28, height: 28 }}>
          <Icon name="loop" sm />
        </button>
        <div className="tl-legend">
          {Object.entries(BEH_COLORS).map(([k, c]) => (
            <span key={k}>
              <i style={{ background: c }} />
              {k}
            </span>
          ))}
          <span>
            <i style={{ background: "var(--ai)", transform: "rotate(45deg) scale(.8)" }} />
            Keyframe
          </span>
        </div>
        <div className="spacer" />
        {pro && (
          <>
            <button className={`chip-toggle${doc.comp.motionBlur ? " on" : ""}`} data-testid="mb-toggle" title="Motion blur for the whole comp (AE's comp switch). Per-layer switches live in the inspector." onClick={toggleMB}>
              <span className="mb-glyph" aria-hidden="true" />Motion blur
            </button>
            <button className={`chip-toggle${graphOpen ? " on" : ""}`} data-testid="graph-toggle" title="Graph editor (⇧F3): shape the curve between keyframes" onClick={() => st.set("graphOpen", !graphOpen)}>
              <Icon name="graph" sm />Graph
            </button>
          </>
        )}
        <span className="faint" style={{ fontSize: 11.5 }}>
          {pro ? "Drag bars, clips and keys · edges trim · Alt = no snap" : "Drag bars to retime · Pro mode for keyframes"}
        </span>
        <button className="iconbtn" onClick={() => zoom(1 / 1.5)} title="Zoom out (⌘ + wheel)" aria-label="Zoom out"><Icon name="zoomout" sm /></button>
        <button className="iconbtn" onClick={() => zoom(1.5)} title="Zoom in" aria-label="Zoom in"><Icon name="zoomin" sm /></button>
        <button className="iconbtn" onClick={fitAll} title="Fit timeline" aria-label="Fit timeline"><Icon name="fit" sm /></button>
      </div>
      <div style={{ display: "grid", gridTemplateRows: "28px minmax(0,1fr)", minHeight: 0 }}>
        <div className="tl-body" style={{ gridTemplateColumns: `${namesW}px minmax(0,1fr)` }}>
          <div className="tl-ruler-name">{rows.length} layers</div>
          <canvas ref={ruler} onPointerDown={startScrub} style={{ cursor: "col-resize", display: "block", borderBottom: "1px solid var(--line)" }} data-testid="ruler" />
        </div>
        <div className="tl-body" style={{ gridTemplateColumns: `${namesW}px minmax(0,1fr)` }}>
          <div className="tl-names" ref={namesRef} onScroll={(e) => { if (tracksWrap.current && tracksWrap.current.scrollTop !== (e.target as HTMLElement).scrollTop) tracksWrap.current.scrollTop = (e.target as HTMLElement).scrollTop; }}>
            {rows.map((row) =>
              row.kind === "layer" ? (
                <div
                  key={row.L.id}
                  className={`tl-name${sel.includes(row.L.id) ? " sel" : ""}`}
                  style={{ paddingLeft: 8 + row.indent * 16 }}
                  onClick={(e) => st.select([row.L.id], e.shiftKey)}
                  onDoubleClick={() => st.setTab("inspect")}
                  data-testid={`tl-row-${row.L.id}`}
                >
                  {pro ? (
                    <button
                      className={`chev${expanded[row.L.id] ? " open" : ""}`}
                      style={{ visibility: Object.keys(row.L.keys ?? {}).length ? "visible" : "hidden" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        st.toggleExpanded(row.L.id);
                      }}
                      aria-label={`Show keyframes of ${row.L.id}`}
                    >
                      <Icon name="chevron" sm />
                    </button>
                  ) : null}
                  <Icon name={TYPE_ICON[row.L.type]} sm className="faint" />
                  <span className="nm">{row.L.name ?? row.L.id}</span>
                  {(row.L.beh?.length ?? 0) > 0 && <span className="faint mono" style={{ fontSize: 10 }}>{row.L.beh!.length}</span>}
                </div>
              ) : (
                <div key={row.L.id + "/" + row.ch} className="tl-name sub">
                  {row.ch}
                </div>
              ),
            )}
          </div>
          <div
            className="tl-tracks"
            ref={tracksWrap}
            onScroll={(e) => {
              if (namesRef.current && namesRef.current.scrollTop !== (e.target as HTMLElement).scrollTop) namesRef.current.scrollTop = (e.target as HTMLElement).scrollTop;
            }}
            onWheel={onWheel}
          >
            <canvas ref={tracksCanvas} data-testid="tracks" style={{ display: graphOpen ? "none" : "block" }} onPointerDown={(e) => onTrackDown(e, "main")} onPointerMove={(e) => onTrackMove(e, "main")} onDoubleClick={onTrackDbl} />
            {graphOpen &&
              (graphTarget ? (
                <GraphEditor L={graphTarget.L} ch={graphTarget.ch} keyIndex={graphTarget.index} width={width} height={Math.max(120, height - 140)} X={X} />
              ) : (
                <div className="faint" style={{ padding: "14px 16px" }}>Select a keyframe (or a layer with keyframes) to see its curve. F9 applies Easy Ease.</div>
              ))}
            {!rows.length && <div className="faint" style={{ position: "absolute", top: 10, left: 14 }}>Add something from the toolbar or ask the AI.</div>}
          </div>
          <div ref={headRef} style={{ position: "absolute", top: 0, bottom: 0, left: namesW, width: 1.5, background: "#8c9bff", pointerEvents: "none", boxShadow: "0 0 0 .5px rgba(140,155,255,.4)" }} />
          {tip && <div className="vbadge" style={{ position: "absolute", left: namesW + tip.x + 12, top: Math.max(0, tip.y - 30), pointerEvents: "none", color: "var(--text)" }}>{tip.text}</div>}
        </div>
      </div>
      <div className="tl-cam">
        <div className="tl-name" onClick={() => cam && st.select([cam.id])} data-testid="camera-lane">
          <Icon name="camera" sm />
          <span className="nm">Camera{cam ? ` · ${cam.id}` : ""}</span>
        </div>
        <canvas ref={camCanvas} onPointerDown={(e) => onTrackDown(e, "cam")} onPointerMove={(e) => onTrackMove(e, "cam")} />
      </div>
    </section>
  );
}
