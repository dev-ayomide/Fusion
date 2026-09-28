/**
 * Screen-records a first-time user rebuilding the "Money, made calm." hook by hand, using only the
 * interface (no AI, no JSON): blank canvas → text → fonts, colours, entrances → a shape behind it →
 * resize with the corner handles → a logo upload → a motion curve preset → the assistant chat
 * surviving a reload. Captions call out the UX gaps this walkthrough found and what changed.
 *
 *   npx tsx e2e/record-walkthrough.ts [outDir]      (dev server on :5180; FFMPEG=/path/to/ffmpeg with libx264)
 */
import { chromium, type Locator } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const OUT = path.resolve(process.argv[2] ?? "out/walkthrough");
const BASE = process.env.BASE_URL ?? "http://localhost:5180";
const LOGO = process.env.LOGO ?? path.resolve("public/favicon.png");
const W = 1600, H = 900;
const FRAMES = path.join(OUT, "frames");
fs.rmSync(FRAMES, { recursive: true, force: true });
fs.mkdirSync(FRAMES, { recursive: true });

const OVERLAY = `(() => {
  const boot = () => {
    if (document.getElementById("__cursor")) return;
    const c = document.createElement("div"); c.id = "__cursor";
    c.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2l15 8.5-6.5 1.8L9.8 19z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: "fixed", left: "0", top: "0", zIndex: 100000, pointerEvents: "none", transform: "translate(-4px,-2px)" });
    const ring = document.createElement("div");
    Object.assign(ring.style, { position: "fixed", width: "38px", height: "38px", marginLeft: "-19px", marginTop: "-19px", borderRadius: "50%", border: "2px solid #7c5cff", zIndex: 99999, pointerEvents: "none", opacity: "0", transition: "opacity .35s, transform .35s", transform: "scale(.4)" });
    const cap = document.createElement("div"); cap.id = "__caption";
    Object.assign(cap.style, { position: "fixed", bottom: "18px", left: "50%", transform: "translateX(-50%)", zIndex: 99998, pointerEvents: "none", background: "rgba(10,10,14,.94)", color: "#fff", font: "500 16px/1.4 Inter Variable, system-ui, sans-serif", padding: "10px 18px", borderRadius: "12px", boxShadow: "0 10px 40px rgba(0,0,0,.45)", maxWidth: "1000px", textAlign: "center", opacity: "0", transition: "opacity .3s", border: "1px solid rgba(255,255,255,.12)" });
    document.body.append(c, ring, cap);
    addEventListener("mousemove", (e) => { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; }, true);
    addEventListener("mousedown", (e) => { ring.style.left = e.clientX + "px"; ring.style.top = e.clientY + "px"; ring.style.opacity = "1"; ring.style.transform = "scale(1)"; setTimeout(() => { ring.style.opacity = "0"; ring.style.transform = "scale(.4)"; }, 300); }, true);
    window.__caption = (t) => { cap.innerHTML = t; cap.style.opacity = t ? "1" : "0"; };
  };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", boot); else boot();
})();`;

