// Showcase reels for demos and pitches. Each reel is plain FMD JSON; this script only saves typing.
//   node fixtures/showcase/build.mjs            → fixtures/showcase/*.fmd.json
// Render: bench/render-mp4.sh /fixtures/showcase/<name>.fmd.json out/<name>.mp4
import fs from "node:fs";
const out = (name, doc) => fs.writeFileSync(new URL(`./${name}.fmd.json`, import.meta.url), JSON.stringify(doc, null, 1));

const MONO = "JetBrains Mono Variable", SERIF = "Instrument Serif", TIGHT = "Inter Tight Variable";
const EXPO = "cubic(0.16,1,0.3,1)"; // the "snappy" premium ease-out
// A full-bleed colour plate behind a shot (sits back in z so camera shake never shows an edge).
const plate = (id, fill, t0, t1, extra = {}) => ({ id, type: "shape", shape: "rect", w: 2900, h: 1650, fill, pos: [0, 0, -400], in: t0, out: t1, motionBlur: false, ...extra });
// A word that slams in from big + blurred and keeps creeping toward camera until the cut.
const slam = (id, text, t0, t1, o = {}) => ({
  id, type: "text", text, size: o.size ?? 360, font: o.font ?? TIGHT, weight: o.weight ?? 800, color: o.color, tracking: o.tracking ?? -8,
  pos: o.pos ?? [0, 0, 0], in: t0, out: t1, spans: o.spans,
  keys: {
    scale: [[0, o.from ?? 2.8], [0.2, 1, EXPO], [t1 - t0, o.creep ?? 1.07]],
    blur: [[0, 40], [0.16, 0, "out"]],
    opacity: [[0, 0], [0.05, 1]],
    ...(o.rot ? { "rot.z": [[0, o.rot], [0.24, 0, EXPO]] } : {}),
    ...o.keys,
  },
  beh: o.beh, anim: o.anim,
});

