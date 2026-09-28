/**
 * Screen-records a showcase reel being built in the real editor with the plan → build flow:
 * landing prompt → the agent proposes a scene plan (storyboard) → the user tweaks one scene's brief →
 * Build → the look is set, then the five acts build one by one (ops streaming live, each one undo
 * step) → playback → Pro timeline → in-browser MP4 export. The agent ("Claude Opus 5.5") answers
 * through window.fusion.bridge with the acts of a showcase doc: REEL=s02 (SOLSTICE, the default) or
 * REEL=s03 (Everything moves, the pitch opener) — see REELS below.
 *   STOP_AFTER=<n scenes> ends early (no playback of the whole piece, no export) — for smoke tests.
 * Captured with the CDP screencast (sharper than Playwright's recorder), assembled with ffmpeg.
 *   npx tsx e2e/record-build.ts [outDir]      (dev server on :5180; FFMPEG or Remotion's bundled ffmpeg)
 */
import { chromium, type Locator } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const OUT = path.resolve(process.argv[2] ?? "out/recording");
const BASE = process.env.BASE_URL ?? "http://localhost:5180";
const W = 1920, H = 1080;
const FRAMES = path.join(OUT, "frames");
fs.rmSync(FRAMES, { recursive: true, force: true });
fs.mkdirSync(FRAMES, { recursive: true });

