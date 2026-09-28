import { useStore } from "./store";
import { playhead } from "./playhead";
import { revealTime } from "./edit";

/**
 * After something is added, the playhead jumps to where it has fully appeared, so it's visible.
 * The jump is remembered: while the playhead is still there, the next thing added starts where the
 * previous one did instead of drifting later and later.
 */
let jumped: { from: number; to: number } | null = null;

/** When a new layer should start: the playhead, unless it's only there because of our last jump. */
export function insertTime(): number {
  const now = playhead.get();
  return jumped && Math.abs(now - jumped.to) < 1e-3 ? jumped.from : now;
}

/** Show a just-added layer: move the playhead to where it has fully appeared. */
export function revealLayer(id: string, startedAt: number) {
  const t = revealTime(useStore.getState().doc, id);
  if (t === null || t <= playhead.get() + 1e-3) return;
  playhead.pause();
  playhead.set(t);
  jumped = { from: startedAt, to: t };
}
