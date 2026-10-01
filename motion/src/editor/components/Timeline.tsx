import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Doc, Layer } from "../../fmd/schema";
import { applyTxn, type Op } from "../../fmd/ops";
import { CATALOG } from "../../fmd/catalog";
import { activeCamera, behDur, channel } from "../../runtime/evaluate";
import { useStore, useDisplayDoc, displayDoc } from "../store";
import { playhead, fmtTime } from "../playhead";
import { behColor, BEH_COLORS, layerLabel } from "../edit";
import { Icon, TYPE_ICON } from "./ui";
import { CurvePanel } from "./GraphEditor";
import { cubicOf } from "../../runtime/ease";
import "./TimelineAudio.css";
import { MusicPicker, NoteGlyph, SpeakerGlyph } from "./MusicPicker";
import { startAudioEngine, audioDebug, preview } from "../../audio/engine";
import { peekBuffer, peakRange, fileDuration, onAudioLoaded, bufferError, retryBuffer } from "../../audio/buffers";
import { clipLength, gainAt, timing } from "../../audio/schedule";
import { useMusicUI, openMusic, focusTrack } from "../../audio/ui";
import { displayName, toggleMute } from "../../audio/actions";
import { onAssetsChanged } from "../../assets/assets";

const ROW = 30;
const PAD = 12;
const LANE = 40; // audio lane height
const BAND = 26; // scenes band height
const AUDIO_COL = "#5b6cff";
const SCENE_COLS = ["#8b5cf6", "#0a9bf0", "#2fbf85", "#f59e0b", "#f0648a", "#14b8a6"];
const r3 = (v: number) => Math.round(v * 1000) / 1000;

type Row = { kind: "layer"; L: Layer; indent: number } | { kind: "channel"; L: Layer; ch: string };
type HitKind = "bar" | "barL" | "barR" | "clip" | "clipR" | "key";
interface Hit { kind: HitKind; x: number; y: number; w: number; h: number; id: string; beh?: string; ch?: string; idx?: number }
interface Win { start: number; pps: number }

export type RowOrder = "time" | "stack";

function buildRows(doc: Doc, expanded: Record<string, boolean>, pro: boolean, order: RowOrder = "stack"): Row[] {
  const rows: Row[] = [];
  const layers = doc.layers.filter((l) => l.type !== "camera");
  const index = new Map(layers.map((l, i) => [l.id, i]));
  // "time": a waterfall, earliest first (ties: longer first, then document order); "stack": front-most first
  const byTime = (a: Layer, b: Layer) => span(doc, a)[0] - span(doc, b)[0] || span(doc, b)[1] - span(doc, a)[1] || index.get(a.id)! - index.get(b.id)!;
  const sorted = (ls: Layer[]) => (order === "time" ? ls.sort(byTime) : ls.reverse());
  const childrenOf = (id: string | undefined) => sorted(layers.filter((l) => (l.parent ?? undefined) === id));
  const walk = (L: Layer, indent: number) => {
    rows.push({ kind: "layer", L, indent });
    if (pro && expanded[L.id]) for (const ch of Object.keys(L.keys ?? {})) rows.push({ kind: "channel", L, ch });
    for (const c of childrenOf(L.id)) walk(c, indent + 1);
  };
  for (const L of sorted(layers.filter((l) => !l.parent || !layers.some((p) => p.id === l.parent)))) walk(L, 0);
  return rows;
}

function span(doc: Doc, L: Layer): [number, number] {
  return [L.in ?? 0, L.out ?? doc.comp.dur];
}

/** Fill of a bar whose layer is on screen at the playhead. */
const LIVE = "#6c5ce7";