type Scene = { title: string; dur: number; brief: string; reply: string; ids: (id: string) => boolean };
type Reel = {
  doc: string; slug: string; name: string; prompt: string; look: string; plan: string; setup: string;
  /** optional: type into one scene's brief before building, to show the storyboard is editable */
  tweak?: { scene: string; text: string };
  /** the five acts; `ids` picks each act's layers from the showcase doc (the bridge prefixes them with the scene id) */
  scenes: Scene[];
};
const REELS: Record<string, Reel> = {
  s02: {
    doc: "fixtures/showcase/s02-solstice.fmd.json", slug: "solstice", name: "SOLSTICE — festival promo",
    prompt: "A 21-second hype promo for SOLSTICE, a midnight-sun music festival in Lofoten, Norway. Open on an arctic night with a breathing aurora and the line “The sun never sets.” 120 BPM — every cut on the beat.",
    look: "Arctic night into midnight sun: void #07060a, sun #ff5a1f, amber #ffb000, magenta #ff2e88, cream #fff4e0, ice #9ad7ff. Inter Tight 900 slams + Instrument Serif. Cut on the beat.",
    plan: "SOLSTICE in five acts on a 120 BPM grid: the arctic night, the drop, the sun machine, dawn, and the sunrise finale — every cut lands on a beat.",
    setup: "The look: a near-black arctic base, sun-orange and amber accents, cream type; 1080p/30 with motion blur, bloom, grain and a sunset HDRI; one shared camera that shakes harder on every act.",
    tweak: { scene: "The drop", text: " Each name gets its own plate colour and its own entrance." },
    scenes: [
  {
    title: "Arctic night", dur: 4,
    brief: "A starfield over snow peaks, aurora bands breathing out of phase, coordinates typing in, and “The sun never sets.” rising word by word — then it stretches into a cream flash on the drop.",
    reply: "Act 1 — the night: stars over peaks, four blurred aurora bands breathing out of phase, coordinates typing in, the headline rising word by word, then a cream flash exactly on the drop at 4.0 s.",
    ids: (id) => id.startsWith("n-"),
  },
  {
    title: "The drop", dur: 4,
    brief: "Eight artists, one per beat, slamming onto hard-cut colour plates with a lineup counter; a strobe on the last half-beat.",
    reply: "Eight names on eight beats: slam, whip-in, spring drop, tracking collapse, 3D flip, pop, whip, and a two-line slam — each on its own plate, with a stuttering strobe into the next hit.",
    ids: (id) => /^d\d|^d-/.test(id),
  },
  {
    title: "Sun machine", dur: 4,
    brief: "A glowing sun core inside a chrome ring, counter-rotating rays and gold coins orbiting, pulsing on every kick; SOLSTICE tracks in; an amber cloud dissolve out.",
    reply: "The sun machine: an emissive core in a chrome ring, two counter-rotating ray cloners and four gold coins on a tilted orbit rig, all pulsing on the kick. SOLSTICE tracks in; an amber dissolve carries us out.",
    ids: (id) => id.startsWith("u-"),
  },
  {
    title: "Dawn pass", dur: 4,
    brief: "Dawn sky over the mountains; a frosted-glass festival pass flips up in 3D with its ticket number rolling, then 72h · 40 · 1 count up on three beats.",
    reply: "Dawn: a procedural sky with drifting clouds and peaks, a frosted-glass pass flipping up with its ticket number rolling to 4,021, then 72h · 40 · 1 counting up on three consecutive beats.",
    ids: (id) => id.startsWith("w-"),
  },
  {
    title: "Sunrise finale", dur: 5,
    brief: "A horizon line draws out from the centre, the sun rises behind it, SOLSTICE cascades in, the ticket line types on, a last flash on the final hit, fade to black.",
    reply: "Finale: the horizon line draws out, the sun and its rays rise inside a mask behind it, SOLSTICE cascades in letter by letter, the ticket line types on, one last flash at 20 s, fade to black.",
    ids: (id) => id.startsWith("f-"),
  },
],
  },
  s03: {
    doc: "fixtures/showcase/s03-everything-moves.fmd.json", slug: "everything-moves", name: "Everything moves — pitch opener",
    prompt: "Make a 21-second, 120 BPM pitch opener that shows everything Fusion Motion can do — a spark, kinetic type on every beat, real 3D, whole worlds and the app itself — and ends by revealing that the entire video was made from one sentence.",
    look: "Fusion's own palette on a near-black void: lavender #b593ff, cyan #01b2fd, lime #f5ff63, hot pink #ff3d6e, violet #6d3cff, ink #f7f4ff. Inter Tight 900 slams, Instrument Serif accents, JetBrains Mono for prompts. Cut on the beat.",
    plan: "Five acts on a 120 BPM grid — spark, kinetic type, real 3D, worlds (with the editor itself), and a collapse into the reveal. Every cut lands on a beat.",
    setup: "The look: Fusion's lavender, cyan, lime and hot pink on a near-black void; 1080p/30 with motion blur, bloom, grain and a city HDRI; one shared camera with a different handheld energy per act.",
    scenes: [
      {
        title: "Spark", dur: 4,
        brief: "A point of light in the dark, the prompt typing in, three rings of ticks, dots and tiles winding up around it until the light swallows the frame on the drop.",
        reply: "Act 1 — the spark: dust drifting in depth, a pulsing core on the beat, the prompt typing in, three rings winding up and collapsing, then the light swallows the frame into a flash at 4.0 s.",
        ids: (id) => id.startsWith("a-"),
      },
      {
        title: "Kinetic", dur: 4,
        brief: "EVERY · IDEA · deserves · TO · MOVE. — one word per beat on hard-cut colour plates, a 16th-note stutter of MOVE in eight typefaces, then a tunnel of type through the lens.",
        reply: "Five words on five beats, each with its own plate and entrance; eight 16th-note slices of MOVE in eight typefaces; a spiralling tunnel of type through the lens; a strobe into the next act.",
        ids: (id) => id.startsWith("k"),
      },
      {
        title: "Dimension", dur: 4,
        brief: "A chrome torus inside a ring of light; gold, metal, foil and plastic objects pop onto an orbit on the beat; “Real depth.” types up; the torus rushes the lens.",
        reply: "Real 3D: a chrome torus in a rippling ring of light, four PBR objects popping onto a tilted orbit on consecutive beats, DIMENSION tracking behind, and the torus rushing the lens into a flash.",
        ids: (id) => id.startsWith("d-"),
      },
      {
        title: "Worlds", dur: 4,
        brief: "An aurora night over mountains with “Any world.”, a cloud dissolve into dawn, and the editor itself as a frosted card: the prompt, the scene bars filling in, the layer count rolling.",
        reply: "An aurora night over the peaks, a cloud dissolve into dawn, then the editor as a frosted-glass card flipping up: the prompt typing, five scene bars filling on the beat and the layer count rolling up.",
        ids: (id) => id.startsWith("w-"),
      },
      {
        title: "Finale", dur: 5,
        brief: "Everything collapses into a vortex and one point; in the silence, “this entire video was made from one sentence.” types on; the last hit lands the Fusion Motion lockup.",
        reply: "The finale: three counter-rotating vortex rings collapse into a single point, the sentence types on in the silence, and the last hit lands the Fusion Motion lockup before the fade.",
        ids: (id) => id.startsWith("f-"),
      },
    ],
  },
};
const REEL = REELS[process.env.REEL ?? "s02"];
if (!REEL) throw new Error(`unknown REEL (have ${Object.keys(REELS).join(", ")})`);
const DOC = JSON.parse(fs.readFileSync(path.resolve(REEL.doc), "utf8"));
const DUR: number = DOC.comp.dur;
const AGENT = "Claude Opus 5.5";
const PROMPT = REEL.prompt, LOOK = REEL.look, SCENES = REEL.scenes;
const STOP_AFTER = Number(process.env.STOP_AFTER ?? 0);

