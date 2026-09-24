/**
 * The agent side of the recorded session. These are the ops "Claude" sends through the
 * bridge — the same thing an in-app provider or an MCP client will send later.
 */
type Op = Record<string, unknown>;

export const FIRST_PROMPT =
  "A 7-second launch promo for Orbit, my habit-tracking app. Deep navy, premium, the phone floating in 3D with habit dots orbiting it. Headline: “Build habits that stick.”";

export const FIRST_REPLY =
  "Here's a first cut: the phone rises on a spring and turns in 3D, two rings of habit dots orbit it at different depths, the logo pops in, then the headline types up and a lime streak pill lands. The camera pushes in over the whole shot. Vibe sliders are wired to the bounce, pacing and orbit tilt.";

export const FIRST_OPS: Op[] = [
  { op: "set", path: "name", value: "Orbit launch" },
  { op: "set", path: "comp/dur", value: 7 },
  { op: "set", path: "brand/colors", value: { accent: "#6ea8ff", ink: "#f4f6ff", paper: "#060a18", glow: "#1a2a70", lime: "#c6ff4a", coral: "#ff7a59" } },
  { op: "set", path: "comp/bg", value: "$paper" },
  { op: "set", path: "bg", value: { type: "gradient", kind: "radial", colors: ["$glow", "$paper"], noise: 0.05 } },
  { op: "set", path: "shot/beh/push", value: { use: "dolly", at: 0, dur: 7, to: 1480, ease: "inOut" } },
  {
    op: "add", id: "dots", after: "bg",
    layer: { type: "cloner", mode: "radial", n: 28, r: 540, pos: [-430, 0, -40], rot: [70, 0, -14], depth: true, in: 1.1, child: { kind: "shape", shape: "ellipse", w: 9, colors: ["$ink", "$accent"] }, reveal: { dur: 0.4 }, fx: [{ id: "lag", type: "delay", step: 0.02 }], keys: { spin: [[0, 0], [5.9, -70]] } },
  },
  {
    op: "add", id: "ring", after: "dots",
    layer: { type: "cloner", mode: "radial", n: 8, r: 360, pos: [-430, 0, 0], rot: [70, 0, -14], depth: true, in: 0.8, child: { kind: "shape", shape: "ellipse", w: 50, colors: ["$accent", "$lime", "$coral", "$ink"] }, reveal: { dur: 0.7, bounce: 0.5 }, fx: [{ id: "lag", type: "delay", step: 0.07 }, { id: "drift", type: "noise", amp: [8, 8, 24], freq: 0.35 }], keys: { spin: [[0, 0], [6.2, 150]] } },
  },
  {
    op: "add", id: "phone", after: "ring",
    layer: {
      type: "device", model: "iphone", w: 360, screen: "orbit-app", pos: [-430, -6, 0], depth: true, in: 0.15,
      beh: [{ id: "rise", use: "rise", at: 0, dur: 1.2, dist: 300, bounce: 0.35 }, { id: "bob", use: "float", at: 1.3, amp: 10, period: 3.4 }],
      keys: { "rot.y": [[0.1, -34], [2.7, 16, "inOut"], [6.8, -9, "inOut"]], "rot.x": [[0, 10], [2.4, 0, "inOut"]] },
    },
  },
  { op: "add", id: "logo", after: "phone", layer: { type: "image", src: "orbit-logo", w: 74, radius: 18, pos: [146, 268, 0], in: 1.3, beh: [{ id: "pop", use: "popIn", at: 0, dur: 0.7, bounce: 0.55 }] } },
  { op: "add", id: "wordmark", after: "logo", layer: { type: "text", text: "Orbit", size: 46, weight: 700, color: "$ink", align: "left", pos: [200, 268, 0], in: 1.45, beh: [{ id: "in", use: "rise", at: 0, dur: 0.7, dist: 24, bounce: 0.2 }] } },
  { op: "add", id: "title", after: "wordmark", layer: { type: "text", text: "Build habits\nthat stick.", size: 116, weight: 750, color: "$ink", align: "left", tracking: -3, pos: [110, 70, 0], in: 1.7, beh: [{ id: "type", use: "typeUp", at: 0, dur: 0.6, stagger: 0.03, dist: 54 }] } },
  { op: "add", id: "sub", after: "title", layer: { type: "text", text: "Tiny daily wins, tracked beautifully.", size: 36, weight: 450, color: "$accent", align: "left", pos: [114, -118, 0], in: 2.9, beh: [{ id: "in", use: "rise", at: 0, dur: 0.8, dist: 30, bounce: 0.2 }] } },
  { op: "add", id: "pill", after: "sub", layer: { type: "shape", shape: "rect", w: 290, h: 70, radius: 35, fill: "$lime", pos: [259, -238, 0], in: 3.6, beh: [{ id: "pop", use: "popIn", at: 0, dur: 0.8, bounce: 0.55 }, { id: "beat", use: "pulse", at: 1, amp: 0.025, period: 1.5 }] } },
  { op: "add", id: "pill-label", after: "pill", layer: { type: "text", text: "12-day streak", size: 29, weight: 700, color: "$paper", parent: "pill", in: 3.75, beh: [{ id: "in", use: "fadeIn", at: 0, dur: 0.4 }] } },
  {
    op: "set", path: "bindings", value: [
      { from: "style.bounce", path: "phone/beh/rise/bounce", lo: 0.05, hi: 0.7 },
      { from: "style.bounce", path: "pill/beh/pop/bounce", lo: 0.1, hi: 0.8 },
      { from: "style.energy", path: "title/beh/type/stagger", lo: 0.07, hi: 0.015 },
      { from: "style.energy", path: "phone/beh/rise/dur", lo: 1.8, hi: 0.7 },
      { from: "style.depth", path: "ring/rot/x", lo: 30, hi: 82 },
      { from: "style.depth", path: "dots/rot/x", lo: 30, hi: 82 },
    ],
  },
  { op: "set", path: "style", value: { energy: 0.5, bounce: 0.5, depth: 0.73, speed: 0.5 } },
];

