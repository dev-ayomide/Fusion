import { test, expect, type Page } from "@playwright/test";
import { fresh, doc } from "./helpers";

/* The plan → build flow, driven through the bridge exactly as an external agent would (docs/AGENT-FLOW.md). */

type Pending = { turnId: string; kind: string; prompt: string; scene?: { id: string; prefix: string; brief: string; index: number }; window?: [number, number]; plan?: { scenes: unknown[] } };
const pending = (page: Page) => page.evaluate(() => (window as any).fusion.bridge.pending() as Pending[]); // eslint-disable-line @typescript-eslint/no-explicit-any
const answer = (page: Page, turnId: string, r: unknown) => page.evaluate(([id, r]) => (window as any).fusion.bridge.respond(id, r), [turnId, r] as const); // eslint-disable-line @typescript-eslint/no-explicit-any
const nextPending = async (page: Page, kind: string) => {
  await expect.poll(async () => (await pending(page)).map((p) => p.kind)).toEqual([kind]);
  return (await pending(page))[0];
};
const sceneOps = (word: string) => [
  { op: "add", id: "plate", layer: { type: "shape", shape: "rect", w: 2900, h: 1650, fill: "$accent", pos: [0, 0, -400] } },
  { op: "add", id: "word", layer: { type: "text", text: word, size: 200, color: "$ink", parent: "plate" } },
  { op: "set", path: "cam/beh/shake", value: { use: "shake", at: 0, dur: 1, amp: 6 } },
];

test("landing prompt → plan → edit a queued brief → build scene by scene → undo → rebuild", async ({ page }) => {
  await fresh(page);
  await page.getByLabel("Describe your video").fill("A 9-second teaser for SOLSTICE, a midnight-sun festival");
  await page.getByTestId("start-create").click();
  await expect(page.getByTestId("storyboard")).toBeVisible();
  await page.evaluate(() => (window as any).fusion.bridge.connect("Claude Opus 5.5")); // eslint-disable-line @typescript-eslint/no-explicit-any

  // 1. plan: every scene of the video
  const plan = await nextPending(page, "plan");
  expect(plan.prompt).toContain("SOLSTICE");
  await answer(page, plan.turnId, {
    message: "Three acts: night, drop, sunrise.",
    plan: {
      look: "Midnight blue, hot orange sun, cream type",
      scenes: [
        { title: "Night", dur: 3, brief: "Stars and an aurora." },
        { title: "Drop", dur: 3, brief: "Names slam on the beat." },
        { title: "Sunrise", dur: 3, brief: "The sun rises; logo." },
      ],
    },
  });
  await expect(page.locator("[data-testid^=scene-]")).toHaveCount(3);
  await expect(page.getByTestId("storyboard")).toContainText("3 scenes · 9s");
  expect((await doc(page)).comp).toMatchObject({ dur: 9 });

  // 2. the user edits a scene before building
  const brief2 = page.getByLabel("Brief for Drop");
  await brief2.fill("Eight names slam on the beat, in electric orange.");
  await page.locator(".sb-head h2").click();
  await expect.poll(async () => ((await doc(page)) as any).scenes[1].brief).toContain("electric orange"); // eslint-disable-line @typescript-eslint/no-explicit-any

  // 3. build: setup first, then one scene at a time
  await page.getByTestId("build-video").click();
  const setup = await nextPending(page, "setup");
  expect(setup.plan!.scenes).toHaveLength(3);
  await answer(page, setup.turnId, {
    message: "Night palette, one camera.",
    ops: [
      { op: "del", path: "bg" },
      { op: "del", path: "shot" },
      { op: "set", path: "brand/colors", value: { accent: "#ff5a1f", ink: "#fff4e0", paper: "#02030c" } },
      { op: "add", id: "cam", after: null, layer: { type: "camera", fov: 35, pos: [0, 0, 1713] } },
      { op: "set", path: "comp/cam", value: "cam" },
    ],
    delayMs: 0,
  });

  const s1 = await nextPending(page, "scene");
  expect(s1.scene).toMatchObject({ id: "s1", prefix: "s1-", index: 0 });
  expect(s1.window).toEqual([0, 3]);
  await expect(page.getByTestId("build-progress")).toContainText("scene 1");
  // while scene 1 builds, a queued scene is still editable
  await page.getByLabel("Brief for Sunrise").fill("The sun rises behind SOLSTICE in chrome.");
  await page.locator(".sb-head h2").click();
  await answer(page, s1.turnId, { message: "Night.", ops: sceneOps("NIGHT"), delayMs: 0 });

  const s2 = await nextPending(page, "scene");
  expect(s2.scene!.brief).toContain("electric orange");
  expect(s2.window).toEqual([3, 6]);
  await answer(page, s2.turnId, { message: "Drop.", ops: sceneOps("DROP"), delayMs: 0 });
  const s3 = await nextPending(page, "scene");
  expect(s3.scene!.brief).toContain("chrome"); // the edit made during the build was used
  await answer(page, s3.turnId, { message: "Sunrise.", ops: sceneOps("SUN"), delayMs: 0 });

  await expect.poll(() => page.evaluate(() => (window as any).fusion.director.state().phase)).toBe("done"); // eslint-disable-line @typescript-eslint/no-explicit-any
  const d = (await doc(page)) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  expect(d.scenes.map((s: { status: string }) => s.status)).toEqual(["done", "done", "done"]);
  // ids were namespaced by scene, references followed, and layers sit in their scene's window
  const s2word = d.layers.find((l: { id: string }) => l.id === "s2-word");
  expect(s2word).toMatchObject({ parent: "s2-plate", in: 3, out: 6 });
  // edits to the shared camera stay per scene: behaviour ids are namespaced too
  expect(d.layers.find((l: { id: string }) => l.id === "cam").beh.map((b: { id: string }) => b.id)).toEqual(["s1-shake", "s2-shake", "s3-shake"]);
  await expect(page.locator("[data-testid=scene-s3]")).toContainText("Built");

  // 4. each scene is one undo step
  await page.keyboard.press("Escape");
  await page.locator(".sb-head h2").click();
  await page.keyboard.press("Control+z");
  const afterUndo = (await doc(page)) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  expect(afterUndo.layers.some((l: { id: string }) => l.id.startsWith("s3-"))).toBe(false);
  expect(afterUndo.scenes[2].status).toBe("planned");
  await page.keyboard.press("Control+Shift+z");

  // 5. rebuild one scene from its (edited) brief: its old layers are replaced
  await page.getByTestId("scene-s2").hover();
  await page.getByRole("button", { name: "Rebuild Drop" }).click();
  const again = await nextPending(page, "scene");
  expect(again.scene!.id).toBe("s2");
  await answer(page, again.turnId, { message: "Drop v2.", ops: [{ op: "add", id: "big", layer: { type: "text", text: "DROP!", size: 300 } }], delayMs: 0 });
  await expect.poll(async () => ((await doc(page)) as any).layers.filter((l: { id: string }) => l.id.startsWith("s2-")).map((l: { id: string }) => l.id)).toEqual(["s2-big"]); // eslint-disable-line @typescript-eslint/no-explicit-any
  expect(((await doc(page)) as any).layers.find((l: { id: string }) => l.id === "cam").beh.map((b: { id: string }) => b.id)).toEqual(["s1-shake", "s3-shake"]); // eslint-disable-line @typescript-eslint/no-explicit-any
});

