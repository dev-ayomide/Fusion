// Generates the four Pear-replica FMD docs (one per quadrant of the reference breakdown).
// Plain FMD JSON is the output; this script only saves typing repeated structures.
import fs from "node:fs";
const out = (name, doc) => fs.writeFileSync(new URL(`./${name}.fmd.json`, import.meta.url), JSON.stringify(doc, null, 1));
const base = (name, dur, extra = {}) => ({
  v: 1, name,
  comp: { w: 1920, h: 1080, fps: 30, dur, bg: "#fafbf8", cam: "shot", env: "sky", motionBlur: { angle: 200, samples: 8 },
    post: { bloom: 0.25, bloomThreshold: 1.1, grain: 0.12, vignette: 0.08 }, ...extra },
  brand: { font: "Inter Variable", colors: { lime: "#c9f23a", pale: "#eaf8b8", ink: "#16241a", sky: "#2f86e0", white: "#ffffff" } },
  assets: {}, markers: [], bindings: [], layers: [],
});
const cam = { id: "shot", type: "camera", fov: 35, pos: [0, 0, 1713] };

/* ------------------------------ Q1 — pear card → kinetic type ------------------------------ */
{
  const d = base("Pear Q1 — card + type", 3.3);
  d.comp.post.vignette = 0;
  const objs = [
    ["football", -250, 390, 150], ["coin", -700, 230, 120], ["target", -560, 70, 150], ["phone", 560, 380, 120],
    ["money", 830, 60, 130], ["star", 480, -40, 140], ["trophy", 760, -380, 190], ["gem", -600, -260, 150],
    ["basketball", -330, -330, 140], ["soccer", 260, -300, 120], ["fire", -80, -420, 100], ["rocket", -820, -60, 120],
  ];
  for (const [n] of objs) d.assets[n] = { src: `lib://emoji3d/${n}`, mime: "image/webp" };
  d.layers.push(cam,
    { id: "card", type: "group", name: "Pear card", out: 1.8,
      clip: { w: 1210, h: 675, radius: 44 },
      keys: {
        "clip.w": [[0, 1210], [0.25, 1110, "inOut"], [0.52, 1210, "inOut"], [0.74, 1780, "out"], [1.4, 1780], [1.52, 1650, "in"], [1.72, 860, "inOut"]],
        "clip.h": [[0, 675], [0.25, 615, "inOut"], [0.52, 675, "inOut"], [0.74, 960, "out"], [1.4, 960], [1.52, 870, "in"], [1.72, 350, "inOut"]],
        blur: [[1.48, 0], [1.72, 36, "in"]],
        opacity: [[1.62, 1], [1.8, 0]],
      } },
    { id: "cardsky", type: "sky", parent: "card", top: "#1a72d6", horizon: "#6fb4ec", clouds: 0.42, cloudScale: 1.5, sun: 0.2, seed: 3 },
    { id: "pear", type: "mesh", parent: "card", geom: "pear", material: "foil", color: "#c4ec3e", size: 600, pos: [0, -10, 150], rot: [8, 0, -6],
      keys: { size: [[0, 560], [0.25, 520, "inOut"], [0.52, 560, "inOut"], [0.74, 600, "out"], [1.4, 600], [1.72, 290, "inOut"]], "rot.y": [[0, -35], [1.8, 50]] },
      beh: [{ id: "bob", use: "float", at: 0, amp: 12, period: 2.2 }] },
  );
  objs.forEach(([n, x, y, w], i) => {
    const t0 = 0.6 + (i % 4) * 0.025;
    d.layers.push({ id: `o-${n}`, type: "image", parent: "card", src: n, w: Math.round(w * 1.6), pos: [x, y, 60],
      keys: {
        "pos.x": [[t0, x * 0.12], [t0 + 0.26, x, "out"], [1.38, x * 1.04, "inOut"], [1.66, x * 0.3, "in"]],
        "pos.y": [[t0, y * 0.12], [t0 + 0.26, y, "out"], [1.38, y * 1.04 + 10, "inOut"], [1.66, y * 0.3, "in"]],
        scale: [[t0, 0.2], [t0 + 0.26, 1, "out"], [1.4, 1.05], [1.66, 0.4, "in"]],
        opacity: [[t0, 0], [t0 + 0.08, 1]],
        "rot.z": [[t0, (i % 2 ? 1 : -1) * 90], [t0 + 0.35, 0, "out"], [1.66, (i % 2 ? -1 : 1) * 40, "in"]],
      },
      // keep orbiting while on screen, like the reference: a slow drift plus a gentle tumble
      beh: [{ id: "drift", use: "float", at: t0 + 0.2, amp: 26 + (i % 3) * 8, period: 1.3 + (i % 4) * 0.2 }, { id: "tumble", use: "sway", at: t0 + 0.2, deg: 14, period: 1.1 + (i % 3) * 0.25 }] });
  });
  // --- kinetic type
  d.layers.push(
    { id: "burst", type: "shape", name: "Glow burst", shape: "ellipse", w: 360, h: 360, fill: "$pale", pos: [-290, 0, -5], in: 1.72, out: 2.4, blur: 26,
      keys: { scale: [[0, 0.3], [0.25, 1.35, "out"], [0.6, 1.6]], opacity: [[0, 0], [0.06, 1], [0.35, 0.7], [0.62, 0, "in"]] } },
    { id: "type", type: "group", name: "Sentence", in: 1.72, keys: { scale: [[0.72, 1.85], [0.95, 1, "out"]], "pos.x": [[0.72, 520], [0.95, 0, "out"]] } },
    { id: "w-this", type: "text", parent: "type", in: 1.72, text: "This", size: 82, weight: 500, color: "$ink", align: "right", pos: [-352, 0, 0],
      keys: { blur: [[0, 18], [0.2, 0, "out"]], opacity: [[0, 0], [0.12, 1]] } },
    { id: "w-this-blue", type: "text", parent: "type", in: 1.72, text: "This", size: 82, weight: 500, color: "#4d8fc9", align: "right", pos: [-352, 0, 1],
      keys: { opacity: [[0, 0], [0.08, 1], [0.3, 1], [0.5, 0]] } },
    { id: "w-isnt", type: "text", parent: "type", in: 1.72, text: "isn't", size: 118, font: "Caveat", weight: 700, color: "$ink", align: "left", pos: [-326, -4, 0],
      anim: [{ id: "write", sel: { by: "char", shape: "smooth", start: 0, end: 0.25, offset: [[0.3, -0.25], [0.62, 1, "linear"]] }, add: { wipe: 1 } }] },
    { id: "w-rest", type: "text", parent: "type", in: 1.72, text: "a prediction market", size: 82, weight: 500, color: "$ink", align: "left", pos: [-120, 0, 0],
      anim: [{ id: "pop", sel: { by: "word", shape: "smooth", start: 0, end: 0.4, offset: [[0.75, -0.4], [1.05, 1, "out"]] }, add: { opacity: -1, pos: [0, -24, 0], scale: -0.25 } }] },
    { id: "loopfade", type: "adjust", name: "Loop fade", fadeColor: "#fafbf8", in: 3.1, keys: { fade: [[0, 0], [0.2, 1, "in"]] } },
  );
  out("q1", d);
}


