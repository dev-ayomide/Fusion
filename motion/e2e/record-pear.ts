/**
 * Walkthrough of the quality round: the Pear replica documents opened in the editor, and the
 * After Effects-style tools used on them — U reveal, F9 Easy Ease, the graph editor, effect
 * controls, motion blur, the asset library, glass/counter cards, the cloud dissolve, 3D.
 * Run: npx tsx e2e/record-pear.ts <outDir>
 */
import { chromium, type Locator, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve(process.argv[2] ?? "e2e/artifacts");
const BASE = process.env.BASE_URL ?? "http://localhost:5180";
const W = 1600, H = 960;
fs.mkdirSync(OUT, { recursive: true });

const OVERLAY = `
(() => {
  const boot = () => {
    if (document.getElementById("__cursor")) return;
    const c = document.createElement("div");
    c.id = "__cursor";
    c.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M4 2l15 8.5-6.5 1.8L9.8 19z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: "fixed", left: "0", top: "0", zIndex: 100000, pointerEvents: "none", transform: "translate(-4px,-2px)", transition: "none" });
    const ring = document.createElement("div");
    Object.assign(ring.style, { position: "fixed", width: "34px", height: "34px", marginLeft: "-17px", marginTop: "-17px", borderRadius: "50%", border: "2px solid #f3b24a", zIndex: 99999, pointerEvents: "none", opacity: "0", transition: "opacity .35s, transform .35s", transform: "scale(.4)" });
    const cap = document.createElement("div");
    cap.id = "__caption";
    Object.assign(cap.style, { position: "fixed", top: "7px", left: "50%", transform: "translateX(-50%)", zIndex: 99998, pointerEvents: "none", background: "rgba(12,13,18,.94)", border: "1px solid #f3b24a", color: "#f5f6fa", font: "600 14px/1.3 Inter Variable, system-ui, sans-serif", padding: "7px 14px", borderRadius: "10px", boxShadow: "0 8px 30px rgba(0,0,0,.5)", maxWidth: "760px", textAlign: "center", opacity: "0", transition: "opacity .3s" });
    document.body.append(c, ring, cap);
    addEventListener("mousemove", (e) => { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; }, true);
    addEventListener("mousedown", (e) => { ring.style.left = e.clientX + "px"; ring.style.top = e.clientY + "px"; ring.style.opacity = "1"; ring.style.transform = "scale(1)"; setTimeout(() => { ring.style.opacity = "0"; ring.style.transform = "scale(.4)"; }, 280); }, true);
    window.__caption = (t) => { cap.textContent = t; cap.style.opacity = t ? "1" : "0"; };
  };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", boot); else boot();
})();`;

async function main() {
  const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: OUT, size: { width: W, height: H } } });
  await ctx.addInitScript(OVERLAY);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const log: string[] = [];
  const t0 = Date.now();
  const mark = (s: string) => log.push(`${((Date.now() - t0) / 1000).toFixed(1)}s  ${s}`);

  const caption = async (t: string) => {
    mark(t);
    await page.evaluate((t) => (window as unknown as { __caption: (t: string) => void }).__caption(t), t);
  };
  const pause = (ms: number) => page.waitForTimeout(ms);
  let cur = { x: W / 2, y: H / 2 };
  const moveTo = async (x: number, y: number, steps = 18) => {
    await page.mouse.move(x, y, { steps });
    cur = { x, y };
  };
  const click = async (loc: Locator, opts: { dx?: number; dy?: number } = {}) => {
    await loc.scrollIntoViewIfNeeded();
    const b = (await loc.boundingBox())!;
    await moveTo(b.x + b.width / 2 + (opts.dx ?? 0), b.y + b.height / 2 + (opts.dy ?? 0));
    await pause(160);
    await page.mouse.down();
    await pause(70);
    await page.mouse.up();
    await pause(260);
  };
  const dragTo = async (from: { x: number; y: number }, to: { x: number; y: number }, steps = 30) => {
    await moveTo(from.x, from.y);
    await pause(150);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps });
    await pause(120);
    await page.mouse.up();
    cur = to;
    await pause(350);
  };
  const type = async (loc: Locator, text: string) => {
    await click(loc);
    await page.keyboard.type(text, { delay: 18 });
  };
  const fusion = <T,>(fn: string, arg?: unknown) => page.evaluate(([fn, arg]) => new Function("f", "arg", `return (${fn})(f, arg)`)((window as unknown as { fusion: unknown }).fusion, arg) as T, [fn, arg] as const);
  const agentRespond = async (message: string, ops: unknown[], chips?: unknown[], delayMs = 170) => {
    const pending = await fusion<{ turnId: string }[]>("(f) => f.bridge.pending()");
    const id = pending.at(-1)!.turnId;
    await fusion("(f, a) => f.bridge.respond(a.id, a.r)", { id, r: { message, ops, chips, delayMs } });
  };
  const play = async (ms: number) => {
    await page.keyboard.press("Space");
    await pause(ms);
    await page.keyboard.press("Space");
  };
  const tl = (id: string, t: number, ch?: string) => page.evaluate(([id, t, ch]) => {
    const g = (window as unknown as { __timeline: { x: (t: number) => number; rowY: (id: string, ch?: string) => number | null } }).__timeline;
    return { x: g.x(t as number), y: g.rowY(id as string, (ch as string) || undefined)! };
  }, [id, t, ch ?? ""] as const);

  const open = async (url: string) => {
    await fusion("(f, u) => f.loadDoc(u)", url);
    await pause(2500);
  };
  const setT = async (t: number) => {
    await fusion("(f, t) => f.time.set(t)", t);
    await pause(900);
  };
  const scrub = async (from: number, to: number, steps = 10) => {
    const a = await tl("shot", from).catch(() => null);
    void a;
    const r = (await page.getByTestId("ruler").boundingBox())!;
    const x = (t: number) => page.evaluate((t) => (window as unknown as { __timeline: { x: (t: number) => number } }).__timeline.x(t), t);
    await dragTo({ x: await x(from), y: r.y + r.height / 2 }, { x: await x(to), y: r.y + r.height / 2 }, steps * 6);
  };

  /* ------------------------------------------------------------------ */
  await page.goto(BASE);
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE);
  await pause(1500);

  await caption("Pear replica · shot 1 — one FMD document: clip-mask card, 3D foil pear, 3D emoji, kinetic type");
  await open("/fixtures/pear/q1.fmd.json");
  await click(page.getByRole("group", { name: "Editor mode" }).getByRole("button", { name: "Pro" }));
  await setT(0.4);
  await scrub(0.4, 1.3, 14);
  await caption("Motion blur is a comp switch, like After Effects — every fast move is sampled across the shutter");
  await moveTo((await page.getByTestId("mb-toggle").boundingBox())!.x + 40, (await page.getByTestId("mb-toggle").boundingBox())!.y + 12);
  await pause(1600);
  await scrub(1.3, 2.4, 14);
  await caption("Script accent word + write-on wipe, then the sentence dollies out and the rest pops in word by word");
  await scrub(2.4, 3.2, 12);

  await caption("U reveals a layer's animated properties · keyframe icons show interpolation (◇ linear  ⧗ ease  ■ hold)");
  await click(page.getByTestId("tl-row-card"));
  await page.keyboard.press("u");
  await pause(1400);
  const k = await tl("card", 0.74, "clip.w");
  await moveTo(k.x, k.y);
  await pause(300);
  await page.mouse.down();
  await pause(60);
  await page.mouse.up();
  await pause(600);
  await caption("F9 = Easy Ease on the selected key (⇧F9 in, ⌘⇧F9 out) — the glyph turns into an hourglass");
  await page.keyboard.press("F9");
  await pause(1600);
  await caption("⇧F3 opens the graph editor: drag a bézier handle, the curve (and the doc) update live — one undo step");
  await page.keyboard.press("Shift+F3");
  await pause(1300);
  const hs = await page.evaluate(() => (window as unknown as { __graph: { handles: () => { side: string; x: number; y: number }[] } }).__graph.handles());
  const h = hs.find((q) => q.side === "out") ?? hs[0];
  if (h) {
    await dragTo(h, { x: h.x - 70, y: h.y - 30 }, 40);
    await pause(900);
    await dragTo({ x: h.x - 70, y: h.y - 30 }, { x: h.x + 40, y: h.y }, 40);
  }
  await pause(1200);
  await page.keyboard.press("Shift+F3");
  await pause(600);

  await caption("Effect Controls: Gaussian blur, per-layer motion blur, drop shadow, frosted glass — all keyable");
  await click(page.getByTestId("tl-row-pear"));
  await click(page.getByTestId("tab-inspect")).catch(() => undefined);
  const fx = page.locator(".sec", { hasText: "Gaussian blur" }).first();
  await fx.scrollIntoViewIfNeeded().catch(() => undefined);
  await pause(1800);

  await caption("Asset library: 24 bundled 3D objects (Fluent 3D emoji, MIT) — no upload needed");
  await click(page.getByLabel("Asset library"));
  await pause(1200);
  await click(page.getByLabel("Add trophy"));
  await pause(1500);
  await page.keyboard.press("ControlOrMeta+z");
  await pause(600);

  await caption("Shot 2 — a real UI in HTML/CSS: the amount types in, the panel whips up (motion blur)");
  await open("/fixtures/pear/q2.fmd.json");
  await setT(0.3);
  await scrub(0.3, 2.2, 18);
  await caption("Frosted-glass card over the sky · the counter and % are keyed html vars · the chart draws on (trim paths)");
  await scrub(2.2, 3.4, 16);
  await caption("White flash (adjustment layer) into procedural mountains · 'Back' writes on in a script face");
  await scrub(3.4, 4.9, 16);

  await caption("Shot 3 — a real 3D phone: lime slab mesh, html screen and chat bubbles parented to it");
  await open("/fixtures/pear/q3.fmd.json");
  await setT(1.2);
  await click(page.getByRole("button", { name: /split/i }).first()).catch(async () => { await page.keyboard.press("s"); });
  await pause(1500);
  await caption("Split view: orbit the scene camera around the phone — it's geometry, not a flat mockup");
  const vp = (await page.getByTestId("viewport-canvas").boundingBox())!;
  await dragTo({ x: vp.x + vp.width * 0.25, y: vp.y + vp.height * 0.5 }, { x: vp.x + vp.width * 0.12, y: vp.y + vp.height * 0.45 }, 40);
  await pause(800);
  await page.keyboard.press("s");
  await scrub(1.2, 3.0, 14);

  await caption("Shot 4 — night → day, a glass odds card whose selection slides between rows");
  await open("/fixtures/pear/q4.fmd.json");
  await setT(0.2);
  await scrub(0.2, 2.6, 18);
  await caption("Cloud dissolve: an adjustment layer whose fade spreads through soft fog shapes");
  await scrub(3.4, 4.5, 16);
  await click(page.getByTestId("tl-row-fog")).catch(() => undefined);
  await pause(1800);

  await caption("Every shot is plain JSON — the same small ops the AI uses, measured against the original in docs/QUALITY.md");
  await click(page.getByTestId("tab-json")).catch(() => undefined);
  await pause(2500);
  await caption("");

  const video = page.video();
  await ctx.close();
  await browser.close();
  const vpath = await video!.path();
  fs.renameSync(vpath, path.join(OUT, "pear-walkthrough.webm"));
  fs.writeFileSync(path.join(OUT, "pear-walkthrough-log.txt"), log.join("\n") + `\nerrors: ${errors.length ? errors.join("\n") : "none"}\n`);
  console.log(log.join("\n"));
  console.log("errors", errors);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
