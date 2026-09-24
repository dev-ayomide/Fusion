import type { LayerType } from "./schema";

/**
 * Behavior catalog. `mode`:
 *   own  — exclusive owner of its channels (rise owns pos.y + opacity)
 *   add  — stacks on top of the track (float, wiggle)
 *   text — per-glyph owner, staggered by `by` unit (typeUp, cascade)
 * `writes` lists the channels touched; the validator uses it to reject two owners of a channel.
 */
export type BehMode = "own" | "add" | "text";
export type BehGroup = "Enter" | "Exit" | "Loop" | "Text" | "Camera";

export interface ParamSpec {
  default: number | string;
  desc: string;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
}

export interface BehSpec {
  use: string;
  label: string;
  group: BehGroup;
  mode: BehMode;
  writes: string[];
  dur: number;
  ease: string;
  bounce?: number;
  bake: "exact" | "sample" | "never";
  types?: LayerType[];
  params: Record<string, ParamSpec>;
  desc: string;
}

const VISUAL: LayerType[] = ["text", "shape", "image", "device", "cloner", "group", "html", "path", "mesh"];

export const CATALOG: Record<string, BehSpec> = {
  fadeIn: { use: "fadeIn", label: "Fade in", group: "Enter", mode: "own", writes: ["opacity"], dur: 0.5, ease: "out", bake: "exact", types: VISUAL, params: {}, desc: "Opacity 0 → its value." },
  rise: {
    use: "rise", label: "Rise", group: "Enter", mode: "own", writes: ["pos.y", "opacity"], dur: 0.8, ease: "out", bounce: 0.3, bake: "sample", types: VISUAL,
    params: { dist: { default: 120, desc: "pixels travelled upward", min: 0, max: 1200, step: 10 } },
    desc: "Moves up into place while fading in.",
  },
  drop: {
    use: "drop", label: "Drop", group: "Enter", mode: "own", writes: ["pos.y", "opacity"], dur: 0.8, ease: "out", bounce: 0.4, bake: "sample", types: VISUAL,
    params: { dist: { default: 160, desc: "pixels travelled downward", min: 0, max: 1200, step: 10 } },
    desc: "Falls into place from above.",
  },
  slideIn: {
    use: "slideIn", label: "Slide in", group: "Enter", mode: "own", writes: ["pos.x", "opacity"], dur: 0.8, ease: "out", bounce: 0.2, bake: "sample", types: VISUAL,
    params: { dist: { default: 240, desc: "pixels travelled", min: 0, max: 2000, step: 10 }, from: { default: "left", desc: "side it enters from", options: ["left", "right"] } },
    desc: "Slides in horizontally.",
  },
  popIn: { use: "popIn", label: "Pop in", group: "Enter", mode: "own", writes: ["scale", "opacity"], dur: 0.6, ease: "out", bounce: 0.5, bake: "sample", types: VISUAL, params: { from: { default: 0, desc: "starting scale", min: 0, max: 2, step: 0.05 } }, desc: "Scales up from nothing with a spring." },
  settle: { use: "settle", label: "Settle", group: "Enter", mode: "own", writes: ["scale", "opacity"], dur: 1.0, ease: "out", bake: "sample", types: VISUAL, params: { from: { default: 1.35, desc: "starting scale", min: 0.2, max: 3, step: 0.05 } }, desc: "Shrinks into place from slightly large." },
  spinIn: {
    use: "spinIn", label: "Spin in", group: "Enter", mode: "own", writes: ["rot.z", "scale", "opacity"], dur: 0.9, ease: "out", bounce: 0.3, bake: "sample", types: VISUAL,
    params: { deg: { default: -90, desc: "degrees turned on the way in", min: -720, max: 720, step: 15 } }, desc: "Rotates and scales into place.",
  },
  flipIn: {
    use: "flipIn", label: "Flip in (3D)", group: "Enter", mode: "own", writes: ["rot.y", "opacity"], dur: 1.0, ease: "out", bounce: 0.25, bake: "sample", types: VISUAL,
    params: { deg: { default: -75, desc: "starting Y rotation in degrees", min: -180, max: 180, step: 5 } }, desc: "Turns toward the camera in 3D.",
  },
  fadeOut: { use: "fadeOut", label: "Fade out", group: "Exit", mode: "own", writes: ["opacity"], dur: 0.5, ease: "in", bake: "exact", types: VISUAL, params: {}, desc: "Opacity → 0." },
  sink: {
    use: "sink", label: "Sink out", group: "Exit", mode: "own", writes: ["pos.y", "opacity"], dur: 0.6, ease: "in", bake: "sample", types: VISUAL,
    params: { dist: { default: 100, desc: "pixels travelled downward", min: 0, max: 1200, step: 10 } }, desc: "Drops away while fading out.",
  },
  float: {
    use: "float", label: "Float", group: "Loop", mode: "add", writes: ["pos.y"], dur: 999, ease: "linear", bake: "never", types: VISUAL,
    params: { amp: { default: 14, desc: "pixels of bob", min: 0, max: 200, step: 1 }, period: { default: 3, desc: "seconds per bob", min: 0.2, max: 20, step: 0.1 } },
    desc: "Gentle up-and-down bob.",
  },
  sway: {
    use: "sway", label: "Sway (3D)", group: "Loop", mode: "add", writes: ["rot.y"], dur: 999, ease: "linear", bake: "never", types: VISUAL,
    params: { deg: { default: 10, desc: "degrees each way", min: 0, max: 90, step: 1 }, period: { default: 4, desc: "seconds per cycle", min: 0.2, max: 20, step: 0.1 } },
    desc: "Turns side to side in 3D.",
  },
  wiggle: {
    use: "wiggle", label: "Wiggle", group: "Loop", mode: "add", writes: ["pos.x", "pos.y", "rot.z"], dur: 999, ease: "linear", bake: "never", types: VISUAL,
    params: { amp: { default: 8, desc: "pixels of jitter", min: 0, max: 200, step: 1 }, freq: { default: 1.5, desc: "wiggles per second", min: 0.1, max: 20, step: 0.1 }, deg: { default: 2, desc: "degrees of rotation jitter", min: 0, max: 45, step: 0.5 } },
    desc: "Organic noise-driven jitter.",
  },
  spin: {
    use: "spin", label: "Spin", group: "Loop", mode: "add", writes: ["rot.z"], dur: 999, ease: "linear", bake: "never", types: VISUAL,
    params: { speed: { default: 45, desc: "degrees per second", min: -720, max: 720, step: 5 } }, desc: "Continuous rotation.",
  },
  pulse: {
    use: "pulse", label: "Pulse", group: "Loop", mode: "add", writes: ["scale"], dur: 999, ease: "linear", bake: "never", types: VISUAL,
    params: { amp: { default: 0.04, desc: "scale change", min: 0, max: 1, step: 0.01 }, period: { default: 1.2, desc: "seconds per beat", min: 0.1, max: 10, step: 0.05 } },
    desc: "Breathing scale.",
  },
  typeUp: {
    use: "typeUp", label: "Type up", group: "Text", mode: "text", writes: ["glyph.pos.y", "glyph.opacity"], dur: 0.5, ease: "out", bake: "never", types: ["text"],
    params: { by: { default: "char", desc: "unit", options: ["char", "word", "line"] }, stagger: { default: 0.03, desc: "seconds between units", min: 0, max: 1, step: 0.005 }, dist: { default: 40, desc: "pixels each unit rises", min: 0, max: 400, step: 2 } },
    desc: "Each letter rises and fades in, one after another.",
  },
  bounceIn: {
    use: "bounceIn", label: "Bounce in", group: "Text", mode: "text", writes: ["glyph.scale", "glyph.pos.y", "glyph.opacity"], dur: 0.7, ease: "out", bounce: 0.6, bake: "never", types: ["text"],
    params: { by: { default: "word", desc: "unit", options: ["char", "word", "line"] }, stagger: { default: 0.1, desc: "seconds between units", min: 0, max: 1, step: 0.005 } },
    desc: "Each word pops in with a springy bounce.",
  },
  cascade: {
    use: "cascade", label: "Cascade", group: "Text", mode: "text", writes: ["glyph.pos.y", "glyph.rot.z", "glyph.opacity"], dur: 0.7, ease: "out", bounce: 0.35, bake: "never", types: ["text"],
    params: { by: { default: "char", desc: "unit", options: ["char", "word", "line"] }, stagger: { default: 0.04, desc: "seconds between units", min: 0, max: 1, step: 0.005 }, dist: { default: 90, desc: "pixels each unit falls", min: 0, max: 600, step: 2 } },
    desc: "Letters fall in from above with a slight tilt.",
  },
  typewriter: {
    use: "typewriter", label: "Typewriter", group: "Text", mode: "text", writes: ["glyph.opacity"], dur: 0.01, ease: "linear", bake: "never", types: ["text"],
    params: { by: { default: "char", desc: "unit", options: ["char", "word"] }, stagger: { default: 0.06, desc: "seconds between units", min: 0, max: 1, step: 0.005 } },
    desc: "Letters appear one at a time with no motion.",
  },
  dolly: {
    use: "dolly", label: "Dolly", group: "Camera", mode: "own", writes: ["pos.z"], dur: 4, ease: "inOut", bake: "exact", types: ["camera"],
    params: { to: { default: 1500, desc: "camera z at the end (fit distance for 1080p at 35° is 1713)", step: 10 } },
    desc: "Moves the camera toward or away from the scene.",
  },
  truck: {
    use: "truck", label: "Truck", group: "Camera", mode: "own", writes: ["pos.x"], dur: 4, ease: "inOut", bake: "exact", types: ["camera"],
    params: { to: { default: 200, desc: "camera x at the end", step: 10 } },
    desc: "Slides the camera sideways.",
  },
  orbit: {
    use: "orbit", label: "Orbit", group: "Camera", mode: "own", writes: ["pos.x", "pos.z", "rot.y"], dur: 6, ease: "inOut", bake: "sample", types: ["camera"],
    params: { deg: { default: 20, desc: "degrees swung around the centre", min: -180, max: 180, step: 1 } },
    desc: "Swings the camera around the scene centre.",
  },
  shake: {
    use: "shake", label: "Handheld", group: "Camera", mode: "add", writes: ["pos.x", "pos.y", "rot.z"], dur: 999, ease: "linear", bake: "never", types: ["camera"],
    params: { amp: { default: 6, desc: "pixels of drift", min: 0, max: 100, step: 1 }, freq: { default: 0.6, desc: "drift speed", min: 0.05, max: 10, step: 0.05 } },
    desc: "Subtle handheld drift.",
  },
};

