import type { Doc } from "../fmd/schema";
import type { Op } from "../fmd/ops";
import { frontAfter, uniqueId } from "./edit";

export type NewKind = "text" | "rect" | "ellipse" | "image" | "device" | "browser" | "cloner" | "grid" | "card" | "chart" | "object" | "sky" | "fade";

const r2 = (v: number) => Math.round(v * 100) / 100;
function brand(doc: Doc, want: string, fallbackIdx = 0): string {
  const keys = Object.keys(doc.brand.colors);
  if (keys.includes(want)) return "$" + want;
  return keys.length ? "$" + keys[Math.min(fallbackIdx, keys.length - 1)] : "#ffffff";
}

/**
 * New layers arrive ready to look good: brand colours, a sensible entrance, placed at the
 * playhead, in front of everything. Novices get motion without knowing what a keyframe is.
 */
export function createLayerOps(doc: Doc, kind: NewKind, t: number, extra: { asset?: string; pos?: [number, number, number] } = {}): { ops: Op[]; id: string } {
  const at = r2(Math.min(Math.max(0, t), Math.max(0, doc.comp.dur - 0.5)));
  const pos = extra.pos ?? [0, 0, 0];
  const after = frontAfter(doc);
  let stem: string = kind;
  let layer: Record<string, unknown>;
  switch (kind) {
    case "text":
      stem = "headline";
      layer = { type: "text", text: "Your headline", size: 96, weight: 700, color: brand(doc, "ink", 1), align: "center", pos, in: at, beh: [{ id: "in", use: "typeUp", at: 0, stagger: 0.03, dist: 40 }] };
      break;
    case "rect":
      stem = "card";
      layer = { type: "shape", shape: "rect", w: 360, h: 220, radius: 28, fill: brand(doc, "accent"), pos, in: at, beh: [{ id: "in", use: "popIn", at: 0, dur: 0.7, bounce: 0.45 }] };
      break;
    case "ellipse":
      stem = "circle";
      layer = { type: "shape", shape: "ellipse", w: 220, h: 220, fill: brand(doc, "accent"), pos, in: at, beh: [{ id: "in", use: "popIn", at: 0, dur: 0.7, bounce: 0.5 }] };
      break;
    case "image":
      stem = extra.asset ?? "image";
      layer = { type: "image", src: extra.asset, w: 520, radius: 18, pos, in: at, beh: [{ id: "in", use: "rise", at: 0, dur: 0.8, dist: 60 }] };
      break;
    case "device":
      stem = "phone";
      layer = { type: "device", model: "iphone", w: 360, depth: true, pos, in: at, ...(extra.asset ? { screen: extra.asset } : {}), beh: [{ id: "in", use: "rise", at: 0, dur: 1, dist: 220, bounce: 0.3 }] };
      break;
    case "browser":
      stem = "browser";
      layer = { type: "device", model: "browser", w: 1000, depth: true, pos, in: at, ...(extra.asset ? { screen: extra.asset } : {}), beh: [{ id: "in", use: "rise", at: 0, dur: 1, dist: 160, bounce: 0.25 }] };
      break;
    case "cloner":
      stem = "ring";
      layer = { type: "cloner", mode: "radial", n: 12, r: 300, pos, in: at, depth: true, child: { kind: "shape", shape: "ellipse", w: 44, colors: [brand(doc, "accent"), brand(doc, "ink", 1)] }, reveal: { dur: 0.6, bounce: 0.5 }, fx: [{ id: "lag", type: "delay", step: 0.04 }], keys: { spin: [[0, 0], [r2(doc.comp.dur - at), 90]] } };
      break;
    case "grid":
      stem = "grid";
      layer = { type: "cloner", mode: "grid", n: 25, cols: 5, gap: 70, pos, in: at, child: { kind: "shape", shape: "rect", w: 44, radius: 10, colors: [brand(doc, "accent"), brand(doc, "ink", 1)] }, reveal: { dur: 0.5, bounce: 0.4 }, fx: [{ id: "lag", type: "delay", step: 0.03 }, { id: "wave", type: "wave", amp: [0, 0, 60], freq: 0.5, phase: 0.5 }] };
      break;
    case "card":
      stem = "card";
      layer = {
        type: "html", w: 720, h: 420, radius: 40, pos, in: at, vars: { value: 0 }, glass: { blur: 30, tint: "#ffffff", amount: 0.16, rim: 0.5 }, shadow: { x: 0, y: -24, blur: 50, color: "#000000", opacity: 0.25 },
        html: '<div style="padding:44px;color:#fff;font-family:\'Inter Variable\'"><div style="font-size:30px;opacity:.85">Total</div><div style="font-size:96px;font-weight:600;letter-spacing:-2px">$' + "{{value:0}}</div></div>",
        keys: { "vars.value": [[0.2, 0], [1.6, 1280, "expoOut"]] },
        beh: [{ id: "in", use: "rise", at: 0, dur: 0.8, dist: 80 }],
      };
      break;
    case "chart":
      stem = "chart";
      layer = { type: "path", pos, in: at, smooth: true, width: 8, glow: 0.5, stroke: brand(doc, "accent"), points: [[-400, -120], [-250, -60], [-120, -90], [0, 10], [140, -20], [260, 80], [400, 160]], keys: { trimEnd: [[0, 0], [1.4, 1, "inOut"]] } };
      break;
    case "object":
      stem = "orb";
      layer = { type: "mesh", geom: "sphere", size: 320, material: "chrome", color: "#dfe6ff", pos, in: at, depth: true, keys: { "rot.y": [[0, 0], [r2(doc.comp.dur - at), 120]] }, beh: [{ id: "in", use: "popIn", at: 0, dur: 0.8, bounce: 0.4 }] };
      break;
    case "sky":
      stem = "sky";
      layer = { type: "sky", clouds: 0.5, sun: 0.5, hills: "#3f7f33", grass: "#4c9a2c", hillHeight: 0.4 };
      break;
    case "fade":
      stem = "fade";
      layer = { type: "adjust", in: at, fadeColor: "#ffffff", keys: { fade: [[0, 0], [0.4, 1, "in"]] } };
      break;
  }
  const id = uniqueId(doc, stem);
  // backgrounds go to the back; everything else lands in front
  return { ops: [{ op: "add", id, after: kind === "sky" ? null : after, layer }], id };
}