/* ------------------------------ Q2 — trade UI → Insights → Back your instincts ------------------------------ */
{
  const d = base("Pear Q2 — trade, insights, instincts", 4.97);
  d.comp.post.vignette = 0.12;
  const row = (k, v, c = "#1b1f24") => `<div style="display:flex;justify-content:space-between;padding:11px 0;font-size:25px;color:#8a9099"><span>${k}</span><span style="color:${c}">${v}</span></div>`;
  const trade = `<div style="background:#ffffff;width:100%;height:100%;padding:34px 44px;font-family:'Inter Variable';color:#15181c">
<div style="width:70px;height:6px;border-radius:3px;background:#e4e6ea;margin:0 auto 34px"></div>
<div style="display:flex;justify-content:space-between;align-items:center"><div style="font-size:44px;font-weight:600">Place trade</div>
<div style="font-size:21px;font-weight:600;color:#23a94f;background:#e9f9ee;padding:8px 16px;border-radius:12px">Yes · $67,200 or above</div></div>
<div style="display:flex;margin-top:26px;background:#f1f2f4;border-radius:16px;padding:6px;font-size:22px;font-weight:600;text-align:center">
<div style="flex:1;background:#fff;border-radius:12px;padding:10px;box-shadow:0 2px 6px rgba(0,0,0,.08)">Market</div><div style="flex:1;padding:10px;color:#8a9099">Limit</div></div>
<div style="margin-top:22px;border:2px solid #e8eaee;border-radius:20px;padding:18px 24px"><div style="font-size:20px;color:#9aa0a8">Amount</div>
<div style="font-size:64px;font-weight:500;margin-top:4px"><span style="color:#9aa0a8;font-size:34px">$ </span>{{amt}}<span style="display:inline-block;width:3px;height:52px;background:#15181c;margin-left:4px;opacity:{{caret}}"></span></div></div>
<div style="display:flex;gap:26px;margin-top:22px;font-size:23px;font-weight:600"><span>$50</span><span>$100</span><span>Max</span><span style="margin-left:auto;font-weight:400;color:#8a9099">Balance $240.00</span></div>
<div style="margin-top:34px">${row("Shares", "74.6")}${row("Avg price", "$0.67")}${row("Payout if Yes wins", "$74.60", "#23a94f")}${row("Max loss", "$50.00")}${row("Cashback rewards (0.5%)", "$2.50")}</div>
<div style="margin-top:34px;background:#9df0a8;border-radius:22px;padding:30px;text-align:center;font-size:32px;font-weight:600;color:#118a3a">Confirm · $50 on Yes</div></div>`;
  const insights = `<div style="width:100%;height:100%;padding:44px 52px;font-family:'Inter Variable';color:#ffffff">
<div style="display:flex;justify-content:space-between;align-items:center"><div style="font-size:40px;font-weight:600">Insights</div><div style="width:26px;height:30px;border:3px solid rgba(255,255,255,.85);border-radius:13px 13px 6px 6px"></div></div>
<div style="display:flex;align-items:baseline;gap:22px;margin-top:62px"><div style="font-size:84px;font-weight:500;letter-spacing:-2px">+$<span>{{v:2}}</span></div>
<div style="font-size:28px;color:rgba(255,255,255,.8)"><span style="color:#35d06a">▲</span> {{p:1}}% today</div></div></div>`;
  d.layers.push(cam,
    // --- A: trade panel on white, types an amount, scrolls to Confirm, then whips up
    { id: "day", type: "sky", name: "Sky", top: "#0f5cc6", horizon: "#6fb2ec", clouds: 0.32, cloudScale: 1.4, sun: 0.3, seed: 11 },
    { id: "insights", type: "html", name: "Insights card", in: 1.98, out: 3.85, w: 1200, h: 1000, radius: 48, pos: [0, -1200, 0], html: insights,
      glass: { blur: 34, tint: "#5c9ae0", amount: 0.22, rim: 0.35 }, vars: { v: 174.45, p: 0.9 },
      keys: { "pos.y": [[0, -1300], [0.45, -90, "out"], [1.3, -60]], "vars.v": [[0.2, 174.45], [1.2, 339.47, "out"]], "vars.p": [[0.2, 0.9], [1.2, 3.0, "out"]], blur: [[0, 22], [0.35, 0, "out"]] } },
    { id: "chart", type: "path", name: "Chart", in: 1.98, out: 3.85, parent: "insights", pos: [0, -260, 2], smooth: true, width: 6, stroke: "#6fe38a", glow: 0.5, fillTo: -150, fill: "#6fe38a",
      points: [[-560, -120], [-420, -90], [-300, -100], [-180, -60], [-60, -70], [60, -20], [150, -40], [240, 30], [320, -30], [420, 60], [520, 140]],
      keys: { trimEnd: [[0.4, 0], [1.25, 1, "inOut"]] } },
    { id: "paper", type: "shape", name: "White page", shape: "rect", w: 1920, h: 1080, fill: "#fafbfc", out: 2.2,
      keys: { "pos.y": [[1.84, 0], [2.12, 1500, "in"]] } },
    { id: "trade", type: "html", name: "Trade panel", out: 2.2, w: 1100, h: 1060, radius: 36, pos: [0, -60, 0], html: trade, vars: { amt: 0, caret: 1 },
      shadow: { x: 0, y: -10, blur: 60, color: "#1a2a40", opacity: 0.08 },
      keys: {
        "pos.y": [[0, -800], [0.22, -60, "out"], [1.0, -60], [1.2, 420, "inOut"], [1.8, 440], [2.12, 2000, "in"]],
        "vars.amt": [[0.4, 0, "hold"], [0.55, 5, "hold"], [0.72, 50, "hold"]],
        "vars.caret": [[0, 1, "hold"], [0.8, 0, "hold"]],
        blur: [[0, 16], [0.2, 0, "out"]],
      } },
    { id: "press", type: "shape", name: "Confirm press", parent: "trade", shape: "rect", w: 1012, h: 104, radius: 22, fill: "#ffffff", out: 2.2, pos: [0, -440, 1], opacity: 0,
      keys: { opacity: [[1.55, 0], [1.6, 0.4], [1.8, 0]] } },
    // --- white flash into the mountains
    { id: "flash", type: "adjust", name: "White flash", fadeColor: "#ffffff", in: 3.5, out: 4.15, keys: { fade: [[0, 0], [0.2, 0.65, "in"], [0.3, 0.65], [0.6, 0, "out"]] } },
    { id: "mtn", type: "sky", name: "Mountains", in: 3.72, top: "#0c4aa8", horizon: "#3d8ad8", clouds: 0.18, cloudScale: 1.6, mountains: true, mountainHeight: 0.62, sun: 0.2, seed: 5 },
    
    { id: "instincts", type: "group", name: "Back your instincts", in: 3.72, pos: [0, 90, 0], keys: { scale: [[0, 1.08], [1.25, 1, "out"]] } },
    { id: "back", type: "text", parent: "instincts", in: 3.72, text: "Back", size: 150, font: "Caveat", weight: 700, color: "$lime", align: "right", pos: [-190, -6, 0],
      anim: [{ id: "write", sel: { by: "char", shape: "smooth", start: 0, end: 0.3, offset: [[0.05, -0.3], [0.45, 1, "linear"]] }, add: { wipe: 1 } }] },
    { id: "yours", type: "text", parent: "instincts", in: 3.72, text: "your instincts", size: 112, weight: 500, color: "#ffffff", align: "left", pos: [-120, 0, 0],
      anim: [{ id: "in", sel: { by: "word", shape: "smooth", start: 0, end: 0.5, offset: [[0.3, -0.5], [0.8, 1, "out"]] }, add: { opacity: -1, pos: [30, 0, 0] } }] },
    { id: "loopflash", type: "adjust", name: "Loop flash", fadeColor: "#fafbfc", in: 4.72, keys: { fade: [[0, 0], [0.25, 1, "in"]] } },
  );
  out("q2", d);
}