test("storyboard edits: durations re-time later scenes, reorder, add and delete are undoable", async ({ page }) => {
  await fresh(page);
  await page.getByLabel("Describe your video").fill("Three shots");
  await page.getByTestId("start-create").click();
  await page.evaluate(async () => {
    const f = (window as any).fusion; // eslint-disable-line @typescript-eslint/no-explicit-any
    f.bridge.connect("Agent");
    const [p] = f.bridge.pending();
    await f.bridge.respond(p.turnId, { message: "ok", plan: [{ title: "A", dur: 2, brief: "a" }, { title: "B", dur: 2, brief: "b" }, { title: "C", dur: 2, brief: "c" }] });
  });
  const dur = page.getByLabel("Duration of A");
  await dur.fill("4");
  await dur.press("Enter");
  await expect.poll(async () => ((await doc(page)) as any).scenes.map((s: { start: number }) => s.start)).toEqual([0, 4, 6]); // eslint-disable-line @typescript-eslint/no-explicit-any
  expect(((await doc(page)) as any).comp.dur).toBe(8); // eslint-disable-line @typescript-eslint/no-explicit-any
  await page.getByTestId("scene-s3").hover();
  await page.getByRole("button", { name: "Move C earlier" }).click();
  await expect.poll(async () => ((await doc(page)) as any).scenes.map((s: { title: string }) => s.title).join("")).toBe("ACB"); // eslint-disable-line @typescript-eslint/no-explicit-any
  await page.getByTestId("add-scene").click();
  await expect(page.locator("[data-testid^=scene-]")).toHaveCount(4);
  await page.getByTestId("scene-s1").hover();
  await page.getByRole("button", { name: "Delete A" }).click();
  await expect(page.locator("[data-testid^=scene-]")).toHaveCount(3);
  await page.locator(".sb-head h2").click();
  await page.keyboard.press("Control+z");
  await expect(page.locator("[data-testid^=scene-]")).toHaveCount(4);
});
