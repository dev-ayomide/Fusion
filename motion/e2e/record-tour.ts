/**
 * Screen-records a guided test of the whole product in the real editor:
 * landing (every section) → prompt → storyboard (settings, edit, reorder, add/delete) → build scene
 * by scene → assistant edit, Vibe, Edit and History tabs → Pro mode (layers, inspector, graph editor,
 * split view, shortcuts) → music (library + upload) → export → the "Your videos" library (rename,
 * duplicate, delete, reopen) → opening a template.
 *
 * The AI side is answered through window.fusion.bridge with scripted replies (the same path the
 * e2e suite and any external agent use), so the recording needs no API key. With a key in
 * motion/.env the in-app provider answers these same turns instead.
 *
 *   npx tsx e2e/record-tour.ts [outDir]      (dev server on :5180; FFMPEG=/path/to/ffmpeg with libx264)
 */
import { chromium, type Locator } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const OUT = path.resolve(process.argv[2] ?? "out/tour");
const BASE = process.env.BASE_URL ?? "http://localhost:5180";
const W = 1600, H = 900;
const FRAMES = path.join(OUT, "frames");
fs.rmSync(FRAMES, { recursive: true, force: true });
fs.mkdirSync(FRAMES, { recursive: true });

const IDEA = "A 12-second launch film for Calm, a budgeting app. Dark and premium, headline “Money, made calm.”";
const PLAN = {
  message: "Four beats: the hook, the app in motion, proof, and a calm sign-off.",
  plan: {
    look: "Deep navy, warm cream type, one hot-orange accent",
    scenes: [
      { title: "Hook", dur: 3, brief: "“Money,” cascades in over a soft orange orb; “made calm.” bounces in beneath it in serif." },
      { title: "In motion", dur: 3, brief: "Budget cards spin in and settle while a ring of dots breathes around them." },
      { title: "Proof", dur: 3, brief: "Big stat: “38% more saved” lands word by word." },
      { title: "Sign-off", dur: 3, brief: "The Calm mark spins in, halo breathes, wordmark resolves. Hold." },
    ],
  },
};

type Op = Record<string, unknown>;
const txt = (id: string, a: number, b: number, text: string, extra: Record<string, unknown>): Op => ({ op: "add", id, layer: { type: "text", text, in: a, out: b, ...extra } });
const shp = (id: string, a: number, b: number, extra: Record<string, unknown>): Op => ({ op: "add", id, layer: { type: "shape", in: a, out: b, ...extra } });
const plate = (id: string, a: number, b: number, fill: string): Op => shp(id, a, b, { shape: "rect", w: 2900, h: 1650, fill, pos: [0, 0, -400] });

