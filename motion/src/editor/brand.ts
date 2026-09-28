import type { Doc } from "../fmd/schema";
import type { Op } from "../fmd/ops";
import type { Brand } from "../server/brand";

export type { Brand };

/** Read a website's brand (name, colours, logos) through the server's OpenBrand route. */
export async function fetchBrand(site: string): Promise<Brand> {
  let res: Response;
  try {
    res = await fetch(`/api/brand?url=${encodeURIComponent(site.trim())}`);
  } catch {
    throw new Error("Couldn't reach the brand reader. Check your connection.");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) throw new Error(body?.error ?? "Couldn't read that site's brand.");
  return body as Brand;
}

/* ------------------------------- colours ------------------------------- */

function hsl(hex: string): { h: number; s: number; l: number } {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}
const colourful = (hex: string) => {
  const c = hsl(hex);
  return c.s > 0.22 && c.l > 0.12 && c.l < 0.92;
};

/**
 * Which of the video's colours each brand colour would replace. Colourful ones fill Accent, then
 * Sky, then Sun; the brand's darkest and lightest neutrals become Background and Text, the right
 * way round for the video's current light or dark look, so words stay readable.
 */
export function brandColourPlan(doc: Doc, brand: Brand): Record<string, string> {
  const hexes = brand.colors.map((c) => c.hex);
  const vivid = hexes.filter(colourful);
  const neutral = hexes.filter((h) => !colourful(h)).sort((a, b) => hsl(a).l - hsl(b).l);
  const out: Record<string, string> = {};
  const slots = ["accent", "sky", "sun"].filter((k) => k in doc.brand.colors);
  vivid.slice(0, slots.length).forEach((h, i) => (out[slots[i]] = h));
  const dark = neutral.find((h) => hsl(h).l < 0.2);
  const light = [...neutral].reverse().find((h) => hsl(h).l > 0.85);
  const paper = doc.brand.colors.paper;
  const darkLook = paper ? hsl(paper).l < 0.5 : true;
  if ("paper" in doc.brand.colors && "ink" in doc.brand.colors) {
    if (darkLook) {
      if (dark) out.paper = dark;
      if (light) out.ink = light;
    } else {
      if (light) out.paper = light;
      if (dark) out.ink = dark;
    }
  }
  return out;
}

export function brandColourOps(doc: Doc, brand: Brand): Op[] {
  return Object.entries(brandColourPlan(doc, brand))
    .filter(([k, v]) => doc.brand.colors[k] !== v)
    .map(([k, v]) => ({ op: "set" as const, path: `brand/colors/${k}`, value: v }));
}

/* -------------------------------- logo -------------------------------- */

/**
 * Download the brand's best logo as a File ready to import. Logos drawn in "currentColor" (common for
 * SVG wordmarks) are painted in `ink` so they don't vanish on a dark background.
 */
export async function brandLogoFile(brand: Brand, ink = "#ffffff"): Promise<File | null> {
  const stem = brand.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 16) || "brand";
  for (const logo of brand.logos) {
    try {
      const res = await fetch(logo.url.startsWith("data:") ? logo.url : `/api/brand/image?url=${encodeURIComponent(logo.url)}`);
      if (!res.ok) continue;
      let blob = await res.blob();
      if (!blob.type.startsWith("image/")) continue;
      if (blob.type.includes("svg")) {
        const svg = await blob.text();
        blob = new Blob([svg.replace(/currentColor/g, ink)], { type: "image/svg+xml" });
      }
      const ext = blob.type.includes("svg") ? "svg" : blob.type.split("/")[1]?.replace("jpeg", "jpg").replace(/[^a-z]/g, "") || "png";
      return new File([blob], `${stem}-logo.${ext}`, { type: blob.type });
    } catch {
      /* try the next logo */
    }
  }
  return null;
}

/** One line for the AI, so a storyboard built from the landing prompt uses the brand. */
export function brandBrief(brand: Brand, hasLogo: boolean): string {
  const host = (() => {
    try {
      return new URL(brand.url).hostname.replace(/^www\./, "");
    } catch {
      return brand.url;
    }
  })();
  return `Brand: ${brand.name} (${host}). Use its colours ${brand.colors.map((c) => c.hex).join(", ")}${hasLogo ? " and its attached logo" : ""}.`;
}
