import { z } from "zod";

/**
 * FMD v0.1 — Fusion Motion Document.
 *
 * Space: origin at comp centre, Y up, +Z toward the camera, units are pixels.
 * Time:  `in`/`out` are comp seconds; everything inside a layer (behavior `at`,
 *        key `t`, expression `t`) is layer-local, zero at `in`.
 */

export const Color = z.string().regex(/^(#[0-9a-f]{6}|\$[a-z][a-z0-9-]*)$/, "color must be #rrggbb (lowercase) or $brandName");
const Vec3 = z.tuple([z.number(), z.number(), z.number()]);

/** [t, value, ease?] — t is layer-local seconds; ease shapes the segment arriving at this key. */
export const Key = z.union([z.tuple([z.number(), z.number()]), z.tuple([z.number(), z.number(), z.string()])]);
export const Track = z.array(Key);

export const Beh = z
  .object({
    id: z.string().min(1),
    use: z.string().min(1),
    at: z.number().default(0),
    dur: z.number().positive().optional(),
    ease: z.string().optional(),
    bounce: z.number().min(0).max(1).optional(),
  })
  .catchall(z.unknown());

export const Selector = z.object({
  by: z.enum(["char", "word", "line"]).default("char"),
  shape: z.enum(["ramp", "smooth", "full"]).default("ramp"),
  start: z.number().default(0),
  end: z.number().default(0.15),
  offset: z.union([z.number(), Track]).default(0),
});

export const Anim = z.object({
  id: z.string().min(1),
  sel: Selector,
  add: z.object({
    pos: z.tuple([z.number(), z.number(), z.number()]).optional(),
    rot: z.number().optional(),
    scale: z.number().optional(),
    opacity: z.number().optional(),
  }),
});

export const Fx = z.discriminatedUnion("type", [
  z.object({ id: z.string(), type: z.literal("delay"), step: z.number() }),
  z.object({ id: z.string(), type: z.literal("noise"), amp: Vec3, freq: z.number().default(0.5), seed: z.number().optional() }),
  z.object({ id: z.string(), type: z.literal("wave"), amp: Vec3, freq: z.number().default(0.5), phase: z.number().default(0.4) }),
]);

const base = {
  id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/, "ids start with a letter; letters, digits, _ and - only"),
  name: z.string().optional(),
  in: z.number().min(0).optional(),
  out: z.number().positive().optional(),
  parent: z.string().optional(),
  hidden: z.boolean().optional(),
  locked: z.boolean().optional(),
  pos: Vec3.optional(),
  rot: Vec3.optional(),
  scale: z.number().optional(),
  opacity: z.number().min(0).max(1).optional(),
  /** 3D layers depth-sort among each other (AE's 3D switch). Flat layers paint in document order. */
  depth: z.boolean().optional(),
  keys: z.record(z.string(), Track).optional(),
  beh: z.array(Beh).optional(),
  expr: z.record(z.string(), z.string()).optional(),
};

export const GradientLayer = z.object({
  ...base,
  type: z.literal("gradient"),
  colors: z.array(Color).min(2).max(4),
  kind: z.enum(["linear", "radial"]).optional(),
  angle: z.number().optional(),
  noise: z.number().min(0).max(1).optional(),
});

export const TextLayer = z.object({
  ...base,
  type: z.literal("text"),
  text: z.string(),
  size: z.number().positive(),
  font: z.string().optional(),
  weight: z.number().min(100).max(900).optional(),
  color: Color.optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  tracking: z.number().optional(),
  lineHeight: z.number().positive().optional(),
  anim: z.array(Anim).optional(),
});

export const ShapeLayer = z.object({
  ...base,
  type: z.literal("shape"),
  shape: z.enum(["rect", "ellipse"]),
  w: z.number().positive(),
  h: z.number().positive(),
  radius: z.number().min(0).optional(),
  fill: Color.optional(),
  stroke: Color.optional(),
  strokeWidth: z.number().min(0).optional(),
});

export const ImageLayer = z.object({
  ...base,
  type: z.literal("image"),
  src: z.string(),
  w: z.number().positive(),
  h: z.number().positive().optional(),
  radius: z.number().min(0).optional(),
});

export const DeviceLayer = z.object({
  ...base,
  type: z.literal("device"),
  model: z.enum(["iphone", "browser"]),
  screen: z.string().optional(),
  w: z.number().positive().optional(),
  color: Color.optional(),
});

export const ClonerLayer = z.object({
  ...base,
  type: z.literal("cloner"),
  mode: z.enum(["radial", "grid", "linear"]),
  n: z.number().int().min(1).max(400),
  r: z.number().optional(),
  cols: z.number().int().min(1).optional(),
  gap: z.number().optional(),
  spin: z.number().optional(),
  billboard: z.boolean().optional(),
  /** radial only: turn each clone to point away from the centre (ticks, petals) */
  orient: z.boolean().optional(),
  child: z.object({
    kind: z.enum(["shape", "image", "text"]),
    shape: z.enum(["rect", "ellipse"]).optional(),
    w: z.number().positive(),
    h: z.number().positive().optional(),
    radius: z.number().optional(),
    fill: Color.optional(),
    src: z.string().optional(),
    text: z.string().optional(),
    colors: z.array(Color).optional(),
  }),
  reveal: z.object({ dur: z.number().positive(), bounce: z.number().min(0).max(1).optional(), at: z.number().optional() }).optional(),
  fx: z.array(Fx).optional(),
});

export const CameraLayer = z.object({
  ...base,
  type: z.literal("camera"),
  fov: z.number().min(5).max(120).optional(),
  target: Vec3.optional(),
});

export const GroupLayer = z.object({ ...base, type: z.literal("group") });

export const Layer = z.discriminatedUnion("type", [
  GradientLayer, TextLayer, ShapeLayer, ImageLayer, DeviceLayer, ClonerLayer, CameraLayer, GroupLayer,
]);

export const Asset = z.object({
  src: z.string(),
  mime: z.string(),
  name: z.string().optional(),
  w: z.number().optional(),
  h: z.number().optional(),
});

export const Binding = z.object({
  from: z.enum(["style.energy", "style.bounce", "style.depth", "style.speed"]),
  path: z.string(),
  lo: z.number(),
  hi: z.number(),
});

export const Doc = z.object({
  v: z.literal(1),
  name: z.string().optional(),
  comp: z.object({
    w: z.number().int().positive(),
    h: z.number().int().positive(),
    fps: z.number().int().min(1).max(120),
    dur: z.number().positive().max(600),
    bg: Color,
    cam: z.string().optional(),
  }),
  brand: z.object({
    font: z.string(),
    colors: z.record(z.string().regex(/^[a-z][a-z0-9-]*$/), z.string().regex(/^#[0-9a-f]{6}$/)),
  }),
  assets: z.record(z.string(), Asset).default({}),
  markers: z.array(z.object({ id: z.string(), t: z.number(), label: z.string().optional() })).default([]),
  style: z
    .object({ energy: z.number().min(0).max(1), bounce: z.number().min(0).max(1), depth: z.number().min(0).max(1), speed: z.number().min(0).max(1) })
    .default({ energy: 0.5, bounce: 0.5, depth: 0.5, speed: 0.5 }),
  bindings: z.array(Binding).default([]),
  layers: z.array(Layer),
});

export type Doc = z.infer<typeof Doc>;
export type Layer = z.infer<typeof Layer>;
export type LayerType = Layer["type"];
export type Beh = z.infer<typeof Beh>;
export type Key = z.infer<typeof Key>;
export type Track = z.infer<typeof Track>;
export type Fx = z.infer<typeof Fx>;
export type Anim = z.infer<typeof Anim>;
export type TextLayer = z.infer<typeof TextLayer>;
export type ShapeLayer = z.infer<typeof ShapeLayer>;
export type ImageLayer = z.infer<typeof ImageLayer>;
export type DeviceLayer = z.infer<typeof DeviceLayer>;
export type ClonerLayer = z.infer<typeof ClonerLayer>;
export type CameraLayer = z.infer<typeof CameraLayer>;
export type GradientLayer = z.infer<typeof GradientLayer>;
export type Binding = z.infer<typeof Binding>;

export const LAYER_TYPES: LayerType[] = ["gradient", "text", "shape", "image", "device", "cloner", "camera", "group"];

/** Distance at which a camera with vertical `fov` frames a comp of height `h` exactly. */
export function fitDistance(h: number, fov = 35): number {
  return h / 2 / Math.tan(((fov / 2) * Math.PI) / 180);
}