const OVERLAY = `(() => {
  const boot = () => {
    if (document.getElementById("__cursor")) return;
    const c = document.createElement("div"); c.id = "__cursor";
    c.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2l15 8.5-6.5 1.8L9.8 19z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: "fixed", left: "0", top: "0", zIndex: 100000, pointerEvents: "none", transform: "translate(-4px,-2px)" });
    const ring = document.createElement("div");
    Object.assign(ring.style, { position: "fixed", width: "38px", height: "38px", marginLeft: "-19px", marginTop: "-19px", borderRadius: "50%", border: "2px solid #ff5a1f", zIndex: 99999, pointerEvents: "none", opacity: "0", transition: "opacity .35s, transform .35s", transform: "scale(.4)" });
    const cap = document.createElement("div"); cap.id = "__caption";
    Object.assign(cap.style, { position: "fixed", bottom: "22px", left: "50%", transform: "translateX(-50%)", zIndex: 99998, pointerEvents: "none", background: "rgba(10,10,14,.92)", color: "#fff", font: "600 17px/1.35 Inter Variable, system-ui, sans-serif", padding: "10px 18px", borderRadius: "12px", boxShadow: "0 10px 40px rgba(0,0,0,.45)", maxWidth: "900px", textAlign: "center", opacity: "0", transition: "opacity .3s", border: "1px solid rgba(255,255,255,.12)" });
    document.body.append(c, ring, cap);
    addEventListener("mousemove", (e) => { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; }, true);
    addEventListener("mousedown", (e) => { ring.style.left = e.clientX + "px"; ring.style.top = e.clientY + "px"; ring.style.opacity = "1"; ring.style.transform = "scale(1)"; setTimeout(() => { ring.style.opacity = "0"; ring.style.transform = "scale(.4)"; }, 300); }, true);
    window.__caption = (t) => { cap.textContent = t; cap.style.opacity = t ? "1" : "0"; };
  };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", boot); else boot();
})();`;