/* ------------------------------ Q3 — the lime phone and the group chat ------------------------------ */
{
  const d = base("Pear Q3 — phone chat", 3.83);
  d.comp.post.vignette = 0.1;
  const screen = `<div style="width:100%;height:100%;background:linear-gradient(180deg,#b9c3e6 0%,#d8dcef 55%,#e4e5f1 100%);font-family:'Inter Variable'"></div>`;
  const bubble = (script, rest, me, w) => `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:${me ? "flex-end" : "flex-start"}">
<div style="background:#4a6076;color:#ffffff;border-radius:40px;padding:22px 36px;font-size:44px;font-weight:600;line-height:1.12;max-width:${w}px;letter-spacing:-0.5px">
<span style="font-family:Caveat;font-weight:700;font-size:54px;color:#c9f23a">${script}</span> ${rest}</div></div>`;
  const input = `<div style="width:100%;height:100%;display:flex;align-items:center;gap:22px;font-family:'Inter Variable'">
<div style="width:92px;height:92px;border-radius:46px;background:#f4f5fa;display:flex;align-items:center;justify-content:center;font-size:60px;color:#23262c;font-weight:300">+</div>
<div style="flex:1;height:92px;border-radius:46px;background:#f7f8fc;border:2px solid #e3e5ee;display:flex;align-items:center;padding:0 34px;font-size:38px;color:#a4a9b8">iMessage</div></div>`;
  d.layers.push(
    { id: "shot", type: "camera", fov: 40, pos: [0, -160, 1900], target: [0, 60, 0],
      keys: { "pos.x": [[0, 420], [1.3, -200, "inOut"], [2.5, 260, "inOut"], [3.83, -380, "inOut"]], "pos.y": [[0, -380], [1.9, -220, "inOut"], [3.83, -340, "inOut"]] } },
    { id: "sky", type: "sky", top: "#3a88dc", horizon: "#a2d2f2", clouds: 0.5, cloudScale: 1.5, sun: 0.2, seed: 21 },
    { id: "phone", type: "group", name: "Phone", pos: [40, 200, 0], rot: [-32, 8, 10],
      keys: {
        "rot.y": [[0, 78], [0.32, 6, "out"], [3.45, -8], [3.8, -88, "in"]],
        "rot.z": [[0, 18], [0.32, 12, "out"], [1.1, 4, "inOut"], [1.9, -6, "inOut"], [2.7, 8, "inOut"], [3.45, 4, "inOut"], [3.8, -4, "in"]],
        "rot.x": [[0, -30], [0.32, -34, "out"], [1.5, -26, "inOut"], [2.6, -36, "inOut"], [3.8, -30, "inOut"]],
        "pos.y": [[0.3, -40], [1.2, 40, "inOut"], [2.0, 150, "inOut"], [2.8, 260, "inOut"]],
        "pos.x": [[0, 260], [0.32, 60, "out"], [1.3, -120, "inOut"], [2.3, 80, "inOut"], [3.3, -60, "inOut"], [3.83, 40, "inOut"]],
      } },
    { id: "body", type: "mesh", parent: "phone", geom: "slab", dims: [860, 1760, 70], radius: 150, size: 1, material: "plastic", color: "#c6f025", roughness: 0.28 },
    { id: "bezel", type: "mesh", parent: "phone", geom: "slab", dims: [810, 1710, 72], radius: 128, size: 1, material: "plastic", color: "#101214", roughness: 0.4, pos: [0, 0, 1] },
    { id: "screen", type: "html", parent: "phone", w: 780, h: 1680, radius: 112, pos: [0, 0, 38], html: screen },
    { id: "clock", type: "text", parent: "phone", text: "Today 9:41 AM", size: 30, weight: 500, color: "#6b7188", pos: [0, 330, 40] },
    { id: "input", type: "html", parent: "phone", w: 700, h: 100, pos: [0, -700, 40], html: input },
  );
  const bubbles = [
    ["England", "is sooo close to winning", true, 560, 0.28, 230],
    ["Argentina", "will fuck them up", false, 640, 0.95, 70],
    ["", "you sure? haha, i bet on <span style=\"font-family:Caveat;font-weight:700;font-size:54px;color:#c9f23a\">Spain</span>", false, 420, 1.75, -110],
    ["France", "will win", false, 400, 2.55, -300],
  ];
  bubbles.forEach(([sc, rest, me, w, at, y], i) => {
    const h = i === 2 ? 170 : i === 0 ? 170 : 110;
    d.layers.push({ id: `b${i + 1}`, type: "html", parent: "phone", in: at, w: 720, h, pos: [0, y - 0, 40 + i * 0.1], html: bubble(sc, rest, me, w),
      keys: { scale: [[0, 0.55], [0.32, 1, "out"]], opacity: [[0, 0], [0.1, 1]], "pos.y": [[0, y - 90], [0.32, y, "out"]], "pos.x": [[0, me ? 120 : -120], [0.32, 0, "out"]] } });
  });
  out("q3", d);
}

