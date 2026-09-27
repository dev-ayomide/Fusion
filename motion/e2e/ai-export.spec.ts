import { test, expect } from "@playwright/test";
import { openTemplate, fresh, layer, doc } from "./helpers";

test.describe("AI bridge", () => {
  test("a prompt queues with scoped context; an agent's ops stream into a reviewable diff", async ({ page }) => {
    await openTemplate(page, "launch");
    await page.getByTestId("layer-title").click();
    await page.getByTestId("tab-assistant").click();
    await page.getByLabel("Message the AI").fill("make the headline bounce in word by word and bigger");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByTestId("agent-turn")).toContainText("No AI agent is connected");

    // an agent connects and reads the pending turn: outline + only the scoped layer
    const pending = await page.evaluate(() => {
      const f = (window as any).fusion;
      f.bridge.connect("Claude");
      return f.bridge.pending();
    });
    expect(pending).toHaveLength(1);
    expect(pending[0].scope).toEqual(["title"]);
    expect(JSON.parse(pending[0].inspect).id).toBe("title");
    expect(pending[0].outline).toContain("phone device");

    await page.evaluate((id) => (window as any).fusion.bridge.respond(id, {
      message: "Word-by-word bounce, 20% bigger.",
      ops: [
        { op: "set", path: "title/beh/type", value: { use: "bounceIn", at: 0, stagger: 0.12 } },
        { op: "set", path: "title/size", value: 142 },
      ],
      chips: [{ label: "Even bouncier", ops: [{ op: "set", path: "title/beh/type/bounce", value: 0.8 }] }],
      delayMs: 50,
    }), pending[0].turnId);

    // the change list is a one-line summary until you ask to review it
    const card = page.getByTestId("diff-card");
    await expect(card).toContainText("2 changes");
    await card.getByRole("button", { name: /Review changes/ }).click();
    await expect(card).toContainText("Set title › size to 142");
    await expect(page.getByTestId("keep")).toHaveText("Keep all");
    // the preview is live but not committed
    expect(await page.evaluate(() => (window as any).__store.getState().doc.layers.find((l: any) => l.id === "title").size)).toBe(118);
    // reject the size change, keep the bounce
    await card.getByRole("checkbox", { name: /size/ }).uncheck();
    await expect(page.getByTestId("keep")).toHaveText("Keep 1 of 2");
    await page.getByTestId("keep").click();
    const t = await layer(page, "title");
    expect(t.size).toBe(118);
    expect(t.beh[0].use).toBe("bounceIn");
    await expect(page.getByTestId("agent-turn")).toContainText("Kept");

    // zero-token follow-up chip
    await page.getByRole("button", { name: /Even bouncier/ }).click();
    expect((await layer(page, "title")).beh[0].bounce).toBe(0.8);

    // one undo per AI turn
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+z");
    expect((await layer(page, "title")).beh[0].use).toBe("typeUp");
  });

  test("a bad op is flagged on its own row and the rest still apply", async ({ page }) => {
    await openTemplate(page, "launch");
    await page.evaluate(async () => {
      const f = (window as any).fusion;
      f.bridge.connect("Claude");
      const id = f.prompt("recolour and add a sparkle");
      await f.bridge.respond(id, {
        message: "Done.",
        ops: [
          { op: "set", path: "brand/colors/accent", value: "#ff5a36" },
          { op: "set", path: "sub/color", value: "$doesnotexist" },
          { op: "set", path: "ghost/pos/x", value: 10 },
        ],
        delayMs: 0,
      });
    });
    const card = page.getByTestId("diff-card");
    await expect(card).toContainText("2 skipped");
    await card.getByRole("button", { name: /Review changes/ }).click();
    await expect(card.locator(".err")).toHaveCount(2);
    await expect(page.getByTestId("keep")).toContainText("1 of 3");
    await page.getByTestId("keep").click();
    expect(((await doc(page)).brand as any).colors.accent).toBe("#ff5a36");
    expect((await layer(page, "sub")).color).toBe("$accent");
  });

  test("discard leaves the document untouched", async ({ page }) => {
    await openTemplate(page, "logo");
    const before = await doc(page);
    await page.evaluate(async () => {
      const f = (window as any).fusion;
      f.bridge.connect("Claude");
      const id = f.prompt("delete everything");
      await f.bridge.respond(id, { message: "Removing layers.", ops: [{ op: "del", path: "mark" }, { op: "del", path: "word" }], delayMs: 0 });
    });
    await page.getByRole("button", { name: "Discard" }).first().click();
    expect(await doc(page)).toEqual(before);
  });

  test("pasting ops from any AI works without a connected agent", async ({ page }) => {
    await openTemplate(page, "launch");
    await page.getByRole("button", { name: "Paste ops from any AI" }).click();
    await page.getByLabel("Ops to paste").fill('{"op":"set","path":"title/text","value":"Hello"}\n{"op":"set","path":"title/size","delta":10}');
    await page.getByRole("button", { name: "Preview ops" }).click();
    await page.getByTestId("keep").click();
    const t = await layer(page, "title");
    expect(t.text).toBe("Hello");
    expect(t.size).toBe(128);
  });

  test("start-screen prompt + uploads create a project and queue the request", async ({ page }) => {
    await fresh(page);
    await page.getByLabel("Describe your video").fill("A launch video for Orbit, a habit tracker");
    await page.getByTestId("start-upload").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64") });
    await page.getByTestId("start-create").click();
    await expect(page.getByTestId("editor")).toBeVisible();
    await expect.poll(async () => Object.keys(((await doc(page)) as any).assets)).toEqual(["logo"]);
    expect((await doc(page)).name).toBe("A launch video for Orbit");
    // the landing prompt asks for a scene plan of the whole video
    const pending = await page.evaluate(() => (window as any).fusion.bridge.pending());
    expect(pending[0].kind).toBe("plan");
    expect(pending[0].prompt).toContain("habit tracker");
    expect(pending[0].settings.assets).toEqual(["logo"]);
    await expect(page.getByTestId("storyboard")).toContainText("Drafting your storyboard");
  });

  test("an agent that answers the plan turn with plain ops still works (backward compatible)", async ({ page }) => {
    await fresh(page);
    await page.getByLabel("Describe your video").fill("A logo sting");
    await page.getByTestId("start-create").click();
    await page.evaluate(async () => {
      const f = (window as any).fusion;
      f.bridge.connect("Script");
      const [p] = f.bridge.pending();
      await f.bridge.respond(p.turnId, { message: "Here you go.", ops: [{ op: "set", path: "bg/angle", value: 45 }], delayMs: 0 });
    });
    await page.getByTestId("keep").click();
    expect(((await layer(page, "bg")) as any).angle).toBe(45);
    expect(await page.evaluate(() => (window as any).fusion.director.state().phase)).toBe("idle");
  });
});

