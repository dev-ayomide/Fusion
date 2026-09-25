/**
 * The playhead lives outside React: components subscribe transiently and the viewport
 * reads it inside its own rAF. Only the timecode label re-renders (throttled).
 */
type Fn = () => void;
let t = 0;
let playing = false;
let duration = 5;
let loop = true;
let last = 0;
let raf = 0;
const subs = new Set<Fn>();
const playSubs = new Set<Fn>();

function tick(now: number) {
  if (!playing) return;
  // real time, like an NLE: slow frames drop, they don't slow the clock (clamped for tab switches)
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  t += dt;
  if (t >= duration) {
    if (loop) t = t % duration;
    else {
      t = duration;
      setPlaying(false);
    }
  }
  subs.forEach((f) => f());
  raf = requestAnimationFrame(tick);
}

export const playhead = {
  get: () => t,
  set(v: number) {
    t = Math.max(0, Math.min(duration, v));
    subs.forEach((f) => f());
  },
  isPlaying: () => playing,
  play: () => setPlaying(true),
  pause: () => setPlaying(false),
  toggle: () => setPlaying(!playing),
  setDuration(d: number) {
    duration = d;
    if (t > d) playhead.set(d);
  },
  duration: () => duration,
  setLoop(v: boolean) {
    loop = v;
  },
  subscribe(fn: Fn) {
    subs.add(fn);
    return () => void subs.delete(fn);
  },
  subscribePlaying(fn: Fn) {
    playSubs.add(fn);
    return () => void playSubs.delete(fn);
  },
};

function setPlaying(p: boolean) {
  if (p === playing) return;
  playing = p;
  if (p) {
    if (t >= duration - 1e-3) t = 0;
    last = performance.now();
    raf = requestAnimationFrame(tick);
  } else cancelAnimationFrame(raf);
  playSubs.forEach((f) => f());
  subs.forEach((f) => f());
}

export function fmtTime(s: number, fps: number): string {
  const whole = Math.floor(s);
  const frame = Math.floor((s - whole) * fps + 1e-6);
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}:${String(frame).padStart(2, "0")}`;
}
