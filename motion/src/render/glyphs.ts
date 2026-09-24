import * as THREE from "three";

/**
 * Glyph textures + text layout. Each grapheme is its own quad so every glyph can move,
 * scale, rotate and fade independently (the per-glyph channel troika doesn't have).
 */
export const FONT_STACK: Record<string, string> = {
  "Inter Variable": `"Inter Variable", Inter, system-ui, sans-serif`,
  "Space Grotesk Variable": `"Space Grotesk Variable", "Space Grotesk", system-ui, sans-serif`,
  "Bricolage Grotesque Variable": `"Bricolage Grotesque Variable", system-ui, sans-serif`,
  "Instrument Serif": `"Instrument Serif", Georgia, serif`,
  "JetBrains Mono Variable": `"JetBrains Mono Variable", ui-monospace, monospace`,
};
export const FONT_NAMES = Object.keys(FONT_STACK);
export function fontCss(font: string | undefined, weight: number, px: number): string {
  const stack = FONT_STACK[font ?? ""] ?? `"${font}", ${FONT_STACK["Inter Variable"]}`;
  return `${weight} ${px}px ${stack}`;
}

let fontsVersion = 0;
const fontListeners = new Set<() => void>();
const requested = new Set<string>();
export function onFontsChanged(fn: () => void) {
  fontListeners.add(fn);
  return () => fontListeners.delete(fn);
}
export function getFontsVersion() {
  return fontsVersion;
}
/** Kick off loading a face; when it arrives, drop cached glyphs and notify renderers. */
export function ensureFont(font: string | undefined, weight: number): void {
  if (typeof document === "undefined" || !document.fonts) return;
  const css = fontCss(font, weight, 64);
  if (requested.has(css)) return;
  requested.add(css);
  document.fonts.load(css).then(() => {
    fontsVersion++;
    glyphCache.forEach((g) => g.tex.dispose());
    glyphCache.clear();
    layoutCache.clear();
    fontListeners.forEach((f) => f());
  });
}
export function fontsReady(): Promise<void> {
  return typeof document !== "undefined" && document.fonts ? document.fonts.ready.then(() => undefined) : Promise.resolve();
}

let measureCtx: CanvasRenderingContext2D | null = null;
function mctx() {
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d")!;
  return measureCtx;
}

export interface Glyph {
  tex: THREE.CanvasTexture;
  /** quad size in font px (at the layer's font size, independent of texture resolution) */
  w: number;
  h: number;
}
const glyphCache = new Map<string, Glyph>();

/** Texture for one grapheme, rendered at `res`× so camera push-ins stay sharp. */
export function glyphTexture(ch: string, font: string | undefined, weight: number, size: number, res = 2): Glyph {
  const px = Math.min(512, Math.max(8, Math.round(size * res)));
  const key = `${font}|${weight}|${px}|${ch}`;
  const hit = glyphCache.get(key);
  if (hit) return hit;
  const ctx = mctx();
  ctx.font = fontCss(font, weight, px);
  const m = ctx.measureText(ch);
  const pad = Math.ceil(px * 0.25);
  const cw = Math.max(2, Math.ceil(Math.max(m.width, (m.actualBoundingBoxRight ?? 0) + (m.actualBoundingBoxLeft ?? 0)) + pad * 2));
  const chh = Math.ceil(px * 1.5);
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = chh;
  const g = canvas.getContext("2d")!;
  g.font = ctx.font;
  g.textBaseline = "middle";
  g.textAlign = "center";
  g.fillStyle = "#fff";
  g.fillText(ch, cw / 2, chh / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  const scale = size / px;
  const glyph = { tex, w: cw * scale, h: chh * scale };
  glyphCache.set(key, glyph);
  return glyph;
}

export interface LayoutGlyph { ch: string; x: number; y: number }
export interface TextLayout { glyphs: LayoutGlyph[]; width: number; height: number; lineWidths: number[] }
const layoutCache = new Map<string, TextLayout>();

/** Positions (centre of each glyph) in layer space: block centred vertically, aligned horizontally. */
export function layoutText(text: string, font: string | undefined, weight: number, size: number, align: "left" | "center" | "right", tracking = 0, lineHeight = 1.08): TextLayout {
  const key = `${text}|${font}|${weight}|${size}|${align}|${tracking}|${lineHeight}|${fontsVersion}`;
  const hit = layoutCache.get(key);
  if (hit) return hit;
  const ctx = mctx();
  ctx.font = fontCss(font, weight, size);
  const lines = text.split("\n");
  const lh = size * lineHeight;
  const glyphs: LayoutGlyph[] = [];
  const lineWidths: number[] = [];
  lines.forEach((line, li) => {
    const chars = Array.from(line);
    const total = ctx.measureText(line).width + tracking * Math.max(0, chars.length - 1);
    lineWidths.push(total);
    const x0 = align === "left" ? 0 : align === "center" ? -total / 2 : -total;
    const y = ((lines.length - 1) / 2 - li) * lh;
    let prefix = "";
    chars.forEach((ch, i) => {
      const before = ctx.measureText(prefix).width;
      const adv = ctx.measureText(prefix + ch).width - before;
      glyphs.push({ ch, x: x0 + before + i * tracking + adv / 2, y });
      prefix += ch;
    });
  });
  const layout = { glyphs, width: Math.max(0, ...lineWidths), height: lines.length * lh, lineWidths };
  if (layoutCache.size > 400) layoutCache.clear();
  layoutCache.set(key, layout);
  return layout;
}