/* ============================== 01 — "Type a sentence. Get cinema." ============================== */
{
  const T = { spark: 0, type: 2.4, hero: 5.6, product: 10.0, finale: 14.35, end: 18.6 };
  const d = {
    v: 1, name: "Showcase 01 — Type a sentence. Get cinema.",
    comp: {
      w: 1920, h: 1080, fps: 30, dur: T.end, bg: "$void", cam: "shot", env: "city",
      motionBlur: { angle: 220, samples: 8 },
      post: { bloom: 0.8, bloomThreshold: 1.02, vignette: 0.25, grain: 0.05, contrast: 0.06 },
    },
    brand: { font: "Inter Variable", colors: {
      void: "#050507", ink: "#f5f3ee", lime: "#d4ff3a", hot: "#ff3d1f", violet: "#5b3bff", paper: "#eeebe3", graphite: "#16161a", olive: "#27330b", muted: "#8a877f",
    } },
    assets: {}, markers: [
      { id: "m1", t: T.type, label: "Kinetic type" }, { id: "m2", t: T.hero, label: "3D hero" },
      { id: "m3", t: T.product, label: "Prompt → ops → motion" }, { id: "m4", t: T.finale, label: "Logo" },
    ],
    style: { energy: 0.9, bounce: 0.5, depth: 0.8, speed: 0.6 }, bindings: [], layers: [],
  };
  const L = (...ls) => d.layers.push(...ls);

  // ---------- camera: one continuous camera, hard "hold" jumps on the cuts
  L({ id: "shot", type: "camera", fov: 35, pos: [0, 0, 1713],
    keys: {
      "pos.z": [[0, 1900], [2.3, 1380, "expoIn"], [T.type, 1713, "hold"], [T.hero, 2150, "hold"], [T.product - 0.3, 1640, "easy"],
        [T.product, 1713, "hold"], [T.finale, 1950, "hold"], [T.end, 1620, "easy"]],
      "rot.z": [[0, 0], [T.hero, -3, "hold"], [T.product - 0.3, 2, "easy"], [T.product, 0, "hold"]],
      "pos.y": [[0, 0], [T.finale, 60, "hold"], [T.end, 0, "easy"]],
    },
    beh: [
      { id: "drift", use: "shake", at: 0, dur: T.type, amp: 6, freq: 0.5 },
      { id: "punch", use: "shake", at: T.type, dur: T.hero - T.type, amp: 16, freq: 2.6 },
      { id: "float", use: "shake", at: T.hero, dur: T.end - T.hero, amp: 8, freq: 0.4 },
    ] });

  /* ---------- 1. SPARK (0 → 2.4): a single point of light winds up, a prompt types, the light swallows the frame */
  L(
    { id: "s1-glow", type: "gradient", kind: "radial", colors: ["#141a06", "$void"], noise: 0.06, out: T.type },
    { id: "s1-halo", type: "cloner", name: "Tick halo", mode: "radial", n: 72, r: 150, orient: true, out: T.type, pos: [0, 40, 0],
      child: { kind: "shape", shape: "rect", w: 4, h: 26, radius: 2, fill: "$lime" },
      reveal: { dur: 0.5, bounce: 0.2, at: 0.15 }, fx: [{ id: "lag", type: "delay", step: 0.008 }],
      keys: { r: [[0, 120], [1.8, 230, "easy"], [2.25, 60, "expoIn"]], spin: [[0, 0], [2.3, 200, "expoIn"]], opacity: [[0, 0.9], [2.0, 0.9], [2.25, 0]] } },
    { id: "s1-ring", type: "cloner", name: "Outer dots", mode: "radial", n: 24, r: 330, out: T.type, pos: [0, 40, 0],
      child: { kind: "shape", shape: "ellipse", w: 7, fill: "$ink" },
      reveal: { dur: 0.6, bounce: 0.4, at: 0.4 }, fx: [{ id: "lag", type: "delay", step: 0.02 }],
      keys: { spin: [[0, 0], [2.3, -140, "expoIn"]], r: [[0, 330], [2.25, 40, "expoIn"]], opacity: [[1.9, 0.8], [2.25, 0]] } },
    { id: "s1-core", type: "mesh", name: "Spark", geom: "sphere", material: "emissive", color: "$lime", size: 60, pos: [0, 40, 0], out: T.type,
      keys: { size: [[0, 1], [0.35, 70, EXPO], [1.7, 90, "easy"], [2.38, 5200, "expoIn"]] },
      beh: [{ id: "beat", use: "pulse", at: 0.4, dur: 1.6, amp: 0.18, period: 0.4 }] },
    { id: "s1-prompt", type: "text", name: "Prompt", text: "> make it unforgettable_", size: 34, font: MONO, weight: 500, color: "$ink", pos: [0, -230, 0], out: 2.15,
      spans: [{ text: ">", color: "$lime" }, { text: "unforgettable", color: "$lime" }],
      beh: [{ id: "type", use: "typewriter", at: 0.45, by: "char", stagger: 0.045 }], keys: { opacity: [[1.85, 1], [2.1, 0]], blur: [[1.85, 0], [2.1, 14]] } },
  );

  /* ---------- 2. KINETIC TYPE (2.4 → 5.6): five words, five plates, cut on the beat */
  const b = [T.type, 2.85, 3.3, 3.98, 4.45, T.hero];
  L(
    plate("s2-p1", "$lime", b[0], b[1]), plate("s2-p2", "$void", b[1], b[2]), plate("s2-p3", "$graphite", b[2], b[3]),
    plate("s2-p4", "$hot", b[3], b[4]), plate("s2-p5", "$violet", b[4], b[5]),
    slam("s2-w1", "TYPE", b[0], b[1], { color: "$void", size: 430, rot: -10 }),
    slam("s2-w2", "ONE", b[1], b[2], { color: "$lime", size: 460, from: 0.4, keys: { "pos.y": [[0, -120], [0.22, 0, EXPO]] } }),
    { id: "s2-w3", type: "text", text: "sentence.", size: 330, font: SERIF, weight: 400, color: "$ink", in: b[2], out: b[3],
      keys: { tracking: [[0, 60], [0.5, -6, EXPO], [b[3] - b[2], -10]], blur: [[0, 30], [0.25, 0, "out"]], scale: [[0, 1.25], [0.5, 1, EXPO], [b[3] - b[2], 1.05]] },
      beh: [{ id: "in", use: "typeUp", at: 0, by: "char", stagger: 0.025, dist: 80 }] },
    slam("s2-w4", "GET", b[3], b[4], { color: "$void", size: 470, rot: 8, from: 3.4 }),
    { id: "s2-w5", type: "text", text: "CINEMA.", size: 360, font: TIGHT, weight: 900, color: "$ink", in: b[4], out: b[5],
      keys: { tracking: [[0.25, -12], [b[5] - b[4], 6, "easyIn"]], scale: [[0, 1], [b[5] - b[4], 1.07, "easyIn"]] },
      beh: [{ id: "in", use: "bounceIn", at: 0, by: "char", stagger: 0.035, bounce: 0.55, dur: 0.55 }] },
    // a lime underline that whips across the last word
    { id: "s2-bar", type: "shape", shape: "rect", w: 1500, h: 26, radius: 13, fill: "$lime", pos: [0, -230, 10], in: b[4] + 0.25, out: b[5],
      keys: { "scale": [[0, 0.02], [0.35, 1, EXPO]], "pos.x": [[0, -700], [0.35, 0, EXPO]] } },
    { id: "s2-flash", type: "adjust", name: "Cloud dissolve", in: b[5] - 0.3, out: b[5] + 0.05, fadeColor: "$void", dissolve: 0.7, keys: { fade: [[0, 0], [0.3, 1, "in"]] } },
  );
  // white-out that bridges the spark into the first plate
  L({ id: "s1-flash", type: "adjust", name: "White-out", in: 2.2, out: 2.75, fadeColor: "$ink", keys: { fade: [[0, 0], [0.18, 1, "in"], [0.55, 0, "out"]] } });

  /* ---------- 3. 3D HERO (5.6 → 10.0): chrome, gold and glass orbiting a torus, a ring of light */
  const H = T.hero, HD = T.product - T.hero;
  L(
    { id: "s3-bg", type: "gradient", kind: "radial", colors: ["#1b1446", "#07060f", "$void"], noise: 0.06, in: H, out: T.product + 0.4 },
    { id: "s3-ring", type: "cloner", name: "Light ring", mode: "radial", n: 90, r: 760, in: H, out: T.product + 0.4, rot: [72, 0, 0], depth: true, billboard: true,
      child: { kind: "shape", shape: "ellipse", w: 12, fill: "$lime" }, reveal: { dur: 0.5, at: 0.2 }, fx: [{ id: "lag", type: "delay", step: 0.006 }, { id: "ripple", type: "wave", amp: [0, 0, 40], freq: 0.7, phase: 0.3 }],
      keys: { spin: [[0, 0], [HD + 0.4, 120]], r: [[0, 200], [0.9, 760, EXPO]] } },
    { id: "s3-torus", type: "mesh", name: "Chrome torus", geom: "torus", material: "chrome", color: "#dfe3ea", size: 560, in: H, out: T.product + 0.4, depth: true, pos: [0, 30, 0],
      keys: { "rot.x": [[0, 70], [HD, -30]], "rot.y": [[0, -90], [HD, 250]], scale: [[0, 0], [0.9, 1, "spring(0.9,0.45)"]] },
      beh: [{ id: "bob", use: "float", at: 0.9, amp: 18, period: 2.4 }] },
    { id: "s3-rig", type: "group", name: "Orbit rig", in: H, out: T.product + 0.4, rot: [14, 0, 0], pos: [0, 30, 0], keys: { "rot.y": [[0, 0], [HD + 0.4, 300]] } },
    { id: "s3-gold", type: "mesh", geom: "coin", material: "gold", color: "#ffc44d", size: 230, parent: "s3-rig", in: H, pos: [560, 0, 0], depth: true,
      keys: { "rot.y": [[0, 0], [HD, 720]], scale: [[0.3, 0], [1.0, 1, "spring(0.7,0.5)"]] } },
    { id: "s3-glass", type: "mesh", geom: "sphere", material: "metal", color: "#8b6bff", roughness: 0.18, size: 250, parent: "s3-rig", in: H, pos: [-560, 0, 0], depth: true,
      keys: { scale: [[0.45, 0], [1.1, 1, "spring(0.7,0.5)"]] } },
    { id: "s3-foil", type: "mesh", geom: "capsule", material: "foil", color: "$hot", size: 170, parent: "s3-rig", in: H, pos: [0, 0, 560], depth: true,
      keys: { "rot.z": [[0, 0], [HD, 540]], scale: [[0.6, 0], [1.2, 1, "spring(0.7,0.5)"]] } },
    { id: "s3-lime", type: "mesh", geom: "box", material: "plastic", color: "$lime", size: 150, parent: "s3-rig", in: H, pos: [0, 0, -560], depth: true,
      keys: { "rot.x": [[0, 0], [HD, 400]], "rot.y": [[0, 0], [HD, 300]], scale: [[0.75, 0], [1.3, 1, "spring(0.7,0.5)"]] } },
    { id: "s3-title", type: "text", text: "Real 3D.", size: 150, font: SERIF, color: "$ink", align: "left", pos: [-820, -290, 0], in: H + 1.1, out: T.product,
      beh: [{ id: "in", use: "typeUp", at: 0, by: "char", stagger: 0.04, dist: 60 }], keys: { blur: [[0, 16], [0.4, 0, "out"]] } },
    { id: "s3-sub", type: "text", text: "chrome · metal · gold   —   lit by HDRI, rendered live in the browser", size: 26, font: MONO, weight: 500, color: "$muted", align: "left", pos: [-815, -385, 0], in: H + 1.6, out: T.product,
      spans: [{ text: "chrome · metal · gold", color: "$lime" }], beh: [{ id: "in", use: "typewriter", at: 0, stagger: 0.018 }] },
    // the torus rushes the lens → iris into the product shot
  );
  d.layers.find((l) => l.id === "s3-torus").keys["pos.z"] = [[HD - 0.5, 0], [HD + 0.35, 1500, "expoIn"]];

  /* ---------- 4. PROMPT → OPS → MOTION (10.0 → 14.35): the product story in one shot */
  const P = T.product;
  L(
    { id: "s4-iris", type: "group", name: "Iris", in: P - 0.25, out: T.finale, clip: { w: 10, h: 10, radius: 5 },
      keys: { "clip.w": [[0, 10], [0.5, 2400, "expoIn"]], "clip.h": [[0, 10], [0.5, 2400, "expoIn"]], "clip.radius": [[0, 5], [0.4, 1200], [0.5, 0]] } },
    { id: "s4-paper", type: "shape", shape: "rect", parent: "s4-iris", in: P - 0.25, w: 2600, h: 1500, fill: "$paper", pos: [0, 0, -50], motionBlur: false },
    { id: "s4-grid", type: "cloner", mode: "grid", parent: "s4-iris", in: P - 0.25, n: 24 * 14, cols: 24, gap: 90, pos: [0, 0, -40], motionBlur: false,
      child: { kind: "shape", shape: "ellipse", w: 5, fill: "#cfcbc0" } },
  );
  // left: the assistant card and the ops it streams
  L(
    { id: "s4-card", type: "html", name: "Assistant card", w: 760, h: 250, radius: 30, pos: [-470, 170, 0], in: P + 0.1, out: T.finale,
      shadow: { x: 0, y: -30, blur: 70, color: "#000000", opacity: 0.16 },
      beh: [{ id: "in", use: "rise", at: 0, dur: 0.7, bounce: 0.3, dist: 80 }],
      html: "<div style='width:760px;height:250px;background:#fff;border-radius:30px;padding:30px 36px;box-sizing:border-box;font-family:Inter Variable;color:#16161a'>"
        + "<div style='display:flex;align-items:center;gap:12px;font-size:20px;color:#8a877f;font-weight:600'><div style='width:28px;height:28px;border-radius:14px;background:#d4ff3a;box-shadow:0 0 0 6px #f1ffc4'></div>Fusion · Director</div>"
        + "<div style='margin-top:26px;height:2px;background:#eeebe3'></div>"
        + "<div style='position:absolute;right:36px;bottom:30px;font:600 18px Inter Variable;color:#fff;background:#16161a;padding:12px 20px;border-radius:14px'>Generate ↵</div></div>" },
    { id: "s4-ask", type: "text", text: "Make our launch feel like\na movie trailer.", size: 40, weight: 600, color: "$graphite", align: "left", lineHeight: 1.18, pos: [-815, 150, 5], in: P + 0.45, out: T.finale, tracking: -1,
      spans: [{ text: "movie trailer.", font: SERIF, weight: 400, size: 46 }],
      beh: [{ id: "type", use: "typewriter", at: 0, stagger: 0.028 }] },
    { id: "s4-ops", type: "text", name: "Ops stream", align: "left", size: 25, font: MONO, weight: 500, color: "$graphite", lineHeight: 1.75, pos: [-850, -170, 0], in: P + 1.85, out: T.finale,
      text: [["+ add", "mesh", "hero", "chrome"], ["~ key", "hero/rot.y", "", "spring(.9,.45)"], ["+ add", "path", "growth", "trim 0 → 1"], ["~ key", "arr/value", "", "0 → 2.4M"], ["~ set", "comp/post", "bloom", "0.9"]]
        .map(([o, a, b, c]) => `${o}  ${(a + " " + b).trim().padEnd(18)}${c}`).join("\n"),
      spans: [{ text: "+ add", all: true, color: "#4b7a00", weight: 700 }, { text: "~ key", all: true, color: "#c22e14", weight: 700 }, { text: "~ set", all: true, color: "#4a31d6", weight: 700 }],
      beh: [{ id: "in", use: "typeUp", at: 0, by: "line", stagger: 0.32, dist: 24, dur: 0.4 }] },
    { id: "s4-label", type: "text", text: "5 ops · 212 tokens · 1 undo", size: 20, font: MONO, weight: 600, color: "$muted", align: "left", pos: [-850, -420, 0], in: P + 3.5, out: T.finale,
      beh: [{ id: "in", use: "fadeIn", at: 0, dur: 0.4 }] },
  );
  // right: the stage the ops build, each element landing on its op line
  const S = P + 1.7;
  L(
    { id: "s4-stage", type: "group", name: "Stage", pos: [470, 0, 0], in: S, out: T.finale, clip: { w: 840, h: 700, radius: 40 },
      keys: { "clip.h": [[0, 0], [0.55, 700, EXPO]], "clip.w": [[0, 600], [0.55, 840, EXPO]] } },
    { id: "s4-stage-fill", type: "shape", shape: "rect", w: 900, h: 760, fill: "#0c0a1a", parent: "s4-stage", in: S, pos: [0, 0, -20], motionBlur: false },
    { id: "s4-hero", type: "mesh", geom: "sphere", material: "chrome", size: 210, parent: "s4-stage", in: S + 0.2, pos: [-230, 140, 120], depth: true,
      keys: { "pos.y": [[0, 600], [0.7, 140, "bounce"]], "rot.y": [[0, 0], [3, 360]] } },
    { id: "s4-torus", type: "mesh", geom: "ring", material: "gold", color: "#ffc44d", size: 150, parent: "s4-stage", in: S + 0.55, pos: [230, 170, 80], depth: true,
      keys: { "rot.x": [[0, 60], [2.6, 420]], "rot.y": [[0, 0], [2.6, 200]], scale: [[0, 0], [0.6, 1, "spring(0.6,0.55)"]] } },
    { id: "s4-chart", type: "path", parent: "s4-stage", in: S + 0.85, pos: [0, -150, 60], stroke: "$lime", width: 8, glow: 0.9, smooth: true, fillTo: -300, fill: "$olive",
      points: [[-360, -110], [-270, -70], [-190, -95], [-100, -20], [-20, -45], [70, 30], [160, 10], [250, 90], [360, 150]],
      keys: { trimEnd: [[0, 0], [1.1, 1, "easy"]] } },
    { id: "s4-arr", type: "text", text: "${value}M", value: 0, format: { decimals: 1 }, size: 96, font: TIGHT, weight: 800, color: "$ink", align: "left", tracking: -3, parent: "s4-stage", in: S + 1.2, pos: [-360, -20, 90],
      keys: { value: [[0, 0], [1.3, 2.4, "expoOut"]] }, beh: [{ id: "in", use: "fadeIn", at: 0, dur: 0.3 }] },
    { id: "s4-arr-l", type: "text", text: "ARR  ▲ 312%", size: 22, font: MONO, weight: 600, color: "$lime", align: "left", parent: "s4-stage", in: S + 1.35, pos: [-356, -95, 90],
      beh: [{ id: "in", use: "typewriter", at: 0, stagger: 0.03 }] },
    { id: "s4-out", type: "adjust", name: "Dip", in: T.finale - 0.35, out: T.finale + 0.05, fadeColor: "$void", dissolve: 0.6, keys: { fade: [[0, 0], [0.35, 1, "in"]] } },
  );

  /* ---------- 5. FINALE (14.35 → 18.6): an undulating field of light and the lockup */
  const F = T.finale;
  L(
    { id: "s5-bg", type: "gradient", kind: "radial", colors: ["#1a1340", "#070611", "$void"], noise: 0.06, in: F },
    { id: "s5-field", type: "cloner", name: "Field", mode: "grid", n: 26 * 15, cols: 26, gap: 95, in: F, pos: [0, -470, -250], rot: [-74, 0, 0], depth: true, billboard: true,
      child: { kind: "shape", shape: "ellipse", w: 11, fill: "$lime" }, reveal: { dur: 0.5, at: 0 }, fx: [{ id: "lag", type: "delay", step: 0.004 }, { id: "swell", type: "wave", amp: [0, 0, 90], freq: 0.45, phase: 0.22 }] },
    { id: "s5-orb", type: "mesh", geom: "sphere", material: "emissive", color: "$lime", size: 34, in: F + 0.4, pos: [0, 190, 40],
      keys: { scale: [[0, 0], [0.5, 1, "spring(0.5,0.6)"]] }, beh: [{ id: "beat", use: "pulse", at: 0.5, amp: 0.2, period: 0.9 }] },
    { id: "s5-logo", type: "text", text: "Fusion Motion", size: 190, font: TIGHT, weight: 700, color: "$ink", tracking: -6, pos: [0, 40, 50], in: F + 0.5,
      spans: [{ text: "Motion", font: SERIF, weight: 400, color: "$lime", size: 210 }],
      beh: [{ id: "in", use: "cascade", at: 0, by: "char", stagger: 0.04, dist: 120 }], keys: { blur: [[0, 20], [0.6, 0, "out"]], scale: [[0, 1.08], [4, 1, "easy"]] } },
    { id: "s5-tag", type: "text", text: "Describe it. Watch it move.", size: 38, font: MONO, weight: 500, color: "$ink", pos: [0, -110, 50], in: F + 1.5,
      spans: [{ text: "Watch it move.", color: "$lime" }], beh: [{ id: "in", use: "typewriter", at: 0, stagger: 0.045 }] },
    { id: "s5-foot", type: "text", text: "evaluate(doc, t) → frame   ·   one JSON document   ·   rendered in the browser", size: 20, font: MONO, weight: 500, color: "$muted", pos: [0, 450, 50], in: F + 2.4,
      beh: [{ id: "in", use: "fadeIn", at: 0, dur: 0.6 }] },
    { id: "s5-end", type: "adjust", name: "Fade out", in: T.end - 0.45, fadeColor: "$void", keys: { fade: [[0, 0], [0.45, 1, "in"]] } },
  );
  // the score (bench/score.mjs s01), mastered into the music library by bench/music-library.mjs
  d.audio = [{ id: "score", src: "lib://music/showcase-s01", name: "Type a Sentence (score)", at: 0, offset: 0, volume: 1, fadeIn: 0, fadeOut: 0 }];
  out("s01-type-a-sentence", d);
}

