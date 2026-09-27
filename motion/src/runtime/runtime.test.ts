import { describe, expect, it } from "vitest";
import { easeFn, EASE_NAMES, springEase, isValidEase } from "./ease";
import { fbm, noise1 } from "./noise";
import { evalExpr, exprError } from "./expr";
import { evaluate, keyVal, channel, textUnits, evalLayer } from "./evaluate";
import { launchTemplate, logoTemplate, kineticTemplate } from "../templates";
import type { Doc, Layer } from "../fmd/schema";
import { fitDistance } from "../fmd/schema";

const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe("easing", () => {
  it("every named ease hits exact endpoints", () => {
    for (const n of EASE_NAMES) {
      close(easeFn(n)(0), 0);
      close(easeFn(n)(1), 1);
    }
  });
  it("cubic() matches endpoints and midpoint symmetry for inOut-like curves", () => {
    const f = easeFn("cubic(0.42,0,0.58,1)");
    close(f(0), 0);
    close(f(1), 1);
    close(f(0.5), 0.5, 1e-3);
  });
  it("spring(dur,bounce) is exact at both ends for every bounce", () => {
    for (const b of [0, 0.1, 0.3, 0.5, 0.7, 0.9]) {
      const f = springEase(b);
      close(f(0), 0);
      close(f(1), 1);
      close(easeFn(`spring(0.8,${b})`)(1), 1);
    }
  });
  it("bouncy springs overshoot, critical springs don't", () => {
    const peak = (b: number) => Math.max(...Array.from({ length: 200 }, (_, i) => springEase(b)(i / 200)));
    expect(peak(0.6)).toBeGreaterThan(1.05);
    expect(peak(0)).toBeLessThanOrEqual(1.0001);
  });
  it("spring is settled near the end of the segment", () => {
    close(springEase(0.5)(0.97), 1, 0.02);
  });
  it("validates ease strings", () => {
    expect(isValidEase("out")).toBe(true);
    expect(isValidEase("spring(0.8,0.4)")).toBe(true);
    expect(isValidEase("cubic(0.1,0.2,0.3,0.4)")).toBe(true);
    expect(isValidEase("wobbly")).toBe(false);
  });
  it("unknown eases fall back to linear rather than crash", () => {
    close(easeFn("nope")(0.25), 0.25);
  });
});

describe("keyframes", () => {
  const tr: [number, number, string?][] = [[0, 0], [1, 10], [2, 30, "inOut"]];
  it("holds before first and after last", () => {
    expect(keyVal(tr as never, -1)).toBe(0);
    expect(keyVal(tr as never, 5)).toBe(30);
  });
  it("interpolates linearly by default and eases into eased keys", () => {
    close(keyVal(tr as never, 0.5), 5);
    close(keyVal(tr as never, 1.5), 20, 1e-3); // inOut midpoint
    expect(keyVal(tr as never, 1.25)).toBeLessThan(12.5);
  });
});

describe("noise", () => {
  it("is deterministic and bounded", () => {
    for (let i = 0; i < 200; i++) {
      const x = i * 0.137;
      expect(noise1(7, x)).toBe(noise1(7, x));
      expect(Math.abs(fbm(3, x))).toBeLessThanOrEqual(1);
    }
    expect(noise1(1, 0.5)).not.toBe(noise1(2, 0.5));
  });
  it("is zero at integer lattice points (gradient noise)", () => {
    close(noise1(9, 3), 0);
  });
});

describe("expressions", () => {
  const s = { t: 2, value: 10, base: 5, i: 1, n: 4, w: 1920, h: 1080, fps: 30 };
  it("arithmetic, precedence and power", () => {
    expect(evalExpr("1 + 2 * 3", s, 0)).toBe(7);
    expect(evalExpr("(1 + 2) * 3", s, 0)).toBe(9);
    expect(evalExpr("2 ^ 3 ^ 2", s, 0)).toBe(512);
    expect(evalExpr("-2 ^ 2", s, 0)).toBe(-4);
    expect(evalExpr("10 % 4", s, 0)).toBe(2);
  });
  it("bound names, functions, ternary, logic", () => {
    expect(evalExpr("value + t * 10", s, 0)).toBe(30);
    expect(evalExpr("clamp(value, 0, 3)", s, 0)).toBe(3);
    expect(evalExpr("t > 1 ? base : 0", s, 0)).toBe(5);
    expect(evalExpr("t > 1 && i == 1", s, 0)).toBe(1);
    expect(evalExpr("!0", s, 0)).toBe(1);
    close(evalExpr("sin(pi / 2)", s, 0), 1);
    expect(evalExpr("lerp(0, 100, 0.25)", s, 0)).toBe(25);
  });
  it("reports errors and falls back without throwing", () => {
    expect(exprError("1 +")).toMatch(/end/);
    expect(exprError("foo(1)")).toMatch(/unknown function/);
    expect(exprError("window")).toMatch(/unknown name/);
    expect(evalExpr("1 / 0", s, 99)).toBe(0);
    expect(evalExpr("broken(", s, 42)).toBe(42);
  });
  it("cannot reach JS globals", () => {
    expect(exprError("constructor")).not.toBeNull();
    expect(exprError("this")).not.toBeNull();
  });
});

