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
    /** 0..1 of each glyph hidden from the right edge — a write-on wipe */
    wipe: z.number().optional(),
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
  /** Gaussian blur radius in comp px (AE: Gaussian Blur › Blurriness). Keyable as `blur`. */
  blur: z.number().min(0).optional(),
  /** Per-layer motion-blur switch; only used when comp.motionBlur is on. Default true. */
  motionBlur: z.boolean().optional(),
};

export const Shadow = z.object({
  x: z.number().default(0),
  y: z.number().default(-24),
  blur: z.number().min(0).default(40),
  color: z.string().default("#000000"),
  opacity: z.number().min(0).max(1).default(0.35),
});
export const Glass = z.object({
  /** backdrop blur radius (px) */
  blur: z.number().min(0).default(28),
  tint: z.string().default("#ffffff"),
  /** how much tint covers the blurred backdrop */
  amount: z.number().min(0).max(1).default(0.18),
  /** brightness of the thin rim light */
  rim: z.number().min(0).max(1).default(0.5),
});
const surface = { shadow: Shadow.optional(), glass: Glass.optional() };

export const GradientLayer = z.object({
  ...base,
  type: z.literal("gradient"),
  colors: z.array(Color).min(2).max(4),
  kind: z.enum(["linear", "radial"]).optional(),
  angle: z.number().optional(),
  noise: z.number().min(0).max(1).optional(),
});

export const Span = z.object({
  /** the substring to style (first occurrence, or every one with all: true) */
  text: z.string().min(1),
  all: z.boolean().optional(),
  font: z.string().optional(),
  weight: z.number().optional(),
  color: Color.optional(),
  size: z.number().positive().optional(),
});

export const TextLayer = z.object({
  ...base,
  type: z.literal("text"),
  /** styled runs inside the text: a script accent word, a coloured keyword */
  spans: z.array(Span).optional(),
  /** rolling number: `{value}` in text is replaced by the keyable `value` channel */
  value: z.number().optional(),
  format: z.object({ decimals: z.number().int().min(0).max(6).default(0), thousands: z.boolean().default(true) }).optional(),
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
  ...surface,
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
  ...surface,
  src: z.string(),
  w: z.number().positive(),
  h: z.number().positive().optional(),
  radius: z.number().min(0).optional(),
});

export const DeviceLayer = z.object({
  ...base,
  type: z.literal("device"),
  shadow: Shadow.optional(),
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

export const GroupLayer = z.object({
  ...base,
  type: z.literal("group"),
  /** mask children to a rounded rectangle centred on the group (AE: mask / track matte). Keyable: clip.w clip.h clip.radius */
  clip: z.object({ w: z.number().positive(), h: z.number().positive(), radius: z.number().min(0).default(0) }).optional(),
});

/** A UI card written in HTML/CSS and rasterised crisply. `{{name}}` / `{{name:2}}` pull from `vars` (keyable as vars.name). */
export const HtmlLayer = z.object({
  ...base,
  type: z.literal("html"),
  ...surface,
  html: z.string().max(20000),
  w: z.number().positive(),
  h: z.number().positive(),
  radius: z.number().min(0).optional(),
  vars: z.record(z.string(), z.number()).optional(),
});

/** A stroked line (AE shape layer + Trim Paths). Points are layer-local px. */
export const PathLayer = z.object({
  ...base,
  type: z.literal("path"),
  points: z.array(z.tuple([z.number(), z.number()])).min(2),
  smooth: z.boolean().optional(),
  closed: z.boolean().optional(),
  stroke: Color.optional(),
  width: z.number().positive().optional(),
  trimStart: z.number().min(0).max(1).optional(),
  trimEnd: z.number().min(0).max(1).optional(),
  /** soft glow around the stroke */
  glow: z.number().min(0).max(1).optional(),
  /** fill the area under the line down to this y (charts) */
  fillTo: z.number().optional(),
  fill: Color.optional(),
});

export const MATERIALS = ["chrome", "foil", "metal", "gold", "glass", "plastic", "matte", "clay", "emissive"] as const;
/** A real 3D object under the scene's HDRI environment. */
export const MeshLayer = z.object({
  ...base,
  type: z.literal("mesh"),
  geom: z.enum(["sphere", "box", "torus", "cylinder", "capsule", "cone", "balloon", "pear", "coin", "ring", "slab"]),
  size: z.number().positive(),
  /** slab only: [width, height, depth] in px (a phone body, a card) */
  dims: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]).optional(),
  /** slab only: corner radius in px */
  radius: z.number().min(0).optional(),
  material: z.enum(MATERIALS).default("plastic"),
  color: Color.optional(),
  roughness: z.number().min(0).max(1).optional(),
  metalness: z.number().min(0).max(1).optional(),
  /** texture mapped onto the object (asset id) */
  map: z.string().optional(),
});

