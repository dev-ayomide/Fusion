import { CATALOG, type BehSpec } from "../fmd/catalog";
import { fitDistance, type Beh, type CameraLayer, type ClonerLayer, type Doc, type Layer, type TextLayer, type Track } from "../fmd/schema";
import { registerBakeSampler } from "../fmd/ops";
import { easeFn, clamp01 } from "./ease";
import { fbm, strSeed } from "./noise";
import { evalExpr } from "./expr";

/* ------------------------------------------------------------------ *
 * Frame state — everything the renderer needs, nothing it must derive. *
 * ------------------------------------------------------------------ */
export interface Xform {
  x: number; y: number; z: number;
  rx: number; ry: number; rz: number; // degrees
  s: number; o: number;
}
export interface GlyphState { dx: number; dy: number; s: number; rz: number; o: number; wipe: number }
export interface CloneState { x: number; y: number; z: number; s: number; o: number; rz: number; i: number }
export interface LayerFrame {
  id: string;
  type: Layer["type"];
  visible: boolean;
  local: number;
  xf: Xform;
  props: Record<string, number>;
  glyphs?: GlyphState[];
  clones?: CloneState[];
}
export interface CameraFrame { x: number; y: number; z: number; rx: number; ry: number; rz: number; fov: number; target?: [number, number, number] }
export interface Frame { t: number; layers: LayerFrame[]; camera: CameraFrame; byId: Map<string, LayerFrame> }

const DEG = Math.PI / 180;

/* ------------------------------ keys ------------------------------- */
export function keyVal(track: Track, t: number): number {
  if (!track.length) return 0;
  if (t <= track[0][0]) return track[0][1];
  for (let i = 1; i < track.length; i++) {
    const k = track[i];
    if (t <= k[0]) {
      const p = track[i - 1];
      const span = k[0] - p[0];
      const u = span <= 0 ? 1 : (t - p[0]) / span;
      return p[1] + (k[1] - p[1]) * easeFn(k[2] ?? "linear")(u);
    }
  }
  return track[track.length - 1][1];
}

/* --------------------------- static base --------------------------- */
const TUPLE: Record<string, [string, number]> = {
  "pos.x": ["pos", 0], "pos.y": ["pos", 1], "pos.z": ["pos", 2],
  "rot.x": ["rot", 0], "rot.y": ["rot", 1], "rot.z": ["rot", 2],
};
const DEFAULTS: Record<string, number> = { scale: 1, opacity: 1, fov: 35, noise: 0, angle: 90, tracking: 0, radius: 0, spin: 0, gap: 0, blur: 0, trimStart: 0, trimEnd: 1, width: 6, glow: 0, clouds: 0.5, drift: 1, sun: 0.6, hillHeight: 0.25, exposure: 0, contrast: 0, saturation: 0, fade: 0, value: 0, size: 200 };
const NESTED_DEFAULTS: Record<string, number> = { "shadow.opacity": 0.35, "shadow.blur": 40, "glass.blur": 28, "glass.amount": 0.18, "clip.radius": 0 };

export function staticValue(doc: Doc, L: Layer, ch: string): number {
  const t = TUPLE[ch];
  const rec = L as unknown as Record<string, unknown>;
  if (t) {
    const arr = rec[t[0]] as number[] | undefined;
    if (arr && typeof arr[t[1]] === "number") return arr[t[1]];
    if (L.type === "camera" && ch === "pos.z") return fitDistance(doc.comp.h, (L as CameraLayer).fov ?? 35);
    return 0;
  }
  const v = rec[ch];
  if (typeof v === "number") return v;
  if (ch.includes(".")) {
    // nested fields: shadow.opacity, glass.blur, clip.w, vars.amount …
    const [head, tail] = ch.split(".", 2);
    const obj = rec[head] as Record<string, unknown> | undefined;
    const nv = obj?.[tail];
    if (typeof nv === "number") return nv;
    return NESTED_DEFAULTS[ch] ?? 0;
  }
  if (ch === "r" && L.type === "cloner") return 300;
  if (ch === "w" && L.type === "device") return (L as { model: string }).model === "browser" ? 900 : 390;
  if (ch === "gap" && L.type === "cloner") return (L as ClonerLayer).child.w * 1.4;
  return DEFAULTS[ch] ?? 0;
}

