import { test, expect } from "@playwright/test";
import { openTemplate, fresh, doc, layer, setTime, tl, drag, layerCenter, canvasStats } from "./helpers";

test.describe("start screen", () => {
  test("shows templates with rendered thumbnails and opens one", async ({ page }) => {
    await fresh(page);
    await expect(page.getByTestId("tpl-launch")).toBeVisible();
    await expect.poll(async () => page.getByTestId("tpl-launch").locator(".thumb").evaluate((el) => getComputedStyle(el).backgroundImage)).toContain("data:image");
    await page.getByTestId("tpl-kinetic").click();
    await expect(page.getByTestId("editor")).toBeVisible();
    expect((await doc(page)).name).toBe("Kinetic type");
  });

  test("renders a real, non-blank frame", async ({ page }) => {
    await openTemplate(page, "launch");
    await setTime(page, 3.4);
    await page.waitForTimeout(400);
    const s = await canvasStats(page);
    expect(s.colors).toBeGreaterThan(40);
    expect(s.mean).toBeGreaterThan(8);
  });
});

test.describe("inspector + undo", () => {
  test("editing a field is one undoable transaction", async ({ page }) => {
    await openTemplate(page, "launch");
    await page.getByTestId("layer-title").click();
    await page.getByTestId("tab-inspect").click();
    const field = page.getByLabel("title pos.x");
    await field.fill("250");
    await field.press("Enter");
    await expect.poll(async () => (await layer(page, "title")).pos[0]).toBe(250);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await layer(page, "title")).pos[0]).toBe(100);
    await page.keyboard.press("Control+Shift+z");
    await expect.poll(async () => (await layer(page, "title")).pos[0]).toBe(250);
  });

  test("keyframe toggle adds a key at the playhead and auto-keys later edits", async ({ page }) => {
    await openTemplate(page, "launch");
    await page.getByTestId("layer-sub").click();
    await page.getByTestId("tab-inspect").click();
    await setTime(page, 3);
    await page.getByLabel("Keyframe Rotation").click();
    await expect.poll(async () => (await layer(page, "sub")).keys?.["rot.z"]?.length).toBe(1);
    await setTime(page, 4.5);
    const f = page.getByLabel("sub rot.z");
    await f.fill("12");
    await f.press("Enter");
    const keys = (await layer(page, "sub")).keys["rot.z"];
    expect(keys).toEqual([[0.4, 0], [1.9, 12]]);
  });

  test("text edits preview live and commit on blur", async ({ page }) => {
    await openTemplate(page, "launch");
    await page.getByTestId("layer-title").click();
    await page.getByTestId("tab-inspect").click();
    await page.locator("#insp-text").fill("Spend less.\nLive more.");
    await page.locator("#insp-text").blur();
    expect((await layer(page, "title")).text).toBe("Spend less.\nLive more.");
  });

  test("simple mode presets swap an entrance in one click", async ({ page }) => {
    await openTemplate(page, "launch", "Simple");
    await page.getByTestId("tl-row-title").click();
    await page.getByTestId("tab-inspect").click();
    await page.getByRole("button", { name: "Bounce in" }).click();
    const beh = (await layer(page, "title")).beh;
    expect(beh.map((b: { use: string }) => b.use)).toEqual(["bounceIn"]);
    await page.getByRole("button", { name: "Float" }).click();
    expect((await layer(page, "title")).beh.map((b: { use: string }) => b.use)).toEqual(["bounceIn", "float"]);
  });

  test("owner conflicts are refused with a reason", async ({ page }) => {
    await openTemplate(page, "launch");
    await page.getByTestId("layer-sub").click();
    await page.getByTestId("tab-inspect").click();
    await page.getByRole("button", { name: "Add", exact: true }).first().click();
    await expect(page.locator(".addmenu").getByRole("button", { name: "Drop" })).toBeDisabled();
    await expect(page.locator(".addmenu").getByRole("button", { name: "Drop" })).toHaveAttribute("title", /conflicts with Rise/);
    await page.locator(".addmenu").getByRole("button", { name: "Wiggle" }).click();
    expect((await layer(page, "sub")).beh.map((b: { use: string }) => b.use)).toContain("wiggle");
  });
});