/** Procedural photographic-style background: sky gradient, drifting clouds, sun, haze and hills. */
export const SkyLayer = z.object({
  ...base,
  type: z.literal("sky"),
  top: Color.optional(),
  horizon: Color.optional(),
  clouds: z.number().min(0).max(1).optional(),
  cloudScale: z.number().positive().optional(),
  drift: z.number().optional(),
  sun: z.number().min(0).max(1).optional(),
  hills: Color.optional(),
  hillHeight: z.number().min(0).max(1).optional(),
  mountains: z.boolean().optional(),
  /** 0..1 relative peak height */
  mountainHeight: z.number().min(0).max(2).optional(),
  grass: Color.optional(),
  /** night skies: star brightness 0..1 */
  stars: z.number().min(0).max(1).optional(),
  seed: z.number().optional(),
});

/** Adjustment layer: affects every layer below it while visible (AE adjustment layer). */
export const AdjustLayer = z.object({
  ...base,
  type: z.literal("adjust"),
  /** stops; 0 = unchanged */
  exposure: z.number().min(-4).max(4).optional(),
  /** offsets; 0 = unchanged, -1..1 */
  contrast: z.number().min(-1).max(1).optional(),
  saturation: z.number().min(-1).max(1).optional(),
  /** fade everything below toward this colour by `fade` (0..1) — white-outs, dips to black */
  fadeColor: Color.optional(),
  fade: z.number().min(0).max(1).optional(),
  /** 0 = uniform fade; >0 = the fade spreads through soft cloud shapes (fog/cloud dissolve) */
  dissolve: z.number().min(0).max(1).optional(),
});

export const Layer = z.discriminatedUnion("type", [
  GradientLayer, TextLayer, ShapeLayer, ImageLayer, DeviceLayer, ClonerLayer, CameraLayer, GroupLayer,
  HtmlLayer, PathLayer, MeshLayer, SkyLayer, AdjustLayer,
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

/**
 * A planned shot. The AI proposes the list before building; the user edits it; each scene is then
 * built into layers inside [start, start + dur). `status` tracks the build.
 */
export const Scene = z.object({
  id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/),
  title: z.string(),
  start: z.number().min(0),
  dur: z.number().positive(),
  /** what happens in the shot: the user-editable brief the AI builds from */
  brief: z.string(),
  status: z.enum(["planned", "building", "done"]).optional(),
});

/** A music or sound track on the comp timeline. `src` is an asset id or a library ref (lib://music/<name>). */
export const AudioTrack = z.object({
  id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/),
  src: z.string(),
  name: z.string().optional(),
  /** comp time the track starts at (s) */
  at: z.number().min(0).default(0),
  /** seconds into the file where playback begins (trim head) */
  offset: z.number().min(0).default(0),
  /** play length (s); defaults to the rest of the file / the comp */
  dur: z.number().positive().optional(),
  volume: z.number().min(0).max(2).default(1),
  fadeIn: z.number().min(0).default(0),
  fadeOut: z.number().min(0).default(0),
  muted: z.boolean().optional(),
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
    /** AE comp motion blur: 180° shutter = half a frame; samples = subframes averaged */
    motionBlur: z.object({ angle: z.number().min(0).max(720).default(180), samples: z.number().int().min(2).max(32).default(12) }).optional(),
    /** whole-frame finishing */
    post: z
      .object({
        bloom: z.number().min(0).max(3).optional(),
        bloomThreshold: z.number().min(0).max(4).optional(),
        /** stops; 0 = unchanged */
        exposure: z.number().min(-4).max(4).optional(),
        /** offsets; 0 = unchanged, -1..1 (AE Brightness & Contrast / Hue-Saturation style) */
        contrast: z.number().min(-1).max(1).optional(),
        saturation: z.number().min(-1).max(1).optional(),
        vignette: z.number().min(0).max(1).optional(),
        grain: z.number().min(0).max(1).optional(),
      })
      .optional(),
    /** image-based lighting for 3D: studio | city | sky | sunset | dawn | night | park | warehouse */
    env: z.string().optional(),
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
  scenes: z.array(Scene).default([]),
  audio: z.array(AudioTrack).default([]),
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
export type Scene = z.infer<typeof Scene>;
export type AudioTrack = z.infer<typeof AudioTrack>;
export type HtmlLayer = z.infer<typeof HtmlLayer>;
export type PathLayer = z.infer<typeof PathLayer>;
export type MeshLayer = z.infer<typeof MeshLayer>;
export type SkyLayer = z.infer<typeof SkyLayer>;
export type AdjustLayer = z.infer<typeof AdjustLayer>;
export type GroupLayer = z.infer<typeof GroupLayer>;
export type ShadowT = z.infer<typeof Shadow>;
export type GlassT = z.infer<typeof Glass>;

export const LAYER_TYPES: LayerType[] = ["gradient", "sky", "text", "shape", "image", "html", "path", "device", "mesh", "cloner", "camera", "group", "adjust"];

/** Distance at which a camera with vertical `fov` frames a comp of height `h` exactly. */
export function fitDistance(h: number, fov = 35): number {
  return h / 2 / Math.tan(((fov / 2) * Math.PI) / 180);
}
