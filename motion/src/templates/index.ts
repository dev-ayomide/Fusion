import type { Doc } from "../fmd/schema";

export interface Template {
  id: string;
  title: string;
  blurb: string;
  make: () => Doc;
}

const base = (name: string, colors: Record<string, string>, dur = 6): Doc => ({
  v: 1,
  name,
  comp: { w: 1920, h: 1080, fps: 30, dur, bg: "$paper", cam: "shot" },
  brand: { font: "Inter Variable", colors },
  assets: {},
  markers: [],
  style: { energy: 0.5, bounce: 0.5, depth: 0.5, speed: 0.5 },
  bindings: [], scenes: [], audio: [],
  layers: [],
});

/** Product launch: a phone rising on a spring, a ring of chips orbiting it in 3D, headline typing in. */
export function launchTemplate(): Doc {
  const d = base("Product launch", { accent: "#7c6cff", ink: "#f5f5fa", paper: "#0d0e14", glow: "#2a1f6b", mint: "#5ee6b5" });
  d.layers = [
    { id: "bg", type: "gradient", kind: "radial", colors: ["$glow", "$paper"], noise: 0.06 },
    { id: "shot", type: "camera", fov: 35, pos: [0, 0, 1713], beh: [{ id: "push", use: "dolly", at: 0, dur: 6, to: 1560, ease: "inOut" }] },
    {
      id: "ring", type: "cloner", mode: "radial", n: 10, r: 360, in: 0.8, pos: [-420, 0, 0], rot: [68, 0, 0], depth: true, billboard: true,
      child: { kind: "shape", shape: "ellipse", w: 52, colors: ["$accent", "$mint", "$ink"] },
      reveal: { dur: 0.7, bounce: 0.5 }, fx: [{ id: "lag", type: "delay", step: 0.05 }, { id: "drift", type: "noise", amp: [10, 10, 30], freq: 0.4 }],
      keys: { spin: [[0, 0], [5.2, 120]] },
    },
    {
      id: "phone", type: "device", model: "iphone", w: 360, pos: [-420, 0, 0], in: 0.2, depth: true,
      beh: [{ id: "rise", use: "rise", at: 0, dur: 1.1, bounce: 0.35, dist: 260 }, { id: "bob", use: "float", at: 1.2, amp: 10, period: 3.2 }],
      keys: { "rot.y": [[0.3, -28], [2.6, 14, "inOut"], [5.8, -8, "inOut"]] },
    },
    {
      id: "title", type: "text", text: "Money,\nmade calm.", size: 118, weight: 700, color: "$ink", align: "left", pos: [100, 90, 0], in: 1.4, tracking: -2,
      beh: [{ id: "type", use: "typeUp", at: 0, stagger: 0.035, dist: 50, dur: 0.6 }],
    },
    {
      id: "sub", type: "text", text: "Budgeting that finally feels calm.", size: 36, weight: 450, color: "$accent", align: "left", pos: [104, -110, 0], in: 2.6,
      beh: [{ id: "in", use: "rise", at: 0, dur: 0.8, dist: 30, bounce: 0.2 }],
    },
    {
      id: "cta", type: "shape", shape: "rect", w: 300, h: 76, radius: 38, fill: "$accent", pos: [250, -240, 0], in: 3.2,
      beh: [{ id: "pop", use: "popIn", at: 0, dur: 0.7, bounce: 0.55 }, { id: "beat", use: "pulse", at: 1, amp: 0.03, period: 1.4 }],
    },
    {
      id: "cta-label", type: "text", text: "Get Ledger", size: 32, weight: 650, color: "$ink", parent: "cta", pos: [0, 0, 0], in: 3.35,
      beh: [{ id: "in", use: "fadeIn", at: 0, dur: 0.4 }],
    },
  ];
  d.bindings = [
    { from: "style.bounce", path: "phone/beh/rise/bounce", lo: 0, hi: 0.7 },
    { from: "style.bounce", path: "cta/beh/pop/bounce", lo: 0.1, hi: 0.8 },
    { from: "style.energy", path: "title/beh/type/stagger", lo: 0.07, hi: 0.015 },
    { from: "style.energy", path: "phone/beh/rise/dur", lo: 1.6, hi: 0.7 },
    { from: "style.depth", path: "ring/rot/x", lo: 20, hi: 78 },
  ];
  return d;
}

