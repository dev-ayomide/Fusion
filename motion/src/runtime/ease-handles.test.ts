import { describe, it, expect } from "vitest";
import { cubicOf, withHandles, easeFn, BEZIER } from "./ease";
import { easeKeyOps } from "../editor/edit";
import { applyTxn } from "../fmd/ops";
import { Doc } from "../fmd/schema";

describe("bézier handles", () => {
  it("reads named and cubic eases, not springs", () => {
    expect(cubicOf("easy")).toEqual([0.333, 0, 0.667, 1]);
    expect(cubicOf("cubic(0.1, 0.2, 0.3, 0.4)")).toEqual([0.1, 0.2, 0.3, 0.4]);
    expect(cubicOf(undefined)).toEqual([0, 0, 1, 1]);
    expect(cubicOf("spring(1,0.4)")).toBeNull();
    expect(cubicOf("hold")).toBeNull();
  });
  it("rewrites one side and snaps back to names when it matches one", () => {
    expect(withHandles("linear", { in: [0.667, 1] })).toBe("easyIn");
    expect(withHandles("easyIn", { out: [0.333, 0] })).toBe("easy");
    expect(withHandles("easy", { in: [0.5, 1.2] })).toBe("cubic(0.333,0,0.5,1.2)");
    expect(withHandles("easy", { out: [-3, 0.2] })).toBe("cubic(0,0.2,0.667,1)"); // x is clamped to 0..1
  });
  it("named béziers are exact at the ends", () => {
    for (const k of Object.keys(BEZIER)) {
      expect(easeFn(k)(0)).toBe(0);
      expect(easeFn(k)(1)).toBe(1);
    }
  });
});

describe("easy ease (F9)", () => {
  const doc = Doc.parse({
    v: 1, comp: { w: 1920, h: 1080, fps: 30, dur: 4, bg: "#000000" }, brand: { font: "Inter Variable", colors: {} },
    layers: [{ id: "a", type: "shape", shape: "rect", w: 10, h: 10, keys: { "pos.x": [[0, 0], [1, 100, "out"], [2, 0]] } }],
  });
  it("eases both sides of a middle key and keeps the other handles", () => {
    const ops = easeKeyOps(doc, { layer: "a", channel: "pos.x", index: 1 }, "easy");
    const r = applyTxn(doc, ops, { source: "you" });
    const tr = r.doc.layers[0].keys!["pos.x"];
    expect(tr[1][2]).toBe("cubic(0.22,1,0.667,1)"); // the arriving segment kept its outgoing handle
    expect(tr[2][2]).toBe("easyOut");
  });
  it("in / out only touch their side; linear resets", () => {
    const inOnly = applyTxn(doc, easeKeyOps(doc, { layer: "a", channel: "pos.x", index: 1 }, "in"), { source: "you" }).doc;
    expect(inOnly.layers[0].keys!["pos.x"][2][2]).toBeUndefined();
    const lin = applyTxn(doc, easeKeyOps(doc, { layer: "a", channel: "pos.x", index: 1 }, "linear"), { source: "you" }).doc;
    expect(lin.layers[0].keys!["pos.x"][1][2]).toBe("cubic(0.22,1,1,1)");
    expect(lin.layers[0].keys!["pos.x"][2]).toHaveLength(2);
  });
  it("is a no-op for a missing key", () => {
    expect(easeKeyOps(doc, { layer: "a", channel: "nope", index: 0 }, "easy")).toEqual([]);
  });
});