/** Track value before behaviors: keys if present, else the static field. */
export function trackValue(doc: Doc, L: Layer, ch: string, local: number): number {
  const tr = L.keys?.[ch];
  return tr && tr.length ? keyVal(tr, local) : staticValue(doc, L, ch);
}

/* ---------------------------- behaviors ---------------------------- */
export function behEase(b: Beh, spec: BehSpec): string {
  if (b.ease) return b.ease;
  const bounce = b.bounce ?? spec.bounce;
  if (bounce !== undefined) return `spring(${b.dur ?? spec.dur},${bounce})`;
  return spec.ease;
}
export function behDur(b: Beh): number {
  return b.dur ?? CATALOG[b.use]?.dur ?? 0.6;
}
function param<T extends number | string>(b: Beh, spec: BehSpec, name: string): T {
  const v = (b as Record<string, unknown>)[name];
  return (v ?? spec.params[name]?.default) as T;
}
function progress(b: Beh, spec: BehSpec, local: number): number {
  const dur = behDur(b);
  const u = dur <= 0 ? 1 : (local - b.at) / dur;
  return easeFn(behEase(b, spec))(clamp01(u));
}

type OwnFn = (ch: string, base: number, p: number, b: Beh, spec: BehSpec, ctx: EvalCtx) => number;
interface EvalCtx { doc: Doc; L: Layer; local: number }

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const OWN: Record<string, OwnFn> = {
  fadeIn: (_c, base, p) => base * clamp01(p),
  fadeOut: (_c, base, p) => base * (1 - clamp01(p)),
  rise: (ch, base, p, b, s) => (ch === "pos.y" ? base - param<number>(b, s, "dist") * (1 - p) : base * clamp01(p * 1.4)),
  drop: (ch, base, p, b, s) => (ch === "pos.y" ? base + param<number>(b, s, "dist") * (1 - p) : base * clamp01(p * 1.4)),
  slideIn: (ch, base, p, b, s) => {
    if (ch === "opacity") return base * clamp01(p * 1.6);
    const sign = param<string>(b, s, "from") === "right" ? -1 : 1;
    return base - sign * param<number>(b, s, "dist") * (1 - p);
  },
  popIn: (ch, base, p, b, s) => {
    if (ch === "opacity") return base * clamp01(p * 4);
    const from = param<number>(b, s, "from");
    return base * (from + (1 - from) * p);
  },
  settle: (ch, base, p, b, s) => {
    if (ch === "opacity") return base * clamp01(p * 3);
    const from = param<number>(b, s, "from");
    return base * (from + (1 - from) * p);
  },
  spinIn: (ch, base, p, b, s) => {
    if (ch === "opacity") return base * clamp01(p * 3);
    if (ch === "scale") return base * Math.max(0, p);
    return base + param<number>(b, s, "deg") * (1 - p);
  },
  flipIn: (ch, base, p, b, s) => (ch === "opacity" ? base * clamp01(p * 2) : base + param<number>(b, s, "deg") * (1 - p)),
  sink: (ch, base, p, b, s) => (ch === "pos.y" ? base - param<number>(b, s, "dist") * p : base * (1 - clamp01(p))),
  dolly: (_c, base, p, b, s) => lerp(base, param<number>(b, s, "to"), p),
  truck: (_c, base, p, b, s) => lerp(base, param<number>(b, s, "to"), p),
  orbit: (ch, base, p, b, s, ctx) => {
    const a = param<number>(b, s, "deg") * p;
    if (ch === "rot.y") return base + a;
    const R = trackValue(ctx.doc, ctx.L, "pos.z", ctx.local);
    const x0 = trackValue(ctx.doc, ctx.L, "pos.x", ctx.local);
    return ch === "pos.x" ? x0 + Math.sin(a * DEG) * R : Math.cos(a * DEG) * R;
  },
};