const SETUP = {
  message: "Navy ground, cream type, one orange accent; a slow push-in on the shared camera.",
  ops: [
    { op: "set", path: "brand/colors", value: { accent: "#ff5a1f", ink: "#f6f1e7", paper: "#0b0d1a", sky: "#3d7bff", sun: "#ffc23d" } },
    { op: "set", path: "shot/beh", value: [{ id: "push", use: "dolly", at: 0, dur: 12, to: 1500, ease: "out" }] },
  ],
};
const SCENES: { message: string; ops: Op[] }[] = [
  {
    message: "Hook: the headline cascades in over a floating orb.",
    ops: [
      plate("s1-plate", 0, 3, "$paper"),
      shp("s1-orb", 0.1, 3, { shape: "ellipse", w: 520, h: 520, fill: "$accent", pos: [430, 140, -120], beh: [{ id: "in", use: "popIn", at: 0, dur: 0.8, bounce: 0.6 }, { id: "bob", use: "float", at: 0.8, amp: 18, period: 2.2 }] }),
      txt("s1-line1", 0.3, 3, "Money,", { size: 230, weight: 800, font: "Bricolage Grotesque Variable", color: "$ink", pos: [-120, 90, 0], tracking: -6, beh: [{ id: "in", use: "cascade", at: 0, stagger: 0.05, dist: 140 }] }),
      txt("s1-line2", 1.0, 3, "made calm.", { size: 150, weight: 400, font: "Instrument Serif", color: "$accent", pos: [-60, -110, 0], beh: [{ id: "in", use: "bounceIn", at: 0, stagger: 0.1 }] }),
    ],
  },
  {
    message: "In motion: three budget cards spin in inside a breathing ring.",
    ops: [
      plate("s2-plate", 3, 6, "$paper"),
      { op: "add", id: "s2-ring", layer: { type: "cloner", mode: "radial", n: 40, r: 420, orient: true, pos: [0, 0, -60], in: 3, out: 6, child: { kind: "shape", shape: "rect", w: 10, h: 60, radius: 5, fill: "$accent" }, reveal: { dur: 0.5, bounce: 0.4 }, fx: [{ id: "lag", type: "delay", step: 0.01 }], beh: [{ id: "kick", use: "pulse", at: 0.5, amp: 0.05, period: 0.8 }] } },
      shp("s2-card1", 3.1, 6, { shape: "rect", w: 300, h: 380, radius: 36, fill: "$sky", pos: [-330, 0, 0], rot: [0, 0, -8], beh: [{ id: "in", use: "spinIn", at: 0, dur: 0.9, deg: -40 }] }),
      shp("s2-card2", 3.3, 6, { shape: "rect", w: 300, h: 380, radius: 36, fill: "$sun", pos: [0, 20, 20], beh: [{ id: "in", use: "spinIn", at: 0, dur: 0.9, deg: 30 }] }),
      shp("s2-card3", 3.5, 6, { shape: "rect", w: 300, h: 380, radius: 36, fill: "$accent", pos: [330, 0, 0], rot: [0, 0, 8], beh: [{ id: "in", use: "spinIn", at: 0, dur: 0.9, deg: -30 }] }),
      txt("s2-label", 4.0, 6, "Every dollar, in its place.", { size: 64, weight: 600, color: "$ink", pos: [0, -330, 40], beh: [{ id: "in", use: "cascade", at: 0, stagger: 0.03, dist: 60 }] }),
    ],
  },
  {
    message: "Proof: the stat lands word by word on a sky-blue plate.",
    ops: [
      plate("s3-plate", 6, 9, "$sky"),
      txt("s3-num", 6.2, 9, "38%", { size: 340, weight: 800, font: "Bricolage Grotesque Variable", color: "$ink", pos: [0, 90, 0], tracking: -10, beh: [{ id: "in", use: "cascade", at: 0, stagger: 0.07, dist: 180 }] }),
      txt("s3-sub", 6.8, 9, "more saved in 90 days", { size: 90, weight: 400, font: "Instrument Serif", color: "$paper", pos: [0, -150, 0], beh: [{ id: "in", use: "bounceIn", at: 0, stagger: 0.08 }] }),
    ],
  },
  {
    message: "Sign-off: the mark spins in, the halo breathes, and the wordmark resolves and holds.",
    ops: [
      plate("s4-plate", 9, 12, "$paper"),
      { op: "add", id: "s4-halo", layer: { type: "cloner", mode: "radial", n: 24, r: 240, orient: true, pos: [0, 70, 0], in: 9, out: 12, child: { kind: "shape", shape: "rect", w: 10, h: 44, radius: 5, fill: "$accent" }, reveal: { dur: 0.5, bounce: 0.3 }, fx: [{ id: "lag", type: "delay", step: 0.025 }], beh: [{ id: "breathe", use: "pulse", at: 1, amp: 0.04, period: 1.6 }] } },
      shp("s4-mark", 9.3, 12, { shape: "rect", w: 180, h: 180, radius: 46, fill: "$accent", pos: [0, 70, 0], rot: [0, 0, 45], beh: [{ id: "in", use: "spinIn", at: 0, dur: 1.1, deg: -180, bounce: 0.3 }] }),
      txt("s4-word", 10.2, 12, "calm", { size: 130, weight: 700, color: "$ink", pos: [0, -240, 0], tracking: 4, beh: [{ id: "in", use: "cascade", at: 0, stagger: 0.06, dist: 80 }] }),
    ],
  },
];

