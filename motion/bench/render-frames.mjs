// Render an FMD doc to a PNG sequence through the harness page (frame-exact, resumable).
// node bench/render-frames.mjs <doc url> <outdir> [width] [fps] [from] [to]   (PORT defaults to 5181)
import { chromium } from 'playwright';
import fs from 'node:fs';
const [doc, outdir, width = '960', fpsArg, fromArg, toArg] = process.argv.slice(2);
fs.mkdirSync(outdir, { recursive: true });
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: Number(width), height: Math.round(Number(width) * 9 / 16) } });
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
await p.goto(`http://localhost:${process.env.PORT ?? 5181}/harness.html?doc=${doc}&time=0&w=${width}`);
await p.waitForFunction(() => window.ready === true, null, { timeout: 120000 });
const meta = await (await fetch(`http://localhost:${process.env.PORT ?? 5181}${doc}`)).json();
const fps = Number(fpsArg || meta.comp.fps);
const n = Math.round(meta.comp.dur * fps);
const from = Number(fromArg || 0), to = Number(toArg || n);
const t0 = Date.now();
for (let i = from; i < to; i++) {
  if (fs.existsSync(`${outdir}/f${String(i).padStart(4, '0')}.png`)) continue;
  const url = await p.evaluate(async (t) => { await window.setTime(t); return document.getElementById('c').toDataURL('image/png'); }, i / fps);
  fs.writeFileSync(`${outdir}/f${String(i).padStart(4, '0')}.png`, Buffer.from(url.split(',')[1], 'base64'));
}
console.log(`frames ${to - from} in ${((Date.now() - t0) / 1000).toFixed(1)}s`, errs.slice(0, 5).join('\n') || 'no errors');
await b.close();