test.describe("viewport", () => {
  test("dragging a layer moves it and is a single undo step", async ({ page }) => {
    await openTemplate(page, "launch");
    await setTime(page, 4);
    await page.waitForTimeout(300);
    const c = await layerCenter(page, "title");
    const before = (await layer(page, "title")).pos;
    const steps0 = await page.evaluate(() => (window as any).__store.getState().past.length);
    await drag(page, c, { x: c.x - 120, y: c.y + 60 });
    const after = (await layer(page, "title")).pos;
    expect(after[0]).toBeLessThan(before[0] - 100);
    expect(after[1]).toBeLessThan(before[1] - 40);
    expect(await page.evaluate(() => (window as any).__store.getState().past.length)).toBe(steps0 + 1);
    await page.keyboard.press("Control+z");
    expect((await layer(page, "title")).pos).toEqual(before);
  });

  test("clicking selects the front-most layer; empty space deselects", async ({ page }) => {
    await openTemplate(page, "launch");
    await setTime(page, 4);
    await page.waitForTimeout(300);
    const c = await layerCenter(page, "cta");
    await page.mouse.click(c.x, c.y);
    // the label sits in front of the pill, so it wins the pick
    await expect.poll(() => page.evaluate(() => (window as any).__store.getState().selection)).toEqual(["cta-label"]);
    const vp = await page.getByTestId("viewport-canvas").boundingBox();
    await page.mouse.click(vp!.x + 20, vp!.y + vp!.height / 2);
    await expect.poll(() => page.evaluate(() => (window as any).__store.getState().selection)).toEqual([]);
  });

  test("regression: no selection box for a layer that isn't on screen yet", async ({ page }) => {
    await openTemplate(page, "launch");
    await page.getByTestId("layer-sub").click();
    await setTime(page, 1);
    await page.waitForTimeout(300);
    await expect(page.locator(".selbox")).toHaveCount(0);
    await setTime(page, 4);
    await expect(page.locator(".selbox")).toHaveCount(1);
  });

  test("split view shows the scene camera next to the shot", async ({ page }) => {
    await openTemplate(page, "launch");
    await page.keyboard.press("s");
    await expect(page.getByRole("button", { name: "Split" })).toHaveAttribute("aria-pressed", "true");
    await page.waitForTimeout(300);
    const s = await canvasStats(page);
    expect(s.colors).toBeGreaterThan(20);
  });

  test("toolbar adds layers with sensible defaults", async ({ page }) => {
    await openTemplate(page, "blank", "Simple");
    await page.getByRole("button", { name: "Add text" }).click();
    await page.getByRole("button", { name: "Add device" }).click();
    await page.getByRole("button", { name: "iPhone" }).click();
    await page.getByRole("button", { name: "Add cloner" }).click();
    await page.getByRole("button", { name: /Ring/ }).click();
    const d = await doc(page);
    const types = d.layers.map((l) => l.type);
    expect(types).toEqual(["gradient", "text", "device", "cloner", "camera"]);
    expect((d.layers[1] as any).beh[0].use).toBe("typeUp");
  });
});