/* ------------------------------ Q4 — night → day, best odds, confirm ------------------------------ */
{
  const d = base("Pear Q4 — trade and share", 4.57);
  d.comp.post.vignette = 0.15;
  const rowH = (name, sub, price, shares, badge) => `<div style="display:flex;align-items:center;background:#ffffff;border-radius:22px;padding:18px 24px;height:100px;margin-top:16px">
<div style="width:30px;height:30px;border-radius:15px;border:3px solid #c9ced6;margin-right:20px"></div>
<div style="flex:1"><div style="font-size:27px;font-weight:600;color:#15181c">${name}${badge ? ` <span style="font-size:17px;background:#15181c;color:#fff;border-radius:10px;padding:3px 10px;margin-left:6px">Best</span>` : ""}</div><div style="font-size:18px;color:#9aa0a8;margin-top:4px">${sub}</div></div>
<div style="text-align:right"><div style="font-size:30px;font-weight:700;color:#15181c">${price}</div><div style="font-size:18px;color:#9aa0a8;margin-top:2px">${shares}</div></div></div>`;
  const card = `<div style="width:100%;height:100%;padding:26px 30px;font-family:'Inter Variable'">
<div style="width:70px;height:6px;border-radius:3px;background:rgba(255,255,255,.8);margin:0 auto"></div>
<div style="height:170px"></div>
<div style="text-align:center;font-size:30px;font-weight:600;color:rgba(255,255,255,.95)">Manifold</div>
<div style="text-align:center;margin-top:12px"><span style="background:#d4f76a;color:#2c3a06;font-size:19px;font-weight:600;padding:7px 18px;border-radius:14px">Best odds found</span></div>
</div>`;
  const rowY = [70, -48, -166]; // centres of the three rows inside the card (card-local)
  const q4cam = { ...cam, keys: { "pos.z": [[0, 1713], [4.57, 1540, "inOut"]], "pos.x": [[0, -90], [4.57, 90, "inOut"]], "pos.y": [[0, 30], [4.57, -30, "inOut"]] } };
  d.layers.push(q4cam,
    { id: "day", type: "sky", name: "Day", top: "#1a5fc6", horizon: "#9fcdf0", clouds: 0.36, cloudScale: 1.4, hills: "#2f6a2a", hillHeight: 0.55, grass: "#2c6a18", sun: 0.35, seed: 8 },
    { id: "night", type: "sky", name: "Night", out: 0.95, top: "#040a1e", horizon: "#1b3264", clouds: 0.42, cloudScale: 1.4, hills: "#0b1d14", hillHeight: 0.55, grass: "#0f2a14", stars: 0.8, sun: 0, seed: 8,
      keys: { opacity: [[0.58, 1], [0.9, 0, "inOut"]] } },
    { id: "title", type: "text", name: "Trade and Share", text: "Trade and Share", size: 168, weight: 500, color: "#ffffff", out: 1.0, pos: [0, 40, 0],
      spans: [{ text: "and", color: "$lime" }], keys: { blur: [[0.55, 0], [0.9, 30, "in"]], opacity: [[0.62, 1], [0.95, 0]], scale: [[0, 1], [0.95, 1.06]] } },
    { id: "mcard", type: "html", name: "Odds card", in: 0.62, out: 3.15, w: 860, h: 900, radius: 44, pos: [0, -120, 0], html: card,
      glass: { blur: 30, tint: "#e8f1ff", amount: 0.22, rim: 0.4 },
      keys: { "pos.y": [[0, -900], [0.4, -150, "out"], [2.2, -130]], blur: [[0, 26], [0.35, 0, "out"], [2.25, 0], [2.5, 30, "in"]], opacity: [[2.3, 1], [2.53, 0]] } },
    { id: "sel", type: "shape", name: "Selection", parent: "mcard", in: 0.62, out: 3.15, shape: "rect", w: 810, h: 108, radius: 24, fill: "#e2fb93", stroke: "#bff03a", strokeWidth: 4, pos: [0, rowY[2], 1],
      keys: { "pos.y": [[0.55, rowY[2], "hold"], [1.02, rowY[1], "out"], [1.25, rowY[1]], [1.72, rowY[0], "out"]], opacity: [[0.3, 0], [0.45, 1]] } },
  );
  // rows: white plates, the moving lime selection, then transparent text on top
  const rows = [["Polymarket", "Recommended", "$0.67", "74.6 shares", true], ["Kalshi", "-2.1 shares vs best", "$0.65", "72.5 shares"], ["Manifold", "-4.2 shares vs best", "$0.63", "70.4 shares"]];
  rows.forEach((r, i) => d.layers.splice(d.layers.findIndex((L) => L.id === "sel"), 0,
    { id: `plate${i}`, type: "shape", parent: "mcard", in: 0.62, out: 3.15, shape: "rect", w: 800, h: 100, radius: 22, fill: "#ffffff", pos: [0, rowY[i], 0.5] }));
  rows.forEach((r, i) => d.layers.push({ id: `row${i}`, type: "html", parent: "mcard", in: 0.62, out: 3.15, w: 800, h: 100, pos: [0, rowY[i], 2],
    html: rowH(...r).replace("background:#ffffff;", "").replace("margin-top:16px", "margin-top:0") }));
  const logos = [["#7b4fe6", 0.62, 1.3], ["#27c28f", 1.3, 2.0], ["#3a6be0", 2.0, 3.15]];
  logos.forEach(([c, a, b], i) => d.layers.push({ id: `logo${i}`, type: "mesh", name: "Logo", parent: "mcard", in: a, out: b, geom: "box", size: 130, material: "plastic", color: c, pos: [0, 300, 60],
    keys: { "rot.y": [[0, -40], [b - a, 60]], "rot.x": [[0, 20], [b - a, -10]], scale: [[0, 0.6], [0.2, 1, "out"]] } }));
  d.layers.push(
    { id: "confirm", type: "shape", name: "Confirm", in: 2.45, shape: "rect", w: 1000, h: 110, radius: 30, fill: "#eefbb4", pos: [0, -40, 0],
      keys: { opacity: [[0, 0], [0.2, 1]], blur: [[0, 20], [0.25, 0, "out"]], scale: [[0, 0.9], [0.3, 1, "out"], [0.7, 1], [0.8, 0.96, "inOut"], [0.95, 1, "out"]] } },
    { id: "confirmhot", type: "shape", name: "Confirm pressed", in: 3.2, out: 3.7, shape: "rect", w: 1000, h: 110, radius: 30, fill: "#c9f23a", pos: [0, -40, 0.5],
      keys: { opacity: [[0, 0], [0.08, 1], [0.35, 1], [0.5, 0]] } },
    { id: "confirmlabel", type: "text", name: "Confirm label", in: 2.45, text: "Confirm", size: 34, weight: 600, color: "#2a3308", pos: [0, -52, 1], keys: { opacity: [[0, 0], [0.25, 1]] } },
    { id: "fog", type: "adjust", name: "Cloud dissolve", in: 3.55, fadeColor: "#f4f7fa", dissolve: 1, keys: { fade: [[0, 0], [0.85, 1, "inOut"]] } },
  );
  out("q4", d);
}
console.log("ok");
