/** Deterministic, seedable 1D gradient noise in [-1,1]. Input is in seconds × freq, never frames. */

function hash(n: number): number {
  let x = Math.imul(n | 0, 0x27d4eb2d) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 15), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967295;
}

export function strSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function noise1(seed: number, x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const g0 = hash(seed * 7919 + i) * 2 - 1;
  const g1 = hash(seed * 7919 + i + 1) * 2 - 1;
  const d0 = g0 * f;
  const d1 = g1 * (f - 1);
  const u = f * f * f * (f * (f * 6 - 15) + 10);
  return (d0 + (d1 - d0) * u) * 2;
}

/** Smooth noise with 2 octaves, roughly in [-1,1]. */
export function fbm(seed: number, x: number): number {
  return Math.max(-1, Math.min(1, noise1(seed, x) * 0.75 + noise1(seed + 101, x * 2.1) * 0.35));
}
