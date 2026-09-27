import { assetUrl, libraryUrl } from "../assets/assets";
import { MUSIC, type MusicTrack } from "./music-catalog";

/**
 * Decoded audio for a track `src` (an asset id or lib://music/<name>), shared by playback, export and
 * the timeline waveform. Each src is fetched and decoded once; waveform peaks are computed once per
 * buffer. Listeners hear about every buffer that finishes loading (the timeline redraws).
 */
export const DECODE_RATE = 48000;

type Entry = { state: "loading"; p: Promise<AudioBuffer> } | { state: "ready"; buf: AudioBuffer; peaks: Peaks } | { state: "error"; error: string };
const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();
export function onAudioLoaded(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export function libraryTrack(src: string): MusicTrack | undefined {
  const m = /^lib:\/\/music\/([a-z0-9-]+)$/.exec(src);
  return m ? MUSIC.find((t) => t.name === m[1]) : undefined;
}

/** A URL the browser can fetch for this src, or undefined if the asset isn't available (yet). */
export function audioUrl(src: string): string | undefined {
  if (src.startsWith("lib://")) return libraryUrl(src) ?? undefined;
  return assetUrl(src);
}

let decoder: BaseAudioContext | null = null;
function decodeCtx(): BaseAudioContext {
  // an OfflineAudioContext decodes without needing a user gesture; buffers are context-independent
  decoder ??= new OfflineAudioContext(2, 1, DECODE_RATE);
  return decoder;
}

export function loadBuffer(src: string): Promise<AudioBuffer> {
  const hit = cache.get(src);
  if (hit?.state === "ready") return Promise.resolve(hit.buf);
  if (hit?.state === "loading") return hit.p;
  const url = audioUrl(src);
  if (!url) return Promise.reject(new Error(`audio "${src}" is not available`));
  const p = (async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`couldn't load ${src} (${res.status})`);
    const bytes = await res.arrayBuffer();
    try {
      return await decodeCtx().decodeAudioData(bytes);
    } catch {
      throw new Error("This browser can't decode that audio file — try MP3 or WAV.");
    }
  })();
  cache.set(src, { state: "loading", p });
  p.then(
    (buf) => {
      cache.set(src, { state: "ready", buf, peaks: computePeaks(buf) });
      listeners.forEach((f) => f());
    },
    (e: Error) => {
      cache.set(src, { state: "error", error: e.message });
      listeners.forEach((f) => f());
    },
  );
  return p;
}

/** Synchronous view for renderers: the buffer (and its peaks) if already decoded; kicks off loading otherwise. */
export function peekBuffer(src: string): { buf: AudioBuffer; peaks: Peaks } | null {
  const hit = cache.get(src);
  if (hit?.state === "ready") return hit;
  if (!hit && audioUrl(src)) loadBuffer(src).catch(() => undefined);
  return null;
}
export function bufferError(src: string): string | null {
  const hit = cache.get(src);
  return hit?.state === "error" ? hit.error : null;
}
/** Forget a failed/unavailable src so it's retried (e.g. once an uploaded asset's URL is registered). */
export function retryBuffer(src: string) {
  if (cache.get(src)?.state === "error") cache.delete(src);
}

/** File duration: decoded if possible, else the library catalogue's figure, else null. */
export function fileDuration(src: string): number | null {
  const hit = cache.get(src);
  if (hit?.state === "ready") return hit.buf.duration;
  return libraryTrack(src)?.dur ?? null;
}

/* ------------------------------ peaks ------------------------------ */
/** Max |sample| and RMS per bin, both 0..1, `rate` bins per second of file. */
export interface Peaks {
  rate: number;
  max: Float32Array;
  rms: Float32Array;
}
export const PEAK_RATE = 200;
export function computePeaks(buf: AudioBuffer, rate = PEAK_RATE): Peaks {
  const n = Math.max(1, Math.ceil(buf.duration * rate));
  const max = new Float32Array(n), rms = new Float32Array(n);
  const chans = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
  const per = buf.sampleRate / rate;
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * per), b = Math.min(buf.length, Math.floor((i + 1) * per));
    let m = 0, s = 0;
    for (const ch of chans)
      for (let k = a; k < b; k++) {
        const v = ch[k];
        const av = v < 0 ? -v : v;
        if (av > m) m = av;
        s += v * v;
      }
    max[i] = Math.min(1, m);
    rms[i] = Math.min(1, Math.sqrt(s / Math.max(1, (b - a) * chans.length)));
  }
  return { rate, max, rms };
}

/** Largest max/rms over the file range [f0, f1) seconds (what one waveform column shows). */
export function peakRange(p: Peaks, f0: number, f1: number): [number, number] {
  const a = Math.max(0, Math.floor(f0 * p.rate)), b = Math.min(p.max.length, Math.max(a + 1, Math.ceil(f1 * p.rate)));
  let m = 0, r = 0;
  for (let i = a; i < b; i++) {
    if (p.max[i] > m) m = p.max[i];
    if (p.rms[i] > r) r = p.rms[i];
  }
  return [m, r];
}