test.describe("timeline", () => {
  test("drag a bar to retime, a clip to shift, a clip edge to lengthen", async ({ page }) => {
    await openTemplate(page, "launch");
    // bar body (past the clips) → in shifts
    const p = await tl(page, "sub", 5);
    await drag(page, p, { x: p.x + (await page.evaluate(() => (window as any).__timeline.pps)) * 0.5, y: p.y });
    await expect.poll(async () => (await layer(page, "sub")).in).toBeCloseTo(3.1, 1);
    // clip body → behavior `at` shifts, layer `in` unchanged
    const c = await tl(page, "title", 1.6);
    const pps = await page.evaluate(() => (window as any).__timeline.pps);
    await drag(page, c, { x: c.x + pps * 0.4, y: c.y });
    const t = await layer(page, "title");
    expect(t.in).toBe(1.4);
    expect(t.beh[0].at).toBeGreaterThan(0.3);
    // right edge of the phone's rise clip → dur grows
    const e = await tl(page, "phone", 0.2 + 1.1 - 0.02);
    await drag(page, e, { x: e.x + pps * 0.5, y: e.y });
    await expect.poll(async () => (await layer(page, "phone")).beh[0].dur).toBeGreaterThan(1.4);
  });

  test("keys: expand, drag a key, delete with the keyboard", async ({ page }) => {
    await openTemplate(page, "launch");
    await page.getByLabel("Show keyframes of phone").click();
    const k = await tl(page, "phone", 0.2 + 2.6, "rot.y");
    const pps = await page.evaluate(() => (window as any).__timeline.pps);
    await drag(page, k, { x: k.x + pps * 0.5, y: k.y });
    const keys = (await layer(page, "phone")).keys["rot.y"];
    expect(keys[1][0]).toBeCloseTo(3.1, 1);
    await page.keyboard.press("Delete");
    expect((await layer(page, "phone")).keys["rot.y"]).toHaveLength(2);
  });

  test("regression: clips can't be dragged before their layer starts", async ({ page }) => {
    await openTemplate(page, "launch");
    const c = await tl(page, "sub", 3);
    const pps = await page.evaluate(() => (window as any).__timeline.pps);
    await drag(page, c, { x: c.x - pps * 2, y: c.y });
    expect((await layer(page, "sub")).beh[0].at).toBe(0);
  });

  test("regression: layer names and tracks scroll together", async ({ page }) => {
    await openTemplate(page, "launch");
    await page.getByLabel("Show keyframes of phone").click();
    await page.locator(".tl-names").evaluate((el) => (el.scrollTop = 40));
    await expect.poll(() => page.locator(".tl-tracks").evaluate((el) => el.scrollTop)).toBe(40);
    await page.locator(".tl-tracks").evaluate((el) => (el.scrollTop = 10));
    await expect.poll(() => page.locator(".tl-names").evaluate((el) => el.scrollTop)).toBe(10);
  });

  test("ruler scrubs the playhead and the timecode follows", async ({ page }) => {
    await openTemplate(page, "launch");
    const r = await page.getByTestId("ruler").boundingBox();
    const x = await page.evaluate(() => (window as any).__timeline.x(2));
    await page.mouse.click(x, r!.y + 10);
    await expect(page.getByTestId("timecode")).toContainText("00:02:00");
  });

  test("space plays and pauses", async ({ page }) => {
    await openTemplate(page, "launch");
    await page.keyboard.press("Space");
    await page.waitForTimeout(700);
    await page.keyboard.press("Space");
    const t = await page.evaluate(() => (window as any).fusion.time.get());
    expect(t).toBeGreaterThan(0.2);
  });
});

test.describe("vibe sliders + bindings", () => {
  test("a slider drives every bound setting; a hand edit detaches its binding", async ({ page }) => {
    await openTemplate(page, "launch", "Simple");
    // the vibe sliders live in a drawer at the top of the assistant
    await page.getByRole("button", { name: "Vibe" }).click();
    const slider = page.locator("#style-bounce");
    await slider.focus();
    for (let i = 0; i < 30; i++) await page.keyboard.press("ArrowRight");
    await page.keyboard.up("ArrowRight");
    await expect.poll(async () => (await layer(page, "phone")).beh[0].bounce).toBeGreaterThan(0.5);
    await page.evaluate(() => (window as any).fusion.apply([{ op: "set", path: "phone/beh/rise/bounce", value: 0.05 }], "hand edit"));
    await page.getByRole("button", { name: /Bouncier/ }).click();
    expect((await layer(page, "phone")).beh[0].bounce).toBe(0.05);
    expect((await layer(page, "cta")).beh[0].bounce).toBeGreaterThan(0.6);
  });
});

