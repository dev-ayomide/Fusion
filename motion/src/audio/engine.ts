import type { AudioTrack, Doc } from "../fmd/schema";
import { playhead } from "../editor/playhead";
import { loadBuffer, peekBuffer, onAudioLoaded } from "./buffers";
import { gainPoints, planPlayback, gainAt, timing } from "./schedule";

/**
 * Live soundtrack playback, slaved to the playhead (which stays the master clock for the picture).
 *
 * On play/seek/loop/edit, every track is (re)scheduled against AudioContext time: a source node
 * starts at an exact context time with an exact file offset, and a gain node carries the fade
 * envelope as ramps. While playing we compare how far the playhead moved with how far the audio
 * clock moved since scheduling; any divergence beyond a frame or two (a seek, a loop wrap, a tab
 * stall that the playhead clamps) triggers a resync. Output latency is compensated so what you hear
 * lines up with what you see. Browsers only let audio start after a gesture: the context is resumed
 * on the first pointer/key event.
 */
const LEAD = 0.04; // schedule slightly in the future so every node starts on time
const DRIFT = 0.06; // resync threshold (s)

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let getDoc: () => Doc = () => ({ audio: [], comp: { dur: 0 } }) as unknown as Doc;
let started = false;
interface Live { id: string; key: string; src: AudioBufferSourceNode; gain: GainNode }
let live: Live[] = [];
let anchor: { ctxT: number; compT: number } | null = null;
let lastAudio: AudioTrack[] | null = null;
let lastDur = 0;
let pending = 0;

function context(): AudioContext | null {
  if (ctx) return ctx;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx = new AC({ latencyHint: "interactive" });
  master = ctx.createGain();
  master.connect(ctx.destination);
  return ctx;
}
/** Resume on a user gesture (autoplay policy). Safe to call any time. */
export function unlockAudio() {
  const c = context();
  if (c && c.state === "suspended") c.resume().catch(() => undefined);
}

const structKey = (a: AudioTrack) => {
  const t = timing(a);
  return `${a.src}|${t.at}|${t.offset}|${t.dur ?? ""}|${t.muted ? 1 : 0}`;
};
const latency = () => (ctx ? (ctx.outputLatency || 0) + (ctx.baseLatency || 0) : 0);

function stopAll(fadeS = 0.015) {
  if (!ctx) return;
  const now = ctx.currentTime;
  for (const l of live) {
    try {
      l.gain.gain.cancelScheduledValues(now);
      l.gain.gain.setValueAtTime(l.gain.gain.value, now);
      l.gain.gain.linearRampToValueAtTime(0, now + fadeS); // de-click
      l.src.stop(now + fadeS + 0.005);
    } catch {
      /* already stopped */
    }
  }
  live = [];
  anchor = null;
}

function applyGain(g: GainNode, a: AudioTrack, fileDur: number, compDur: number, ctxT: number, compT: number) {
  const p = g.gain;
  p.cancelScheduledValues(ctxT);
  const pts = gainPoints(timing(a), fileDur, compDur, compT);
  if (!pts.length) {
    p.setValueAtTime(0, ctxT);
    return;
  }
  p.setValueAtTime(pts[0][1], ctxT + Math.max(0, pts[0][0] - compT));
  for (const [t, v] of pts.slice(1)) p.linearRampToValueAtTime(v, ctxT + (t - compT));
}

/** Schedule every audible track from the current playhead position. */
function schedule() {
  const c = context();
  if (!c || !master) return;
  stopAll();
  if (!playhead.isPlaying()) return;
  if (c.state === "suspended") c.resume().catch(() => undefined);
  const doc = getDoc();
  lastAudio = doc.audio;
  lastDur = doc.comp.dur;
  const ctxT = c.currentTime + LEAD;
  // the sound scheduled at ctxT is heard `latency` later, when the playhead will show this time:
  const compT = playhead.get() + LEAD + latency();
  anchor = { ctxT: c.currentTime, compT: playhead.get() };
  for (const a of doc.audio) {
    if (a.muted) continue;
    const ready = peekBuffer(a.src);
    if (!ready) {
      // not decoded yet: start as soon as it is (the resync picks up the right offset)
      loadBuffer(a.src).then(() => requestResync(), () => undefined);
      continue;
    }
    const plan = planPlayback(timing(a), compT, ready.buf.duration, doc.comp.dur);
    if (!plan) continue;
    const src = c.createBufferSource();
    src.buffer = ready.buf;
    const gain = c.createGain();
    src.connect(gain).connect(master);
    applyGain(gain, a, ready.buf.duration, doc.comp.dur, ctxT, compT);
    src.start(ctxT + plan.delay, plan.offset, plan.dur);
    live.push({ id: a.id, key: structKey(a), src, gain });
  }
}