/** Layers on screen at time t: a layer counts only while it and every parent are (children often have no out point). */
function liveAt(doc: Doc, t: number): Set<string> {
  const byId = new Map(doc.layers.map((l) => [l.id, l]));
  const memo = new Map<string, boolean>();
  const alive = (L: Layer | undefined): boolean => {
    if (!L) return true;
    const hit = memo.get(L.id);
    if (hit !== undefined) return hit;
    const [a, b] = span(doc, L);
    const v = t >= a && t < b && alive(L.parent ? byId.get(L.parent) : undefined);
    memo.set(L.id, v);
    return v;
  };
  return new Set(doc.layers.filter((l) => l.type !== "camera" && alive(l)).map((l) => l.id));
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

function drawRows(ctx: CanvasRenderingContext2D, doc: Doc, rows: Row[], w: number, win: Win, sel: string[], ai: Record<string, number>, keySel: { layer: string; channel: string; index: number } | null, hits: Hit[], camLane = false, live: Set<string> | null = null) {
  const X = (t: number) => PAD + (t - win.start) * win.pps;
  const now = Date.now();
  ctx.font = "500 11px Inter Variable, system-ui, sans-serif";
  ctx.textBaseline = "middle";
  // grid
  const step = niceStep(win.pps);
  for (let t = Math.ceil(win.start / step) * step; X(t) < w; t += step) {
    ctx.fillStyle = Math.abs(t - Math.round(t)) < 1e-6 ? "#e9e8ec" : "#f3f2f5";
    ctx.fillRect(Math.round(X(t)), 0, 1, rows.length * ROW);
  }
  const dur = doc.comp.dur;
  ctx.fillStyle = "rgba(25,23,28,.035)";
  ctx.fillRect(X(dur), 0, Math.max(0, w - X(dur)), rows.length * ROW);
  rows.forEach((row, i) => {
    const y = i * ROW;
    const L = row.L;
    const isSel = sel.includes(L.id);
    ctx.fillStyle = isSel && row.kind === "layer" ? "rgba(10,155,240,.05)" : "transparent";
    ctx.fillRect(0, y, w, ROW);
    ctx.fillStyle = "#f3f2f5";
    ctx.fillRect(0, y + ROW - 1, w, 1);
    const [a, b] = span(doc, L);
    // what's on screen at the playhead stays bright; everything else steps back
    const dim = !!live && live.size > 0 && !live.has(L.id) && !isSel;
    ctx.globalAlpha = dim ? 0.3 : 1;
    if (row.kind === "layer") {
      const x0 = X(a), x1 = X(b);
      if (live && live.has(L.id) && !camLane) {
        ctx.save();
        ctx.shadowColor = "rgba(108,92,231,.35)";
        ctx.shadowBlur = 10;
        ctx.fillStyle = "rgba(108,92,231,.10)";
        rr(ctx, x0, y + 4, x1 - x0, ROW - 8, (ROW - 8) / 2);
        ctx.fill();
        ctx.restore();
      }
      const top = y + 4, h = ROW - 8;
      const pill = h / 2;
      // behaviour clips (computed first: the whole bar takes the colour of the layer's main animation)
      const { clips, lanes } = clipLanes(doc, L);
      const main = clips.find((c) => !c.loop) ?? clips[0];
      const isLive = !camLane && !!live && live.has(L.id);
      ctx.fillStyle = camLane ? "rgba(255,154,61,.18)" : isLive ? LIVE : main ? hexA(behColor(main.bh.use), 0.62) : isSel ? "rgba(10,155,240,.14)" : "#efeef2";
      rr(ctx, x0, top, x1 - x0, h, pill);
      ctx.fill();
      // a live bar carries its layer's name (behaviour clips, drawn next, keep their own labels)
      const firstClip = Math.min(...clips.filter((c) => !c.loop).map((c) => X(c.t0)), x1);
      if (isLive && firstClip - x0 > 40) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, top, firstClip - x0 - 4, h);
        ctx.clip();
        ctx.fillStyle = "#ffffff";
        ctx.font = "600 11px Inter Variable, system-ui, sans-serif";
        ctx.fillText(`▸ ${layerLabel(L)}`, x0 + 10, top + h / 2 + 0.5);
        ctx.restore();
      }
      if (isSel) {
        ctx.strokeStyle = "#0a9bf0";
        ctx.lineWidth = 1.5;
        rr(ctx, x0 + 0.75, top + 0.75, x1 - x0 - 1.5, h - 1.5, pill);
        ctx.stroke();
      }
      hits.push({ kind: "bar", x: x0 + 6, y: top, w: Math.max(0, x1 - x0 - 12), h, id: L.id });
      if (!camLane) {
        hits.push({ kind: "barL", x: x0 - 4, y: top, w: 10, h, id: L.id });
        hits.push({ kind: "barR", x: x1 - 6, y: top, w: 10, h, id: L.id });
      }
      const lh = (h - 4) / lanes;
      for (const c of clips) {
        const cx0 = X(c.t0), cx1 = X(c.t1);
        const cy = top + 2 + c.lane * lh;
        const col = behColor(c.bh.use);
        const cr = (lh - 1) / 2;
        ctx.fillStyle = hexA(col, c.loop ? 0.16 : 1);
        rr(ctx, cx0 + 1, cy + 0.5, Math.max(4, cx1 - cx0 - 2), lh - 1, cr);
        ctx.fill();
        // a light divider where the animation ends, so its edge is still easy to find and drag
        if (!c.loop && cx1 < x1 - 6) {
          ctx.fillStyle = "rgba(255,255,255,.85)";
          ctx.fillRect(cx1 - 1.5, cy + 3, 1.5, lh - 6);
        }
        if (c.loop) {
          ctx.strokeStyle = hexA(col, 0.75);
          ctx.setLineDash([3, 3]);
          ctx.lineWidth = 1;
          rr(ctx, cx0 + 1.5, cy + 1, Math.max(4, cx1 - cx0 - 3), lh - 2, cr);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        if (cx1 - cx0 > 34 && lh > 9) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(cx0, cy, cx1 - cx0 - 4, lh);
          ctx.clip();
          ctx.fillStyle = "#19171c";
          ctx.font = `600 ${lh > 14 ? 11 : 9.5}px Inter Variable, system-ui, sans-serif`;
          ctx.fillText(CATALOG[c.bh.use]?.label ?? c.bh.use, cx0 + 9, cy + lh / 2 + 0.5);
          ctx.restore();
        }
        hits.push({ kind: "clip", x: cx0, y: cy, w: Math.max(4, cx1 - cx0 - 6), h: lh, id: L.id, beh: c.bh.id });
        if (!c.loop) hits.push({ kind: "clipR", x: cx1 - 6, y: cy, w: 8, h: lh, id: L.id, beh: c.bh.id });
      }
      // collapsed key ticks
      for (const tr of Object.values(L.keys ?? {}))
        for (const k of tr) {
          const kx = X(a + k[0]);
          ctx.fillStyle = "#f59e0b";
          diamond(ctx, kx, top + h - 2, 3);
        }
      const age = now - (ai[L.id] ?? 0);
      if (age < 5000) {
        const al = 1 - age / 5000;
        ctx.strokeStyle = `rgba(139,92,246,${al})`;
        ctx.lineWidth = 2;
        rr(ctx, x0 - 1.5, top - 1.5, x1 - x0 + 3, h + 3, (h + 3) / 2);
        ctx.stroke();
      }
    } else {
      const tr = L.keys?.[row.ch] ?? [];
      ctx.strokeStyle = "#dcdae0";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      tr.forEach((k, j) => (j ? ctx.lineTo(X(a + k[0]), y + ROW / 2) : ctx.moveTo(X(a + k[0]), y + ROW / 2)));
      ctx.stroke();
      tr.forEach((k, j) => {
        const kx = X(a + k[0]);
        const isK = keySel && keySel.layer === L.id && keySel.channel === row.ch && keySel.index === j;
        ctx.fillStyle = isK ? "#19171c" : "#f59e0b";
        keyGlyph(ctx, kx, y + ROW / 2, isK ? 6.5 : 5.5, j > 0 ? interp(k[2], "in") : null, j < tr.length - 1 ? interp(tr[j + 1][2], "out") : null);
        if (win.pps > 60) {
          ctx.fillStyle = "#8a8691";
          ctx.font = "10px JetBrains Mono Variable, monospace";
          ctx.fillText(String(Math.round(k[1] * 100) / 100), kx + 9, y + ROW / 2 + 0.5);
        }
        hits.push({ kind: "key", x: kx - 7, y: y + 4, w: 14, h: ROW - 8, id: L.id, ch: row.ch, idx: j });
      });
    }
  });
  ctx.globalAlpha = 1;
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

