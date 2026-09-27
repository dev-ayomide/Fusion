/**
 * Screen-records a showcase reel being built in the real editor: landing page → prompt → the agent
 * answers through the bridge in five turns (one per act, ops streaming into the live preview) →
 * review/keep → playback → Pro timeline → in-browser MP4 export.
 * Captured with the CDP screencast (sharper than Playwright's recorder), assembled with ffmpeg.
 *   npx tsx e2e/record-build.ts [outDir]      (dev server on :5180; FFMPEG or Remotion's bundled ffmpeg)
 */
import { chromium, type Locator } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const OUT = path.resolve(process.argv[2] ?? "out/recording");
const BASE = process.env.BASE_URL ?? "http://localhost:5180";
const DOC = JSON.parse(fs.readFileSync(path.resolve("fixtures/showcase/s02-solstice.fmd.json"), "utf8"));
const W = 1920, H = 1080;
const FRAMES = path.join(OUT, "frames");
fs.rmSync(FRAMES, { recursive: true, force: true });
fs.mkdirSync(FRAMES, { recursive: true });

const AGENT = "Claude Opus 5.5";
const TURNS: { prompt: string; reply: string; ids: (id: string) => boolean; extra?: boolean; play: [number, number] }[] = [
  {
    prompt: "A 21-second hype promo for SOLSTICE, a midnight-sun music festival in Lofoten, Norway. Open on an arctic night with a breathing aurora and the line “The sun never sets.” 120 BPM — every cut on the beat.",
    reply: "Act 1 — the night. A starfield over snow peaks, four blurred aurora bands breathing out of phase, coordinates typing in, the headline rising word by word on the beat, then it stretches and blurs into a cream flash exactly on the drop at 4.0 s. The comp is 1080p/30 with motion blur, bloom and a sunset HDRI for the 3D to come.",
    ids: (id) => id === "cam" || id.startsWith("n-"), extra: true, play: [0, 4.4],
  },
  {
    prompt: "Now the drop: eight artists, one per beat, a different plate colour and a different entrance for each.",
    reply: "Eight names on eight beats (4.0 → 8.0 s): slam, whip-in from left, spring drop, tracking collapse, 3D flip, pop, whip from right, and a two-line slam — each on its own plate with a lineup counter. A stuttering strobe on the last half-beat sets up the next hit.",
    ids: (id) => /^d\d|^d-/.test(id), play: [3.6, 8.3],
  },
  {
    prompt: "Build a sun machine that pulses on every kick, with gold orbiting it.",
    reply: "The sun machine (8 → 12 s): an emissive core inside a chrome ring, two counter-rotating ray cloners, four gold coins on a tilted orbit rig. The glow, rays and core pulse with a 0.5 s period — locked to the kick at 120 BPM. SOLSTICE tracks in underneath; an amber cloud-dissolve carries us out.",
    ids: (id) => id.startsWith("u-"), play: [7.8, 12.3],
  },
  {
    prompt: "Dawn: a glass festival pass floating over the mountains, and stats that roll up on the beat.",
    reply: "Dawn (12 → 16 s): a procedural sky with drifting clouds and peaks, a frosted-glass 3-day pass flipping up in 3D with its ticket number rolling to 4,021, then 72h · 40 · 1 counting up on three consecutive beats.",
    ids: (id) => id.startsWith("w-"), play: [11.8, 16.2],
  },
  {
    prompt: "Finish with the sun rising over a glowing horizon line, then the logo and ticket info.",
    reply: "Finale (16 → 21 s): a horizon line draws out from the centre, the sun and its rays rise inside a mask so they sit behind the line, SOLSTICE cascades in letter by letter, the ticket line types on, one last flash on the final hit at 20 s, fade to black.",
    ids: (id) => id.startsWith("f-"), play: [15.8, 21],
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
    await setTime(from); await pause(250);
    await page.keyboard.press("Space");
    await pause((to - from) * 1000);
    await page.keyboard.press("Space");
  };
  const respond = async (reply: string, ops: unknown[], delayMs: number) => {
    const pending = await fusion<{ turnId: string }[]>("(f) => f.bridge.pending()");
    await fusion("(f, a) => f.bridge.respond(a.id, a.r)", { id: pending.at(-1)!.turnId, r: { message: reply, ops, delayMs } });
  };

  /* ------------------------------------------------------------------ */
  await page.goto(BASE);
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE);
  await pause(1500);
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  await pause(1200);
  await caption("Fusion Motion — describe a video; an AI agent builds it as editable motion design");
  await moveTo(W * 0.5, H * 0.45);
  await pause(2200);

  const T0 = TURNS[0];
  await caption("1 · Describe the video");
  await type(page.getByLabel("Describe your video"), T0.prompt, 20);
  await pause(600);
  await click(page.getByTestId("start-create"));
  await page.getByTestId("editor").waitFor();
  await pause(1300);
  await caption(`2 · ${AGENT} connects through the agent bridge and reads the document outline`);
  await pause(1500);
  await fusion("(f, n) => f.bridge.connect(n)", AGENT);
  await pause(1000);

  for (let i = 0; i < TURNS.length; i++) {
    const T = TURNS[i];
    if (i > 0) {
      await caption(`${i + 2} · Next prompt: act ${i + 1}`);
      await type(page.getByLabel("Message the AI"), T.prompt, 18);
      await page.keyboard.press("Enter");
      await pause(900);
    }
    const ops: unknown[] = [];
    if (T.extra) {
      const existing = await fusion<{ layers: { id: string }[] }>("(f) => f.doc()");
      ops.push(
        // clear the blank canvas first: its layers use the old palette, so swapping the brand before
        // deleting them would leave dangling colour tokens and the review would reject the brand op
        ...existing.layers.map((l) => ({ op: "del", path: l.id })),
        { op: "set", path: "name", value: "SOLSTICE — festival promo" },
        { op: "set", path: "brand", value: DOC.brand },
        { op: "set", path: "style", value: DOC.style },
        { op: "set", path: "markers", value: DOC.markers },
        { op: "set", path: "comp", value: { ...DOC.comp, cam: undefined } },
      );
    }
    const layers = DOC.layers.filter((l: { id: string }) => T.ids(l.id));
    for (const l of layers) {
      const { id, ...layer } = l;
      ops.push({ op: "add", id, layer });
    }
    if (T.extra) ops.push({ op: "set", path: "comp/cam", value: DOC.comp.cam });
    await caption(i === 0 ? "3 · The agent answers with ops — each one streams into the live preview" : `${i + 3} · ${ops.length} ops streaming in — every one reviewable`);
    await respond(T.reply, ops, Math.max(40, Math.min(160, 5200 / ops.length)));
    await pause(900);
    await page.locator(".msgs").evaluate((el) => el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })).catch(() => {});
    await pause(900);
    await click(page.getByTestId("keep"));
    await pause(500);
    await caption(i === 0 ? "Keep → one undoable transaction. Play it:" : "Kept. Play the new act:");
    await play(T.play[0], T.play[1]);
    await pause(500);
  }

  await caption("8 · Pro mode: the same document as layers, keyframes and behaviour clips");
  await click(page.getByRole("group", { name: "Editor mode" }).getByRole("button", { name: "Pro" }));
  await pause(2500);
  await caption("The whole piece — 75 layers, one JSON document, playing live in the browser");
  await play(0, 21);
  await pause(600);

  await caption("9 · Export: every frame rendered in the browser by the same renderer (sped up here)");
  await click(page.getByTestId("export-open"));
  await pause(600);
  await click(page.getByTestId("export-dialog").getByRole("button", { name: "MP4", exact: true }));
  await click(page.getByTestId("export-dialog").getByRole("button", { name: "1080p" }));
  await click(page.getByTestId("export-run"));
  mark("EXPORT_START");
  await page.getByTestId("export-info").waitFor({ timeout: 1_800_000 });
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
  fs.writeFileSync(path.join(OUT, `solstice-in-browser-export${info.ext}`), Buffer.from(info.b64, "base64"));
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
  execFileSync(ff, ["-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", path.join(FRAMES, "list.txt"), "-r", "30", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-movflags", "+faststart", path.join(OUT, "solstice-build-session.mp4")],
    { env: { ...process.env, DYLD_LIBRARY_PATH: rc } });
  console.log("frames", shots.length, "marks", marks, "export", info.codec, info.width, info.height, info.frames, (info.ms / 1000).toFixed(1) + "s");
  console.log("errors", errors.length ? errors : "none");
}

main().catch((e) => { console.error(e); process.exit(1); });
