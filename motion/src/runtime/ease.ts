/**
 * Easing. Every ease maps u∈[0,1] → [~0,~1] with ease(0)=0 and ease(1)=1 exactly
 * (springs may overshoot in between). All are pure and seekable.
 */
export type EaseFn = (u: number) => number;

const clamp01 = (u: number) => (u < 0 ? 0 : u > 1 ? 1 : u);

function cubicBezier(x1: number, y1: number, x2: number, y2: number): EaseFn {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (u) => {
    if (u <= 0) return 0;
    if (u >= 1) return 1;
    let t = u;
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - u;
      const d = dx(t);
      if (Math.abs(e) < 1e-6) break;
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    if (t < 0 || t > 1 || Math.abs(sx(t) - u) > 1e-4) {
      let lo = 0, hi = 1;
      t = u;
      for (let i = 0; i < 30; i++) {
        const v = sx(t);
        if (Math.abs(v - u) < 1e-6) break;
        if (v < u) lo = t;
        else hi = t;
        t = (lo + hi) / 2;
      }
    }
    return sy(t);
  };
}

/**
 * spring(dur, bounce) as a normalized ease. bounce 0 = critically damped, 1 = very springy.
 * Frequency is chosen so the oscillation has settled by u=1; a linear correction term makes
 * ease(1) exactly 1 so key endpoints are hit precisely.
 */
export function springEase(bounce: number): EaseFn {
  const b = Math.max(0, Math.min(0.95, bounce));
  const zeta = 1 - b;
  // envelope e^{-zeta*w*T} ≈ 1e-3 at T=1; critically damped needs a little more room
  const w = zeta >= 0.999 ? 9.2 : 6.9 / zeta;
  const raw = (x: number): number => {
    if (x <= 0) return 0;
    if (zeta >= 0.999) return 1 - Math.exp(-w * x) * (1 + w * x);
    const wd = w * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * w * x) * (Math.cos(wd * x) + ((zeta * w) / wd) * Math.sin(wd * x));
  };
  const end = raw(1);
  return (u) => {
    if (u <= 0) return 0;
    if (u >= 1) return 1;
    return raw(u) + (1 - end) * u;
  };
}

/** Named béziers (x1,y1,x2,y2). `easy` is After Effects' Easy Ease (33% influence, 0 speed). */
export const BEZIER: Record<string, [number, number, number, number]> = {
  linear: [0, 0, 1, 1],
  in: [0.55, 0, 1, 0.45],
  out: [0.22, 1, 0.36, 1],
  inOut: [0.65, 0, 0.35, 1],
  easy: [0.333, 0, 0.667, 1],
  easyIn: [0, 0, 0.667, 1],
  easyOut: [0.333, 0, 1, 1],
  expoOut: [0.16, 1, 0.3, 1],
  expoIn: [0.7, 0, 0.84, 0],
  expoInOut: [0.87, 0, 0.13, 1],
  back: [0.34, 1.56, 0.64, 1],
  anticipate: [0.36, 0, 0.66, -0.56],
};

const NAMED: Record<string, EaseFn> = {
  ...Object.fromEntries(Object.entries(BEZIER).map(([k, v]) => [k, k === "linear" ? (u: number) => u : cubicBezier(...v)])),
  hold: (u) => (u >= 1 ? 1 : 0),
  elastic: (u) => (u <= 0 ? 0 : u >= 1 ? 1 : Math.pow(2, -10 * u) * Math.sin((u * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
  bounce: (u) => {
    const n1 = 7.5625, d1 = 2.75;
    if (u < 1 / d1) return n1 * u * u;
    if (u < 2 / d1) return n1 * (u -= 1.5 / d1) * u + 0.75;
    if (u < 2.5 / d1) return n1 * (u -= 2.25 / d1) * u + 0.9375;
    return n1 * (u -= 2.625 / d1) * u + 0.984375;
  },
};

export const EASE_NAMES = Object.keys(NAMED);
const cache = new Map<string, EaseFn>();

/** Parse `linear | in | out | inOut | back | … | cubic(x1,y1,x2,y2) | spring(dur,bounce)`. */
export function easeFn(spec: string | undefined): EaseFn {
  const s = spec ?? "linear";
  const hit = cache.get(s);
  if (hit) return hit;
  let fn: EaseFn | undefined = NAMED[s];
  if (!fn) {
    const m = /^(cubic|spring)\(([^)]*)\)$/.exec(s.replace(/\s+/g, ""));
    if (m) {
      const nums = m[2].split(",").map(Number);
      if (m[1] === "cubic" && nums.length === 4 && nums.every(Number.isFinite)) fn = cubicBezier(nums[0], nums[1], nums[2], nums[3]);
      if (m[1] === "spring" && nums.length === 2 && nums.every(Number.isFinite)) fn = springEase(nums[1]);
    }
  }
  fn ??= NAMED.linear;
  cache.set(s, fn);
  return fn;
}

export function isValidEase(spec: string): boolean {
  if (NAMED[spec]) return true;
  return /^cubic\(\s*-?[\d.]+\s*,\s*-?[\d.]+\s*,\s*-?[\d.]+\s*,\s*-?[\d.]+\s*\)$/.test(spec) || /^spring\(\s*[\d.]+\s*,\s*[\d.]+\s*\)$/.test(spec);
}

/** The bézier handles of an ease, or null when it isn't a bézier (spring, bounce, hold…). */
export function cubicOf(spec: string | undefined): [number, number, number, number] | null {
  const s = (spec ?? "linear").replace(/\s+/g, "");
  if (BEZIER[s]) return [...BEZIER[s]];
  const m = /^cubic\(([^)]*)\)$/.exec(s);
  if (!m) return null;
  const n = m[1].split(",").map(Number);
  return n.length === 4 && n.every(Number.isFinite) ? (n as [number, number, number, number]) : null;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
/**
 * Rewrite one or both handles of a segment's ease (the segment arriving at a key).
 * `out` = the handle leaving the previous key, `in` = the handle arriving at this key — AE's
 * outgoing / incoming velocity. Non-bézier eases are replaced by linear first.
 */
export function withHandles(spec: string | undefined, h: { out?: [number, number]; in?: [number, number] }): string {
  const c = cubicOf(spec) ?? [0, 0, 1, 1];
  if (h.out) [c[0], c[1]] = [Math.min(1, Math.max(0, h.out[0])), h.out[1]];
  if (h.in) [c[2], c[3]] = [Math.min(1, Math.max(0, h.in[0])), h.in[1]];
  const named = Object.entries(BEZIER).find(([, v]) => v.every((x, i) => Math.abs(x - c[i]) < 1e-3));
  return named ? named[0] : `cubic(${c.map(r3).join(",")})`;
}

export { clamp01 };
