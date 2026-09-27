import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { openTemplate, doc } from "./helpers";

/**
 * Music end to end: pick a library track from the timeline, see its lane + waveform, play it in sync,
 * edit it (undoable), upload your own file, see the scenes band, and export an MP4 with an AAC track.
 */
// macOS: the real GPU through ANGLE/Metal (as bench/render-frames.mjs does) — WebCodecs export stalls under
// SwiftShader on this machine (the existing export specs hit the same stall). Autoplay allowed for the engine.
const gl = process.platform === "darwin" ? ["--use-angle=metal", "--enable-gpu"] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
test.use({ launchOptions: { args: [...gl, "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] } });

type AudioDbg = { debug: () => { state: string; playing: string[]; ctxTime: number; anchor: { ctxT: number; compT: number } | null } };
const dbg = (page: Page) => page.evaluate(() => (window as unknown as { __audio: AudioDbg }).__audio.debug());
const audio = async (page: Page) => (await doc(page)).audio as { id: string; src: string; at: number; dur?: number; volume: number; fadeOut: number; muted?: boolean }[];

/** Fraction of lane pixels that aren't background (the waveform really drew). */
const inked = (page: Page) =>
  page.evaluate(() => {
    const c = document.querySelector('[data-testid="audio-lanes"]') as HTMLCanvasElement | null;
    if (!c) return 0;
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0 && d[i] < 200) n++;
    return n / (d.length / 4);
  });

/** 2 s stereo 16-bit WAV: a 440 Hz tone with a click every half second. */
function wavFile(file: string) {
  const sr = 44100, n = sr * 2, buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.round((0.3 * Math.sin((2 * Math.PI * 440 * i) / sr) + (i % (sr / 2) < 200 ? 0.5 : 0)) * 32767);
    buf.writeInt16LE(v, 44 + i * 4); buf.writeInt16LE(v, 46 + i * 4);
  }
  fs.writeFileSync(file, buf);
}

test("add library music from the timeline, play in sync, edit, undo", async ({ page }) => {
  await openTemplate(page, "launch", "Simple");
  await expect(page.getByTestId("audio-empty")).toBeVisible();
  await page.getByTestId("audio-empty").click();
  const picker = page.getByTestId("music-picker");
  await expect(picker).toBeVisible();
  await expect(page.locator('[data-testid^="music-row-"]')).toHaveCount(9);

  // preview one track, then use another: one undoable transaction, fitted to the 6 s comp with a fade
  await page.getByTestId("music-preview-neon").click();
  await expect(page.getByTestId("music-row-neon")).toHaveClass(/playing/);
  await page.getByTestId("music-use-drive").click();
  await expect(page.getByTestId("music-row-neon")).not.toHaveClass(/playing/);
  await expect(page.getByTestId("music-current")).toContainText("Drive");
  let a = await audio(page);
  expect(a).toHaveLength(1);
  expect(a[0]).toMatchObject({ id: "music", src: "lib://music/drive", at: 0, dur: 6, fadeOut: 1.5 });

  // volume slider: live preview, one commit on release
  const vol = page.getByTestId("music-volume");
  await vol.focus();
  for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowLeft");
  await page.keyboard.up("ArrowLeft");
  await expect.poll(async () => (await audio(page))[0].volume).toBeCloseTo(0.8, 2);
  await page.getByTestId("music-close").click();
  await expect(picker).toBeHidden();

  // the lane: waveform drawn, button shows the track
  await expect(page.getByTestId("music-button")).toContainText("Drive");
  await expect(page.getByTestId("audio-row-music")).toBeVisible();
  await expect.poll(() => inked(page), { timeout: 15_000 }).toBeGreaterThan(0.05);
  await page.getByTestId("audio-section").screenshot({ path: "test-results/audio-lane.png" });

  // play: the engine schedules the track against the AudioContext clock and stays in sync
  await page.getByRole("button", { name: "Play" }).first().click();
  await expect.poll(async () => (await dbg(page)).playing, { timeout: 10_000 }).toEqual(["music"]);
  expect((await dbg(page)).state).toBe("running");
  await page.waitForTimeout(1200);
  const drift = await page.evaluate(() => {
    const d = (window as unknown as { __audio: AudioDbg }).__audio.debug();
    const t = (window as unknown as { fusion: { time: { get: () => number } } }).fusion.time.get();
    return Math.abs(t - (d.anchor!.compT + (d.ctxTime - d.anchor!.ctxT)));
  });
  expect(drift).toBeLessThan(0.06);
  await page.getByRole("button", { name: "Pause" }).first().click();
  await expect.poll(async () => (await dbg(page)).playing).toEqual([]);

  // drag the clip right by ~1 s on the lane (snaps), then undo
  const geo = await page.evaluate(() => {
    const g = (window as unknown as { __timeline: { audioX: (t: number) => number; audioY: (id: string) => number; pps: number } }).__timeline;
    return { x: g.audioX(2), y: g.audioY("music"), pps: g.pps };
  });
  await page.mouse.move(geo.x, geo.y);
  await page.mouse.down();
  await page.mouse.move(geo.x + geo.pps * 0.5, geo.y, { steps: 6 });
  await page.mouse.move(geo.x + geo.pps * 1.0, geo.y, { steps: 6 });
  await page.mouse.up();
  a = await audio(page);
  expect(a[0].at).toBeGreaterThan(0.8);
  expect(a[0].at).toBeLessThan(1.2);
  await page.keyboard.press("Meta+z");
  await expect.poll(async () => (await audio(page))[0].at).toBe(0);

  // mute from the lane
  await page.getByTestId("audio-mute-music").click();
  expect((await audio(page))[0].muted).toBe(true);
  await page.getByTestId("audio-mute-music").click();
  expect((await audio(page))[0].muted).toBeFalsy();
});

test("upload your own audio file", async ({ page }) => {
  await openTemplate(page, "launch", "Simple");
  const file = path.resolve("test-results/tone.wav");
  fs.mkdirSync("test-results", { recursive: true });
  wavFile(file);
  await page.getByTestId("music-button").click();
  await page.getByTestId("music-file").setInputFiles(file);
  await expect(page.getByTestId("music-current")).toContainText("tone");
  const d = await doc(page);
  const a = (d.audio as { src: string; dur: number }[])[0];
  expect(a.src).toBe("tone");
  expect((d.assets as Record<string, { mime: string }>).tone.mime).toMatch(/^audio\//);
  expect(a.dur).toBeCloseTo(2, 1); // shorter than the comp: plays out, no forced fade
  await page.getByTestId("music-close").click();
  await expect.poll(() => inked(page), { timeout: 15_000 }).toBeGreaterThan(0.02);
});

test("scenes band draws the plan and seeks on click", async ({ page }) => {
  await openTemplate(page, "launch", "Pro");
  await page.evaluate(() =>
    (window as unknown as { fusion: { apply: (ops: unknown[]) => unknown } }).fusion.apply([
      { op: "set", path: "scenes/hook", value: { title: "Hook", start: 0, dur: 2, brief: "open", status: "done" } },
      { op: "set", path: "scenes/demo", value: { title: "Demo", start: 2, dur: 2.5, brief: "show", status: "building" } },
      { op: "set", path: "scenes/cta", value: { title: "Call to action", start: 4.5, dur: 1.5, brief: "end", status: "planned" } },
    ]),
  );
  const band = page.getByTestId("scenes-band");
  await expect(band).toBeVisible();
  const p = await page.evaluate(() => {
    const g = (window as unknown as { __timeline: { x: (t: number) => number; bandY: () => number } }).__timeline;
    return { x: g.x(5), y: g.bandY() };
  });
  await page.mouse.click(p.x, p.y);
  await expect.poll(() => page.evaluate(() => (window as unknown as { fusion: { time: { get: () => number } } }).fusion.time.get())).toBe(4.5);
  await page.locator(".timeline").screenshot({ path: "test-results/scenes-band.png" });
});

test("export an MP4 with the soundtrack (AAC, comp length, in sync)", async ({ page }) => {
  await openTemplate(page, "launch", "Simple");
  await page.evaluate(() =>
    (window as unknown as { fusion: { apply: (ops: unknown[]) => unknown } }).fusion.apply([{ op: "set", path: "audio/music", value: { src: "lib://music/titan", name: "Titan", at: 0, dur: 6, fadeOut: 1 } }]),
  );
  await page.getByTestId("export-open").click();
  await page.getByTestId("export-dialog").getByRole("button", { name: "720p" }).click();
  await page.getByTestId("export-run").click();
  await expect(page.getByTestId("export-info")).toBeVisible({ timeout: 120_000 });
  const r = await page.evaluate(async () => {
    const x = (window as unknown as { __lastExport: { blob: Blob; audio: unknown; audioNote?: string } }).__lastExport;
    return { audio: x.audio, note: x.audioNote ?? null, bytes: Array.from(new Uint8Array(await x.blob.arrayBuffer())) };
  });
  expect(r.note).toBeNull();
  expect(r.audio).toMatchObject({ codec: "aac", tracks: 1, sampleRate: 48000 });
  const out = path.resolve("test-results/audio-export.mp4");
  fs.writeFileSync(out, Buffer.from(r.bytes));
  // ffprobe (bundled with Remotion in the repo root) when available
  const dir = path.resolve("../node_modules/@remotion/compositor-darwin-arm64");
  if (fs.existsSync(path.join(dir, "ffprobe"))) {
    const probe = execFileSync(path.join(dir, "ffprobe"), ["-v", "error", "-show_entries", "stream=codec_type,codec_name,duration", "-of", "json", out], { env: { ...process.env, DYLD_LIBRARY_PATH: dir } }).toString();
    const streams = JSON.parse(probe).streams as { codec_type: string; codec_name: string; duration: string }[];
    const aud = streams.find((s) => s.codec_type === "audio")!;
    expect(aud.codec_name).toBe("aac");
    expect(Math.abs(Number(aud.duration) - 6)).toBeLessThan(0.06);
    expect(Number(streams.find((s) => s.codec_type === "video")!.duration)).toBeCloseTo(6, 2);
  }
});

test("projects without music export exactly as before (no audio track)", async ({ page }) => {
  await openTemplate(page, "logo", "Simple");
  await page.getByTestId("export-open").click();
  await page.getByTestId("export-dialog").getByRole("button", { name: "720p" }).click();
  await page.getByTestId("export-run").click();
  await expect(page.getByTestId("export-info")).toBeVisible({ timeout: 120_000 });
  const r = await page.evaluate(() => (window as unknown as { __lastExport: { audio: unknown; audioNote?: string } }).__lastExport);
  expect(r.audio).toBeNull();
  expect(r.audioNote).toBeUndefined();
});