/** Kinetic type: words cascading and bouncing over colour blocks. */
export function kineticTemplate(): Doc {
  const d = base("Kinetic type", { accent: "#ff5a36", ink: "#101014", paper: "#f3efe6", sun: "#ffc23d", sky: "#3d7bff" }, 5);
  d.layers = [
    { id: "bg", type: "gradient", kind: "linear", angle: 120, colors: ["$paper", "#e6dfd0"], noise: 0.05 },
    { id: "shot", type: "camera", fov: 35, beh: [{ id: "drift", use: "shake", at: 0, amp: 5, freq: 0.3 }] },
    { id: "block-a", type: "shape", shape: "rect", w: 560, h: 560, radius: 60, fill: "$sun", pos: [-520, 120, -80], rot: [0, 0, -8], beh: [{ id: "in", use: "spinIn", at: 0, dur: 1, deg: -40 }, { id: "wob", use: "wiggle", at: 1, amp: 6, freq: 0.4, deg: 1.5 }] },
    { id: "block-b", type: "shape", shape: "ellipse", w: 380, h: 380, fill: "$sky", pos: [600, -210, -40], in: 0.25, beh: [{ id: "in", use: "popIn", at: 0, dur: 0.8, bounce: 0.6 }, { id: "bob", use: "float", at: 0.8, amp: 16, period: 2.4 }] },
    { id: "line1", type: "text", text: "MOTION", size: 220, weight: 800, font: "Bricolage Grotesque Variable", color: "$ink", pos: [0, 120, 0], in: 0.5, tracking: -6, beh: [{ id: "in", use: "cascade", at: 0, stagger: 0.05, dist: 140 }] },
    { id: "line2", type: "text", text: "that talks back.", size: 110, weight: 500, font: "Instrument Serif", color: "$accent", pos: [0, -70, 0], in: 1.3, beh: [{ id: "in", use: "bounceIn", at: 0, stagger: 0.12 }] },
    { id: "dots", type: "cloner", mode: "linear", n: 7, gap: 46, pos: [0, -260, 0], in: 2.1, child: { kind: "shape", shape: "ellipse", w: 18, fill: "$ink" }, reveal: { dur: 0.5, bounce: 0.5 }, fx: [{ id: "lag", type: "delay", step: 0.06 }, { id: "wave", type: "wave", amp: [0, 14, 0], freq: 0.8, phase: 0.6 }] },
  ];
  d.bindings = [{ from: "style.energy", path: "line1/beh/in/stagger", lo: 0.09, hi: 0.025 }, { from: "style.bounce", path: "block-b/beh/in/bounce", lo: 0.1, hi: 0.8 }];
  return d;
}

/** Logo reveal: shapes converge, a mark spins in, the wordmark resolves. */
export function logoTemplate(): Doc {
  const d = base("Logo reveal", { accent: "#22d3a6", ink: "#ffffff", paper: "#07110f", deep: "#0f3b33" }, 5);
  d.layers = [
    { id: "bg", type: "gradient", kind: "radial", colors: ["$deep", "$paper"], noise: 0.08 },
    { id: "shot", type: "camera", fov: 35, beh: [{ id: "push", use: "dolly", at: 0, dur: 5, to: 1500, ease: "out" }] },
    { id: "halo", type: "cloner", mode: "radial", n: 24, r: 260, orient: true, pos: [0, 60, 0], child: { kind: "shape", shape: "rect", w: 10, h: 44, radius: 5, fill: "$accent" }, reveal: { dur: 0.5, bounce: 0.3 }, fx: [{ id: "lag", type: "delay", step: 0.025 }], keys: { spin: [[0, 0], [5, 60]] }, beh: [{ id: "breathe", use: "pulse", at: 1.2, amp: 0.04, period: 1.6 }] },
    { id: "mark", type: "shape", shape: "rect", w: 190, h: 190, radius: 48, fill: "$accent", pos: [0, 60, 0], rot: [0, 0, 45], in: 0.4, beh: [{ id: "in", use: "spinIn", at: 0, dur: 1.1, deg: -180, bounce: 0.3 }] },
    { id: "core", type: "shape", shape: "ellipse", w: 80, h: 80, fill: "$paper", parent: "mark", in: 0.9, beh: [{ id: "in", use: "popIn", at: 0, dur: 0.6, bounce: 0.5 }] },
    { id: "word", type: "text", text: "verdant", size: 120, weight: 700, color: "$ink", pos: [0, -250, 0], in: 1.5, tracking: 4, anim: [{ id: "reveal", sel: { by: "char", shape: "smooth", start: 0, end: 0.3, offset: [[0, -0.3], [1.1, 1]] }, add: { pos: [0, -40, 0], opacity: -1 } }] },
  ];
  return d;
}

export function blankTemplate(): Doc {
  const d = base("Untitled", { accent: "#7c6cff", ink: "#f5f5fa", paper: "#101116" }, 5);
  d.layers = [
    { id: "bg", type: "gradient", kind: "linear", angle: 90, colors: ["$paper", "#08080b"] },
    { id: "shot", type: "camera", fov: 35 },
  ];
  return d;
}

export const TEMPLATES: Template[] = [
  { id: "launch", title: "Product launch", blurb: "Phone on a spring, orbiting chips, headline types in", make: launchTemplate },
  { id: "kinetic", title: "Kinetic type", blurb: "Big words cascade over colour blocks", make: kineticTemplate },
  { id: "logo", title: "Logo reveal", blurb: "Mark spins in, halo breathes, wordmark resolves", make: logoTemplate },
  { id: "blank", title: "Blank canvas", blurb: "Background and camera, nothing else", make: blankTemplate },
];
