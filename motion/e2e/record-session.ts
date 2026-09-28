/**
 * Records a full user session end-to-end: describe → upload → AI draft (via the bridge) → review →
 * vibe sliders → scoped AI edit → discard → pro keyframing → split view → JSON → undo → export.
 * Run: npx tsx e2e/record-session.ts <outDir>
 */
import { chromium, type Locator, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";
import * as S from "./orbit-script";

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

  /* ------------------------------------------------------------------ */
  await page.goto(BASE);
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE);
  await pause(1800);

  await caption("1 · Describe the video and drop in your brand assets");
  await type(page.getByLabel("Describe your video"), S.FIRST_PROMPT);
  await pause(300);
  const fx = path.resolve("e2e/fixtures");
  await page.getByTestId("start-upload").setInputFiles([path.join(fx, "orbit-app.png"), path.join(fx, "orbit-logo.png")]);
  await pause(900);
  await click(page.getByTestId("start-create"));
  await page.getByTestId("editor").waitFor();
  await pause(1200);

  await caption("2 · The request waits for an AI agent — here Claude connects through the bridge");
  await pause(1600);
  await fusion("(f) => f.bridge.connect('Claude')");
  await pause(900);
  await caption("3 · The agent answers with ops — the timeline builds itself live");
  await agentRespond(S.FIRST_REPLY, S.FIRST_OPS, S.FIRST_CHIPS);
  await pause(1200);
  await page.locator(".msgs").evaluate((el) => el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }));
  await pause(1500);

  await caption("4 · Every AI change is a reviewable op. Keep all — one undo step");
  await click(page.getByTestId("keep"));
  await pause(800);
  await caption("5 · Play the draft");
  await page.evaluate(() => (window as unknown as { fusion: { time: { set: (t: number) => void } } }).fusion.time.set(0));
  await play(6500);
  await pause(400);

  await caption("6 · Vibe sliders: no AI, zero tokens — they drive bindings the agent set up");
  await click(page.getByRole("button", { name: "Vibe" }));
  const bounce = page.locator("#style-bounce");
  const bb = (await bounce.boundingBox())!;
  await dragTo({ x: bb.x + bb.width * 0.5, y: bb.y + bb.height / 2 }, { x: bb.x + bb.width * 0.92, y: bb.y + bb.height / 2 });
  const energy = page.locator("#style-energy");
  const eb = (await energy.boundingBox())!;
  await dragTo({ x: eb.x + eb.width * 0.5, y: eb.y + eb.height / 2 }, { x: eb.x + eb.width * 0.8, y: eb.y + eb.height / 2 });
  await page.evaluate(() => (window as unknown as { fusion: { time: { set: (t: number) => void } } }).fusion.time.set(0.2));
  await play(3500);
  await caption("7 · Follow-up chips apply instantly — no model call");
  await click(page.getByRole("button", { name: /Add a sparkle burst/ }));
  await page.evaluate(() => (window as unknown as { fusion: { time: { set: (t: number) => void } } }).fusion.time.set(3.5));
  await play(2200);

  await caption("8 · Focus the AI: select the headline, then ask — only that layer is sent");
  await page.evaluate(() => (window as unknown as { fusion: { time: { set: (t: number) => void } } }).fusion.time.set(4.2));
  await pause(500);
  const c = await page.evaluate(() => (window as unknown as { __viewport: { center: (id: string) => { x: number; y: number } } }).__viewport.center("title"));
  await moveTo(c.x, c.y);
  await page.mouse.click(c.x, c.y);
  await pause(500);
  await click(page.getByTestId("tab-assistant"));
  await type(page.getByLabel("Message the AI"), S.SCOPED_PROMPT);
  await page.keyboard.press("Enter");
  await pause(1100);
  await agentRespond(S.SCOPED_REPLY, S.SCOPED_OPS);
  await pause(900);
  await click(page.getByTestId("keep"));
  await page.evaluate(() => (window as unknown as { fusion: { time: { set: (t: number) => void } } }).fusion.time.set(1.6));
  await play(2400);

  await caption("9 · Not every idea lands — preview it, then Discard");
  await page.keyboard.press("Escape");
  await type(page.getByLabel("Message the AI"), S.ORBIT_PROMPT);
  await page.keyboard.press("Enter");
  await pause(900);
  await agentRespond(S.ORBIT_REPLY, S.ORBIT_OPS);
  await page.evaluate(() => (window as unknown as { fusion: { time: { set: (t: number) => void } } }).fusion.time.set(1));
  await play(2600);
  await click(page.getByRole("button", { name: "Discard" }).last());
  await pause(500);
  await type(page.getByLabel("Message the AI"), S.PUSH_PROMPT);
  await page.keyboard.press("Enter");
  await pause(900);
  await agentRespond(S.PUSH_REPLY, S.PUSH_OPS);
  await pause(600);
  await click(page.getByTestId("keep"));
  await pause(600);

  await caption("10 · Pro mode: layers, behavior clips and keyframes on the same document");
  await click(page.getByRole("group", { name: "Editor mode" }).getByRole("button", { name: "Pro" }));
  await pause(800);
  await click(page.getByTestId("layer-phone"));
  await click(page.getByLabel("Show keyframes of phone"));
  await pause(600);
  const pps = await page.evaluate(() => (window as unknown as { __timeline: { pps: number } }).__timeline.pps);
  const k = await tl("phone", 0.15 + 2.7, "rot.y");
  await caption("11 · Drag a keyframe, drag a clip — snapping, one undo step each");
  await dragTo(k, { x: k.x + pps * 0.6, y: k.y });
  const clip = await tl("sub", 3.1);
  await dragTo(clip, { x: clip.x - pps * 0.35, y: clip.y });
  await pause(500);

  await caption("12 · Stopwatch a property: the streak pill tilts in on two keys");
  await click(page.getByTestId("layer-pill"));
  await click(page.getByTestId("tab-inspect"));
  await page.evaluate(() => (window as unknown as { fusion: { time: { set: (t: number) => void } } }).fusion.time.set(4.4));
  await pause(300);
  await click(page.getByLabel("Keyframe Rotation"));
  await page.evaluate(() => (window as unknown as { fusion: { time: { set: (t: number) => void } } }).fusion.time.set(5.4));
  await pause(300);
  await type(page.getByLabel("pill rot.z"), "-6");
  await page.keyboard.press("Enter");
  await pause(500);
  await page.evaluate(() => (window as unknown as { fusion: { time: { set: (t: number) => void } } }).fusion.time.set(4));
  await play(2200);

  await caption("13 · Split view: orbit the scene camera next to the shot");
  await click(page.getByRole("button", { name: "Split", exact: true }));
  await pause(700);
  const vp = (await page.getByTestId("viewport-canvas").boundingBox())!;
  await dragTo({ x: vp.x + vp.width * 0.25, y: vp.y + vp.height * 0.5 }, { x: vp.x + vp.width * 0.36, y: vp.y + vp.height * 0.42 }, 40);
  await pause(900);
  await click(page.getByRole("button", { name: "Shot", exact: true }));

  await caption("14 · The JSON is the source of truth — and the outline is all the AI reads");
  await click(page.getByTestId("tab-json")).catch(() => undefined); // developer mode only
  await pause(1600);
  await click(page.getByRole("button", { name: "What the AI sees" }));
  await pause(2200);

  await caption("15 · Every change — yours, the AI's, a slider — is one undoable transaction");
  await click(page.getByTestId("tab-history"));
  await pause(1300);
  await page.keyboard.press("Control+z");
  await pause(700);
  await page.keyboard.press("Control+z");
  await pause(900);
  await page.keyboard.press("Control+Shift+z");
  await pause(600);
  await page.keyboard.press("Control+Shift+z");
  await pause(900);

  await caption("16 · Export: every frame rendered in-browser by the preview renderer (sped up in this recording)");
  await click(page.getByTestId("export-open"));
  await pause(500);
  await click(page.getByTestId("export-dialog").getByRole("button", { name: "MP4", exact: true }));
  await click(page.getByTestId("export-dialog").getByRole("button", { name: "1080p" }));
  await click(page.getByTestId("export-run"));
  mark("EXPORT_START");
  await page.getByTestId("export-info").waitFor({ timeout: 600_000 });
  mark("EXPORT_END");
  await caption("Done — a 1080p MP4 rendered frame-perfect");
  await pause(3500);
  await click(page.getByTestId("export-dialog").getByRole("button", { name: "Close", exact: true }));
  await caption("…and the project stays a live, editable document");
  await page.evaluate(() => (window as unknown as { fusion: { time: { set: (t: number) => void } } }).fusion.time.set(0));
  await play(7600);
  await pause(1500);

  const info = await page.evaluate(async () => {
    const r = (window as unknown as { __lastExport: { blob: Blob; codec: string; width: number; height: number; frames: number; ms: number; ext: string } }).__lastExport;
    const buf = new Uint8Array(await r.blob.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { b64: btoa(bin), codec: r.codec, width: r.width, height: r.height, frames: r.frames, ms: r.ms, ext: r.ext };
  });
  fs.writeFileSync(path.join(OUT, `orbit-launch${info.ext}`), Buffer.from(info.b64, "base64"));
  const finalDoc = await page.evaluate(() => (window as unknown as { fusion: { doc: () => unknown } }).fusion.doc());
  fs.writeFileSync(path.join(OUT, "orbit-launch.fmd.json"), JSON.stringify(finalDoc, null, 2));
  const video = page.video();
  await ctx.close();
  await browser.close();
  const vpath = await video!.path();
  fs.renameSync(vpath, path.join(OUT, "session.webm"));
  fs.writeFileSync(path.join(OUT, "session-log.txt"), log.join("\n") + `\n\nexport: ${info.codec} ${info.width}x${info.height} ${info.frames} frames in ${(info.ms / 1000).toFixed(1)}s\nerrors: ${errors.length ? errors.join("\n") : "none"}\n`);
  console.log(log.join("\n"));
  console.log("export", info.codec, info.width, info.height, info.frames, (info.ms / 1000).toFixed(1) + "s");
  console.log("errors", errors);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