type AddFn = (ch: string, acc: number, dt: number, b: Beh, spec: BehSpec, seed: number) => number;
const TAU = Math.PI * 2;
const ADD: Record<string, AddFn> = {
  float: (_c, acc, dt, b, s) => acc + param<number>(b, s, "amp") * Math.sin((TAU * dt) / param<number>(b, s, "period")),
  sway: (_c, acc, dt, b, s) => acc + param<number>(b, s, "deg") * Math.sin((TAU * dt) / param<number>(b, s, "period")),
  pulse: (_c, acc, dt, b, s) => acc + param<number>(b, s, "amp") * Math.sin((TAU * dt) / param<number>(b, s, "period")),
  spin: (_c, acc, dt, b, s) => acc + param<number>(b, s, "speed") * dt,
  wiggle: (ch, acc, dt, b, s, seed) => {
    const f = param<number>(b, s, "freq");
    if (ch === "rot.z") return acc + param<number>(b, s, "deg") * fbm(seed + 2, dt * f);
    return acc + param<number>(b, s, "amp") * fbm(seed + (ch === "pos.x" ? 0 : 1), dt * f);
  },
  shake: (ch, acc, dt, b, s, seed) => {
    const f = param<number>(b, s, "freq"), a = param<number>(b, s, "amp");
    if (ch === "rot.z") return acc + a * 0.08 * fbm(seed + 2, dt * f);
    return acc + a * fbm(seed + (ch === "pos.x" ? 0 : 1), dt * f);
  },
};

/** Composition: track → add behaviors → owner → expression. */
export function channel(doc: Doc, L: Layer, ch: string, local: number): number {
  const base = trackValue(doc, L, ch, local);
  let acc = base;
  let owners: Beh[] | null = null;
  for (const b of L.beh ?? []) {
    const spec = CATALOG[b.use];
    if (!spec || !spec.writes.includes(ch)) continue;
    if (spec.mode === "add") {
      const dt = local - b.at;
      if (dt >= 0 && dt <= behDur(b)) acc = ADD[b.use](ch, acc, dt, b, spec, strSeed(L.id + "/" + b.id));
    } else if (spec.mode === "own") (owners ??= []).push(b);
  }
  let result = acc;
  if (owners) {
    owners.sort((a, b) => a.at - b.at);
    let o = owners[0];
    for (const b of owners) if (b.at <= local) o = b;
    const spec = CATALOG[o.use];
    result = OWN[o.use](ch, base, progress(o, spec, local), o, spec, { doc, L, local });
  }
  const ex = L.expr?.[ch];
  if (ex) result = evalExpr(ex, { t: local, value: result, base, i: 0, n: 1, w: doc.comp.w, h: doc.comp.h, fps: doc.comp.fps }, result);
  return result;
}

/* ------------------------------- text ------------------------------ */
export interface TextUnits { chars: string[]; charIdx: number[]; wordIdx: number[]; lineIdx: number[]; counts: { char: number; word: number; line: number } }
const unitsCache = new Map<string, TextUnits>();
/** Split text into glyphs (newlines removed) and index each by char/word/line. Spaces share the next char's index. */
export function textUnits(text: string): TextUnits {
  const hit = unitsCache.get(text);
  if (hit) return hit;
  const chars: string[] = [], charIdx: number[] = [], wordIdx: number[] = [], lineIdx: number[] = [];
  let c = 0, w = -1, line = 0, prevSpace = true;
  for (const ch of Array.from(text)) {
    if (ch === "\n") {
      line++;
      prevSpace = true;
      continue;
    }
    const space = /\s/.test(ch);
    if (!space && prevSpace) w++;
    prevSpace = space;
    chars.push(ch);
    charIdx.push(c);
    wordIdx.push(Math.max(0, w));
    lineIdx.push(line);
    if (!space) c++;
  }
  const u: TextUnits = { chars, charIdx, wordIdx, lineIdx, counts: { char: Math.max(1, c), word: Math.max(1, w + 1), line: line + 1 } };
  if (unitsCache.size > 500) unitsCache.clear();
  unitsCache.set(text, u);
  return u;
}

