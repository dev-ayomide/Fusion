import type { Doc } from "../fmd/schema";
import { loadBuffer } from "./buffers";
import { gainPoints, planPlayback, timing } from "./schedule";

export const MIX_RATE = 48000;

/** Tracks that contribute sound to an export (unmuted, audible within the comp). */
export function audibleTracks(doc: Doc) {
  return doc.audio.filter((a) => {
    const t = timing(a);
    return !t.muted && t.volume > 0 && t.at < doc.comp.dur;
  });
}

/**
 * Render the doc's soundtrack offline, exactly as playback schedules it (same planPlayback and gain
 * envelope), into one stereo AudioBuffer of comp.dur seconds. Returns null when there's nothing to hear.
 * Throws if a referenced file can't be loaded or decoded.
 */
export async function mixSoundtrack(doc: Doc, sampleRate = MIX_RATE): Promise<AudioBuffer | null> {
  const tracks = audibleTracks(doc);
  if (!tracks.length) return null;
  const bufs = await Promise.all(tracks.map((a) => loadBuffer(a.src)));
  const dur = doc.comp.dur;
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.round(dur * sampleRate)), sampleRate);
  let any = false;
  tracks.forEach((raw, i) => {
    const a = timing(raw);
    const buf = bufs[i];
    const plan = planPlayback(a, 0, buf.duration, dur);
    if (!plan) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    const pts = gainPoints(a, buf.duration, dur, 0);
    g.gain.setValueAtTime(pts[0]?.[1] ?? 0, pts[0]?.[0] ?? 0);
    for (const [t, v] of pts.slice(1)) g.gain.linearRampToValueAtTime(v, t);
    src.connect(g).connect(ctx.destination);
    src.start(plan.delay, plan.offset, plan.dur);
    any = true;
  });
  if (!any) return null;
  const out = await ctx.startRendering();
  // several loud tracks can sum past full scale: soft-limit rather than let the encoder clip
  let peak = 0;
  for (let c = 0; c < out.numberOfChannels; c++) for (const v of out.getChannelData(c)) peak = Math.max(peak, Math.abs(v));
  if (peak > 0.99) {
    for (let c = 0; c < out.numberOfChannels; c++) {
      const d = out.getChannelData(c);
      for (let i = 0; i < d.length; i++) d[i] = 0.99 * Math.tanh(d[i] / 0.99);
    }
  }
  return out;
}
