/**
 * Pure audio-track timing, shared by live playback (engine.ts), the offline export mix (mix.ts)
 * and the timeline lane. All times are comp seconds unless named `file…`.
 *
 *   comp:  ──────[at ········· end)──────        end = min(at + playLen, comp.dur)
 *   file:        [offset ··· offset + (end - at))
 *
 * playLen is `dur` when set, never past the end of the file. Fades are linear in gain and hug the
 * audible span, so a track cut by the comp end still fades out where it stops.
 */
export interface TrackTiming {
  at: number;
  offset: number;
  dur?: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
  muted?: boolean;
}

/**
 * Fill schema defaults. Ops store exactly what was written (zod defaults aren't materialised in the
 * doc), so a track the AI added as {src, at} has no offset/volume/fades yet: always read through this.
 */
export function timing(a: Partial<TrackTiming>): TrackTiming {
  const num = (v: unknown, d: number) => (typeof v === "number" && isFinite(v) ? v : d);
  return {
    at: Math.max(0, num(a.at, 0)),
    offset: Math.max(0, num(a.offset, 0)),
    dur: typeof a.dur === "number" && a.dur > 0 ? a.dur : undefined,
    volume: Math.max(0, num(a.volume, 1)),
    fadeIn: Math.max(0, num(a.fadeIn, 0)),
    fadeOut: Math.max(0, num(a.fadeOut, 0)),
    muted: !!a.muted,
  };
}

export interface Span {
  start: number;
  end: number;
}

/** Comp-time window in which the track is heard (empty when end <= start). */
export function playSpan(tr: TrackTiming, fileDur: number, compDur: number): Span {
  const rest = Math.max(0, fileDur - tr.offset);
  const len = Math.min(tr.dur ?? Infinity, rest);
  return { start: tr.at, end: Math.max(tr.at, Math.min(compDur, tr.at + len)) };
}

/** Nominal clip length as the timeline draws it (not cut by the comp end). */
export function clipLength(tr: TrackTiming, fileDur: number): number {
  return Math.max(0, Math.min(tr.dur ?? Infinity, fileDur - tr.offset));
}

/** File position (s) heard at comp time t, or null when the track is silent there. */
export function fileTimeAt(tr: TrackTiming, t: number, fileDur: number, compDur: number): number | null {
  const { start, end } = playSpan(tr, fileDur, compDur);
  if (t < start || t >= end) return null;
  return tr.offset + (t - start);
}

/** Fade lengths that fit the span (scaled down together when they would overlap). */
export function fitFades(tr: TrackTiming, span: Span): { fin: number; fout: number } {
  const len = span.end - span.start;
  // sub-millisecond fades are no fades (and would make the envelope numerically degenerate)
  const fin = tr.fadeIn >= 1e-3 ? tr.fadeIn : 0, fout = tr.fadeOut >= 1e-3 ? tr.fadeOut : 0;
  if (fin + fout <= len || fin + fout === 0) return { fin, fout };
  const k = len / (fin + fout);
  return { fin: fin * k, fout: fout * k };
}

/** Envelope gain at comp time t: volume × fade in × fade out; 0 outside the span or when muted. */
export function gainAt(tr: TrackTiming, t: number, fileDur: number, compDur: number): number {
  if (tr.muted) return 0;
  const span = playSpan(tr, fileDur, compDur);
  if (t < span.start || t >= span.end) return 0;
  const { fin, fout } = fitFades(tr, span);
  let g = tr.volume;
  if (fin > 0 && t < span.start + fin) g *= (t - span.start) / fin;
  if (fout > 0 && t > span.end - fout) g *= (span.end - t) / fout;
  return Math.max(0, g);
}

/**
 * The gain envelope as linear-ramp breakpoints [compTime, gain] from `from` to the end of the span.
 * The first point is the exact gain at `from`, so playback can start mid-fade; WebAudio then
 * linearRamps between consecutive points (the same shape gainAt describes).
 */
export function gainPoints(tr: TrackTiming, fileDur: number, compDur: number, from = 0): [number, number][] {
  const span = playSpan(tr, fileDur, compDur);
  if (tr.muted || span.end <= span.start) return [];
  const { fin, fout } = fitFades(tr, span);
  const t0 = Math.max(from, span.start);
  if (t0 >= span.end) return [];
  const marks = [span.start + fin, span.end - fout, span.end].filter((t) => t > t0 + 1e-9);
  const pts: [number, number][] = [[t0, gainAtEnv(tr, t0, span, fin, fout)]];
  for (const t of marks) pts.push([t, gainAtEnv(tr, t, span, fin, fout)]);
  // collapse duplicates (e.g. fade in ends exactly where fade out starts)
  return pts.filter((p, i) => i === 0 || p[0] - pts[i - 1][0] > 1e-9);
}
function gainAtEnv(tr: TrackTiming, t: number, span: Span, fin: number, fout: number): number {
  let g = tr.volume;
  if (fin > 0 && t < span.start + fin) g *= Math.max(0, (t - span.start) / fin);
  if (fout > 0 && t > span.end - fout) g *= Math.max(0, (span.end - t) / fout);
  return g;
}

/**
 * What an AudioBufferSourceNode needs when the comp starts playing at t0:
 * start `delay` seconds from now, from file position `offset`, for `dur` seconds. null = nothing to play.
 */
export function planPlayback(tr: TrackTiming, t0: number, fileDur: number, compDur: number): { delay: number; offset: number; dur: number } | null {
  if (tr.muted) return null;
  const { start, end } = playSpan(tr, fileDur, compDur);
  if (end - start <= 1e-4 || t0 >= end - 1e-4) return null;
  if (t0 <= start) return { delay: start - t0, offset: tr.offset, dur: end - start };
  return { delay: 0, offset: tr.offset + (t0 - start), dur: end - t0 };
}

/** "Fit to video": play from `at` to the comp end (or the file end, if that comes first). */
export function fitToComp(tr: TrackTiming, fileDur: number | null, compDur: number): { dur: number; fadeOut: number } {
  const room = Math.max(0.1, compDur - tr.at);
  const rest = fileDur !== null ? Math.max(0.1, fileDur - tr.offset) : Infinity;
  const dur = Math.round(Math.min(room, rest) * 1000) / 1000;
  // cutting a track short needs a fade, or it stops dead
  const cut = rest > room + 0.05;
  return { dur, fadeOut: cut ? Math.max(tr.fadeOut, Math.min(1.5, dur / 4)) : tr.fadeOut };
}
