// Mix an FMD doc's soundtrack (doc.audio) to a WAV, with the same timing rules as src/audio/schedule.ts
// (at / offset / dur / volume / linear fades hugging the audible span / muted / cut at comp.dur).
//   node bench/mix-audio.mjs <doc.fmd.json | http url> <out.wav>     → prints "none" when there's no audio
// Library tracks (lib://music/<name>) come from public/assets/music; uploaded assets live in the browser
// (IndexedDB) and are skipped with a warning.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decode, SR } from "./audio-analyze.mjs";
import { writeWav } from "./score.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [src, out] = process.argv.slice(2);
const doc = /^https?:/.test(src) ? await (await fetch(src)).json() : JSON.parse(fs.readFileSync(src, "utf8"));
const dur = doc.comp.dur, N = Math.round(dur * SR);
const L = new Float32Array(N), R = new Float32Array(N);
let used = 0;
for (const a of doc.audio ?? []) {
  const t = { at: a.at ?? 0, offset: a.offset ?? 0, dur: a.dur, volume: a.volume ?? 1, fadeIn: a.fadeIn ?? 0, fadeOut: a.fadeOut ?? 0 };
  if (a.muted || t.volume <= 0) continue;
  const m = /^lib:\/\/music\/([a-z0-9-]+)$/.exec(a.src);
  if (!m) { console.error(`skipping ${a.id}: ${a.src} is a browser-only upload`); continue; }
  const [fl, fr] = decode(path.join(ROOT, "public/assets/music", `${m[1]}.mp3`));
  const fileDur = fl.length / SR;
  const start = t.at, end = Math.min(dur, t.at + Math.min(t.dur ?? Infinity, Math.max(0, fileDur - t.offset)));
  if (end <= start) continue;
  let fin = t.fadeIn >= 1e-3 ? t.fadeIn : 0, fout = t.fadeOut >= 1e-3 ? t.fadeOut : 0;
  if (fin + fout > end - start) { const k = (end - start) / (fin + fout); fin *= k; fout *= k; }
  for (let i = Math.round(start * SR); i < Math.min(N, Math.round(end * SR)); i++) {
    const tt = i / SR, f = Math.round((t.offset + tt - start) * SR);
    if (f < 0 || f >= fl.length) continue;
    let g = t.volume;
    if (fin && tt < start + fin) g *= (tt - start) / fin;
    if (fout && tt > end - fout) g *= (end - tt) / fout;
    L[i] += fl[f] * g; R[i] += fr[f] * g;
  }
  used++;
}
if (!used) { console.log("none"); process.exit(0); }
for (let i = 0; i < N; i++) { if (Math.abs(L[i]) > 0.99) L[i] = 0.99 * Math.tanh(L[i] / 0.99); if (Math.abs(R[i]) > 0.99) R[i] = 0.99 * Math.tanh(R[i] / 0.99); }
writeWav(out, [L, R]);
console.log(out);
