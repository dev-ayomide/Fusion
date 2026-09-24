import { test, expect } from "@playwright/test";
import { openTemplate, layer, doc, tl, drag } from "./helpers";

/* eslint-disable @typescript-eslint/no-explicit-any */
test.describe("After Effects-style controls", () => {
  test("F9 applies Easy Ease, the key glyph and the graph editor follow, handles reshape the curve", async ({ page }) => {
    await openTemplate(page, "launch");
    await page.getByLabel("Show keyframes of phone").click();
    const k = await tl(page, "phone", 0.2 + 2.6, "rot.y");
    await page.mouse.click(k.x, k.y);
    await page.keyboard.press("F9");
    const keys = (await layer(page, "phone")).keys["rot.y"];
    // easing into key 1 (incoming handle) and out of it (the next segment's outgoing handle)
    expect(keys[1][2]).toMatch(/0\.667,1\)$|^easy|easyIn/);
    expect(keys[2][2]).toMatch(/^cubic\(0\.333,0,|^easy|easyOut/);
    await page.keyboard.press("Shift+F3");
    const graph = page.getByTestId("graph-editor");
    await expect(graph).toBeVisible();
    const before = keys[1][2];
    const hs = await page.evaluate(() => (window as any).__graph.handles());
    const inH = hs.find((h: any) => h.side === "in");
    expect(inH).toBeTruthy();
    // pull the incoming handle left: a longer, gentler arrival
    await drag(page, inH, { x: inH.x - 60, y: inH.y });
    const after = (await layer(page, "phone")).keys["rot.y"][1][2];
    expect(after).not.toBe(before);
    expect(after).toMatch(/^cubic\(/);
    // one drag = one undo step
    await page.keyboard.press("ControlOrMeta+z");
    expect((await layer(page, "phone")).keys["rot.y"][1][2]).toBe(before);
    await page.keyboard.press("Shift+F3");
    await expect(graph).toBeHidden();
  });

  test("J / K jump between keyframes, U reveals animated properties", async ({ page }) => {
    await openTemplate(page, "launch");
    await page.getByTestId("tl-row-phone").click();
    await page.keyboard.press("u");
    await expect(page.locator(".tl-name.sub", { hasText: "rot.y" })).toBeVisible();
    await page.keyboard.press("k");
    const t1 = await page.evaluate(() => (window as any).fusion.time.get());
    await page.keyboard.press("k");
    const t2 = await page.evaluate(() => (window as any).fusion.time.get());
    expect(t2).toBeGreaterThan(t1);
    await page.keyboard.press("j");
    expect(await page.evaluate(() => (window as any).fusion.time.get())).toBeCloseTo(t1, 3);
  });

  test("comp motion blur switch and effect controls", async ({ page }) => {
    await openTemplate(page, "launch");
    await page.getByTestId("mb-toggle").click();
    expect((await doc(page)).comp.motionBlur).toEqual({ angle: 180, samples: 12 });
    await page.getByTestId("tl-row-phone").click();
    await page.getByRole("tab", { name: /inspect/i }).click().catch(() => undefined);
    const effects = page.locator(".sec", { hasText: "Gaussian blur" }).first();
    await expect(effects).toBeVisible();
    await effects.getByRole("button", { name: "Off" }).first().click(); // per-layer motion blur off
    expect((await layer(page, "phone")).motionBlur).toBe(false);
    await page.getByTestId("mb-toggle").click();
    expect((await doc(page)).comp.motionBlur).toBeUndefined();
  });

  test("asset library adds a 3D emoji; effect layers get sensible defaults", async ({ page }) => {
    await openTemplate(page, "launch");
    await page.getByLabel("Asset library").click();
    await expect(page.getByTestId("asset-library")).toBeVisible();
    await page.getByLabel("Add trophy").click();
    const d = await doc(page);
    expect(d.assets.trophy.src).toBe("lib://emoji3d/trophy");
    const img = d.layers.find((l: any) => l.type === "image" && l.src === "trophy");
    expect(img).toBeTruthy();
    for (const [label, type] of [["Glass UI card", "html"], ["Line chart", "path"], ["3D object", "mesh"], ["Sky & landscape", "sky"], ["Fade / white-out", "adjust"]] as const) {
      await page.getByLabel("Add effect layer").click();
      await page.getByRole("button", { name: new RegExp(label.replace(/[&/]/g, ".")) }).click();
      expect((await doc(page)).layers.some((l: any) => l.type === type)).toBe(true);
    }
    // the sky goes to the back
    expect((await doc(page)).layers[0].type).toBe("sky");
  });
});
