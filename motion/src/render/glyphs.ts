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
  "Permanent Marker": `"Permanent Marker", "Comic Sans MS", cursive`,
  "Caveat": `"Caveat", cursive`,
  "Yellowtail": `"Yellowtail", cursive`,
  "Inter Tight Variable": `"Inter Tight Variable", "Inter Variable", system-ui, sans-serif`,
  "Playfair Display Variable": `"Playfair Display Variable", Georgia, serif`,
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

export interface GlyphStyle { font: string | undefined; weight: number; size: number; color?: string }
export interface LayoutGlyph { ch: string; x: number; y: number; style: GlyphStyle }
export interface TextLayout { glyphs: LayoutGlyph[]; width: number; height: number; lineWidths: number[] }
export interface SpanStyle { text: string; all?: boolean; font?: string; weight?: number; color?: string; size?: number }
const layoutCache = new Map<string, TextLayout>();

/** Style of every character (by code-point index), applying spans over the base style. */
function charStyles(text: string, base: GlyphStyle, spans: SpanStyle[] | undefined): GlyphStyle[] {
  const chars = Array.from(text);
  const out = chars.map(() => base);
  for (const sp of spans ?? []) {
    const st: GlyphStyle = { font: sp.font ?? base.font, weight: sp.weight ?? (sp.font ? 400 : base.weight), size: sp.size ?? base.size, color: sp.color ?? base.color };
    let from = 0;
    for (;;) {
      const idx = text.indexOf(sp.text, from);
      if (idx < 0) break;
      // convert UTF-16 index to code-point index
      const cp = Array.from(text.slice(0, idx)).length;
      const len = Array.from(sp.text).length;
      for (let i = cp; i < cp + len; i++) out[i] = st;
      if (!sp.all) break;
      from = idx + sp.text.length;
    }
  }
  return out;
}

/**
 * Positions (centre of each glyph) in layer space: block centred vertically, aligned horizontally.
 * Runs of the same style are measured together so kerning inside a run is kept.
 */
export function layoutText(text: string, font: string | undefined, weight: number, size: number, align: "left" | "center" | "right", tracking = 0, lineHeight = 1.08, spans?: SpanStyle[]): TextLayout {
  const key = `${text}|${font}|${weight}|${size}|${align}|${tracking}|${lineHeight}|${fontsVersion}|${spans ? JSON.stringify(spans) : ""}`;
  const hit = layoutCache.get(key);
  if (hit) return hit;
  const ctx = mctx();
  const base: GlyphStyle = { font, weight, size };
  const styles = charStyles(text, base, spans);
  const lines = text.split("\n");
  const glyphs: LayoutGlyph[] = [];
  const lineWidths: number[] = [];
  let ci = 0;
  const lineHeights = lines.map((line, li) => {
    const off = lines.slice(0, li).reduce((a, l) => a + Array.from(l).length + 1, 0);
    return Math.max(size, ...Array.from(line).map((_, i) => styles[off + i]?.size ?? size)) * lineHeight;
  });
  const totalH = lineHeights.reduce((a, b) => a + b, 0);
  let yTop = totalH / 2;
  lines.forEach((line, li) => {
    const chars = Array.from(line);
    const placed: { ch: string; x: number; st: GlyphStyle }[] = [];
    let x = 0;
    let i = 0;
    while (i < chars.length) {
      const st = styles[ci + i];
      let j = i;
      while (j < chars.length && styles[ci + j] === st) j++;
      ctx.font = fontCss(st.font, st.weight, st.size);
      let prefix = "";
      for (let k = i; k < j; k++) {
        const before = ctx.measureText(prefix).width;
        const adv = ctx.measureText(prefix + chars[k]).width - before;
        placed.push({ ch: chars[k], x: x + before + adv / 2 + k * tracking, st });
        prefix += chars[k];
      }
      x += ctx.measureText(prefix).width;
      i = j;
    }
    const total = x + tracking * Math.max(0, chars.length - 1);
    lineWidths.push(total);
    const x0 = align === "left" ? 0 : align === "center" ? -total / 2 : -total;
    const y = yTop - lineHeights[li] / 2;
    yTop -= lineHeights[li];
    for (const p of placed) glyphs.push({ ch: p.ch, x: x0 + p.x, y, style: p.st });
    ci += chars.length + 1;
  });
  const layout = { glyphs, width: Math.max(0, ...lineWidths), height: totalH, lineWidths };
  if (layoutCache.size > 400) layoutCache.clear();
  layoutCache.set(key, layout);
  return layout;
}