async function main() {
  const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await ctx.addInitScript(OVERLAY);
  const page = await ctx.newPage();
  const errors: string[] = [];
  const checks: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  const cdp = await ctx.newCDPSession(page);
  const shots: { file: string; ts: number }[] = [];
  let n = 0;
  cdp.on("Page.screencastFrame", async (f) => {
    const file = path.join(FRAMES, `s${String(n++).padStart(6, "0")}.jpg`);
    fs.writeFileSync(file, Buffer.from(f.data, "base64"));
    shots.push({ file, ts: f.metadata.timestamp ?? Date.now() / 1000 });
    await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });

  const pause = (ms: number) => page.waitForTimeout(ms);
  const caption = (t: string) => page.evaluate((t) => (window as unknown as { __caption: (t: string) => void }).__caption(t), t);
  const fixed = (t: string) => caption(`<span style="color:#b9a6ff;font-weight:700">Fixed</span> · ${t}`);
  const moveTo = (x: number, y: number, steps = 18) => page.mouse.move(x, y, { steps });
  const click = async (loc: Locator) => {
    await loc.scrollIntoViewIfNeeded();
    const b = (await loc.boundingBox())!;
    await moveTo(b.x + b.width / 2, b.y + b.height / 2);
    await pause(140);
    await page.mouse.down(); await pause(60); await page.mouse.up();
    await pause(300);
  };
  const drag = async (x0: number, y0: number, x1: number, y1: number, steps = 30) => {
    await moveTo(x0, y0); await pause(150);
    await page.mouse.down(); await pause(80);
    await page.mouse.move(x1, y1, { steps }); await pause(120);
    await page.mouse.up(); await pause(400);
  };
  const fusion = <T,>(fn: string, arg?: unknown) => page.evaluate(([fn, arg]) => new Function("f", "arg", `return (${fn})(f, arg)`)((window as unknown as { fusion: unknown }).fusion, arg) as T, [fn, arg] as const);
  type L = { id: string; type: string; text?: string; font?: string; fill?: string; color?: string; scale?: number; keys?: Record<string, unknown[][]> };
  const layers = () => fusion<L[]>("(f) => f.doc().layers");
  const newest = async (before: string[]) => (await layers()).find((l) => !before.includes(l.id))!;
  const check = (ok: boolean, what: string) => { checks.push(`${ok ? "PASS" : "FAIL"}  ${what}`); if (!ok) console.error("FAIL", what); };
  const center = (id: string) => page.evaluate((id) => (window as unknown as { __viewport: { center: (id: string) => { x: number; y: number } | null } }).__viewport.center(id), id);
  const insp = page.getByTestId("inspector");
  const choose = (name: string) => click(insp.getByRole("button", { name, exact: true }));
  const setText = async (text: string) => {
    const box = insp.getByLabel("Text content");
    await click(box);
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type(text, { delay: 55 });
    await page.keyboard.press("ControlOrMeta+Enter");
    await pause(500);
  };
  const handle = async (corner: "br" | "tr") => (await page.locator(`.selbox:not(.ai) .h.${corner}`).first().boundingBox())!;
  const play = async (from: number, to: number) => {
    await fusion("(f, t) => { f.select([]); f.time.set(t); }", from); await pause(300);
    await fusion("(f) => f.time.play()");
    await pause((to - from) * 1000 + 200);
    await fusion("(f) => f.time.pause()");
  };

  /* ------------------------------ start ------------------------------ */
  await page.goto(BASE + "/?ai=off");
  await page.evaluate(() => { localStorage.clear(); indexedDB.deleteDatabase("fusion-motion-projects"); });
  await page.goto(BASE + "/?ai=off");
  await pause(2000);
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 88, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  await caption("Walkthrough: rebuilding the “Money, made calm.” hook by hand, as a first-time user");
  await moveTo(W * 0.5, H * 0.5);
  await pause(2800);
  await caption("No prompt this time: start from a blank canvas");
  await page.evaluate(() => document.querySelector(".final")?.scrollIntoView({ behavior: "smooth", block: "center" }));
  await pause(1600);
  await click(page.getByRole("button", { name: "Open a blank canvas" }));
  await page.getByTestId("editor").waitFor();
  await pause(1200);
  await click(page.getByTestId("tab-inspect"));
  await fixed("an empty canvas used to be a black box with no clue what to do. Now it says where to start");
  await pause(3600);

  /* ------------------------------ first line ------------------------------ */
  let before = (await layers()).map((l) => l.id);
  await caption("Add a line of text from the toolbar");
  await click(page.getByRole("button", { name: "Add text" }));
  await pause(900);
  const line1 = await newest(before);
  await fixed("new text used to be invisible at 0s (it was still mid-entrance). Now the playhead jumps to where it has landed");
  await pause(3600);
  await fixed("the Text box now comes first in Edit, instead of below the fold");
  await pause(2400);
  await setText("Money,");
  await caption("Pick a bolder font and weight");
  await insp.getByLabel("Font").selectOption({ label: "Bricolage Grotesque" }).catch(() => insp.getByLabel("Font").selectOption({ index: 1 }));
  await pause(700);
  await insp.getByLabel("Weight").selectOption({ index: (await insp.getByLabel("Weight").locator("option").count()) - 1 });
  await pause(900);
  await caption("Choose how it enters: Cascade");
  await choose("Cascade");
  await pause(1600);

  await caption("Drag it into place, then grab a corner handle to make it bigger");
  const c1 = (await center(line1.id))!;
  await drag(c1.x, c1.y, c1.x - 40, c1.y - 60);
  await pause(500);
  const h1 = await handle("br");
  await drag(h1.x + h1.width / 2, h1.y + h1.height / 2, h1.x + 80, h1.y + 30, 40);
  await fixed("imported images and text can now be resized from the corners, the same way you move them");
  await pause(3000);
  const l1 = (await layers()).find((l) => l.id === line1.id)!;
  check(l1.text === "Money," && (l1.scale ?? 1) > 1.1, `first line reads "${l1.text}" and was resized to ${Math.round((l1.scale ?? 1) * 100)}%`);

  /* ------------------------------ second line ------------------------------ */
  before = (await layers()).map((l) => l.id);
  await caption("A second line, “made calm.”");
  await click(page.getByRole("button", { name: "Add text" }));
  await pause(900);
  const line2 = await newest(before);
  await fixed("new items used to pile up in the middle on top of each other. Now each lands in a free spot");
  await pause(3200);
  await setText("made calm.");
  await insp.getByLabel("Font").selectOption({ label: "Instrument Serif" }).catch(() => {});
  await pause(700);
  await caption("Colour it with the accent: colours now have plain names (Accent, Text, Background)");
  await click(insp.getByRole("button", { name: "Brand color accent" }).first());
  await pause(1500);
  await choose("Bounce in");
  await pause(1400);
  const c2 = (await center(line2.id))!;
  await drag(c2.x, c2.y, c2.x + 30, c2.y + 10);

  /* ------------------------------ orb ------------------------------ */
  before = (await layers()).map((l) => l.id);
  await caption("Now the orange orb: Shape → Ellipse");
  await click(page.getByRole("button", { name: "Add shape" }));
  await pause(500);
  await click(page.locator(".dock .menu").getByRole("button", { name: /Ellipse/ }));
  await pause(900);
  const orb = await newest(before);
  await click(insp.getByRole("button", { name: "Brand color accent" }).first());
  await pause(600);
  const co = (await center(orb.id))!;
  await drag(co.x, co.y, co.x + 250, co.y - 60);
  const ho = await handle("br");
  await drag(ho.x + ho.width / 2, ho.y + ho.height / 2, ho.x + 110, ho.y + 110, 35);
  await caption("It covers the words, so send it behind them");
  await pause(1200);
  for (let i = 0; i < 3; i++) {
    const b = insp.getByRole("button", { name: "Send backward" });
    if (await b.isDisabled()) break;
    await click(b);
    await pause(500);
  }
  await fixed("there was no way to reorder layers without the Pro layer list. Bring forward / Send backward now sit next to the name");
  await pause(3400);
  await caption("Pop it in, and let it float while it's on screen");
  await choose("Pop in");
  await pause(900);
  await choose("Float");
  await pause(1200);
  await caption("Sizes and fades read in percent now (was 1.42 and 0.8)");
  await insp.getByText("Size", { exact: true }).first().scrollIntoViewIfNeeded().catch(() => {});
  await pause(2600);

  /* ------------------------------ logo ------------------------------ */
  if (fs.existsSync(LOGO)) {
    before = (await layers()).map((l) => l.id);
    await caption("Add the logo: Image → pick a file");
    const chooser = page.waitForEvent("filechooser");
    await click(page.getByRole("button", { name: "Add image" }));
    await (await chooser).setFiles(LOGO);
    await pause(1500);
    const logo = await newest(before);
    if (logo) {
      const hl = await handle("tr");
      await caption("Too big: drag a corner inwards to shrink it");
      await drag(hl.x + hl.width / 2, hl.y + hl.height / 2, hl.x - 60, hl.y + 60, 30);
      const cl = (await center(logo.id))!;
      await drag(cl.x, cl.y, cl.x - 200, cl.y + 60, 30);
      const lg = (await layers()).find((l) => l.id === logo.id)!;
      check((lg.scale ?? 1) < 0.95, `logo shrunk to ${Math.round((lg.scale ?? 1) * 100)}%`);
    }
  }

  /* ------------------------------ play ------------------------------ */
  await caption("Play it back");
  await pause(600);
  await play(0, 3);
  await pause(600);

  /* ------------------------------ curves ------------------------------ */
  await caption("Pro mode: animate the orb by hand and shape its motion");
  await page.keyboard.press("p");
  await pause(1200);
  await fusion("(f, id) => { f.select([id]); f.time.set(0.8); }", orb.id);
  await pause(700);
  await click(insp.getByRole("button", { name: "Keyframe Position X" }));
  await pause(500);
  await fusion("(f) => f.time.set(2.2)");
  await pause(600);
  const co2 = (await center(orb.id))!;
  await caption("Move to 2.2s and drag it: a second keyframe is added automatically");
  await drag(co2.x, co2.y, co2.x - 220, co2.y, 30);
  await pause(800);
  await click(page.getByTestId("graph-toggle"));
  await pause(900);
  await fixed("the graph was a bare editor with no way in. Curves now names the motion in plain words and offers one-click presets");
  await pause(3800);
  await click(page.getByRole("button", { name: /Overshoot/ }).first());
  await pause(1400);
  await caption("Overshoot: it slides past and settles back. Switch Bars ⇄ Curves anytime from the timeline");
  const keys = ((await layers()).find((l) => l.id === orb.id)!.keys ?? {}) as Record<string, unknown[][]>;
  check(Object.values(keys).some((k) => k.some((kf) => kf[2] === "back")), "the Overshoot preset wrote a back ease");
  await play(0.6, 3);
  await pause(400);
  await click(page.getByRole("button", { name: "Bars", exact: true }));
  await page.keyboard.press("p");
  await pause(1000);

  /* ------------------------------ chat persistence ------------------------------ */
  await caption("Ask the assistant for a tweak (answered by a scripted agent here, since this recording has no key)");
  await fusion("(f) => f.bridge.connect('Claude')");
  await click(page.getByTestId("tab-assistant"));
  await pause(600);
  const input = page.getByPlaceholder(/Describe a change|Ask for a change/);
  await click(input);
  await page.keyboard.type("Make the orb a little softer", { delay: 40 });
  await page.keyboard.press("Enter");
  await pause(900);
  const turn = await fusion<{ turnId: string }[]>("(f) => f.bridge.pending()");
  if (turn[0]) await fusion("(f, a) => f.bridge.respond(a.id, a.r)", { id: turn[0].turnId, r: { message: "Softened the orb: lower opacity so the words lead.", ops: [{ op: "set", path: `${orb.id}/opacity`, value: 0.85 }] } });
  await pause(1400);
  if (await page.getByTestId("keep").count()) await click(page.getByTestId("keep"));
  await caption("Model switcher: just the names now, and the changes card shows no raw JSON");
  await pause(2800);
  await caption("Reload the page…");
  await pause(1000);
  await page.reload();
  await pause(1800);
  if (await page.getByTestId("resume").count()) await click(page.getByTestId("resume"));
  else if (await page.getByTestId("project-card").count()) await click(page.getByTestId("project-card").first());
  await page.getByTestId("editor").waitFor();
  await pause(800);
  await click(page.getByTestId("tab-assistant"));
  await fixed("the assistant conversation is now saved with each video in this browser, so it's still here after a reload");
  const kept = await page.getByText("Make the orb a little softer").count();
  check(kept > 0, "the chat survives a reload");
  await pause(4000);
  await caption("Done: the hook, rebuilt with clicks and drags only");
  await play(0, 3.2);
  await caption("");
  await pause(600);
  await cdp.send("Page.stopScreencast");
  const end = Date.now() / 1000;
  await browser.close();

  let list = "ffconcat version 1.0\n";
  for (let i = 0; i < shots.length; i++) {
    const b = i + 1 < shots.length ? shots[i + 1].ts : end;
    list += `file '${path.basename(shots[i].file)}'\nduration ${Math.max(0.001, b - shots[i].ts).toFixed(4)}\n`;
  }
  list += `file '${path.basename(shots.at(-1)!.file)}'\n`;
  fs.writeFileSync(path.join(FRAMES, "list.txt"), list);
  const mp4 = path.join(OUT, "fusion-motion-walkthrough.mp4");
  execFileSync(process.env.FFMPEG ?? "ffmpeg", ["-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", path.join(FRAMES, "list.txt"), "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-r", "30", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "medium", "-crf", "22", "-movflags", "+faststart", mp4]);
  fs.writeFileSync(path.join(OUT, "checks.txt"), checks.join("\n") + `\n\nerrors: ${errors.length ? "\n" + errors.join("\n") : "none"}\n`);
  console.log(checks.join("\n"));
  console.log("errors", errors.length ? errors : "none");
  console.log("frames", shots.length, "→", mp4);
}

main().catch((e) => { console.error(e); process.exit(1); });
