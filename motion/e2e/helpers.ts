import { expect, type Page } from "@playwright/test";

export type AnyDoc = { layers: { id: string; [k: string]: unknown }[]; [k: string]: unknown };

export async function fresh(page: Page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/");
  await expect(page.getByTestId("start")).toBeVisible();
}

export async function openTemplate(page: Page, id: string, mode: "Simple" | "Pro" = "Pro") {
  await fresh(page);
  await page.getByTestId(`tpl-${id}`).click();
  await expect(page.getByTestId("editor")).toBeVisible();
  await page.getByRole("group", { name: "Editor mode" }).getByRole("button", { name: mode }).click();
}

export const doc = (page: Page) => page.evaluate(() => (window as unknown as { fusion: { doc: () => AnyDoc } }).fusion.doc());
export const layer = async (page: Page, id: string) => (await doc(page)).layers.find((l) => l.id === id) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export const setTime = (page: Page, t: number) => page.evaluate((v) => (window as unknown as { fusion: { time: { set: (t: number) => void } } }).fusion.time.set(v), t);
export const past = (page: Page) => page.evaluate(() => (window as unknown as { __store?: unknown }).__store);

/** Screen coordinates of a time/row in the canvas timeline. */
export async function tl(page: Page, id: string, t: number, ch?: string) {
  return page.evaluate(
    ([id, t, ch]) => {
      const g = (window as unknown as { __timeline: { x: (t: number) => number; rowY: (id: string, ch?: string) => number | null } }).__timeline;
      return { x: g.x(t as number), y: g.rowY(id as string, (ch as string) || undefined) };
    },
    [id, t, ch ?? ""] as const,
  );
}

export async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 12) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}

/** Centre of a layer on screen, from the renderer's own bounds. */
export async function layerCenter(page: Page, id: string) {
  const c = await page.evaluate((id) => (window as unknown as { __viewport: { center: (id: string) => { x: number; y: number } | null } }).__viewport.center(id), id);
  if (!c) throw new Error(`layer ${id} not visible`);
  return c;
}

/** Average brightness of the rendered viewport — guards against blank/black frames. */
export async function canvasStats(page: Page) {
  return page.evaluate(() => {
    const src = document.querySelector("[data-testid=viewport-canvas]") as HTMLCanvasElement;
    const c = document.createElement("canvas");
    c.width = 160;
    c.height = 90;
    const g = c.getContext("2d")!;
    g.drawImage(src, 0, 0, 160, 90);
    const d = g.getImageData(0, 0, 160, 90).data;
    let sum = 0, distinct = new Set<number>();
    for (let i = 0; i < d.length; i += 4) {
      sum += d[i] + d[i + 1] + d[i + 2];
      distinct.add((d[i] >> 4) * 256 + (d[i + 1] >> 4) * 16 + (d[i + 2] >> 4));
    }
    return { mean: sum / (d.length / 4) / 3, colors: distinct.size };
  });
}