test.describe("export", () => {
  for (const format of ["webm", "mp4"] as const) {
    test(`renders a ${format} frame-by-frame`, async ({ page }) => {
      await openTemplate(page, "logo");
      await page.evaluate(() => (window as any).fusion.apply([{ op: "set", path: "comp/dur", value: 1 }], "short"));
      await page.getByTestId("export-open").click();
      await page.getByTestId("export-dialog").getByRole("button", { name: format === "mp4" ? "MP4" : "WebM", exact: true }).click();
      await page.getByTestId("export-dialog").getByRole("button", { name: "720p" }).click();
      await page.getByTestId("export-run").click();
      await expect(page.getByTestId("export-info")).toBeVisible({ timeout: 90_000 });
      const info = await page.evaluate(() => {
        const r = (window as any).__lastExport;
        return { size: r.blob.size, frames: r.frames, w: r.width, h: r.height, codec: r.codec, ext: r.ext };
      });
      expect(info.frames).toBe(30);
      expect(info.w).toBe(1280);
      expect(info.h).toBe(720);
      expect(info.ext).toBe("." + format);
      expect(info.size).toBeGreaterThan(5_000);
      // the file plays back in the browser — when this browser can decode the codec it chose. Playwright's
      // Chromium has no proprietary decoders, so an H.264/HEVC MP4 (picked when the GPU encoder is available)
      // can be written but not played back here; real Chrome plays it.
      const playable = await page.evaluate((c) => {
        const t = { avc: 'video/mp4; codecs="avc1.42E01E"', hevc: 'video/mp4; codecs="hvc1.1.6.L93.B0"', vp9: 'video/webm; codecs="vp9"', av1: 'video/mp4; codecs="av01.0.05M.08"', vp8: 'video/webm; codecs="vp8"' } as Record<string, string>;
        return document.createElement("video").canPlayType(t[c] ?? "") !== "";
      }, info.codec);
      if (!playable) {
        test.info().annotations.push({ type: "note", description: `${info.codec} isn't decodable in this browser build; playback check skipped` });
        return;
      }
      await expect.poll(() => page.getByTestId("export-video").evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 20_000 }).toBeGreaterThan(1);
      const dur = await page.getByTestId("export-video").evaluate((v: HTMLVideoElement) => v.duration);
      expect(dur).toBeGreaterThan(0.9);
      expect(dur).toBeLessThan(1.2);
    });
  }
});
