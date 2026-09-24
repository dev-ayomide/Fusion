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

const NAMED: Record<string, EaseFn> = {
  linear: (u) => u,
  in: cubicBezier(0.55, 0, 1, 0.45),
  out: cubicBezier(0.22, 1, 0.36, 1),
  inOut: cubicBezier(0.65, 0, 0.35, 1),
  back: cubicBezier(0.34, 1.56, 0.64, 1),
  anticipate: cubicBezier(0.36, 0, 0.66, -0.56),
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

export { clamp01 };