export const BEH_NAMES = Object.keys(CATALOG);

export function behSpec(use: string): BehSpec | undefined {
  return CATALOG[use];
}

/** Returns the closest catalog names for an unknown behavior, for validator hints. */
export function suggestBeh(use: string): string[] {
  const u = use.toLowerCase();
  return BEH_NAMES.map((n) => ({ n, d: editDistance(u, n.toLowerCase()) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 3)
    .map((x) => x.n);
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

/** Channels a layer can key (numbers). Type-specific ones listed per type. */
export const COMMON_CHANNELS = ["pos.x", "pos.y", "pos.z", "rot.x", "rot.y", "rot.z", "scale", "opacity", "blur"];
export const TYPE_CHANNELS: Partial<Record<LayerType, string[]>> = {
  text: ["size", "tracking", "value"],
  shape: ["w", "h", "radius", "shadow.opacity", "shadow.blur", "glass.blur", "glass.amount"],
  image: ["w", "radius", "shadow.opacity", "shadow.blur"],
  html: ["w", "h", "radius", "shadow.opacity", "shadow.blur", "glass.blur", "glass.amount"],
  path: ["trimStart", "trimEnd", "width", "glow"],
  device: ["w", "shadow.opacity"],
  mesh: ["size"],
  cloner: ["r", "spin", "gap"],
  camera: ["fov"],
  group: ["clip.w", "clip.h", "clip.radius"],
  gradient: ["angle", "noise"],
  sky: ["clouds", "drift", "sun", "hillHeight", "stars"],
  adjust: ["blur", "exposure", "contrast", "saturation", "fade"],
};
/** Types that are backgrounds or pure effects: no transform channels. */
const NO_TRANSFORM: LayerType[] = ["gradient", "sky", "adjust"];
export function channelsFor(type: LayerType): string[] {
  if (NO_TRANSFORM.includes(type)) return ["opacity", ...(TYPE_CHANNELS[type] ?? [])];
  return [...COMMON_CHANNELS, ...(TYPE_CHANNELS[type] ?? [])];
}
/** html layers also accept any vars.<name> channel. */
export function isChannelOf(type: LayerType, ch: string): boolean {
  if (type === "html" && /^vars\.[A-Za-z_]\w*$/.test(ch)) return true;
  return channelsFor(type).includes(ch);
}