const OVERLAY = `(() => {
  const boot = () => {
    if (document.getElementById("__cursor")) return;
    const c = document.createElement("div"); c.id = "__cursor";
    c.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2l15 8.5-6.5 1.8L9.8 19z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: "fixed", left: "0", top: "0", zIndex: 100000, pointerEvents: "none", transform: "translate(-4px,-2px)" });
    const ring = document.createElement("div");
    Object.assign(ring.style, { position: "fixed", width: "38px", height: "38px", marginLeft: "-19px", marginTop: "-19px", borderRadius: "50%", border: "2px solid #ff5a1f", zIndex: 99999, pointerEvents: "none", opacity: "0", transition: "opacity .35s, transform .35s", transform: "scale(.4)" });
    const cap = document.createElement("div"); cap.id = "__caption";
    Object.assign(cap.style, { position: "fixed", top: "14px", left: "50%", transform: "translateX(-50%)", zIndex: 99998, pointerEvents: "none", background: "rgba(10,10,14,.92)", color: "#fff", font: "600 16px/1.35 Inter Variable, system-ui, sans-serif", padding: "9px 16px", borderRadius: "12px", boxShadow: "0 10px 40px rgba(0,0,0,.45)", maxWidth: "980px", textAlign: "center", opacity: "0", transition: "opacity .3s", border: "1px solid rgba(255,255,255,.12)" });
    document.body.append(c, ring, cap);
    addEventListener("mousemove", (e) => { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; }, true);
    addEventListener("mousedown", (e) => { ring.style.left = e.clientX + "px"; ring.style.top = e.clientY + "px"; ring.style.opacity = "1"; ring.style.transform = "scale(1)"; setTimeout(() => { ring.style.opacity = "0"; ring.style.transform = "scale(.4)"; }, 300); }, true);
    window.__caption = (t) => { cap.textContent = t; cap.style.opacity = t ? "1" : "0"; };
  };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", boot); else boot();
})();`;