function unitOf(u: TextUnits, i: number, by: string): number {
  return by === "word" ? u.wordIdx[i] : by === "line" ? u.lineIdx[i] : u.charIdx[i];
}

function evalGlyphs(L: TextLayer, local: number): GlyphState[] {
  const u = textUnits(L.text);
  const out: GlyphState[] = u.chars.map(() => ({ dx: 0, dy: 0, s: 1, rz: 0, o: 1, wipe: 0 }));
  for (const b of L.beh ?? []) {
    const spec = CATALOG[b.use];
    if (!spec || spec.mode !== "text") continue;
    const by = param<string>(b, spec, "by");
    const stagger = param<number>(b, spec, "stagger");
    const dur = behDur(b);
    const ease = easeFn(behEase(b, spec));
    for (let i = 0; i < out.length; i++) {
      const g = out[i];
      const k = unitOf(u, i, by);
      const t0 = b.at + stagger * k;
      if (b.use === "typewriter") {
        if (local < t0) g.o = 0;
        continue;
      }
      const p = ease(clamp01((local - t0) / dur));
      const alpha = local < t0 ? 0 : 1;
      switch (b.use) {
        case "typeUp":
          g.dy -= param<number>(b, spec, "dist") * (1 - p);
          g.o *= clamp01(p * 1.3) * alpha;
          break;
        case "bounceIn":
          g.s *= Math.max(0, p);
          g.dy -= 24 * (1 - p);
          g.o *= clamp01(p * 3) * alpha;
          break;
        case "cascade":
          g.dy += param<number>(b, spec, "dist") * (1 - p);
          g.rz += 14 * (1 - p) * (k % 2 ? 1 : -1);
          g.o *= clamp01(p * 2) * alpha;
          break;
      }
    }
  }
  for (const a of L.anim ?? []) {
    const sel = a.sel;
    const count = u.counts[sel.by as "char" | "word" | "line"];
    const off = typeof sel.offset === "number" ? sel.offset : keyVal(sel.offset, local);
    const span = Math.max(1e-6, sel.end - sel.start);
    for (let i = 0; i < out.length; i++) {
      const k = unitOf(u, i, sel.by);
      const un = count <= 1 ? 0 : k / (count - 1);
      const x = (un - sel.start - off) / span;
      const w = sel.shape === "full" ? (x > 0 ? 1 : 0) : sel.shape === "smooth" ? smoothstep(clamp01(x)) : clamp01(x);
      const g = out[i];
      if (a.add.pos) {
        g.dx += a.add.pos[0] * w;
        g.dy += a.add.pos[1] * w;
      }
      if (a.add.scale !== undefined) g.s += a.add.scale * w;
      if (a.add.rot !== undefined) g.rz += a.add.rot * w;
      if (a.add.opacity !== undefined) g.o = clamp01(g.o + a.add.opacity * w);
      if (a.add.wipe !== undefined) g.wipe = clamp01(g.wipe + a.add.wipe * w);
    }
  }
  return out;
}
const smoothstep = (u: number) => u * u * (3 - 2 * u);