function mini(layers: Layer[], dur = 4): Doc {
  return { v: 1, comp: { w: 1920, h: 1080, fps: 30, dur, bg: "#000000" }, brand: { font: "Inter", colors: { ink: "#ffffff" } }, assets: {}, markers: [], style: { energy: 0.5, bounce: 0.5, depth: 0.5, speed: 0.5 }, bindings: [], scenes: [], audio: [], layers };
}

describe("composition pipeline", () => {
  const L: Layer = { id: "a", type: "shape", shape: "rect", w: 100, h: 100, pos: [0, 50, 0], in: 1, beh: [{ id: "r", use: "rise", at: 0.5, dur: 1, dist: 200, ease: "linear" }] };
  const d = mini([L]);
  it("owner holds its from-pose before `at` (layer-local time)", () => {
    // comp t=1.2 → local 0.2 < at 0.5
    close(channel(d, L, "pos.y", 0.2), 50 - 200);
    close(channel(d, L, "opacity", 0.2), 0);
  });
  it("owner reaches rest pose at at+dur and stays there", () => {
    close(channel(d, L, "pos.y", 1.5), 50);
    close(channel(d, L, "pos.y", 3), 50);
    close(channel(d, L, "opacity", 3), 1);
  });
  it("moving `in` shifts the whole animation (local time)", () => {
    const f1 = evalLayer(d, L, 2.0);
    const moved = { ...L, in: 2 };
    const f2 = evalLayer(mini([moved]), moved, 3.0);
    close(f1.xf.y, f2.xf.y);
  });
  it("visibility follows in/out", () => {
    expect(evalLayer(d, L, 0.5).visible).toBe(false);
    expect(evalLayer(d, L, 1).visible).toBe(true);
    expect(evalLayer(d, { ...L, out: 2 }, 2.5).visible).toBe(false);
  });
  it("add behaviors stack on keys and are identity outside their window", () => {
    const f: Layer = { id: "f", type: "shape", shape: "rect", w: 10, h: 10, keys: { "pos.y": [[0, 0], [2, 100]] }, beh: [{ id: "b", use: "float", at: 1, dur: 1, amp: 20, period: 4 }] };
    close(channel(mini([f]), f, "pos.y", 0.5), 25);
    close(channel(mini([f]), f, "pos.y", 2), 120); // dt=1 is a quarter period → +amp
    close(channel(mini([f]), f, "pos.y", 2.5), 100); // outside the window → identity
  });
  it("expression runs last and can read value", () => {
    const e: Layer = { id: "e", type: "shape", shape: "rect", w: 10, h: 10, pos: [0, 10, 0], expr: { "pos.y": "value * 2 + t" } };
    close(channel(mini([e]), e, "pos.y", 3), 23);
  });
  it("enter and exit owners on one channel hand over in time order", () => {
    const x: Layer = { id: "x", type: "shape", shape: "rect", w: 10, h: 10, beh: [{ id: "i", use: "fadeIn", at: 0, dur: 1, ease: "linear" }, { id: "o", use: "fadeOut", at: 3, dur: 1, ease: "linear" }] };
    const dd = mini([x], 5);
    close(channel(dd, x, "opacity", 0.5), 0.5);
    close(channel(dd, x, "opacity", 2), 1);
    close(channel(dd, x, "opacity", 3.5), 0.5);
    close(channel(dd, x, "opacity", 4.5), 0);
  });
});

describe("float add behavior value", () => {
  it("adds amp·sin at the quarter period", () => {
    const f: Layer = { id: "f", type: "shape", shape: "rect", w: 10, h: 10, beh: [{ id: "b", use: "float", at: 0, amp: 20, period: 4 }] };
    close(channel(mini([f]), f, "pos.y", 1), 20);
  });
});