/* ------------------------------ audio lanes ------------------------------ */
type AHitKind = "abody" | "aL" | "aR";
interface AHit { kind: AHitKind; x: number; y: number; w: number; h: number; id: string }

/** One lane per audio track: a clip with its waveform (shaped by the fades), name pill, trim handles. */
function drawAudio(ctx: CanvasRenderingContext2D, doc: Doc, w: number, win: Win, focus: string | null, hits: AHit[]) {
  const X = (t: number) => PAD + (t - win.start) * win.pps;
  const T = (x: number) => (x - PAD) / win.pps + win.start;
  const H = doc.audio.length * LANE;
  const step = niceStep(win.pps);
  for (let t = Math.ceil(win.start / step) * step; X(t) < w; t += step) {
    ctx.fillStyle = Math.abs(t - Math.round(t)) < 1e-6 ? "#e9e8ec" : "#f3f2f5";
    ctx.fillRect(Math.round(X(t)), 0, 1, H);
  }
  const dur = doc.comp.dur;
  doc.audio.forEach((raw, i) => {
    const a = timing(raw);
    const y = i * LANE;
    ctx.fillStyle = "#f3f2f5";
    ctx.fillRect(0, y + LANE - 1, w, 1);
    const ready = peekBuffer(raw.src);
    const fileDur = ready?.buf.duration ?? fileDuration(raw.src);
    const len = fileDur !== null ? clipLength(a, fileDur) : Math.max(0.5, dur - a.at);
    const x0 = X(a.at), x1 = Math.max(x0 + 6, X(a.at + len));
    const top = y + 5, h = LANE - 10, mid = top + h / 2;
    const col = a.muted ? "#a3a0aa" : AUDIO_COL;
    const focused = focus === raw.id;
    ctx.fillStyle = hexA(col, a.muted ? 0.07 : focused ? 0.16 : 0.11);
    rr(ctx, x0, top, x1 - x0, h, 9);
    ctx.fill();
    ctx.save();
    rr(ctx, x0, top, x1 - x0, h, 9);
    ctx.clip();
    if (ready && fileDur !== null) {
      const half = h / 2 - 3;
      const env = { ...a, volume: 1, muted: false };
      const vis = Math.min(1, 0.45 + 0.55 * Math.min(1.2, a.volume));
      for (let px = Math.max(0, Math.floor(x0)); px < Math.min(w, x1); px++) {
        const t = T(px);
        const f0 = a.offset + (t - a.at);
        if (f0 < 0) continue;
        const [m, r] = peakRange(ready.peaks, f0, f0 + 1 / win.pps);
        const inComp = t < dur;
        const g = (inComp ? gainAt(env, t, fileDur, dur) : 0.3) * vis;
        // gamma so quiet passages still read; rms drawn darker inside the peak envelope
        const hm = Math.max(0.5, Math.pow(m, 0.6) * half * g), hr = Math.max(0.5, Math.min(Math.pow(m, 0.6), Math.pow(r * 1.4, 0.6)) * half * g);
        ctx.fillStyle = hexA(col, inComp ? 0.38 : 0.16);
        ctx.fillRect(px, mid - hm, 1, hm * 2);
        ctx.fillStyle = hexA(col, inComp ? 0.85 : 0.3);
        ctx.fillRect(px, mid - hr, 1, hr * 2);
      }
      // fade ramps: a thin gain line over the fades
      const span = { start: a.at, end: Math.min(dur, a.at + len) };
      const fin = Math.min(a.fadeIn, (span.end - span.start) / 2), fout = Math.min(a.fadeOut, (span.end - span.start) / 2);
      ctx.strokeStyle = hexA(col, 0.9);
      ctx.lineWidth = 1.25;
      if (fin > 0.01) {
        ctx.beginPath();
        ctx.moveTo(X(span.start), top + h - 1);
        ctx.lineTo(X(span.start + fin), top + 1);
        ctx.stroke();
      }
      if (fout > 0.01) {
        ctx.beginPath();
        ctx.moveTo(X(span.end - fout), top + 1);
        ctx.lineTo(X(span.end), top + h - 1);
        ctx.stroke();
      }
    } else {
      // decoding (or missing): a calm dotted centre line
      ctx.strokeStyle = hexA(col, 0.45);
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(x0 + 8, mid);
      ctx.lineTo(x1 - 8, mid);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
    if (focused) {
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.5;
      rr(ctx, x0 + 0.75, top + 0.75, x1 - x0 - 1.5, h - 1.5, 8.5);
      ctx.stroke();
    }
    // name pill (stays readable over the waveform, sticks to the left edge when scrolled)
    const err = bufferError(raw.src);
    const label = `${displayName(raw)}${a.muted ? " · muted" : ""}${err ? " · can't load" : !ready ? " · loading…" : ""}`;
    ctx.font = "600 10.5px Inter Variable, system-ui, sans-serif";
    const tw = ctx.measureText(label).width;
    const lx = Math.max(x0 + 6, Math.min(PAD, x1 - tw - 22));
    if (x1 - lx > 30) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, top, x1 - x0 - 4, h);
      ctx.clip();
      ctx.fillStyle = "rgba(255,255,255,.88)";
      rr(ctx, lx, top + 3, tw + 14, 15, 7.5);
      ctx.fill();
      ctx.fillStyle = err ? "#e5484d" : a.muted ? "#8a8691" : "#2f3aa8";
      ctx.textBaseline = "middle";
      ctx.fillText(label, lx + 7, top + 10.5);
      ctx.restore();
    }
    hits.push({ kind: "abody", x: x0 + 6, y: top, w: Math.max(0, x1 - x0 - 12), h, id: raw.id });
    hits.push({ kind: "aL", x: x0 - 4, y: top, w: 10, h, id: raw.id });
    hits.push({ kind: "aR", x: x1 - 6, y: top, w: 10, h, id: raw.id });
  });
  ctx.fillStyle = "rgba(25,23,28,.035)";
  ctx.fillRect(X(dur), 0, Math.max(0, w - X(dur)), H);
}