/* ============================== 02 — SOLSTICE (festival promo, 120 BPM) ============================== */
// Every cut sits on the beat grid (1 beat = 0.5 s) so bench/score.mjs can score it frame-exactly.
export const S02 = { bpm: 120, night: 0, drop: 4, sun: 8, dawn: 12, finale: 16, end: 21 };
export const S02_LINEUP = ["AURORA KIDS", "NØRTH", "SUNDOG", "VANTA", "HALO/HALO", "ELSKA", "FJORD SYSTEM", "MIDNIGHT\nORCHESTRA"];
{
  const T = S02, BEAT = 0.5;
  const d = {
    v: 1, name: "Showcase 02 — SOLSTICE",
    comp: {
      w: 1920, h: 1080, fps: 30, dur: T.end, bg: "$void", cam: "cam", env: "sunset",
      motionBlur: { angle: 240, samples: 10 },
      post: { bloom: 0.9, bloomThreshold: 1.0, vignette: 0.28, grain: 0.05, contrast: 0.08, saturation: 0.06 },
    },
    brand: { font: "Inter Variable", colors: {
      void: "#07060a", sun: "#ff5a1f", amber: "#ffb000", magenta: "#ff2e88", cream: "#fff4e0", ice: "#9ad7ff", night: "#02030c", ember: "#3a0d05",
    } },
    assets: {}, bindings: [], style: { energy: 1, bounce: 0.5, depth: 0.8, speed: 0.7 },
    markers: [{ id: "drop", t: T.drop, label: "Drop" }, { id: "sun", t: T.sun, label: "Sun machine" }, { id: "dawn", t: T.dawn, label: "Dawn" }, { id: "fin", t: T.finale, label: "Finale" }],
    layers: [],
  };
  const L = (...ls) => d.layers.push(...ls);

  L({ id: "cam", type: "camera", fov: 35, pos: [0, 0, 1713],
    keys: {
      "pos.z": [[0, 1900], [T.drop, 1640, "easy"], [T.drop, 1713, "hold"], [T.sun, 2250, "hold"], [T.dawn, 1650, "easy"], [T.dawn, 1850, "hold"], [T.finale, 1560, "easy"], [T.finale, 1713, "hold"], [T.end, 1600, "easy"]],
      "pos.y": [[0, -120], [T.drop, 60, "easy"], [T.drop, 0, "hold"], [T.dawn, -60, "hold"], [T.finale, 40, "easy"], [T.finale, 0, "hold"]],
      "rot.z": [[0, 0], [T.sun, -4, "hold"], [T.dawn, 4, "easy"], [T.dawn, 0, "hold"]],
    },
    beh: [
      { id: "hand", use: "shake", at: 0, dur: T.drop, amp: 5, freq: 0.4 },
      { id: "drop", use: "shake", at: T.drop, dur: T.sun - T.drop, amp: 18, freq: 3 },
      { id: "sun", use: "shake", at: T.sun, dur: T.dawn - T.sun, amp: 10, freq: 1.2 },
      { id: "air", use: "shake", at: T.dawn, dur: T.end - T.dawn, amp: 6, freq: 0.5 },
    ] });

  /* ---- 1. NIGHT (0 → 4): arctic night, an aurora breathing, the promise */
  L(
    { id: "n-sky", type: "sky", top: "$night", horizon: "#1c2250", stars: 1, clouds: 0.12, cloudScale: 1.4, drift: 0.02, mountains: true, mountainHeight: 0.95, hills: "#04050c", hillHeight: 0.22, seed: 7, out: T.drop,
      keys: { sun: [[2.6, 0], [4, 0.35, "easyIn"]] } },
    ...[["#35ff9a", -520, 330, 1300, 0], ["#7a4bff", 380, 380, 1100, 1.3], ["#2fd7ff", 0, 280, 900, 2.1], ["$magenta", 700, 300, 700, 0.7]].map(([c, x, y, w, ph], i) => ({
      id: `n-aur${i}`, type: "shape", shape: "ellipse", w, h: 180, fill: c, pos: [x, y, -300], rot: [0, 0, i % 2 ? 8 : -6], blur: 110, opacity: 0.4, out: T.drop, motionBlur: false,
      keys: { "pos.x": [[0, x - 120], [T.drop, x + 140, "easy"]], opacity: [[0, 0], [1.2, 0.42, "easy"], [3.7, 0.5], [4, 0.9]] },
      beh: [{ id: "breathe", use: "pulse", at: ph, amp: 0.12, period: 2 + i * 0.4 }, { id: "float", use: "float", at: 0, amp: 30, period: 3 + i }] })),
    { id: "n-coord", type: "text", text: "69.6°N  ·  LOFOTEN  ·  00:00", size: 26, font: MONO, weight: 500, color: "$ice", tracking: 3, pos: [0, 330, 0], out: T.drop - 0.1,
      beh: [{ id: "in", use: "typewriter", at: 0.3, stagger: 0.03 }] },
    { id: "n-line", type: "text", text: "The sun never sets.", size: 150, font: SERIF, color: "$cream", pos: [0, 80, 0], out: T.drop,
      beh: [{ id: "in", use: "typeUp", at: 1.0, by: "word", stagger: 0.25, dist: 50, dur: 0.7 }],
      keys: { blur: [[1.0, 18], [1.8, 0, "out"], [3.4, 0], [4, 26, "in"]], scale: [[1, 1], [4, 1.12, "easyIn"]], tracking: [[3, 0], [4, 30, "easyIn"]] } },
    { id: "n-sub", type: "text", text: "not for seventy-two hours.", size: 34, font: MONO, weight: 500, color: "$amber", pos: [0, -40, 0], out: T.drop - 0.1,
      beh: [{ id: "in", use: "typewriter", at: 2.2, stagger: 0.035 }] },
    { id: "n-flash", type: "adjust", name: "Flash", in: T.drop - 0.12, out: T.drop + 0.35, fadeColor: "$cream", keys: { fade: [[0, 0], [0.12, 1, "in"], [0.47, 0, "out"]] } },
  );

  /* ---- 2. DROP (4 → 8): one artist per beat, eight plates, eight different entrances */
  const plates = ["$sun", "$void", "$magenta", "$cream", "$void", "$amber", "$ice", "$void"];
  const inks = ["$void", "$sun", "$cream", "$void", "$magenta", "$void", "$void", "$cream"];
  S02_LINEUP.forEach((name, i) => {
    const t0 = T.drop + i * BEAT, t1 = t0 + BEAT, id = `d${i}`;
    const longest = Math.max(...name.split("\n").map((s) => s.length));
    const size = Math.min(380, Math.round(1650 / (0.64 * longest)));
    const entr = [
      { scale: [[0, 2.6], [0.18, 1, EXPO], [BEAT, 1.06]], "rot.z": [[0, -9], [0.22, 0, EXPO]] },
      { "pos.x": [[0, -1400], [0.2, 0, EXPO], [BEAT, 40]] },
      { "pos.y": [[0, 700], [0.22, 0, "spring(0.3,0.5)"]], scale: [[0.22, 1], [BEAT, 1.05]] },
      { tracking: [[0, 140], [0.25, -6, EXPO]], scale: [[0, 1.3], [0.25, 1, EXPO]] },
      { "rot.x": [[0, -90], [0.24, 0, EXPO]], scale: [[0.24, 1], [BEAT, 1.06]] },
      { scale: [[0, 0.2], [0.2, 1, "spring(0.35,0.6)"]] },
      { "pos.x": [[0, 1400], [0.2, 0, EXPO], [BEAT, -40]] },
      { scale: [[0, 3.2], [0.24, 1, EXPO], [BEAT, 1.04]], "rot.z": [[0, 6], [0.24, 0, EXPO]] },
    ][i];
    L(
      plate(`${id}-p`, plates[i], t0, t1),
      { id: `${id}-n`, type: "text", text: name, size, font: TIGHT, weight: 900, color: inks[i], tracking: -6, lineHeight: 0.92, in: t0, out: t1,
        keys: { ...entr, blur: [[0, 26], [0.14, 0, "out"]] }, beh: i === 5 ? undefined : undefined },
      { id: `${id}-k`, type: "text", text: `0${i + 1} / 08`, size: 24, font: MONO, weight: 700, color: inks[i], align: "left", pos: [-880, 470, 20], in: t0, out: t1 },
      { id: `${id}-f`, type: "text", text: "SOLSTICE 26 — LINEUP", size: 24, font: MONO, weight: 700, color: inks[i], align: "right", pos: [880, 470, 20], in: t0, out: t1 },
    );
  });
  L({ id: "d-strobe", type: "adjust", name: "Roll strobe", in: T.sun - 0.25, out: T.sun, fadeColor: "$cream",
    keys: { fade: [[0, 0], [0.0625, 0.7, "hold"], [0.125, 0, "hold"], [0.1875, 0.8, "hold"], [0.25, 1, "hold"]] } });

  /* ---- 3. SUN MACHINE (8 → 12): a machine that makes daylight, pulsing on every kick */
  const U = T.sun, UD = T.dawn - T.sun;
  L(
    { id: "u-bg", type: "gradient", kind: "radial", colors: ["$ember", "#12060a", "$void"], noise: 0.05, in: U, out: T.dawn },
    { id: "u-glow", type: "shape", shape: "ellipse", w: 1100, h: 1100, fill: "$sun", blur: 160, opacity: 0.55, pos: [0, 40, -300], in: U, out: T.dawn, motionBlur: false,
      beh: [{ id: "kick", use: "pulse", at: 0, amp: 0.1, period: BEAT }] },
    { id: "u-rays2", type: "cloner", mode: "radial", n: 140, r: 640, orient: true, pos: [0, 40, -100], in: U, out: T.dawn,
      child: { kind: "shape", shape: "rect", w: 4, h: 70, radius: 2, fill: "$sun" }, reveal: { dur: 0.4, at: 0.1 }, fx: [{ id: "lag", type: "delay", step: 0.003 }, { id: "w", type: "wave", amp: [0, 0, 60], freq: 1, phase: 0.2 }],
      keys: { spin: [[0, 0], [UD, -70]], opacity: [[0, 0.8]] } },
    { id: "u-rays", type: "cloner", mode: "radial", n: 64, r: 430, orient: true, pos: [0, 40, -50], in: U, out: T.dawn,
      child: { kind: "shape", shape: "rect", w: 12, h: 170, radius: 6, fill: "$amber" }, reveal: { dur: 0.45, bounce: 0.4, at: 0 }, fx: [{ id: "lag", type: "delay", step: 0.006 }],
      keys: { spin: [[0, 0], [UD, 95]] }, beh: [{ id: "kick", use: "pulse", at: 0, amp: 0.07, period: BEAT }] },
    { id: "u-ring", type: "mesh", geom: "ring", material: "chrome", color: "#ffd9b8", size: 1080, pos: [0, 40, 0], in: U, out: T.dawn, depth: true,
      keys: { "rot.x": [[0, 76]], "rot.y": [[0, -14], [UD, 14]], "rot.z": [[0, 0], [UD, 200]], scale: [[0, 0.3], [0.6, 1, "spring(0.6,0.4)"]] } },
    { id: "u-core", type: "mesh", geom: "sphere", material: "emissive", color: "#ff6a12", size: 360, pos: [0, 40, 20], in: U, out: T.dawn, depth: true,
      keys: { scale: [[0, 0], [0.5, 1, "spring(0.5,0.55)"]] }, beh: [{ id: "kick", use: "pulse", at: 0.5, amp: 0.06, period: BEAT }] },
    { id: "u-rig", type: "group", pos: [0, 40, 0], rot: [18, 0, 0], in: U, out: T.dawn, keys: { "rot.y": [[0, 0], [UD, 260]] } },
    ...[0, 1, 2, 3].map((k) => ({
      id: `u-coin${k}`, type: "mesh", geom: "coin", material: "gold", color: "#ffc44d", size: 150, parent: "u-rig", in: U, depth: true,
      pos: [Math.round(Math.cos(k * Math.PI / 2) * 620), 0, Math.round(Math.sin(k * Math.PI / 2) * 620)],
      keys: { "rot.y": [[0, k * 40], [UD, k * 40 + 900]], scale: [[0.3 + k * 0.12, 0], [0.8 + k * 0.12, 1, "spring(0.5,0.5)"]] } })),
    { id: "u-date", type: "text", text: "19 — 21  JUNE  2026", size: 30, font: MONO, weight: 600, color: "$amber", tracking: 8, pos: [0, 470, 200], in: U + 0.5, out: T.dawn,
      beh: [{ id: "in", use: "typewriter", at: 0, stagger: 0.03 }] },
    { id: "u-title", type: "text", text: "SOLSTICE", size: 250, font: TIGHT, weight: 900, color: "$cream", pos: [0, -380, 250], in: U + 1.0, out: T.dawn,
      keys: { tracking: [[0, 120], [0.8, 10, EXPO], [UD - 1, 30]], blur: [[0, 30], [0.4, 0, "out"]], opacity: [[0, 0], [0.15, 1]] } },
    { id: "u-out", type: "adjust", in: T.dawn - 0.25, out: T.dawn + 0.3, fadeColor: "$amber", dissolve: 0.5, keys: { fade: [[0, 0], [0.25, 1, "in"], [0.55, 0, "out"]] } },
  );

  /* ---- 4. DAWN (12 → 16): the pass, over a sky that never gets dark */
  const W0 = T.dawn;
  L(
    { id: "w-sky", type: "sky", top: "#2a5fae", horizon: "#ffc38a", clouds: 0.45, cloudScale: 1.2, drift: 0.05, sun: 0.85, mountains: true, mountainHeight: 1.1, hills: "#1b2a3a", grass: "#1d2638", hillHeight: 0.3, seed: 4, in: W0, out: T.finale },
    { id: "w-pass", type: "html", name: "Festival pass", w: 940, h: 440, radius: 34, pos: [0, 150, 100], in: W0 + 0.25, out: T.finale, depth: true,
      glass: { blur: 40, tint: "#0d1426", amount: 0.55, rim: 0.8 }, shadow: { x: 0, y: -40, blur: 80, color: "#0b1a33", opacity: 0.35 },
      vars: { n: 0 }, keys: { "vars.n": [[0.3, 0], [2.2, 4021, "expoOut"]], "rot.x": [[0, -70], [0.7, 0, EXPO]], opacity: [[0, 0], [0.2, 1]] },
      beh: [{ id: "sway", use: "sway", at: 0.7, deg: 9, period: 3.6 }, { id: "bob", use: "float", at: 0.7, amp: 12, period: 2.4 }],
      html: "<div style='width:940px;height:440px;display:flex;font-family:Inter Tight Variable;color:#fff'>"
        + "<div style='width:300px;display:flex;align-items:center;justify-content:center;border-right:2px dashed rgba(255,255,255,.45)'><div style='width:190px;height:190px;border-radius:50%;background:radial-gradient(circle at 40% 35%,#ffd36b,#ff5a1f 60%,#c2250a);box-shadow:0 0 60px #ff7a2a'></div></div>"
        + "<div style='flex:1;padding:44px 48px;display:flex;flex-direction:column;justify-content:space-between'>"
        + "<div><div style='font:700 18px JetBrains Mono Variable;letter-spacing:4px;opacity:.85'>3-DAY PASS · GENERAL ADMISSION</div>"
        + "<div style='font-weight:900;font-size:96px;letter-spacing:-3px;line-height:1;margin-top:14px'>SOLSTICE 26</div>"
        + "<div style='font-size:26px;font-weight:600;margin-top:12px;opacity:.95'>19 — 21 June · Lofoten, Norway</div></div>"
        + "<div style='display:flex;align-items:flex-end;justify-content:space-between'><div style='font:600 20px JetBrains Mono Variable;opacity:.85'>NO. {{n}}</div>"
        + "<div style='height:54px;width:260px;background:repeating-linear-gradient(90deg,#fff 0 3px,transparent 3px 7px,#fff 7px 8px,transparent 8px 12px)'></div></div></div></div>" },
    ...[["{value}h", 72, "of daylight"], ["{value}", 40, "artists"], ["{value}", 1, "sun"]].map(([txt, v, lab], i) => [
      { id: `w-stat${i}`, type: "text", text: txt, value: 0, size: 150, font: TIGHT, weight: 900, color: "$cream", tracking: -4, pos: [-560 + i * 560, -250, 150], in: W0 + 1.5 + i * BEAT, out: T.finale,
        keys: { value: [[0, 0], [0.8, v, "expoOut"]], "pos.y": [[0, -330], [0.4, -250, EXPO]], opacity: [[0, 0], [0.15, 1]], blur: [[0, 16], [0.3, 0, "out"]] } },
      { id: `w-lab${i}`, type: "text", text: lab, size: 30, font: MONO, weight: 600, color: "$cream", pos: [-560 + i * 560, -355, 150], in: W0 + 1.7 + i * BEAT, out: T.finale,
        beh: [{ id: "in", use: "typewriter", at: 0, stagger: 0.04 }] },
    ]).flat(),
    { id: "w-flash", type: "adjust", in: T.finale - 0.12, out: T.finale + 0.4, fadeColor: "$cream", keys: { fade: [[0, 0], [0.12, 1, "in"], [0.52, 0, "out"]] } },
  );

  /* ---- 5. FINALE (16 → 21): sunrise over a horizon line, the lockup */
  const F = T.finale;
  L(
    { id: "f-bg", type: "gradient", kind: "linear", angle: 90, colors: ["$void", "#1a0806", "#3a1206"], in: F },
    { id: "f-clip", type: "group", name: "Horizon mask", pos: [0, 230, 0], in: F, clip: { w: 2600, h: 960 } },
    { id: "f-rays", type: "cloner", mode: "radial", n: 72, r: 760, orient: true, parent: "f-clip", in: F, pos: [0, -330, -100],
      child: { kind: "shape", shape: "rect", w: 8, h: 260, radius: 4, fill: "$sun" }, reveal: { dur: 0.6, at: 0.3 }, fx: [{ id: "lag", type: "delay", step: 0.006 }],
      keys: { spin: [[0, 0], [5, 40]], opacity: [[0, 0.75]], "pos.y": [[0, -900], [1.4, -330, EXPO]] } },
    { id: "f-sun", type: "mesh", geom: "sphere", material: "emissive", color: "#ff5a1f", size: 820, parent: "f-clip", in: F, pos: [0, -330, 0],
      keys: { "pos.y": [[0, -1000], [1.4, -330, EXPO]] }, beh: [{ id: "kick", use: "pulse", at: 1.5, amp: 0.025, period: BEAT }] },
    { id: "f-line", type: "path", points: [[-1100, 0], [1100, 0]], stroke: "$amber", width: 5, glow: 1, pos: [0, -250, 50], in: F,
      keys: { trimStart: [[0, 0.5], [0.5, 0, EXPO]], trimEnd: [[0, 0.5], [0.5, 1, EXPO]] } },
    { id: "f-logo", type: "text", text: "SOLSTICE", size: 270, font: TIGHT, weight: 900, color: "$cream", pos: [0, -410, 120], in: F + 0.9,
      keys: { tracking: [[0, 160], [1, 6, EXPO], [T.end - F - 0.9, 20]], blur: [[0, 30], [0.5, 0, "out"]], opacity: [[0, 0], [0.12, 1]] },
      beh: [{ id: "in", use: "cascade", at: 0, by: "char", stagger: 0.05, dist: 80 }] },
    { id: "f-info", type: "text", text: "19—21.06.2026   ·   LOFOTEN, NORWAY   ·   TICKETS ON SALE NOW", size: 26, font: MONO, weight: 600, color: "$amber", tracking: 2, pos: [0, -520, 120], in: F + 2.0,
      spans: [{ text: "TICKETS ON SALE NOW", color: "$cream" }], beh: [{ id: "in", use: "typewriter", at: 0, stagger: 0.022 }] },
    { id: "f-hit", type: "adjust", in: 20.0, out: 20.2, fadeColor: "$cream", keys: { fade: [[0, 0.5], [0.2, 0, "out"]] } },
    { id: "f-end", type: "adjust", in: T.end - 0.6, fadeColor: "$void", keys: { fade: [[0, 0], [0.6, 1, "in"]] } },
  );
  d.audio = [{ id: "score", src: "lib://music/showcase-s02", name: "Solstice (score)", at: 0, offset: 0, volume: 1, fadeIn: 0, fadeOut: 0 }];
  out("s02-solstice", d);
}