describe("text", () => {
  it("indexes chars, words and lines; spaces don't count as chars", () => {
    const u = textUnits("Hi there\nyou");
    expect(u.chars.join("")).toBe("Hi thereyou");
    expect(u.counts).toEqual({ char: 10, word: 3, line: 2 });
    expect(u.wordIdx[u.chars.indexOf("y")]).toBe(2);
    expect(u.lineIdx[u.chars.indexOf("y")]).toBe(1);
  });
  it("typeUp reveals glyphs one after another", () => {
    const t: Layer = { id: "t", type: "text", text: "abc", size: 50, beh: [{ id: "b", use: "typeUp", at: 0, dur: 0.2, stagger: 0.5 }] };
    const d = mini([t]);
    const g = evalLayer(d, t, 0.6).glyphs!;
    expect(g[0].o).toBeGreaterThan(0.99);
    expect(g[1].o).toBeGreaterThan(0.2);
    expect(g[2].o).toBe(0);
  });
  it("selector offset reveals left to right (golden)", () => {
    const t: Layer = { id: "t", type: "text", text: "abcde", size: 50, anim: [{ id: "a", sel: { by: "char", shape: "ramp", start: 0, end: 0.25, offset: [[0, -0.25], [1, 1]] }, add: { opacity: -1 } }] };
    const d = mini([t]);
    expect(evalLayer(d, t, 0).glyphs!.map((g) => g.o)).toEqual([0, 0, 0, 0, 0]);
    const mid = evalLayer(d, t, 0.5).glyphs!.map((g) => g.o);
    expect(mid[0]).toBe(1);
    expect(mid[4]).toBe(0);
    expect(evalLayer(d, t, 1).glyphs!.every((g) => g.o === 1)).toBe(true);
  });
});

describe("cloner", () => {
  it("radial layout puts n items on the radius, reveal staggers by delay", () => {
    const c: Layer = { id: "c", type: "cloner", mode: "radial", n: 4, r: 100, child: { kind: "shape", w: 10 }, reveal: { dur: 0.5 }, fx: [{ id: "d", type: "delay", step: 1 }] };
    const f = evalLayer(mini([c]), c, 0.6);
    for (const k of f.clones!) close(Math.hypot(k.x, k.y), 100, 1e-6);
    expect(f.clones![0].s).toBeGreaterThan(0.9);
    expect(f.clones![1].s).toBe(0);
  });
  it("grid is centred", () => {
    const c: Layer = { id: "c", type: "cloner", mode: "grid", n: 9, gap: 10, child: { kind: "shape", w: 5 } };
    const f = evalLayer(mini([c]), c, 0);
    close(f.clones!.reduce((a, k) => a + k.x, 0), 0);
    close(f.clones![4].x, 0);
    close(f.clones![4].y, 0);
  });
});

describe("camera", () => {
  it("defaults to fit distance so 1 unit = 1 px at z=0", () => {
    close(fitDistance(1080, 35), 1712.64, 0.05);
    const d = mini([{ id: "cam", type: "camera" }]);
    close(evaluate(d, 0).camera.z, fitDistance(1080, 35));
  });
  it("dolly moves toward `to`", () => {
    const d = mini([{ id: "cam", type: "camera", beh: [{ id: "p", use: "dolly", at: 0, dur: 2, to: 1000, ease: "linear" }] }]);
    close(evaluate(d, 1).camera.z, (fitDistance(1080) + 1000) / 2, 1e-6);
  });
});

describe("templates evaluate cleanly at every frame", () => {
  for (const make of [launchTemplate, kineticTemplate, logoTemplate]) {
    it(make.name, () => {
      const d = make();
      for (let f = 0; f <= d.comp.dur * d.comp.fps; f += 3) {
        const fr = evaluate(d, f / d.comp.fps);
        for (const l of fr.layers) {
          for (const v of Object.values(l.xf)) expect(Number.isFinite(v)).toBe(true);
          for (const g of l.glyphs ?? []) expect(Number.isFinite(g.dy + g.o + g.s)).toBe(true);
        }
      }
    });
  }
  it("is deterministic (same doc + t → same frame)", () => {
    const d = launchTemplate();
    const a = JSON.stringify(evaluate(d, 2.345).layers);
    const b = JSON.stringify(evaluate(structuredClone(d), 2.345).layers);
    expect(a).toBe(b);
  });
});