/** Scenes band: planned = dashed outline, building = moving stripes, done = solid. */
function drawScenes(ctx: CanvasRenderingContext2D, doc: Doc, w: number, win: Win, now: number) {
  const X = (t: number) => PAD + (t - win.start) * win.pps;
  ctx.font = "600 11px Inter Variable, system-ui, sans-serif";
  ctx.textBaseline = "middle";
  doc.scenes.forEach((sc, i) => {
    const col = SCENE_COLS[i % SCENE_COLS.length];
    const x0 = X(sc.start) + 1, x1 = X(sc.start + sc.dur) - 1;
    if (x1 < 0 || x0 > w) return;
    const top = 4, h = BAND - 8;
    const st = sc.status ?? "planned";
    ctx.save();
    rr(ctx, x0, top, x1 - x0, h, 6);
    if (st === "done") {
      ctx.fillStyle = hexA(col, 0.88);
      ctx.fill();
    } else if (st === "building") {
      ctx.fillStyle = hexA(col, 0.14);
      ctx.fill();
      ctx.clip();
      ctx.strokeStyle = hexA(col, 0.38);
      ctx.lineWidth = 5;
      const off = ((now / 40) % 14) - 14;
      for (let x = x0 + off - h; x < x1 + h; x += 14) {
        ctx.beginPath();
        ctx.moveTo(x, top + h);
        ctx.lineTo(x + h, top);
        ctx.stroke();
      }
    } else {
      ctx.fillStyle = hexA(col, 0.07);
      ctx.fill();
      ctx.strokeStyle = hexA(col, 0.8);
      ctx.lineWidth = 1.25;
      ctx.setLineDash([4, 3]);
      rr(ctx, x0 + 0.6, top + 0.6, x1 - x0 - 1.2, h - 1.2, 5.5);
      ctx.stroke();
    }
    ctx.restore();
    if (x1 - x0 > 26) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0 + 2, top, x1 - x0 - 6, h);
      ctx.clip();
      ctx.fillStyle = st === "done" ? "#fff" : "#19171c";
      const tag = st === "building" ? " · building" : "";
      ctx.fillText(`${sc.title}${tag}`, x0 + 8, top + h / 2 + 0.5);
      ctx.restore();
    }
  });
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
  const [order, setOrderState] = useState<RowOrder>(() => {
    try {
      return localStorage.getItem("fusion-tl-order") === "stack" ? "stack" : "time";
    } catch {
      return "time";
    }
  });
  const setOrder = (o: RowOrder) => {
    setOrderState(o);
    try {
      localStorage.setItem("fusion-tl-order", o);
    } catch {
      /* private mode: the choice lasts for this session */
    }
  };
  const rows = useMemo(() => buildRows(doc, expanded, pro, order), [doc, expanded, pro, order]);
  // layers on screen at the playhead; recomputed per frame but only re-renders when the set changes
  const [live, setLive] = useState<Set<string>>(() => liveAt(doc, playhead.get()));
  useEffect(() => {
    let key = "";
    const update = () => {
      const next = liveAt(doc, playhead.get());
      const k = [...next].join("|");
      if (k !== key) {
        key = k;
        setLive(next);
      }
    };
    update();
    return playhead.subscribe(update);
  }, [doc]);
  const cam = activeCamera(doc);
  const [height, setHeight] = useState(pro ? 320 : 280);
  const [width, setWidth] = useState(800);
  const [win, setWin] = useState<Win>({ start: 0, pps: 100 });
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [audioTip, setAudioTip] = useState<{ x: number; text: string } | null>(null);
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
  const audioCanvas = useRef<HTMLCanvasElement>(null);
  const audioHead = useRef<HTMLDivElement>(null);
  const bandCanvas = useRef<HTMLCanvasElement>(null);
  const audioHits = useRef<AHit[]>([]);
  const [audioTick, setAudioTick] = useState(0);
  const musicFocus = useMusicUI((s) => s.target);
  const hasScenes = doc.scenes.length > 0;
  const audioH = doc.audio.length * LANE;
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
    drawRows(ctx, doc, rows, width, win, sel, ai, keySel, hits.current, false, live);
    const cc = camCanvas.current;
    if (cc) {
      const cctx = fitCanvas(cc, width, ROW);
      camHits.current = [];
      if (cam) drawRows(cctx, doc, [{ kind: "layer", L: cam, indent: 0 }], width, win, sel, ai, keySel, camHits.current, true);
    }
  }, [doc, rows, width, win, sel, ai, keySel, cam, live]);

  // soundtrack: the engine follows the playhead for the life of the page; lanes redraw as audio decodes
  useEffect(() => {
    startAudioEngine(displayDoc, (fn) => useStore.subscribe(fn));
    const offLoaded = onAudioLoaded(() => setAudioTick((n) => n + 1));
    const offAssets = onAssetsChanged(() => {
      for (const a of displayDoc().audio) retryBuffer(a.src);
      setAudioTick((n) => n + 1);
    });
    (window as unknown as Record<string, unknown>).__audio = { debug: audioDebug, preview, mix: () => import("../../audio/mix").then((m) => m.mixSoundtrack(useStore.getState().doc)) };
    return () => {
      offLoaded();
      offAssets();
    };
  }, []);
  useEffect(() => {
    const c = audioCanvas.current;
    if (!c || !doc.audio.length) return;
    const ctx = fitCanvas(c, width, audioH);
    audioHits.current = [];
    drawAudio(ctx, doc, width, win, musicFocus ?? doc.audio[0]?.id ?? null, audioHits.current);
  }, [doc, width, win, musicFocus, audioTick, audioH]);

  // scenes band: redrawn with the playhead; a "building" scene animates on its own
  const drawBand = () => {
    const c = bandCanvas.current;
    if (!c || !hasScenes) return;
    const ctx = fitCanvas(c, width, BAND);
    drawScenes(ctx, doc, width, win, performance.now());
    const px = X(playhead.get());
    ctx.fillStyle = "#0a9bf0";
    ctx.fillRect(px - 0.75, 0, 1.5, BAND);
  };
  const building = doc.scenes.some((sc) => sc.status === "building");
  useEffect(() => {
    drawBand();
    if (!building) return;
    let raf = 0;
    const loop = () => {
      drawBand();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }); // eslint-disable-line react-hooks/exhaustive-deps

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
          ctx.fillStyle = major ? "#cfcdd4" : "#e6e5e9";
          ctx.fillRect(Math.round(X(s)), major ? 14 : 20, 1, major ? 14 : 8);
          if (major) {
            ctx.fillStyle = "#8a8691";
            ctx.fillText(step < 1 ? s.toFixed(2) : `${Math.round(s)}s`, X(s) + 4, 9);
          }
        }
        for (const m of doc.markers) {
          ctx.fillStyle = "#ff9f43";
          diamond(ctx, X(m.t), 22, 4);
        }
        const px = X(t);
        ctx.save();
        ctx.shadowColor = "rgba(10,155,240,.45)";
        ctx.shadowBlur = 6;
        ctx.fillStyle = "#0a9bf0";
        rr(ctx, px - 7, 3, 14, 16, 7);
        ctx.fill();
        ctx.restore();
      }
      if (headRef.current) headRef.current.style.transform = `translateX(${X(t)}px)`;
      if (audioHead.current) audioHead.current.style.transform = `translateX(${X(t)}px)`;
      drawBand();
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

  // Follow the playhead: glide the list so the layers on screen stay in view (the first one a row from the
  // top, so what just finished is still visible above it). A scroll by the user pauses this for 4 s.
  const userScrolledAt = useRef(-Infinity);
  // The names column and the tracks scroll in sync. Every programmatic scroll records where it put each column,
  // so the scroll events it causes are recognised as echoes — never mistaken for the user, never copied back
  // (a lagging echo copied back used to drag the list backwards and pause the follow).
  const glidePos = useRef(-1);
  const namesPos = useRef(-1);
  const scrollBoth = (v: number) => {
    const wrap = tracksWrap.current;
    if (!wrap) return;
    wrap.scrollTop = v;
    glidePos.current = wrap.scrollTop;
    if (namesRef.current) {
      namesRef.current.scrollTop = wrap.scrollTop;
      namesPos.current = namesRef.current.scrollTop;
    }
  };
  const glide = useRef({ target: 0, raf: 0, last: 0, wake: 0, kick: () => {} });
  const userScrolled = () => {
    userScrolledAt.current = performance.now();
    glide.current.kick(); // arms the timer that resumes the follow
  };
  useEffect(() => {
    const g = glide.current;
    const step = (now: number) => {
      g.raf = 0;
      const wrap = tracksWrap.current;
      if (!wrap) return;
      const paused = 4000 - (performance.now() - userScrolledAt.current);
      if (paused > 0) {
        // the user scrolled: pick the follow back up once they've left it alone for 4 s
        clearTimeout(g.wake);
        g.wake = window.setTimeout(() => {
          g.last = 0;
          if (!g.raf) g.raf = requestAnimationFrame(step);
        }, paused + 20);
        return;
      }
      const target = Math.min(Math.max(0, g.target), Math.max(0, wrap.scrollHeight - wrap.clientHeight));
      const d = target - wrap.scrollTop;
      if (Math.abs(d) < 1) return;
      // time-based easing: the same glide at 30, 60 or 120 fps (≈ 90% of the way in 0.2 s)
      const dt = Math.min(0.1, g.last ? (now - g.last) / 1000 : 1 / 60);
      g.last = now;
      scrollBoth(wrap.scrollTop + Math.sign(d) * Math.max(1, Math.abs(d) * (1 - Math.exp(-dt * 11))));
      g.raf = requestAnimationFrame(step);
    };
    g.kick = () => {
      if (!g.raf) g.raf = requestAnimationFrame(step);
    };
    // frame the window of rows that shows the most live layers (earliest such window; one row of context above)
    const wrap = tracksWrap.current;
    const isLive = rows.map((r) => (r.kind === "layer" && live.has(r.L.id) ? 1 : 0));
    const first = isLive.indexOf(1);
    if (wrap && first >= 0) {
      const V = Math.max(1, Math.floor(wrap.clientHeight / ROW) - 1);
      let best = first, bestN = -1, n = 0;
      for (let i = 0; i < isLive.length; i++) {
        n += isLive[i] - (i >= V ? isLive[i - V] : 0);
        const start = Math.max(0, i - V + 1);
        if (n > bestN && isLive[start]) [best, bestN] = [start, n];
      }
      g.target = Math.max(0, (best - 1) * ROW);
      if (!g.raf) {
        g.last = 0;
        g.raf = requestAnimationFrame(step);
      }
    }
    return () => {
      cancelAnimationFrame(g.raf);
      clearTimeout(g.wake);
      g.raf = 0;
    };
  }, [rows, live]);

  // geometry hook for tests and agents that drive the UI (screen coords of rows, times, clips)
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__timeline = {
      x: (t: number) => (tracksCanvas.current?.getBoundingClientRect().left ?? 0) + X(t),
      rowY: (id: string, ch?: string) => {
        const i = rows.findIndex((r) => r.L.id === id && (ch ? r.kind === "channel" && r.ch === ch : r.kind === "layer"));
        if (i < 0) return null;
        // bring the row into the visible part of the scrolling track list first
        const wrap = tracksWrap.current;
        if (wrap && (i * ROW < wrap.scrollTop || (i + 1) * ROW > wrap.scrollTop + wrap.clientHeight)) {
          scrollBoth(Math.max(0, i * ROW - (wrap.clientHeight - ROW) / 2));
        }
        const top = tracksCanvas.current?.getBoundingClientRect().top ?? 0;
        return top + i * ROW + ROW / 2;
      },
      camY: () => {
        const r = camCanvas.current?.getBoundingClientRect();
        return r ? r.top + ROW / 2 : null;
      },
      audioY: (id: string) => {
        const i = doc.audio.findIndex((a) => a.id === id);
        const r = audioCanvas.current?.getBoundingClientRect();
        return i < 0 || !r ? null : r.top + i * LANE + LANE / 2;
      },
      audioX: (t: number) => (audioCanvas.current?.getBoundingClientRect().left ?? 0) + X(t),
      bandY: () => {
        const r = bandCanvas.current?.getBoundingClientRect();
        return r ? r.top + BAND / 2 : null;
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

  /* ------------------------------ audio lanes ------------------------------ */
  const audioHitAt = (e: { clientX: number; clientY: number }, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    return { x, y, r, hit: [...audioHits.current].reverse().find((h) => x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) };
  };
  const onAudioDown = (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLCanvasElement;
    const { x, r, hit } = audioHitAt(e, el);
    if (!hit) return startScrub(e);
    focusTrack(hit.id);
    const st = useStore.getState();
    const base = st.doc;
    const raw = base.audio.find((a) => a.id === hit.id);
    if (!raw) return;
    const a = timing(raw);
    const fileDur = fileDuration(raw.src);
    const len = fileDur !== null ? clipLength(a, fileDur) : a.dur ?? base.comp.dur - a.at;
    const cands = [...snapTimes(base, ""), ...base.scenes.flatMap((sc) => [sc.start, sc.start + sc.dur]), ...base.audio.filter((o) => o.id !== hit.id).map((o) => timing(o).at)];
    const t0 = T(x);
    const name = displayName(raw);
    let ops: Op[] = [];
    let label = "";
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const d = T(ev.clientX - r.left) - t0;
      const free = ev.altKey;
      const fps = base.comp.fps;
      if (hit.kind === "abody") {
        // snap either edge, whichever is closer to something
        const sAt = snap(a.at + d, cands, fps, free), sEnd = snap(a.at + len + d, cands, fps, free) - len;
        const at = Math.max(0, r3(Math.abs(sEnd - (a.at + d)) < Math.abs(sAt - (a.at + d)) ? sEnd : sAt));
        ops = [{ op: "set", path: `audio/${hit.id}/at`, value: at }];
        label = `${name} starts ${at.toFixed(2)}s`;
      } else if (hit.kind === "aL") {
        // trim the head: the music under the playhead stays put, only the clip's start moves
        const lo = Math.max(0, a.at - a.offset), hi = a.at + len - 0.1;
        const at = r3(Math.min(hi, Math.max(lo, snap(a.at + d, cands, fps, free))));
        const dd = at - a.at;
        ops = [
          { op: "set", path: `audio/${hit.id}/at`, value: at },
          { op: "set", path: `audio/${hit.id}/offset`, value: r3(Math.max(0, a.offset + dd)) },
          { op: "set", path: `audio/${hit.id}/dur`, value: r3(len - dd) },
        ];
        label = `trim in → ${at.toFixed(2)}s (file ${(a.offset + dd).toFixed(2)}s)`;
      } else {
        const maxEnd = fileDur !== null ? a.at + (fileDur - a.offset) : Infinity;
        const end = Math.min(maxEnd, Math.max(a.at + 0.1, snap(a.at + len + d, cands, fps, free)));
        ops = [{ op: "set", path: `audio/${hit.id}/dur`, value: r3(end - a.at) }];
        label = `${name} ends ${end.toFixed(2)}s`;
      }
      const res = applyTxn(base, ops, { source: "you", validate: false });
      if (res.ok) useStore.getState().setTransient(res.doc);
      setAudioTip({ x: ev.clientX - r.left, text: label });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setAudioTip(null);
      const s2 = useStore.getState();
      s2.setTransient(null);
      if (ops.length) {
        const res = s2.commit(ops, { source: "you", intent: label || "Moved music" });
        if (!res.ok) s2.toast(res.errors[0], "error");
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const onAudioMove = (e: React.PointerEvent) => {
    if (e.buttons) return;
    const el = e.currentTarget as HTMLCanvasElement;
    const { hit } = audioHitAt(e, el);
    el.style.cursor = !hit ? "text" : hit.kind === "abody" ? "grab" : "ew-resize";
  };
  const onAudioDbl = (e: React.MouseEvent) => {
    const { hit } = audioHitAt(e, e.currentTarget as HTMLElement);
    if (hit) openMusic(hit.id);
  };
  const sceneAt = (clientX: number, el: HTMLElement) => {
    const x = clientX - el.getBoundingClientRect().left;
    return doc.scenes.find((sc) => x >= X(sc.start) && x <= X(sc.start + sc.dur));
  };
  const onBandDown = (e: React.PointerEvent) => {
    const sc = sceneAt(e.clientX, e.currentTarget as HTMLElement);
    if (!sc) return startScrub(e);
    playhead.pause();
    playhead.set(sc.start);
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

  // the music lanes and the scenes band are added on top of the chosen height, so they never squeeze the layer rows
  const pinnedH = (doc.audio.length ? Math.min(3, doc.audio.length) * LANE : 34) + 1 + (hasScenes ? BAND : 0);
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
  // curves view target: the selected key's layer and channel, else the selected layer (keyed first)
  const graphTarget = (() => {
    if (!graphOpen) return null;
    const L =
      (keySel && doc.layers.find((l) => l.id === keySel.layer)) ||
      doc.layers.find((l) => sel.includes(l.id) && Object.keys(l.keys ?? {}).length) ||
      doc.layers.find((l) => sel.includes(l.id)) ||
      null;
    const keyed = Object.keys(L?.keys ?? {}).filter((c) => (L?.keys?.[c]?.length ?? 0) > 0);
    const ch = keySel && L?.id === keySel.layer && keyed.includes(keySel.channel) ? keySel.channel : keyed[0] ?? null;
    const index = keySel && L && keySel.layer === L.id && keySel.channel === ch ? keySel.index : null;
    return { L, keyed, ch, index };
  })();
  return (
    <section className="timeline" style={{ height: height + pinnedH, ["--names" as string]: `${namesW}px`, gridTemplateRows: "6px 44px minmax(0, 1fr) auto auto" }} aria-label="Timeline">
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
        <button className={`chip-toggle tl-music-btn${doc.audio.length ? " has" : ""}`} onClick={() => openMusic()} data-testid="music-button" title="Music: free tracks or your own file">
          <NoteGlyph size={12} />
          <span>{doc.audio.length ? displayName(doc.audio[0]) : "Add music"}</span>
          {doc.audio.length > 1 && <span className="tl-music-n">+{doc.audio.length - 1}</span>}
        </button>
        <div className="tl-legend">
          {Object.entries(BEH_COLORS).map(([k, c]) => (
            <span key={k}>
              <i style={{ background: c }} />
              {k}
            </span>
          ))}
          <span>
            <i style={{ background: "var(--key)", borderRadius: 1, transform: "rotate(45deg) scale(.8)" }} />
            Keyframe
          </span>
        </div>
        <div className="spacer" />
        {pro && (
          <>
            <button className={`chip-toggle${doc.comp.motionBlur ? " on" : ""}`} data-testid="mb-toggle" title="Motion blur for the whole comp (AE's comp switch). Per-layer switches live in the inspector." onClick={toggleMB}>
              <span className="mb-glyph" aria-hidden="true" />Motion blur
            </button>
            <div className="seg sm tl-view" role="group" aria-label="Timeline view">
              <button aria-pressed={!graphOpen} onClick={() => st.set("graphOpen", false)} title="Layers as bars: when things happen">
                Bars
              </button>
              <button aria-pressed={graphOpen} data-testid="graph-toggle" onClick={() => st.set("graphOpen", !graphOpen)} title="Motion curves: how things speed up and slow down (⇧F3)">
                <Icon name="graph" sm />Curves
              </button>
            </div>
          </>
        )}
        <div className="seg sm tl-view" role="group" aria-label="Layer order">
          <button aria-pressed={order === "time"} data-testid="order-time" onClick={() => setOrder("time")} title="Layers in the order they appear: a waterfall that follows the playhead">
            Time
          </button>
          <button aria-pressed={order === "stack"} data-testid="order-stack" onClick={() => setOrder("stack")} title="Layers front to back, as they're drawn">
            Stack
          </button>
        </div>
        <span className="faint" style={{ fontSize: 11.5, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {pro ? "Drag bars, clips and keys · edges trim · Alt = no snap" : "Drag bars to retime · Pro mode for keyframes"}
        </span>
        <button className="iconbtn" onClick={() => zoom(1 / 1.5)} title="Zoom out (⌘ + wheel)" aria-label="Zoom out"><Icon name="zoomout" sm /></button>
        <button className="iconbtn" onClick={() => zoom(1.5)} title="Zoom in" aria-label="Zoom in"><Icon name="zoomin" sm /></button>
        <button className="iconbtn" onClick={fitAll} title="Fit timeline" aria-label="Fit timeline"><Icon name="fit" sm /></button>
      </div>
      <div style={{ display: "grid", gridTemplateRows: hasScenes ? `28px ${BAND}px minmax(0,1fr)` : "28px minmax(0,1fr)", minHeight: 0 }}>
        <div className="tl-body" style={{ gridTemplateColumns: `${namesW}px minmax(0,1fr)` }}>
          <div className="tl-ruler-name">{rows.length} layers</div>
          <canvas ref={ruler} onPointerDown={startScrub} style={{ cursor: "col-resize", display: "block", borderBottom: "1px solid var(--line)" }} data-testid="ruler" />
        </div>
        {hasScenes && (
          <div className="tl-body tl-band" style={{ gridTemplateColumns: `${namesW}px minmax(0,1fr)` }}>
            <div className="tl-ruler-name tl-band-name">Scenes · {doc.scenes.length}</div>
            <canvas
              ref={bandCanvas}
              data-testid="scenes-band"
              onPointerDown={onBandDown}
              onPointerMove={(e) => ((e.currentTarget as HTMLElement).style.cursor = sceneAt(e.clientX, e.currentTarget as HTMLElement) ? "pointer" : "col-resize")}
              title="Click a scene to jump to it"
            />
          </div>
        )}
        <div className="tl-body" style={{ gridTemplateColumns: `${namesW}px minmax(0,1fr)` }}>
          <div className="tl-names" ref={namesRef} onWheel={userScrolled} onScroll={(e) => {
            const v = (e.target as HTMLElement).scrollTop;
            if (Math.abs(v - namesPos.current) <= 1) return; // an echo of syncing it to the tracks
            namesPos.current = v; // the user scrolled the names: the tracks follow
            userScrolled();
            if (tracksWrap.current && Math.abs(tracksWrap.current.scrollTop - v) > 1) {
              tracksWrap.current.scrollTop = v;
              glidePos.current = tracksWrap.current.scrollTop;
            }
          }}>
            {rows.map((row) =>
              row.kind === "layer" ? (
                <div
                  key={row.L.id}
                  className={`tl-name${sel.includes(row.L.id) ? " sel" : ""}${live.size && !live.has(row.L.id) ? " dim" : ""}`}
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
                  <span className="nm">{layerLabel(row.L)}</span>
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
              const v = (e.target as HTMLElement).scrollTop;
              if (Math.abs(v - glidePos.current) <= 2) return; // our own scroll (or its echo)
              userScrolled();
              if (namesRef.current && Math.abs(namesRef.current.scrollTop - v) > 1) {
                namesRef.current.scrollTop = v;
                namesPos.current = namesRef.current.scrollTop;
              }
            }}
            onWheel={onWheel}
          >
            <canvas ref={tracksCanvas} data-testid="tracks" style={{ display: graphOpen ? "none" : "block" }} onPointerDown={(e) => onTrackDown(e, "main")} onPointerMove={(e) => onTrackMove(e, "main")} onDoubleClick={onTrackDbl} />
            {graphOpen && graphTarget && (
              <CurvePanel L={graphTarget.L} keyed={graphTarget.keyed} ch={graphTarget.ch} keyIndex={graphTarget.index} width={width} height={Math.max(146, height - 140)} X={X} />
            )}
            {!rows.length && <div className="faint" style={{ position: "absolute", top: 10, left: 14 }}>Add something from the toolbar or ask the AI.</div>}
          </div>
          <div ref={headRef} style={{ position: "absolute", top: 0, bottom: 0, left: namesW, width: 1.5, background: "#0a9bf0", pointerEvents: "none", boxShadow: "0 0 6px rgba(10,155,240,.4)" }} />
          {tip && <div className="vbadge" style={{ position: "absolute", left: namesW + tip.x + 12, top: Math.max(0, tip.y - 30), pointerEvents: "none", color: "var(--text)" }}>{tip.text}</div>}
        </div>
      </div>
      <div className="tl-audio" style={{ ["--lanes" as string]: Math.max(1, Math.min(3, doc.audio.length)) }} data-testid="audio-section">
        <div className="tl-audio-scroll">
          <div className="tl-audio-grid" style={{ gridTemplateColumns: `${namesW}px minmax(0,1fr)` }}>
            <div className="tl-audio-names">
              {doc.audio.map((a) => (
                <div
                  key={a.id}
                  className={`tl-name tl-aname${(musicFocus ?? doc.audio[0]?.id) === a.id ? " sel" : ""}${a.muted ? " muted" : ""}`}
                  onClick={() => openMusic(a.id)}
                  title="Open music settings"
                  data-testid={`audio-row-${a.id}`}
                >
                  <NoteGlyph size={13} />
                  <span className="nm">{displayName(a)}</span>
                  <button
                    className={`tl-mute${a.muted ? " on" : ""}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleMute(a.id);
                    }}
                    aria-label={a.muted ? `Unmute ${displayName(a)}` : `Mute ${displayName(a)}`}
                    title={a.muted ? "Unmute" : "Mute"}
                    data-testid={`audio-mute-${a.id}`}
                  >
                    <SpeakerGlyph muted={a.muted} size={13} />
                  </button>
                </div>
              ))}
              {!doc.audio.length && (
                <div className="tl-name tl-aname empty" onClick={() => openMusic(null)}>
                  <NoteGlyph size={13} />
                  <span className="nm">Music</span>
                </div>
              )}
            </div>
            <div className="tl-audio-tracks">
              {doc.audio.length ? (
                <canvas ref={audioCanvas} data-testid="audio-lanes" onPointerDown={onAudioDown} onPointerMove={onAudioMove} onDoubleClick={onAudioDbl} />
              ) : (
                <button className="tl-audio-empty" onClick={() => openMusic(null)} data-testid="audio-empty">
                  <Icon name="plus" sm /> Add music <span className="faint">· free tracks, or upload your own</span>
                </button>
              )}
            </div>
          </div>
        </div>
        {doc.audio.length > 0 && <div ref={audioHead} className="tl-audio-head" style={{ left: namesW }} />}
        {audioTip && <div className="vbadge" style={{ position: "absolute", left: namesW + audioTip.x + 12, top: -30, pointerEvents: "none", color: "var(--text)", zIndex: 3 }}>{audioTip.text}</div>}
      </div>
      <div className="tl-cam">
        <div className="tl-name" onClick={() => cam && st.select([cam.id])} data-testid="camera-lane">
          <Icon name="camera" sm />
          <span className="nm">Camera{cam ? ` · ${cam.id}` : ""}</span>
        </div>
        <canvas ref={camCanvas} onPointerDown={(e) => onTrackDown(e, "cam")} onPointerMove={(e) => onTrackMove(e, "cam")} />
      </div>
      {createPortal(<MusicPicker />, document.body)}
    </section>
  );
}
