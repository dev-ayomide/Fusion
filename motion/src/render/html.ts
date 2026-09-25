import * as THREE from "three";
import interUrl from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url";
import bricolageUrl from "@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2?url";
import serifUrl from "@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2?url";
import markerUrl from "@fontsource/permanent-marker/files/permanent-marker-latin-400-normal.woff2?url";
import caveatUrl from "@fontsource/caveat/files/caveat-latin-400-normal.woff2?url";
import monoUrl from "@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2?url";
import groteskUrl from "@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2?url";
import caveatBoldUrl from "@fontsource/caveat/files/caveat-latin-700-normal.woff2?url";
import yellowtailUrl from "@fontsource/yellowtail/files/yellowtail-latin-400-normal.woff2?url";
import interTightUrl from "@fontsource-variable/inter-tight/files/inter-tight-latin-wght-normal.woff2?url";
import playfairUrl from "@fontsource-variable/playfair-display/files/playfair-display-latin-wght-normal.woff2?url";
import { assetUrl } from "../assets/assets";

/**
 * `html` layers: a UI card written in HTML/CSS, rasterised through an SVG <foreignObject> into a
 * texture. This is how an agent (or a person) can make any interface state — a trade form, a chat
 * thread, a stats card — without an image editor. SVG images are sandboxed: no scripts run and no
 * network requests are made, so fonts and images are inlined as data URLs.
 */

const FACES: { family: string; url: string; weight: string }[] = [
  { family: "Inter Variable", url: interUrl, weight: "100 900" },
  { family: "Bricolage Grotesque Variable", url: bricolageUrl, weight: "200 800" },
  { family: "Instrument Serif", url: serifUrl, weight: "400" },
  { family: "Permanent Marker", url: markerUrl, weight: "400" },
  { family: "Caveat", url: caveatUrl, weight: "400" },
  { family: "JetBrains Mono Variable", url: monoUrl, weight: "100 800" },
  { family: "Space Grotesk Variable", url: groteskUrl, weight: "300 700" },
  { family: "Caveat", url: caveatBoldUrl, weight: "700" },
  { family: "Yellowtail", url: yellowtailUrl, weight: "400" },
  { family: "Inter Tight Variable", url: interTightUrl, weight: "100 900" },
  { family: "Playfair Display Variable", url: playfairUrl, weight: "400 900" },
];

async function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}

let fontCss: Promise<string> | null = null;
function embeddedFonts(): Promise<string> {
  fontCss ??= Promise.all(
    FACES.map(async (f) => {
      try {
        const data = await toDataUrl(await (await fetch(f.url)).blob());
        return `@font-face{font-family:"${f.family}";src:url(${data}) format("woff2");font-weight:${f.weight};font-display:block}`;
      } catch {
        return "";
      }
    }),
  ).then((x) => x.join(""));
  return fontCss;
}

const assetData = new Map<string, Promise<string>>();
function assetDataUrl(id: string): Promise<string> {
  let p = assetData.get(id);
  if (!p) {
    const url = assetUrl(id);
    p = url ? fetch(url).then((r) => r.blob()).then(toDataUrl).catch(() => "") : Promise.resolve("");
    assetData.set(id, p);
  }
  return p;
}

/** Fill `{{name}}` / `{{name:2}}` placeholders from numeric vars. */
export function fillVars(tpl: string, vars: Record<string, number>): string {
  return tpl.replace(/\{\{\s*([A-Za-z_]\w*)(?::(\d))?\s*\}\}/g, (_m, name: string, dec?: string) => {
    const v = vars[name];
    if (v === undefined) return "";
    const d = dec ? Number(dec) : 0;
    return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  });
}

/** Strip anything executable. SVG images can't run script anyway; this keeps the document honest. */
export function sanitize(html: string): string {
  return html
    .replace(/<\s*(script|iframe|object|embed|link|meta)[\s\S]*?(<\/\s*\1\s*>|\/?>)/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "");
}

/** Convert HTML to well-formed XHTML for foreignObject (void tags, &nbsp;, bare &). */
function xhtml(html: string): string {
  return html
    .replace(/<(br|hr|img|input|meta|source|wbr)(\s[^>]*?)?\s*\/?>/gi, (_m, t: string, a = "") => `<${t}${a} />`)
    .replace(/&nbsp;/g, "&#160;")
    .replace(/&(?!#?\w+;)/g, "&amp;");
}

interface Entry { tex: THREE.Texture | null; status: "loading" | "ready" | "error"; used: number }
const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();
let pending = 0;
const idleWaiters: (() => void)[] = [];

export function onHtmlReady(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
/** Resolves when no rasterisation is in flight (the exporter waits on this per frame). */
export function htmlIdle(): Promise<void> {
  return pending === 0 ? Promise.resolve() : new Promise((r) => idleWaiters.push(r));
}

async function rasterise(html: string, w: number, h: number, scale: number): Promise<THREE.Texture> {
  const fonts = await embeddedFonts();
  let body = xhtml(sanitize(html));
  const ids = [...new Set([...body.matchAll(/asset:\/\/([\w-]+)/g)].map((m) => m[1]))];
  for (const id of ids) body = body.split(`asset://${id}`).join(await assetDataUrl(id));
  const W = Math.round(w * scale), H = Math.round(h * scale);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${w} ${h}">` +
    `<foreignObject x="0" y="0" width="${w}" height="${h}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${w}px;height:${h}px;overflow:hidden;font-family:'Inter Variable',system-ui,sans-serif;-webkit-font-smoothing:antialiased">` +
    `<style>${fonts}*{box-sizing:border-box}</style>${body}</div></foreignObject></svg>`;
  const img = new Image();
  img.decoding = "sync";
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  await img.decode();
  // bake into a canvas so the texture is a plain bitmap at the target resolution
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  c.getContext("2d")!.drawImage(img, 0, 0, W, H);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  return tex;
}

let clock = 0;
/**
 * Texture for a filled HTML card at a given resolution scale, or the most recent one for the
 * same layer while the new one is being rasterised (so counters don't flicker).
 */
export function htmlTexture(layerKey: string, html: string, w: number, h: number, scale: number): THREE.Texture | null {
  const q = Math.min(3, Math.max(1, Math.round(scale * 2) / 2));
  const key = `${w}x${h}@${q}|${html}`;
  const hit = cache.get(key);
  clock++;
  if (hit) {
    hit.used = clock;
    if (hit.status === "ready") {
      lastFor.set(layerKey, hit.tex!);
      return hit.tex;
    }
    return lastFor.get(layerKey) ?? null;
  }
  const e: Entry = { tex: null, status: "loading", used: clock };
  cache.set(key, e);
  pending++;
  rasterise(html, w, h, q)
    .then((tex) => {
      e.tex = tex;
      e.status = "ready";
    })
    .catch((err) => {
      e.status = "error";
      console.warn("html layer failed to rasterise", err);
    })
    .finally(() => {
      pending--;
      evict();
      listeners.forEach((f) => f());
      if (pending === 0) idleWaiters.splice(0).forEach((r) => r());
    });
  return lastFor.get(layerKey) ?? null;
}
const lastFor = new Map<string, THREE.Texture>();

function evict() {
  if (cache.size <= 160) return;
  const inUse = new Set(lastFor.values());
  [...cache.entries()]
    .sort((a, b) => a[1].used - b[1].used)
    .slice(0, cache.size - 120)
    .forEach(([k, e]) => {
      if (e.tex && !inUse.has(e.tex)) e.tex.dispose();
      if (!e.tex || !inUse.has(e.tex)) cache.delete(k);
    });
}
