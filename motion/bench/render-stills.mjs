// Render chosen moments of an FMD doc as JPEG stills (quick look-dev without rendering every frame).
// node bench/render-stills.mjs <doc url> <outdir> <t1,t2,…> [width]   (render server on :5181)
import { chromium } from "playwright";
import fs from "node:fs";
const [doc, outdir, times, width = "960"] = process.argv.slice(2);
fs.mkdirSync(outdir, { recursive: true });
const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: Number(width), height: Math.round(Number(width) * 9 / 16) } });
const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
await p.goto(`http://localhost:5181/harness.html?doc=${doc}&time=0&w=${width}`);
await p.waitForFunction(() => window.ready === true, null, { timeout: 120000 });
const t0 = Date.now();
for (const t of times.split(",").map(Number)) {
  const url = await p.evaluate(async (t) => { await window.setTime(t); return document.getElementById("c").toDataURL("image/jpeg", 0.85); }, t);
  fs.writeFileSync(`${outdir}/t${t.toFixed(2).padStart(5, "0")}.jpg`, Buffer.from(url.split(",")[1], "base64"));
}
console.log("done", ((Date.now() - t0) / 1000).toFixed(1) + "s", errs.slice(0, 5));
await b.close();