/* ------------------------------ cloner ----------------------------- */
function evalClones(L: ClonerLayer, local: number, props: Record<string, number>): CloneState[] {
  const n = L.n;
  const out: CloneState[] = [];
  const r = props.r, gap = props.gap, spin = props.spin * DEG;
  const cols = L.cols ?? Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const delay = L.fx?.find((f) => f.type === "delay");
  const rv = L.reveal;
  const revealEase = rv ? easeFn(rv.bounce !== undefined ? `spring(${rv.dur},${rv.bounce})` : "out") : null;
  const baseSeed = strSeed(L.id);
  for (let i = 0; i < n; i++) {
    let x = 0, y = 0, z = 0;
    if (L.mode === "radial") {
      const a = (i / n) * TAU + spin;
      x = Math.cos(a) * r;
      y = Math.sin(a) * r;
    } else if (L.mode === "grid") {
      const cx = i % cols, cy = Math.floor(i / cols);
      x = (cx - (cols - 1) / 2) * gap;
      y = -(cy - (rows - 1) / 2) * gap;
    } else {
      x = (i - (n - 1) / 2) * gap;
    }
    let s = 1, o = 1;
    const rz = L.mode === "radial" && L.orient ? ((i / n) * TAU + spin) / DEG - 90 : 0;
    if (rv && revealEase) {
      const t0 = (rv.at ?? 0) + (delay ? delay.step * i : 0);
      const p = revealEase(clamp01((local - t0) / rv.dur));
      s = local < t0 ? 0 : Math.max(0, p);
      o = local < t0 ? 0 : clamp01(p * 3);
    }
    for (const f of L.fx ?? []) {
      if (f.type === "noise") {
        const sd = (f.seed ?? baseSeed) + i * 17;
        x += f.amp[0] * fbm(sd, local * f.freq);
        y += f.amp[1] * fbm(sd + 5, local * f.freq);
        z += f.amp[2] * fbm(sd + 9, local * f.freq);
      } else if (f.type === "wave") {
        const ph = TAU * local * f.freq - f.phase * i;
        x += f.amp[0] * Math.sin(ph);
        y += f.amp[1] * Math.sin(ph);
        z += f.amp[2] * Math.sin(ph);
      }
    }
    out.push({ x, y, z, s, o, rz, i });
  }
  return out;
}

/* ------------------------------ layers ----------------------------- */
const PROPS: Partial<Record<Layer["type"], string[]>> = {
  text: ["size", "tracking", "value", "blur"],
  shape: ["w", "h", "radius", "blur", "shadow.opacity", "shadow.blur", "glass.blur", "glass.amount"],
  image: ["w", "radius", "blur", "shadow.opacity", "shadow.blur"],
  html: ["w", "h", "radius", "blur", "shadow.opacity", "shadow.blur", "glass.blur", "glass.amount"],
  path: ["trimStart", "trimEnd", "width", "glow", "blur"],
  device: ["w", "blur", "shadow.opacity"],
  mesh: ["size", "blur"],
  cloner: ["r", "spin", "gap", "blur"],
  camera: ["fov"],
  group: ["clip.w", "clip.h", "clip.radius", "blur"],
  gradient: ["angle", "noise", "blur"],
  sky: ["clouds", "drift", "sun", "hillHeight", "blur"],
  adjust: ["blur", "exposure", "contrast", "saturation", "fade"],
};
const NO_XF = new Set(["gradient", "sky", "adjust"]);

export function layerSpan(doc: Doc, L: Layer): [number, number] {
  return [L.in ?? 0, L.out ?? doc.comp.dur];
}

export function evalLayer(doc: Doc, L: Layer, t: number): LayerFrame {
  const [a, b] = layerSpan(doc, L);
  const local = t - a;
  const visible = !L.hidden && t >= a && t < b + 1e-9;
  const ch = (c: string) => channel(doc, L, c, local);
  const xf: Xform = NO_XF.has(L.type)
    ? { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, s: 1, o: ch("opacity") }
    : { x: ch("pos.x"), y: ch("pos.y"), z: ch("pos.z"), rx: ch("rot.x"), ry: ch("rot.y"), rz: ch("rot.z"), s: ch("scale"), o: ch("opacity") };
  const props: Record<string, number> = {};
  for (const p of PROPS[L.type] ?? []) props[p] = ch(p);
  if (L.type === "html") for (const k of Object.keys(L.vars ?? {})) props["vars." + k] = ch("vars." + k);
  const f: LayerFrame = { id: L.id, type: L.type, visible, local, xf, props };
  if (L.type === "text") f.glyphs = evalGlyphs({ ...L, text: displayText(L, props.value) }, local);
  if (L.type === "cloner") f.clones = evalClones(L, local, props);
  return f;
}