/* ============================== 03 — EVERYTHING MOVES (pitch opener, 120 BPM) ============================== */
// A 21-second opener that shows the range of the engine in five acts, every cut on the beat grid
// (1 beat = 0.5 s): spark → kinetic type → real 3D → worlds + the app itself → collapse and lockup.
export const S03 = { bpm: 120, spark: 0, kin: 4, dim: 8, worlds: 12, finale: 16, end: 21 };
{
  const T = S03, BEAT = 0.5;
  const PAL = ["$lav", "$cyan", "$lime", "$hot"];
  const d = {
    v: 1, name: "Showcase 03 — Everything moves",
    comp: {
      w: 1920, h: 1080, fps: 30, dur: T.end, bg: "$void", cam: "cam", env: "city",
      motionBlur: { angle: 240, samples: 10 },
      post: { bloom: 0.9, bloomThreshold: 1.0, vignette: 0.3, grain: 0.05, contrast: 0.08, saturation: 0.06 },
    },
    brand: { font: "Inter Variable", colors: {
      void: "#060509", ink: "#f7f4ff", lav: "#b593ff", violet: "#6d3cff", cyan: "#01b2fd", lime: "#f5ff63", hot: "#ff3d6e", deep: "#140b33", cream: "#fff6e8", muted: "#8c86a3",
    } },
    assets: {}, bindings: [], style: { energy: 1, bounce: 0.55, depth: 0.9, speed: 0.75 },
    markers: [{ id: "kin", t: T.kin, label: "Kinetic type" }, { id: "dim", t: T.dim, label: "3D" }, { id: "worlds", t: T.worlds, label: "Worlds" }, { id: "fin", t: T.finale, label: "Finale" }],
    layers: [],
  };
  const L = (...ls) => d.layers.push(...ls);
  const flash = (id, t, color = "$ink", len = 0.55) => ({ id, type: "adjust", name: "Flash", in: t - 0.12, out: t + len, fadeColor: color, keys: { fade: [[0, 0], [0.12, 1, "in"], [len + 0.12, 0, "out"]] } });

  // one shared camera: hard "hold" jumps on the cuts, a different handheld energy per act
  L({ id: "cam", type: "camera", fov: 35, pos: [0, 0, 1713],
    keys: {
      "pos.z": [[0, 2100], [3.95, 1480, "expoIn"], [T.kin, 1713, "hold"], [T.dim, 2300, "hold"], [T.worlds - 0.3, 1760, "easy"], [T.worlds, 1713, "hold"], [T.finale, 1640, "easy"], [T.finale, 1713, "hold"], [T.end, 1560, "easy"]],
      "pos.y": [[0, 0], [T.worlds, -240, "hold"], [T.finale - 0.1, 90, "easy"], [T.finale, 0, "hold"]],
      "rot.z": [[0, 0], [T.dim, -5, "hold"], [T.worlds - 0.3, 3, "easy"], [T.worlds, 0, "hold"]],
    },
    beh: [
      { id: "breath", use: "shake", at: 0, dur: T.kin, amp: 5, freq: 0.4 },
      { id: "punch", use: "shake", at: T.kin, dur: T.dim - T.kin, amp: 20, freq: 3 },
      { id: "orbit", use: "shake", at: T.dim, dur: T.worlds - T.dim, amp: 9, freq: 1 },
      { id: "air", use: "shake", at: T.worlds, dur: T.finale - T.worlds, amp: 6, freq: 0.5 },
      { id: "still", use: "shake", at: T.finale, dur: T.end - T.finale, amp: 4, freq: 0.4 },
    ] });

  /* ---- 1. SPARK (0 → 4): a point of light, a prompt, three rings winding up, the light swallows the frame */
  L(
    { id: "a-bg", type: "gradient", kind: "radial", colors: ["#1c1045", "#0a0716", "$void"], noise: 0.06, out: T.kin },
    { id: "a-dust", type: "cloner", name: "Dust", mode: "grid", n: 240, cols: 20, gap: 150, pos: [0, 0, -700], out: T.kin, depth: true, billboard: true, motionBlur: false,
      child: { kind: "shape", shape: "ellipse", w: 5, colors: ["$lav", "$ink", "$cyan"] }, reveal: { dur: 1.2, at: 0 }, fx: [{ id: "lag", type: "delay", step: 0.004 }, { id: "drift", type: "noise", amp: [60, 60, 260], freq: 0.18 }],
      keys: { opacity: [[0, 0.55]], scale: [[0, 1], [3.95, 1.9, "expoIn"]] } },
    { id: "a-halo", type: "cloner", name: "Tick halo", mode: "radial", n: 96, r: 170, orient: true, pos: [0, 40, 0], out: T.kin,
      child: { kind: "shape", shape: "rect", w: 4, h: 30, radius: 2, fill: "$lav" }, reveal: { dur: 0.5, bounce: 0.2, at: 0.2 }, fx: [{ id: "lag", type: "delay", step: 0.006 }],
      keys: { r: [[0, 140], [2.6, 270, "easy"], [3.8, 40, "expoIn"]], spin: [[0, 0], [3.85, 280, "expoIn"]], opacity: [[3.4, 1], [3.8, 0]] } },
    { id: "a-dots", type: "cloner", name: "Colour dots", mode: "radial", n: 32, r: 360, pos: [0, 40, 0], out: T.kin,
      child: { kind: "shape", shape: "ellipse", w: 9, colors: PAL }, reveal: { dur: 0.6, bounce: 0.4, at: 0.5 }, fx: [{ id: "lag", type: "delay", step: 0.02 }],
      keys: { spin: [[0, 0], [3.85, -200, "expoIn"]], r: [[0, 360], [3.8, 30, "expoIn"]], opacity: [[3.4, 1], [3.8, 0]] } },
    { id: "a-tiles", type: "cloner", name: "Tile ring", mode: "radial", n: 12, r: 580, orient: true, pos: [0, 40, 0], out: T.kin,
      child: { kind: "shape", shape: "rect", w: 44, h: 44, radius: 13, colors: PAL }, reveal: { dur: 0.5, bounce: 0.5, at: 1.0 }, fx: [{ id: "lag", type: "delay", step: 0.05 }, { id: "bob", type: "wave", amp: [0, 0, 80], freq: 1, phase: 0.5 }],
      keys: { spin: [[0, 0], [3.85, 150, "expoIn"]], r: [[0, 580], [3.8, 60, "expoIn"]], opacity: [[3.4, 1], [3.8, 0]] } },
    { id: "a-core", type: "mesh", name: "Spark", geom: "sphere", material: "emissive", color: "$lav", size: 60, pos: [0, 40, 0], out: T.kin,
      keys: { size: [[0, 1], [0.4, 64, "cubic(0.16,1,0.3,1)"], [3.0, 100, "easy"], [3.98, 5400, "expoIn"]] },
      beh: [{ id: "beat", use: "pulse", at: 0.5, dur: 3, amp: 0.16, period: BEAT }] },
    { id: "a-prompt", type: "text", name: "Prompt", text: "> make something impossible_", size: 38, font: MONO, weight: 500, color: "$ink", pos: [0, -250, 0], out: 3.6,
      spans: [{ text: ">", color: "$lav" }, { text: "impossible", color: "$lime" }],
      beh: [{ id: "type", use: "typewriter", at: 0.5, by: "char", stagger: 0.05 }], keys: { opacity: [[3.15, 1], [3.5, 0]], blur: [[3.15, 0], [3.5, 18]] } },
    { id: "a-tl", type: "text", text: "PROMPT → MOTION", size: 20, font: MONO, weight: 700, color: "$muted", tracking: 4, align: "left", pos: [-880, 480, 0], out: T.kin,
      beh: [{ id: "in", use: "typewriter", at: 1.0, stagger: 0.03 }] },
    { id: "a-tr", type: "text", text: "1920 × 1080 · 30 FPS · LIVE", size: 20, font: MONO, weight: 700, color: "$muted", tracking: 4, align: "right", pos: [880, 480, 0], out: T.kin,
      spans: [{ text: "LIVE", color: "$hot" }], beh: [{ id: "in", use: "typewriter", at: 1.3, stagger: 0.03 }] },
    flash("a-flash", T.kin),
  );

  /* ---- 2. KINETIC (4 → 8): five words on five beats, a 16th-note stutter, a tunnel of type */
  const words = [
    ["EVERY", "$lime", "$void", { scale: [[0, 2.8], [0.18, 1, EXPO], [BEAT, 1.06]], "rot.z": [[0, -10], [0.22, 0, EXPO]] }, {}],
    ["IDEA", "$void", "$lav", { "pos.x": [[0, -1500], [0.2, 0, EXPO], [BEAT, 40]] }, { size: 470 }],
    ["deserves", "$hot", "$cream", { tracking: [[0, 120], [0.3, -4, EXPO]], scale: [[0, 1.35], [0.3, 1, EXPO], [BEAT, 1.05]] }, { font: SERIF, weight: 400, size: 380 }],
    ["TO", "$cyan", "$void", { "pos.y": [[0, 720], [0.24, 0, "spring(0.3,0.5)"]], scale: [[0.24, 1], [BEAT, 1.08]] }, { size: 640 }],
    ["MOVE.", "$void", "$ink", { "rot.x": [[0, -90], [0.26, 0, EXPO]], scale: [[0.26, 1], [2 * BEAT, 1.1, "easyIn"]] }, { size: 440, tracking: 4 }],
  ];
  words.forEach(([text, plateC, inkC, keys, o], i) => {
    const t0 = T.kin + i * BEAT, t1 = i === 4 ? t0 + 2 * BEAT : t0 + BEAT;
    L(
      plate(`k${i}-p`, plateC, t0, t1),
      { id: `k${i}-w`, type: "text", text, size: o.size ?? 400, font: o.font ?? TIGHT, weight: o.weight ?? 900, color: inkC, tracking: o.tracking ?? -8, in: t0, out: t1,
        keys: { ...keys, blur: [[0, 26], [0.14, 0, "out"]] } },
      { id: `k${i}-n`, type: "text", text: `0${i + 1}`, size: 22, font: MONO, weight: 700, color: inkC, align: "left", pos: [-880, 480, 20], in: t0, out: t1 },
    );
  });
  L({ id: "k4-bar", type: "shape", shape: "rect", w: 1300, h: 24, radius: 12, fill: "$lime", pos: [0, -250, 10], in: T.kin + 2.25, out: T.kin + 2.5,
    keys: { scale: [[0, 0.02], [0.2, 1, EXPO]], "pos.x": [[0, -650], [0.2, 0, EXPO]] } });
  // the stutter: eight 16th-note slices, every one a different plate, face and angle
  const faces = [[TIGHT, 900], [SERIF, 400], [MONO, 800], ["Permanent Marker", 400], ["Playfair Display Variable", 900], [TIGHT, 300], ["Bricolage Grotesque Variable", 800], [SERIF, 400]];
  const stP = ["$lav", "$void", "$lime", "$hot", "$cyan", "$ink", "$violet", "$void"];
  const stI = ["$void", "$lime", "$void", "$cream", "$void", "$violet", "$lime", "$hot"];
  for (let i = 0; i < 8; i++) {
    const t0 = T.kin + 2.5 + i * 0.125, t1 = t0 + 0.125;
    L(
      plate(`ks${i}-p`, stP[i], t0, t1),
      { id: `ks${i}-w`, type: "text", text: i % 2 ? "move" : "MOVE", size: 300 + (i % 3) * 90, font: faces[i][0], weight: faces[i][1], color: stI[i], tracking: -4,
        pos: [(i % 3 - 1) * 120, (i % 2 ? -1 : 1) * 60, 0], rot: [0, 0, (i % 2 ? 1 : -1) * (4 + i)], in: t0, out: t1,
        keys: { scale: [[0, 1.25], [0.125, 1, "out"]] } },
    );
  }
  // a tunnel of type flying through the lens on the last beat
  L(
    plate("kt-p", "$void", T.kin + 3.5, T.dim),
    { id: "kt-tunnel", type: "cloner", name: "Type tunnel", mode: "linear", n: 16, gap: 520, rot: [0, 90, 0], depth: true, billboard: true, in: T.kin + 3.5, out: T.dim,
      child: { kind: "text", text: "MOVE.", w: 220, colors: PAL }, fx: [{ id: "spiral", type: "wave", amp: [0, 260, 260], freq: 0.6, phase: 0.55 }],
      keys: { "pos.z": [[0, -3200], [0.5, 2600, "expoIn"]] } },
    { id: "k-strobe", type: "adjust", name: "Strobe", in: T.dim - 0.25, out: T.dim, fadeColor: "$ink",
      keys: { fade: [[0, 0], [0.0625, 0.7, "hold"], [0.125, 0, "hold"], [0.1875, 0.85, "hold"], [0.25, 1, "hold"]] } },
  );

  /* ---- 3. DIMENSION (8 → 12): chrome, gold, glass and foil orbiting a torus inside a ring of light */
  const D = T.dim, DD = T.worlds - T.dim;
  L(
    { id: "d-bg", type: "gradient", kind: "radial", colors: ["#2a1470", "#0c0820", "$void"], noise: 0.05, in: D, out: T.worlds },
    { id: "d-word", type: "text", text: "DIMENSION", size: 330, font: TIGHT, weight: 900, color: "$violet", opacity: 0.4, pos: [0, 0, -520], blur: 4, in: D, out: T.worlds, motionBlur: false,
      keys: { tracking: [[0, 220], [DD, -12, "easy"]] } },
    { id: "d-ring", type: "cloner", name: "Light ring", mode: "radial", n: 100, r: 780, rot: [72, 0, 0], depth: true, billboard: true, in: D, out: T.worlds,
      child: { kind: "shape", shape: "ellipse", w: 13, colors: ["$lav", "$cyan", "$lime"] }, reveal: { dur: 0.5, at: 0.1 }, fx: [{ id: "lag", type: "delay", step: 0.005 }, { id: "ripple", type: "wave", amp: [0, 0, 50], freq: 0.8, phase: 0.3 }],
      keys: { spin: [[0, 0], [DD, 150]], r: [[0, 200], [0.9, 780, EXPO]] } },
    { id: "d-torus", type: "mesh", name: "Chrome torus", geom: "torus", material: "chrome", color: "#e4e1f0", size: 560, pos: [0, 30, 0], in: D, out: T.worlds, depth: true,
      keys: { "rot.x": [[0, 70], [DD, -30]], "rot.y": [[0, -90], [DD, 250]], scale: [[0, 0], [0.8, 1, "spring(0.8,0.45)"]], "pos.z": [[DD - 0.55, 0], [DD - 0.02, 1500, "expoIn"]] },
      beh: [{ id: "bob", use: "float", at: 0.8, amp: 18, period: 2 }] },
    { id: "d-rig", type: "group", name: "Orbit rig", pos: [0, 30, 0], rot: [16, 0, 0], in: D, out: T.worlds, keys: { "rot.y": [[0, 0], [DD, 320]] } },
    { id: "d-gold", type: "mesh", geom: "coin", material: "gold", color: "#ffc44d", size: 230, parent: "d-rig", in: D, pos: [580, 0, 0], depth: true,
      keys: { "rot.y": [[0, 0], [DD, 720]], scale: [[0.5, 0], [0.9, 1, "spring(0.6,0.5)"]] } },
    { id: "d-glass", type: "mesh", geom: "sphere", material: "metal", color: "#8b6bff", roughness: 0.16, size: 250, parent: "d-rig", in: D, pos: [0, 0, 580], depth: true,
      keys: { scale: [[1.0, 0], [1.4, 1, "spring(0.6,0.5)"]] } },
    { id: "d-pear", type: "mesh", geom: "balloon", material: "foil", color: "$hot", size: 240, parent: "d-rig", in: D, pos: [-580, 0, 0], depth: true,
      keys: { "rot.y": [[0, 0], [DD, -360]], scale: [[1.5, 0], [1.9, 1, "spring(0.6,0.5)"]] } },
    { id: "d-box", type: "mesh", geom: "box", material: "plastic", color: "$lime", size: 150, parent: "d-rig", in: D, pos: [0, 0, -580], depth: true,
      keys: { "rot.x": [[0, 0], [DD, 400]], "rot.y": [[0, 0], [DD, 300]], scale: [[2.0, 0], [2.4, 1, "spring(0.6,0.5)"]] } },
    { id: "d-title", type: "text", text: "Real depth.", size: 140, font: SERIF, color: "$ink", align: "left", pos: [-840, -300, 200], in: D + 1.0, out: T.worlds - 0.4,
      beh: [{ id: "in", use: "typeUp", at: 0, by: "char", stagger: 0.04, dist: 60 }], keys: { blur: [[0, 16], [0.4, 0, "out"]] } },
    { id: "d-sub", type: "text", text: "chrome · gold · glass · foil  —  lit and rendered live", size: 24, font: MONO, weight: 500, color: "$muted", align: "left", pos: [-835, -390, 200], in: D + 1.5, out: T.worlds - 0.4,
      spans: [{ text: "chrome · gold · glass · foil", color: "$lime" }], beh: [{ id: "in", use: "typewriter", at: 0, stagger: 0.02 }] },
    flash("d-flash", T.worlds, "$cream", 0.5),
  );

  /* ---- 4. WORLDS (12 → 16): an aurora night that dissolves into dawn, and the app that made all of this */
  const Wn = T.worlds, Wd = T.worlds + 2;
  L(
    { id: "w-night", type: "sky", top: "#05061a", horizon: "#2a1a5e", stars: 1, clouds: 0.1, cloudScale: 1.4, drift: 0.03, mountains: true, mountainHeight: 0.95, hills: "#04040c", hillHeight: 0.22, seed: 11, in: Wn, out: Wd + 0.3 },
    ...[["$lime", -520, 330, 1300, 0], ["$violet", 380, 380, 1100, 1.3], ["$cyan", 0, 280, 900, 2.1], ["$hot", 700, 300, 700, 0.7]].map(([c, x, y, w, ph], i) => ({
      id: `w-aur${i}`, type: "shape", shape: "ellipse", w, h: 180, fill: c, pos: [x, y, -300], rot: [0, 0, i % 2 ? 8 : -6], blur: 110, opacity: 0.45, in: Wn, out: Wd + 0.3, motionBlur: false,
      keys: { "pos.x": [[0, x - 120], [2.3, x + 140, "easy"]], opacity: [[0, 0.2], [0.6, 0.5, "easy"]] },
      beh: [{ id: "breathe", use: "pulse", at: ph, amp: 0.12, period: 1 + i * 0.25 }, { id: "float", use: "float", at: 0, amp: 30, period: 2 + i * 0.5 }] })),
    { id: "w-line", type: "text", text: "Any world.", size: 190, font: SERIF, color: "$cream", pos: [0, 120, 0], in: Wn + 0.25, out: Wd,
      beh: [{ id: "in", use: "typeUp", at: 0, by: "word", stagger: 0.25, dist: 50, dur: 0.6 }],
      keys: { blur: [[0, 18], [0.6, 0, "out"], [1.4, 0], [1.75, 24, "in"]], tracking: [[1.2, 0], [1.75, 40, "easyIn"]] } },
    { id: "w-coord", type: "text", text: "68.2°N  ·  00:14  ·  AURORA", size: 24, font: MONO, weight: 600, color: "$cyan", tracking: 4, pos: [0, -40, 0], in: Wn + 0.6, out: Wd,
      beh: [{ id: "in", use: "typewriter", at: 0, stagger: 0.03 }] },
    { id: "w-day", type: "sky", top: "#3b6fd6", horizon: "#ffc38a", clouds: 0.45, cloudScale: 1.2, drift: 0.06, mountains: true, mountainHeight: 1.1, hills: "#1b2a3a", grass: "#1d2638", hillHeight: 0.3, seed: 4, in: Wd, out: T.finale,
      keys: { sun: [[0, 0.35], [2, 0.9, "easy"]] } },
    { id: "w-dissolve", type: "adjust", name: "Cloud dissolve", in: Wd - 0.25, out: Wd + 0.3, fadeColor: "#ffe2c0", dissolve: 0.7, keys: { fade: [[0, 0], [0.25, 1, "in"], [0.55, 0, "out"]] } },
  );
  // the editor itself, as a frosted card: the prompt, the scene bars filling in, the layer count rolling
  const bars = [["Spark", "#b593ff", 0.0, 330], ["Kinetic", "#f5ff63", 0.15, 300], ["Dimension", "#01b2fd", 0.3, 360], ["Worlds", "#ff3d6e", 0.45, 330], ["Finale", "#6d3cff", 0.6, 380]];
  L(
    { id: "w-app", type: "html", name: "The editor", w: 1080, h: 560, radius: 32, pos: [0, 70, 120], in: Wd + 0.05, out: T.finale, depth: true,
      glass: { blur: 46, tint: "#0b0820", amount: 0.86, rim: 0.9 }, shadow: { x: 0, y: -40, blur: 90, color: "#0b0a1f", opacity: 0.4 },
      vars: { a: 0, b: 0, c: 0, d: 0, e: 0, n: 0 },
      keys: {
        "rot.x": [[0, -75], [0.6, 0, EXPO]], opacity: [[0, 0], [0.2, 1]],
        ...Object.fromEntries(bars.map(([, , at, w], i) => [`vars.${"abcde"[i]}`, [[0.55 + at, 0], [1.15 + at, w, EXPO]]])),
        "vars.n": [[0.5, 0], [1.9, 0, "hold"]],
      },
      beh: [{ id: "sway", use: "sway", at: 0.6, deg: 7, period: 3.2 }, { id: "bob", use: "float", at: 0.6, amp: 10, period: 2.2 }],
      html: "<div style='width:1080px;height:560px;font-family:Inter Variable;color:#f7f4ff;display:flex;flex-direction:column'>"
        + "<div style='height:64px;display:flex;align-items:center;gap:12px;padding:0 28px;border-bottom:1px solid rgba(255,255,255,.14)'>"
        + "<div style='width:26px;height:26px;border-radius:8px;background:conic-gradient(from 200deg,#b593ff,#01b2fd,#f5ff63,#b593ff);box-shadow:inset 0 0 0 6px #1a1533'></div>"
        + "<div style='font-weight:650;font-size:19px'>Fusion Motion</div><div style='opacity:.5;font-size:19px'>/ Everything moves</div>"
        + "<div style='margin-left:auto;font:600 15px JetBrains Mono Variable;opacity:.8'>{{n}} layers</div>"
        + "<div style='background:#f7f4ff;color:#140b33;font-weight:700;font-size:16px;padding:9px 18px;border-radius:999px'>Export</div></div>"
        + "<div style='margin:26px 28px 0;height:84px;border-radius:20px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.16)'></div>"
        + "<div style='margin:26px 28px 0;display:grid;gap:14px'>"
        + bars.map(([name, col], i) => `<div style='display:flex;align-items:center;gap:16px'><div style='width:110px;font:600 15px JetBrains Mono Variable;opacity:.75'>${name}</div><div style='flex:1;height:34px;border-radius:12px;background:rgba(255,255,255,.06);position:relative'><div style='position:absolute;left:${i * 150}px;top:0;height:34px;width:{{${"abcde"[i]}}}px;border-radius:12px;background:${col}'></div></div></div>`).join("")
        + "</div></div>" },
    { id: "w-ask", type: "text", text: "make something impossible", size: 32, font: MONO, weight: 500, color: "$ink", align: "left", pos: [-480, 212, 140], in: Wd + 0.45, out: T.finale,
      spans: [{ text: "impossible", color: "$lime" }], beh: [{ id: "type", use: "typewriter", at: 0, stagger: 0.03 }] },
    { id: "w-cap", type: "text", text: "one prompt  →  a plan  →  every layer, built by AI", size: 26, font: MONO, weight: 600, color: "$ink", pos: [0, -330, 160], in: Wd + 1.1, out: T.finale,
      spans: [{ text: "built by AI", color: "$lime" }], beh: [{ id: "in", use: "typewriter", at: 0, stagger: 0.022 }] },
    flash("w-flash", T.finale, "$ink", 0.4),
  );

  /* ---- 5. FINALE (16 → 21): everything collapses into one point, one sentence, the lockup */
  const F = T.finale, C = F + 1.5; // the collapse lands at 17.5
  L(
    { id: "f-bg", type: "gradient", kind: "radial", colors: ["#241059", "#0a0716", "$void"], noise: 0.06, in: F, out: C },
    ...[[64, 920, 34, 14, 1, 0.004], [46, 660, 28, 12, -1, 0.006], [30, 420, 22, 10, 1, 0.01]].map(([n, r, w, h, dir, step], i) => ({
      id: `f-vortex${i}`, type: "cloner", name: `Vortex ${i + 1}`, mode: "radial", n, r, orient: true, in: F, out: C, pos: [0, 0, i * 40],
      child: { kind: "shape", shape: "rect", w, h, radius: h / 2, colors: i === 1 ? ["$cyan", "$lime", "$lav"] : PAL }, reveal: { dur: 0.35, at: 0 }, fx: [{ id: "lag", type: "delay", step }, { id: "w", type: "wave", amp: [0, 0, 90], freq: 1.2, phase: 0.4 }],
      keys: { spin: [[0, 0], [1.5, dir * (360 + i * 120), "expoIn"]], r: [[0, r], [0.6, r * 0.8, "easy"], [1.5, 0, "expoIn"]] } })),
    { id: "f-core", type: "mesh", geom: "sphere", material: "emissive", color: "$ink", size: 40, in: F, out: C + 0.1,
      keys: { size: [[0, 0], [0.4, 60, EXPO], [1.3, 90, "easy"], [1.5, 6, "expoIn"]] }, beh: [{ id: "beat", use: "pulse", at: 0.4, dur: 1, amp: 0.2, period: BEAT }] },
    { id: "f-sentence", type: "text", text: "this entire video was made from one sentence.", size: 58, font: MONO, weight: 500, color: "$ink", in: C + 0.05, out: F + 3.45,
      spans: [{ text: "one sentence.", color: "$lav" }], beh: [{ id: "type", use: "typewriter", at: 0.1, stagger: 0.035 }],
      keys: { blur: [[1.7, 0], [1.9, 14]], opacity: [[1.7, 1], [1.9, 0]] } },
    flash("f-hit", F + 3.5, "$lav", 0.45),
    { id: "f-glow", type: "gradient", kind: "radial", colors: ["#241059", "#0a0716", "$void"], noise: 0.06, in: F + 3.45 },
    { id: "f-ring", type: "cloner", mode: "radial", n: 72, r: 520, orient: true, in: F + 3.45, pos: [0, 30, -80],
      child: { kind: "shape", shape: "rect", w: 4, h: 36, radius: 2, colors: PAL }, reveal: { dur: 0.4, at: 0.05 }, fx: [{ id: "lag", type: "delay", step: 0.004 }],
      keys: { spin: [[0, 0], [1.6, 40]], r: [[0, 200], [0.6, 520, EXPO]], opacity: [[0, 0.8]] } },
    { id: "f-logo", type: "text", text: "Fusion Motion", size: 200, font: TIGHT, weight: 700, color: "$ink", tracking: -6, pos: [0, 40, 50], in: F + 3.5,
      spans: [{ text: "Motion", font: SERIF, weight: 400, color: "$lav", size: 220 }],
      beh: [{ id: "in", use: "cascade", at: 0, by: "char", stagger: 0.03, dist: 120 }], keys: { blur: [[0, 22], [0.5, 0, "out"]], scale: [[0, 1.1], [1.5, 1, "easy"]] } },
    { id: "f-tag", type: "text", text: "describe it  ·  watch it move", size: 30, font: MONO, weight: 500, color: "$muted", tracking: 2, pos: [0, -120, 50], in: F + 3.95,
      spans: [{ text: "watch it move", color: "$lime" }], beh: [{ id: "in", use: "typewriter", at: 0, stagger: 0.03 }] },
    { id: "f-end", type: "adjust", name: "Fade out", in: T.end - 0.35, fadeColor: "$void", keys: { fade: [[0, 0], [0.35, 1, "in"]] } },
  );
  d.layers.find((l) => l.id === "w-app").keys["vars.n"] = [[0.5, 0], [1.9, d.layers.length, "expoOut"]];
  d.audio = [{ id: "score", src: "lib://music/showcase-s03", name: "Everything moves (score)", at: 0, offset: 0, volume: 1, fadeIn: 0, fadeOut: 0 }];
  out("s03-everything-moves", d);
}