test.describe("json + history", () => {
  test("JSON edits apply as one transaction and invalid JSON is explained (developer mode)", async ({ page }) => {
    await openTemplate(page, "launch", "Pro", "?dev=1");
    await page.getByTestId("tab-json").click();
    const ta = page.getByLabel("Document JSON");
    const text = await ta.inputValue();
    await ta.fill(text.replace('"size": 118', '"size": 140'));
    await page.getByRole("button", { name: "Apply JSON" }).click();
    expect((await layer(page, "title")).size).toBe(140);
    await ta.fill(text.replace('"$ink"', '"$nope"'));
    await page.getByRole("button", { name: "Apply JSON" }).click();
    await expect(page.locator(".json-errs")).toContainText("unknown brand color $nope");
    await page.getByRole("button", { name: "What the AI sees" }).click();
    await expect(page.locator(".json-edit")).toContainText("title text");
  });

  test("history lists edits and can jump back", async ({ page }) => {
    await openTemplate(page, "launch");
    await page.evaluate(() => {
      const f = (window as any).fusion;
      f.apply([{ op: "set", path: "title/size", value: 90 }], "one");
      f.apply([{ op: "set", path: "title/size", value: 80 }], "two");
      f.apply([{ op: "set", path: "title/size", value: 70 }], "three");
    });
    await page.getByTestId("tab-history").click();
    await page.locator(".hist-row").filter({ hasText: /^AIone/ }).click();
    expect((await layer(page, "title")).size).toBe(90);
    await expect(page.locator(".hist-row.future")).toHaveCount(2);
  });
});

test.describe("projects library", () => {
  test("each opened template becomes its own video; rename, duplicate and delete from the landing page", async ({ page }) => {
    await fresh(page);
    await expect(page.getByTestId("projects")).toHaveCount(0);
    for (const id of ["logo", "kinetic"]) {
      await page.getByTestId(`tpl-${id}`).click();
      await expect(page.getByTestId("editor")).toBeVisible();
      await page.getByTestId("home").click();
      await expect(page.getByTestId("start")).toBeVisible();
    }
    const cards = page.getByTestId("project-card");
    await expect(cards).toHaveCount(2);
    await expect(cards.first()).toContainText("Kinetic type"); // most recent first
    await expect(cards.nth(1)).toContainText("Logo reveal");

    await cards.first().hover();
    await cards.first().getByTestId("project-rename").click();
    await page.getByLabel("Video name").fill("My trailer");
    await page.getByLabel("Video name").press("Enter");
    await expect(cards.first()).toContainText("My trailer");

    await cards.first().getByTestId("project-duplicate").click();
    await expect(cards).toHaveCount(3);
    await expect(cards.first()).toContainText("My trailer copy");

    await cards.first().hover();
    await cards.first().getByTestId("project-delete").click();
    await page.getByTestId("project-delete-confirm").click();
    await expect(cards).toHaveCount(2);

    // the renamed project opens with its new name
    await page.getByRole("button", { name: "Open My trailer" }).click();
    await expect(page.getByTestId("editor")).toBeVisible();
    expect((await doc(page)).name).toBe("My trailer");
  });
});

test.describe("shortcuts", () => {
  test("T adds text, ⌘D duplicates, Delete removes", async ({ page }) => {
    await openTemplate(page, "blank");
    await page.locator("body").click({ position: { x: 5, y: 500 } });
    await page.keyboard.press("t");
    expect((await doc(page)).layers.filter((l) => l.type === "text")).toHaveLength(1);
    await page.keyboard.press("Control+d");
    expect((await doc(page)).layers.filter((l) => l.type === "text")).toHaveLength(2);
    await page.keyboard.press("Delete");
    expect((await doc(page)).layers.filter((l) => l.type === "text")).toHaveLength(1);
  });
});

test.describe("persistence", () => {
  test("autosaves and restores on reload", async ({ page }) => {
    await openTemplate(page, "logo");
    await page.evaluate(() => (window as any).fusion.apply([{ op: "set", path: "word/text", value: "persisted" }], "rename"));
    await page.waitForTimeout(700);
    await page.reload();
    await page.getByTestId("resume").click();
    await expect(page.getByTestId("editor")).toBeVisible();
    expect((await layer(page, "word")).text).toBe("persisted");
  });
});