export function activeCamera(doc: Doc): CameraLayer | undefined {
  const cams = doc.layers.filter((l): l is CameraLayer => l.type === "camera");
  return (doc.comp.cam && cams.find((c) => c.id === doc.comp.cam)) || cams[0];
}

/**
 * Evaluate the whole document at time t. `shutter` offsets time for motion-blur subframes:
 * layers with motionBlur !== false (and the camera) are sampled at t + shutter, the rest at t.
 */
export function evaluate(doc: Doc, t: number, shutter = 0): Frame {
  const layers = doc.layers.map((L) => evalLayer(doc, L, shutter && L.motionBlur !== false ? t + shutter : t));
  const byId = new Map(layers.map((l) => [l.id, l]));
  const cam = activeCamera(doc);
  let camera: CameraFrame;
  if (cam) {
    const f = byId.get(cam.id)!;
    camera = { x: f.xf.x, y: f.xf.y, z: f.xf.z, rx: f.xf.rx, ry: f.xf.ry, rz: f.xf.rz, fov: f.props.fov, target: cam.target };
  } else camera = { x: 0, y: 0, z: fitDistance(doc.comp.h, 35), rx: 0, ry: 0, rz: 0, fov: 35 };
  return { t, layers, camera, byId };
}

/** Subframe time offsets for a motion-blurred frame (AE: shutter angle, phase = -angle/2, samples). */
export function shutterOffsets(doc: Doc, samples?: number): number[] {
  const mb = doc.comp.motionBlur;
  if (!mb) return [0];
  const n = Math.max(1, samples ?? mb.samples);
  if (n === 1) return [0];
  const open = (mb.angle / 360) / doc.comp.fps;
  return Array.from({ length: n }, (_, i) => -open / 2 + (open * (i + 0.5)) / n);
}

/** Text with `{value}` replaced by the counter channel, formatted. */
export function displayText(L: TextLayer, value: number): string {
  if (!L.text.includes("{value}")) return L.text;
  const d = L.format?.decimals ?? 0;
  const thousands = L.format?.thousands ?? true;
  const s = Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: thousands });
  return L.text.replace("{value}", (value < 0 ? "-" : "") + s);
}

/* ------------------------------- bake ------------------------------ */
registerBakeSampler((doc, layerId, behId) => {
  const L = doc.layers.find((l) => l.id === layerId)!;
  const b = L.beh!.find((x) => x.id === behId)!;
  const spec = CATALOG[b.use];
  const only = { ...L, beh: [b], expr: undefined, keys: undefined } as Layer;
  const dur = behDur(b);
  const out: Record<string, [number, number][]> = {};
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  for (const ch of spec.writes) {
    if (spec.bake === "exact") {
      out[ch] = [[r3(b.at), r3(channel(doc, only, ch, b.at))], [r3(b.at + dur), r3(channel(doc, only, ch, b.at + dur))]];
      const ease = behEase(b, spec);
      if (ease !== "linear") (out[ch][1] as unknown as unknown[]).push(ease);
    } else {
      const n = Math.max(4, Math.ceil(dur * 20));
      out[ch] = Array.from({ length: n + 1 }, (_, i) => {
        const tt = b.at + (dur * i) / n;
        return [r3(tt), r3(channel(doc, only, ch, tt))] as [number, number];
      });
    }
  }
  return out;
});