function requestResync() {
  cancelAnimationFrame(pending);
  pending = requestAnimationFrame(() => {
    pending = 0;
    if (playhead.isPlaying()) schedule();
  });
}

/** Doc changed: gain-only edits (volume, fades) re-ramp in place; anything structural reschedules. */
function onDoc() {
  const doc = getDoc();
  if (doc.audio === lastAudio && doc.comp.dur === lastDur) return;
  if (!playhead.isPlaying() || !ctx || !anchor) {
    lastAudio = doc.audio;
    lastDur = doc.comp.dur;
    return;
  }
  const sameStructure = doc.comp.dur === lastDur && doc.audio.filter((a) => !a.muted).map(structKey).join() === live.map((l) => l.key).join() && live.length === doc.audio.filter((a) => !a.muted && peekBuffer(a.src)).length;
  lastAudio = doc.audio;
  if (!sameStructure) return requestResync();
  const ctxT = ctx.currentTime + 0.01;
  const compT = anchor.compT + (ctxT - anchor.ctxT) + latency();
  for (const l of live) {
    const a = doc.audio.find((x) => x.id === l.id);
    const buf = l.src.buffer;
    if (a && buf) applyGain(l.gain, a, buf.duration, doc.comp.dur, ctxT, compT);
  }
}

/** Per playhead tick: detect seeks, loop wraps and stalls by comparing clocks. */
function onTick() {
  if (!ctx || !playhead.isPlaying()) return;
  if (!anchor) return;
  const expect = anchor.compT + (ctx.currentTime - anchor.ctxT);
  if (Math.abs(playhead.get() - expect) > DRIFT) schedule();
}

/**
 * Start the engine once (idempotent). `docSource` returns the document to hear (the display doc),
 * `subscribe` notifies on document changes. Returns nothing; the engine lives for the page.
 */
export function startAudioEngine(docSource: () => Doc, subscribe: (fn: () => void) => () => void) {
  getDoc = docSource;
  if (started) return;
  started = true;
  const unlock = () => unlockAudio();
  window.addEventListener("pointerdown", unlock, { capture: true });
  window.addEventListener("keydown", unlock, { capture: true });
  playhead.subscribePlaying(() => {
    if (playhead.isPlaying()) {
      unlockAudio();
      if (preview.current()) preview.stop();
      schedule();
    } else stopAll(0.03);
  });
  playhead.subscribe(onTick);
  subscribe(onDoc);
  onAudioLoaded(() => {
    if (playhead.isPlaying() && getDoc().audio.some((a) => !a.muted && !live.some((l) => l.id === a.id))) requestResync();
  });
  // prefetch what the doc already references so the first play is instant
  subscribe(() => {
    for (const a of getDoc().audio) peekBuffer(a.src);
  });
  for (const a of getDoc().audio) peekBuffer(a.src);
}

/** Test/diagnostic hook: what's scheduled right now. */
export function audioDebug() {
  return {
    state: ctx?.state ?? "none",
    playing: live.map((l) => l.id),
    ctxTime: ctx?.currentTime ?? 0,
    anchor,
    gainNow: (id: string) => {
      const doc = getDoc();
      const a = doc.audio.find((x) => x.id === id);
      const r = a && peekBuffer(a.src);
      return a && r ? gainAt(timing(a), playhead.get(), r.buf.duration, doc.comp.dur) : 0;
    },
  };
}

/* ------------------------------ previews ------------------------------ */
/** One-at-a-time preview player for the music picker (plain <audio>: streams, no decode wait). */
let previewEl: HTMLAudioElement | null = null;
let previewSrc: string | null = null;
const previewSubs = new Set<() => void>();
export const preview = {
  current: () => previewSrc,
  play(src: string, url: string) {
    preview.stop();
    const el = new Audio(url);
    el.volume = 0.9;
    el.onended = () => preview.stop();
    previewEl = el;
    previewSrc = src;
    if (playhead.isPlaying()) playhead.pause();
    el.play().catch(() => preview.stop());
    previewSubs.forEach((f) => f());
  },
  stop() {
    if (previewEl) {
      previewEl.pause();
      previewEl.src = "";
    }
    previewEl = null;
    previewSrc = null;
    previewSubs.forEach((f) => f());
  },
  progress: () => (previewEl && previewEl.duration ? previewEl.currentTime / previewEl.duration : 0),
  subscribe(fn: () => void) {
    previewSubs.add(fn);
    return () => void previewSubs.delete(fn);
  },
};