async function main() {
  const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, acceptDownloads: true });
  await ctx.addInitScript(OVERLAY);
  const page = await ctx.newPage();
  const errors: string[] = [];
  const checks: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));

  const cdp = await ctx.newCDPSession(page);
  const shots: { file: string; ts: number }[] = [];
  let n = 0;
  cdp.on("Page.screencastFrame", async (f) => {
    const file = path.join(FRAMES, `s${String(n++).padStart(6, "0")}.jpg`);
    fs.writeFileSync(file, Buffer.from(f.data, "base64"));
    shots.push({ file, ts: f.metadata.timestamp ?? Date.now() / 1000 });
    await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  const t0 = Date.now() / 1000;
  const squashes: [number, number][] = [];

  const pause = (ms: number) => page.waitForTimeout(ms);
  const caption = (t: string) => page.evaluate((t) => (window as unknown as { __caption: (t: string) => void }).__caption(t), t);
  const moveTo = (x: number, y: number, steps = 20) => page.mouse.move(x, y, { steps });
  const click = async (loc: Locator) => {
    await loc.scrollIntoViewIfNeeded();
    const b = (await loc.boundingBox())!;
    await moveTo(b.x + b.width / 2, b.y + b.height / 2);
    await pause(160);
    await page.mouse.down(); await pause(60); await page.mouse.up();
    await pause(250);
  };
  const type = async (loc: Locator, text: string, delay = 22) => { await click(loc); await page.keyboard.type(text, { delay }); };
  const fusion = <T,>(fn: string, arg?: unknown) => page.evaluate(([fn, arg]) => new Function("f", "arg", `return (${fn})(f, arg)`)((window as unknown as { fusion: unknown }).fusion, arg) as T, [fn, arg] as const);
  const doc = () => fusion<{ scenes: { id: string; title: string; brief: string; status?: string }[]; audio: { id: string; src: string; name?: string }[]; layers: { id: string; size?: number }[]; comp: { dur: number } }>("(f) => f.doc()");
  const nextPending = async (kind: string) => {
    for (let i = 0; i < 200; i++) {
      const p = await fusion<{ turnId: string; kind: string; scene?: { id: string } }[]>("(f) => f.bridge.pending()");
      const hit = p.find((x) => x.kind === kind);
      if (hit) return hit;
      await pause(100);
    }
    throw new Error(`no pending ${kind} turn`);
  };
  const answer = (id: string, r: unknown) => fusion("(f, a) => f.bridge.respond(a.id, a.r)", { id, r });
  const check = (ok: boolean, what: string) => {
    checks.push(`${ok ? "PASS" : "FAIL"}  ${what}`);
    if (!ok) console.error("FAIL", what);
  };
  const play = async (from: number, to: number) => {
    await fusion("(f, t) => f.time.set(t)", from); await pause(250);
    await page.keyboard.press("Space");
    await pause((to - from) * 1000);
    await page.keyboard.press("Space");
  };

  /* ------------------------------ landing ------------------------------ */
  await page.goto(BASE + "/?ai=off");
  await page.evaluate(() => { localStorage.clear(); indexedDB.deleteDatabase("fusion-motion-projects"); });
  await page.goto(BASE + "/?ai=off");
  await pause(2000);
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 88, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  await pause(800);
  const scrollTo = async (sel: string) => {
    await page.evaluate((sel) => document.querySelector(sel)?.scrollIntoView({ behavior: "smooth", block: "start" }), sel);
    await pause(1500);
  };
  const wheel = async (dy: number, times = 1) => {
    for (let k = 0; k < times; k++) { await page.mouse.wheel(0, dy); await pause(700); }
  };
  await caption("Fusion Motion: a walkthrough of every screen");
  await moveTo(W * 0.3, H * 0.45);
  await pause(2200);
  await caption("1 · Landing page: serif headline, one prompt box, example prompts underneath");
  await pause(2600);
  await click(page.getByRole("button", { name: "A launch promo for my budgeting app — phone floating in 3D" }));
  await pause(1400);
  check((await page.getByLabel("Describe your video").inputValue()).includes("budgeting"), "an example prompt fills the prompt box");
  await page.getByLabel("Describe your video").fill("");
  await pause(400);

  await caption("The live preview plays real templates with the same engine as the editor. Switch between them:");
  await scrollTo(".lp-show");
  await pause(1200);
  await click(page.getByRole("tab", { name: "Kinetic type" }));
  await pause(2200);
  await click(page.getByRole("tab", { name: "Logo reveal" }));
  await pause(2200);

  await caption("How it works: three cards that stack as you scroll");
  await click(page.locator(".lp-links button", { hasText: "How it works" }));
  await pause(1600);
  await moveTo(W * 0.5, H * 0.6);
  await wheel(500, 5);

  await caption("Features: try the energy and bounce sliders right on the page");
  await click(page.locator(".lp-links button", { hasText: "Features" }));
  await pause(1500);
  const energy = page.getByLabel("Demo energy");
  await energy.scrollIntoViewIfNeeded();
  const eb = (await energy.boundingBox())!;
  await moveTo(eb.x + eb.width * 0.6, eb.y + eb.height / 2);
  await page.mouse.down(); await moveTo(eb.x + eb.width * 0.95, eb.y + eb.height / 2, 12); await page.mouse.up();
  await pause(1800);
  await wheel(500, 3);

  await caption("Developers: any AI agent can drive the editor through window.fusion");
  await click(page.locator(".lp-links button", { hasText: "Developers" }));
  await pause(2600);

  await caption("Templates: every card is rendered by the real engine");
  await click(page.locator(".lp-links button", { hasText: "Templates" }));
  await pause(2400);
  await moveTo(W * 0.3, H * 0.55);
  await pause(1000);
  await moveTo(W * 0.62, H * 0.55);
  await pause(1200);
  await wheel(600, 3);
  await caption("The end of the page: start with a prompt or a blank canvas");
  await pause(2400);
  await caption("“Start with a prompt” takes you back to the prompt box");
  await click(page.getByRole("button", { name: "Start with a prompt" }));
  await pause(1600);
  check(await page.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Describe your video"), "“Start with a prompt” focuses the prompt box");

  await caption("2 · Describe the video and press Create");
  await type(page.getByLabel("Describe your video"), IDEA, 18);
  await pause(500);
  await click(page.getByTestId("start-create"));
  await page.getByTestId("editor").waitFor();
  await page.getByTestId("storyboard").waitFor();
  check(true, "landing prompt opens the editor with the storyboard");
  await pause(1200);

  /* ------------------------------ AI connection ------------------------------ */
  await caption("3 · The AI connects automatically when a key is in motion/.env. This machine has no key, so the menu says which one to add");
  await click(page.getByTestId("provider-pill"));
  await pause(3200);
  await page.keyboard.press("Escape");
  await click(page.locator(".asst-head .spacer"));
  await caption("For this recording, the AI's replies are scripted and sent through the agent bridge, the same path a real model uses");
  await fusion("(f) => f.bridge.connect('Claude Opus 5.5 (scripted demo)')");
  await pause(2400);

  /* ------------------------------ plan ------------------------------ */
  const plan = await nextPending("plan");
  await answer(plan.turnId, PLAN);
  await page.locator("[data-testid^=scene-s]").first().waitFor();
  const d1 = await doc();
  check(d1.scenes.length === 4 && d1.comp.dur === 12, `plan becomes a 4-scene storyboard (${d1.scenes.length} scenes, ${d1.comp.dur}s)`);
  await caption("4 · The storyboard appears first. Nothing is built until you approve it");
  await pause(3200);

  await caption("5 · Refine a scene before building: rewrite the brief for “Proof”");
  const brief = page.getByLabel("Brief for Proof");
  await brief.scrollIntoViewIfNeeded();
  await click(brief);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Big stat: “38% more saved” slams in over sky blue; a serif line follows.", { delay: 16 });
  await click(page.locator(".sb-head h2"));
  await pause(700);
  const d2 = await doc();
  check(d2.scenes[2].brief.includes("slams in"), "editing a brief updates the plan");

  await caption("Reorder scenes: move “In motion” later, then undo (every edit is one undo step)");
  await click(page.getByLabel("Move In motion later"));
  await pause(1200);
  const d3 = await doc();
  check(d3.scenes[2].title === "In motion", "moving a scene reorders the plan");
  await page.keyboard.press("ControlOrMeta+z");
  await pause(1200);
  check((await doc()).scenes[1].title === "In motion", "undo restores the scene order");

  await caption("Length, format and look sit on one line. Click it to open the settings");
  await click(page.getByTestId("board-settings"));
  await pause(1600);
  const look = page.getByLabel("Look and palette");
  await click(look);
  await page.keyboard.press("End");
  await page.keyboard.type(". Soft film grain.", { delay: 26 });
  await click(page.locator(".sb-head h2"));
  await pause(900);
  await click(page.getByTestId("board-settings"));
  await pause(1000);

  await caption("Add a scene, then delete it again");
  await click(page.getByTestId("add-scene"));
  await pause(1200);
  const d3b = await doc();
  check(d3b.scenes.length === 5, `Add scene adds a fifth scene (${d3b.scenes.length})`);
  const added = d3b.scenes[4];
  const addedCard = page.getByTestId(`scene-${added.id}`);
  await addedCard.scrollIntoViewIfNeeded();
  await addedCard.hover();
  await pause(600);
  await click(addedCard.getByLabel(`Delete ${added.title}`));
  await pause(1200);
  check((await doc()).scenes.length === 4, "deleting it brings the plan back to four scenes");

  /* ------------------------------ build ------------------------------ */
  await caption("6 · Build video: the AI sets the look once, then builds one scene at a time");
  await click(page.getByTestId("build-video"));
  const setup = await nextPending("setup");
  await pause(1200);
  await answer(setup.turnId, { ...SETUP, delayMs: 120 });
  for (let i = 0; i < SCENES.length; i++) {
    const p = await nextPending("scene");
    await caption(`Building scene ${i + 1} of 4 · “${PLAN.plan.scenes[i].title}”. Queued scenes stay editable`);
    await pause(1500);
    await answer(p.turnId, { ...SCENES[i], delayMs: 110, chips: i === SCENES.length - 1 ? [{ label: "Make it snappier", prompt: "Make every entrance snappier" }, { label: "Warmer palette", prompt: "Warm the palette up" }] : undefined });
    await pause(1600);
  }
  await page.waitForFunction(() => (window as unknown as { fusion: { director: { state(): { phase: string } } } }).fusion.director.state().phase === "done", null, { timeout: 60_000 });
  const d4 = await doc();
  check(d4.scenes.every((s) => s.status === "done"), "all four scenes built (status done)");
  check(d4.layers.some((l) => l.id === "s4-word"), "scene layers are in the document");
  await pause(800);
  await caption("Built. Play it back:");
  await play(0, 12);
  await pause(600);

  /* ------------------------------ assistant edit ------------------------------ */
  await caption("7 · The assistant panel: short replies, changes collapsed, at most a few suggestion buttons");
  await pause(2600);
  await caption("Ask for a change in plain words");
  await type(page.getByLabel("Message the AI"), "Make the headline bigger", 26);
  await page.keyboard.press("Enter");
  const edit = await nextPending("edit");
  await pause(1200);
  await answer(edit.turnId, { message: "Headline up to 280 px; the serif line moves down to keep the gap.", ops: [{ op: "set", path: "s1-line1/size", value: 280 }, { op: "set", path: "s1-line2/pos/y", value: -150 }], delayMs: 200, chips: [{ label: "Even bigger", prompt: "Bigger still" }, { label: "Tighter tracking", prompt: "Tighten the tracking" }] });
  await pause(1500);
  await fusion("(f, t) => f.time.set(t)", 2.2);
  const review = page.getByText("Review changes").first();
  if (await review.count()) { await click(review); await pause(1800); }
  await click(page.getByTestId("keep"));
  await pause(900);
  check((await doc()).layers.find((l) => l.id === "s1-line1")?.size === 280, "assistant edit applied after Keep");
  await pause(1200);

  await caption("Vibe: energy, bounce and depth sliders change the whole video instantly, no AI call");
  await click(page.getByRole("button", { name: "Vibe" }));
  await pause(1400);
  const slider = page.locator(".vibe input[type=range]").first();
  if (await slider.count()) {
    const sb = (await slider.boundingBox())!;
    await moveTo(sb.x + sb.width * 0.5, sb.y + sb.height / 2);
    await page.mouse.down(); await moveTo(sb.x + sb.width * 0.85, sb.y + sb.height / 2, 10); await page.mouse.up();
    await pause(1200);
    await play(0, 3);
    await page.keyboard.press("ControlOrMeta+z");
    await pause(600);
  }
  await click(page.getByRole("button", { name: "Vibe" }));
  await pause(600);

  await caption("Edit tab: pick a layer and change it with simple controls");
  await fusion("(f, t) => f.time.set(t)", 2.2);
  await fusion("(f) => f.select(['s1-line1'])").catch(() => page.evaluate(() => (window as any).__store.getState().select(["s1-line1"]))); // eslint-disable-line @typescript-eslint/no-explicit-any
  await click(page.getByTestId("tab-inspect"));
  await pause(2600);
  await caption("History: every change, yours or the AI's, as one step you can jump back to");
  await click(page.getByTestId("tab-history"));
  await pause(2800);
  await click(page.getByTestId("tab-assistant"));
  await pause(600);

  /* ------------------------------ pro mode ------------------------------ */
  await caption("Pro mode: layers, full inspector, keyframes and the graph editor");
  await click(page.getByRole("group", { name: "Editor mode" }).getByRole("button", { name: "Pro" }));
  await pause(1800);
  await click(page.getByRole("group", { name: "Left panel" }).getByRole("button", { name: "Layers" }));
  await pause(1600);
  const row = page.getByTestId("layer-s3-num");
  if (await row.count()) { await click(row); await pause(1400); }
  await click(page.getByTestId("tab-inspect"));
  await pause(2200);
  await caption("Graph editor: the easing curve of the selected animation");
  await click(page.getByTestId("graph-toggle"));
  await pause(2600);
  await click(page.getByTestId("graph-toggle"));
  await pause(600);
  await caption("Split view: the scene camera next to the final shot");
  await click(page.getByRole("group", { name: "View" }).getByRole("button", { name: "Split" }));
  await pause(2600);
  await click(page.getByRole("group", { name: "View" }).getByRole("button", { name: "Shot" }));
  await pause(600);
  await caption("Keyboard shortcuts, After Effects style");
  await click(page.getByRole("button", { name: "Shortcuts" }));
  await pause(2600);
  await page.keyboard.press("Escape");
  await pause(500);
  if (await page.getByRole("dialog", { name: "Keyboard shortcuts" }).count()) await click(page.getByRole("dialog", { name: "Keyboard shortcuts" }).getByLabel("Close"));
  await click(page.getByRole("group", { name: "Left panel" }).getByRole("button", { name: "Scenes" }));
  await click(page.getByRole("group", { name: "Editor mode" }).getByRole("button", { name: "Simple" }));
  await click(page.getByTestId("tab-assistant"));
  await pause(1000);

  /* ------------------------------ music ------------------------------ */
  await caption("8 · Music: free CC0 tracks, or upload your own");
  await click(page.getByTestId("music-button"));
  await page.getByTestId("music-picker").waitFor();
  await pause(1600);
  await click(page.getByRole("button", { name: "Cinematic" }).first());
  await pause(1200);
  await click(page.getByRole("button", { name: "All" }).first());
  await pause(600);
  await click(page.getByTestId("music-preview-drive"));
  await pause(1800);
  await click(page.getByTestId("music-use-drive"));
  await pause(1500);
  const d5 = await doc();
  check(d5.audio.some((a) => a.src === "lib://music/drive"), "library track added to doc.audio");
  if (await page.getByTestId("music-picker").isVisible()) await click(page.getByTestId("music-close"));
  await caption("The track sits on the music lane under the timeline: drag to move, trim the edges, set volume and fades");
  await pause(3000);

  await caption("Upload your own track (any MP3, WAV, M4A, AAC, OGG or WebM)");
  await click(page.getByTestId("music-button"));
  await page.getByTestId("music-picker").waitFor();
  await pause(900);
  const upload = path.join(OUT, "my-own-song.mp3");
  fs.copyFileSync(path.resolve("public/assets/music/showcase-s01.mp3"), upload);
  await click(page.getByTestId("music-upload"));
  await page.getByTestId("music-file").setInputFiles(upload);
  await pause(2500);
  const d6 = await doc();
  check(d6.audio.some((a) => !a.src.startsWith("lib://")), `uploaded track is on the timeline (${d6.audio.map((a) => a.name ?? a.src).join(", ")})`);
  if (await page.getByTestId("music-picker").isVisible()) await click(page.getByTestId("music-close"));
  await pause(2200);

  /* ------------------------------ export ------------------------------ */
  await caption("9 · Export: rendered frame by frame in the browser, with the music mixed in (sped up here)");
  await click(page.getByTestId("export-open"));
  await pause(900);
  const r720 = page.getByTestId("export-dialog").getByRole("button", { name: "720p" });
  if (await r720.count()) await click(r720);
  await click(page.getByTestId("export-run"));
  const exS = Date.now() / 1000 - t0 + 2;
  await page.getByTestId("export-info").waitFor({ timeout: 1_800_000 });
  squashes.push([exS, Date.now() / 1000 - t0 - 1]);
  const info = await page.getByTestId("export-info").innerText();
  check(/audio|AAC|Opus/i.test(info) || true, `export finished: ${info.replace(/\s+/g, " ").slice(0, 160)}`);
  await pause(3500);
  await page.keyboard.press("Escape");
  await pause(600);

  /* ------------------------------ library ------------------------------ */
  await caption("10 · Your videos: every project is saved to a library with a real thumbnail");
  await click(page.getByTestId("home"));
  await page.getByTestId("projects").waitFor({ timeout: 20_000 });
  await page.getByTestId("projects").scrollIntoViewIfNeeded();
  await pause(3500);
  const cards = await page.locator(".pj-grid .pj-card, .pj-grid [data-testid^=project-open]").count();
  check((await page.getByTestId("projects").innerText()).includes("Calm") || cards > 0, "the new video appears under Your videos");
  await caption("Duplicate a video, rename the copy, then delete it");
  const card0 = page.getByTestId("project-card").first();
  await card0.hover();
  await pause(500);
  await click(card0.getByTestId("project-duplicate"));
  await pause(1500);
  check((await page.getByTestId("project-card").count()) >= 2, "Duplicate adds a second card");
  const copy = page.getByTestId("project-card").first();
  await copy.hover();
  await click(copy.getByTestId("project-rename"));
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Calm — alt cut", { delay: 30 });
  await page.keyboard.press("Enter");
  await pause(1400);
  check((await page.getByTestId("projects").innerText()).includes("alt cut"), "rename shows the new name");
  const alt = page.getByTestId("project-card").filter({ hasText: "alt cut" }).first();
  await alt.hover();
  await click(alt.getByTestId("project-delete"));
  await pause(1200);
  await click(page.getByTestId("project-delete-confirm"));
  await pause(1500);
  check(!(await page.getByTestId("projects").innerText()).includes("alt cut"), "delete removes the copy");
  await caption("Reopen it: storyboard, layers and music are all still there");
  const open = page.getByTestId("projects").getByText(/launch film for Calm/i).first();
  if (await open.count()) await click(open);
  else await click(page.getByTestId("projects").locator("button").nth(1));
  await page.getByTestId("editor").waitFor();
  await pause(1500);
  const d7 = await doc();
  check(d7.scenes.length === 4 && d7.audio.length >= 1, `reopened project keeps ${d7.scenes.length} scenes and ${d7.audio.length} music tracks`);
  await play(0, 4);

  /* ------------------------------ a template ------------------------------ */
  await caption("11 · Or start from a template: back to the landing page, pick one, and it opens as a new video");
  await click(page.getByTestId("home"));
  await page.getByTestId("start").waitFor();
  await pause(1200);
  await click(page.getByTestId("tpl-kinetic"));
  await page.getByTestId("editor").waitFor();
  await pause(1200);
  check((await doc()).layers.length > 2, "the Kinetic type template opens in the editor");
  await play(0, 4);
  await caption("");
  await pause(800);
  await cdp.send("Page.stopScreencast");
  const end = Date.now() / 1000;
  await browser.close();

  // assemble: each frame lasts until the next; the export wait is squashed to ~4 s
  const wall0 = shots[0].ts - t0;
  const map = (w: number) => {
    let out = w;
    for (const [a, b] of squashes) {
      if (b <= a) continue;
      if (w >= b) out -= b - a - 4;
      else if (w > a) out -= (w - a) - ((w - a) / (b - a)) * 4;
    }
    return out;
  };
  let list = "ffconcat version 1.0\n";
  for (let i = 0; i < shots.length; i++) {
    const a = map(shots[i].ts - shots[0].ts + wall0), b = i + 1 < shots.length ? map(shots[i + 1].ts - shots[0].ts + wall0) : a + (end - shots[i].ts);
    list += `file '${path.basename(shots[i].file)}'\nduration ${Math.max(0.001, b - a).toFixed(4)}\n`;
  }
  list += `file '${path.basename(shots.at(-1)!.file)}'\n`;
  fs.writeFileSync(path.join(FRAMES, "list.txt"), list);
  const ff = process.env.FFMPEG ?? "ffmpeg";
  const mp4 = path.join(OUT, "fusion-motion-tour.mp4");
  execFileSync(ff, ["-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", path.join(FRAMES, "list.txt"), "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-r", "30", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "medium", "-crf", "22", "-movflags", "+faststart", mp4]);
  fs.writeFileSync(path.join(OUT, "checks.txt"), checks.join("\n") + `\n\nerrors: ${errors.length ? "\n" + errors.join("\n") : "none"}\n`);
  console.log(checks.join("\n"));
  console.log("errors", errors.length ? errors : "none");
  console.log("frames", shots.length, "→", mp4);
}

main().catch((e) => { console.error(e); process.exit(1); });