export const FIRST_CHIPS = [
  {
    label: "Add a sparkle burst",
    ops: [{ op: "add", id: "burst", after: "pill-label", layer: { type: "cloner", mode: "radial", n: 14, r: 190, pos: [259, -238, 0], in: 3.7, out: 4.9, orient: true, child: { kind: "shape", shape: "rect", w: 6, h: 22, radius: 3, colors: ["$lime", "$ink"] }, reveal: { dur: 0.5, bounce: 0.3 }, fx: [{ id: "lag", type: "delay", step: 0.015 }], beh: [{ id: "out", use: "fadeOut", at: 0.7, dur: 0.5 }], keys: { r: [[0, 150], [1.2, 250, "out"]] } } }],
  },
  { label: "Make a 9:16 cut", prompt: "Make a vertical 9:16 version for Stories" },
];

export const SCOPED_PROMPT = "Make the headline land word by word with a bounce";
export const SCOPED_OPS: Op[] = [{ op: "set", path: "title/beh/type", value: { use: "bounceIn", at: 0, dur: 0.75, stagger: 0.11, bounce: 0.6 } }];
export const SCOPED_REPLY = "Swapped the typing for a word-by-word spring. Only the headline was sent to me, so this cost a few dozen tokens.";

export const ORBIT_PROMPT = "Add a slow camera orbit around the phone";
export const ORBIT_OPS: Op[] = [{ op: "set", path: "shot/beh/push", value: { use: "orbit", at: 0, dur: 7, deg: 14, ease: "inOut" } }];
export const ORBIT_REPLY = "Replaced the push-in with a 14° orbit.";

export const PUSH_PROMPT = "Actually keep the push-in, just go a bit closer at the end";
export const PUSH_OPS: Op[] = [{ op: "set", path: "shot/beh/push/to", value: 1360 }];
export const PUSH_REPLY = "Push-in now ends at z = 1360 — about 26% closer than the fitted frame.";