async function main() {
  const angle = process.env.ANGLE ?? (process.platform === "darwin" ? "metal" : "swiftshader");
  const browser = await chromium.launch({ args: [`--use-angle=${angle}`, angle === "swiftshader" ? "--enable-unsafe-swiftshader" : "--enable-gpu", "--ignore-gpu-blocklist"] });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, acceptDownloads: true });
  await ctx.addInitScript(OVERLAY);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // --- screencast capture: every frame the compositor produces, with its timestamp
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
  const marks: Record<string, number> = {};
  const mark = (k: string) => (marks[k] = Date.now() / 1000 - t0);

  const pause = (ms: number) => page.waitForTimeout(ms);
  const caption = (t: string) => page.evaluate((t) => (window as unknown as { __caption: (t: string) => void }).__caption(t), t);
  const moveTo = (x: number, y: number, steps = 22) => page.mouse.move(x, y, { steps });
  const click = async (loc: Locator) => {
    await loc.scrollIntoViewIfNeeded();
    const b = (await loc.boundingBox())!;
    await moveTo(b.x + b.width / 2, b.y + b.height / 2);
    await pause(180);
    await page.mouse.down(); await pause(70); await page.mouse.up();
    await pause(250);
  };
  const type = async (loc: Locator, text: string, delay = 24) => { await click(loc); await page.keyboard.type(text, { delay }); };
  const fusion = <T,>(fn: string, arg?: unknown) => page.evaluate(([fn, arg]) => new Function("f", "arg", `return (${fn})(f, arg)`)((window as unknown as { fusion: unknown }).fusion, arg) as T, [fn, arg] as const);
  const setTime = (t: number) => fusion("(f, t) => f.time.set(t)", t);
  const play = async (from: number, to: number) => {
    // Space must reach the editor, not a focused field or button
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await setTime(from); await pause(250);
    await page.keyboard.press("Space");
    await pause((to - from) * 1000);
    await page.keyboard.press("Space");
  };
  type Pending = { turnId: string; kind: string; scene?: { id: string; index: number } };
  const nextPending = async (): Promise<Pending> => {
    for (;;) {
      const p = await fusion<Pending[]>("(f) => f.bridge.pending()");
      if (p.length) return p[0];
      await pause(150);
    }
  };
  const answer = (turnId: string, r: unknown) => fusion("(f, a) => f.bridge.respond(a.id, a.r)", { id: turnId, r });
  const scrollChat = () => page.locator(".msgs").evaluate((el) => el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })).catch(() => {});

  /* ------------------------------------------------------------------ */
  await page.goto(BASE);
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE);
  await pause(1500);
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  await pause(1200);
  await caption("Fusion Motion — describe a video; an AI agent plans it, then builds it as editable motion design");
  await moveTo(W * 0.5, H * 0.45);
  await pause(2200);

  await caption("1 · Describe the video");
  await type(page.getByLabel("Describe your video"), PROMPT, 20);
  await pause(600);
  await click(page.getByTestId("start-create"));
  await page.getByTestId("editor").waitFor();
  await pause(1300);
  await caption(`2 · ${AGENT} connects through the agent bridge and drafts a storyboard`);
  await fusion("(f, n) => f.bridge.connect(n)", AGENT);
  const plan = await nextPending();
  if (plan.kind !== "plan") throw new Error(`expected a plan turn, got ${plan.kind}`);
  await pause(1800);
  await answer(plan.turnId, {
    message: REEL.plan,
    plan: { look: LOOK, scenes: SCENES.map(({ title, dur, brief }) => ({ title, dur, brief })) },
  });
  await page.getByTestId("scene-s5").waitFor();
  mark("PLAN");
  await caption("3 · The whole video as a scene plan — every scene, its timing and an editable brief");
  await pause(3200);

  if (REEL.tweak) {
    await caption(`4 · Tweak any scene before building — here, ${REEL.tweak.scene.toLowerCase()}`);
    const brief = page.getByLabel(`Brief for ${REEL.tweak.scene}`);
    await click(brief);
    // caret to the very end of the brief (End only reaches the end of the visual line)
    await brief.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(el.value.length, el.value.length));
    await page.keyboard.type(REEL.tweak.text, { delay: 22 });
    await pause(500);
    await click(page.locator(".sb-head h2"));
    await pause(900);
  } else {
    await caption("4 · Every scene's brief stays editable — this one is built exactly as planned");
    await pause(2200);
  }

  await caption("5 · Build — the look is set once, then each scene is built in order");
  await click(page.getByTestId("build-video"));
  for (;;) {
    const p = await nextPending();
    if (p.kind === "setup") {
      const existing = await fusion<{ layers: { id: string }[] }>("(f) => f.doc()");
      const { id: camId, ...cam } = DOC.layers.find((l: { id: string }) => l.id === "cam");
      await pause(1400);
      await answer(p.turnId, {
        message: REEL.setup,
        ops: [
          // clear the blank canvas first: its layers use the old palette
          ...existing.layers.map((l) => ({ op: "del", path: l.id })),
          { op: "set", path: "name", value: REEL.name },
          ...(DOC.audio?.length ? [{ op: "set", path: "audio", value: DOC.audio }] : []),
          { op: "set", path: "brand", value: DOC.brand },
          { op: "set", path: "style", value: DOC.style },
          { op: "set", path: "markers", value: DOC.markers },
          { op: "set", path: "comp", value: { ...DOC.comp, cam: undefined } },
          { op: "add", id: camId, after: null, layer: cam },
          { op: "set", path: "comp/cam", value: camId },
        ],
        delayMs: 120,
      });
      await pause(1200);
      continue;
    }
    if (p.kind !== "scene" || !p.scene) throw new Error(`unexpected ${p.kind} turn`);
    const i = p.scene.index;
    const S = SCENES[i];
    await caption(`${6 + i} · Scene ${i + 1} of ${SCENES.length} — ${S.title}: ${AGENT} answers with ops, streaming into the live preview`);
    await pause(1400);
    const ops = DOC.layers.filter((l: { id: string }) => S.ids(l.id)).map(({ id, ...layer }: { id: string }) => ({ op: "add", id, layer }));
    await answer(p.turnId, { message: S.reply, ops, delayMs: Math.max(40, Math.min(150, 4800 / ops.length)) });
    await scrollChat();
    await pause(700);
    const t0 = SCENES.slice(0, i).reduce((a, s) => a + s.dur, 0);
    await play(Math.max(0, t0 - 0.2), Math.min(DUR, t0 + S.dur + 0.3));
    await pause(400);
    if (STOP_AFTER && i + 1 >= STOP_AFTER) break;
    if (i === SCENES.length - 1) break;
  }
  mark("BUILT");
  if (STOP_AFTER) {
    const st = await fusion<{ phase: string }>("(f) => f.director.state()");
    const d = await fusion<{ scenes: { status: string }[]; layers: { id: string }[] }>("(f) => f.doc()");
    console.log("smoke ok", st.phase, d.scenes.map((s) => s.status).join(","), d.layers.length, "layers", errors.length ? errors : "no errors");
    await cdp.send("Page.stopScreencast");
    await browser.close();
    return;
  }

  await caption("11 · Pro mode: the same document as layers, keyframes and behaviour clips");
  await click(page.getByRole("group", { name: "Editor mode" }).getByRole("button", { name: "Pro" }));
  await pause(2500);
  const nLayers = (await fusion<{ layers: unknown[] }>("(f) => f.doc()")).layers.length;
  await caption(`The whole piece — ${nLayers} layers, one JSON document, playing live in the browser`);
  await play(0, DUR);
  await pause(600);

  await caption("12 · Export: every frame rendered in the browser by the same renderer (sped up here)");
  await click(page.getByTestId("export-open"));
  await pause(600);
  await click(page.getByTestId("export-dialog").getByRole("button", { name: "MP4", exact: true }));
  await click(page.getByTestId("export-dialog").getByRole("button", { name: "1080p" }));
  await click(page.getByTestId("export-run"));
  mark("EXPORT_START");
  // a software-rendered export can take a long time: show a few seconds of progress, then stop
  // capturing until it finishes (the assembly squashes the wait to ~4 s either way)
  await pause(4000);
  await cdp.send("Page.stopScreencast");
  await page.getByTestId("export-info").waitFor({ timeout: 4 * 3_600_000 });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  mark("EXPORT_END");
  await caption("Done — a frame-perfect 1080p MP4, and the project stays fully editable");
  await pause(3500);

  const info = await page.evaluate(async () => {
    const r = (window as unknown as { __lastExport: { blob: Blob; codec: string; width: number; height: number; frames: number; ms: number; ext: string } }).__lastExport;
    const buf = new Uint8Array(await r.blob.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { b64: btoa(bin), codec: r.codec, width: r.width, height: r.height, frames: r.frames, ms: r.ms, ext: r.ext };
  });
  fs.writeFileSync(path.join(OUT, `${REEL.slug}-in-browser-export${info.ext}`), Buffer.from(info.b64, "base64"));
  await cdp.send("Page.stopScreencast");
  const end = Date.now() / 1000;
  await browser.close();

  // --- assemble: each captured frame lasts until the next; the export wait is compressed
  const rel = shots.map((s) => s.ts - shots[0].ts);
  const exS = (marks.EXPORT_START ?? 0) + 2, exE = (marks.EXPORT_END ?? 0) - 1;
  const wall0 = shots[0].ts - t0; // screencast clock → script clock offset
  const squash = (t: number) => { const w = t + wall0; if (w <= exS || exE <= exS) return w; if (w >= exE) return w - (exE - exS) + 4; return exS + ((w - exS) / (exE - exS)) * 4; };
  let list = "ffconcat version 1.0\n";
  for (let i = 0; i < shots.length; i++) {
    const a = squash(rel[i]), b = i + 1 < shots.length ? squash(rel[i + 1]) : a + (end - shots[i].ts);
    list += `file '${path.basename(shots[i].file)}'\nduration ${Math.max(0.001, b - a).toFixed(4)}\n`;
  }
  list += `file '${path.basename(shots.at(-1)!.file)}'\n`;
  fs.writeFileSync(path.join(FRAMES, "list.txt"), list);
  const rc = path.resolve("../node_modules/@remotion/compositor-darwin-arm64");
  const ff = process.env.FFMPEG ?? (fs.existsSync(path.join(rc, "ffmpeg")) ? path.join(rc, "ffmpeg") : "ffmpeg");
  execFileSync(ff, ["-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", path.join(FRAMES, "list.txt"), "-r", "30", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-movflags", "+faststart", path.join(OUT, `${REEL.slug}-build-session.mp4`)],
    { env: { ...process.env, DYLD_LIBRARY_PATH: rc } });
  console.log("frames", shots.length, "marks", marks, "export", info.codec, info.width, info.height, info.frames, (info.ms / 1000).toFixed(1) + "s");
  console.log("errors", errors.length ? errors : "none");
}

main().catch((e) => { console.error(e); process.exit(1); });
