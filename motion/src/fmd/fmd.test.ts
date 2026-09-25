import { describe, expect, it } from "vitest";
import fc from "fast-check";
import "../runtime/evaluate"; // registers the bake sampler
import { applyTxn, applyPrims, validate, describeOp, type Op } from "./ops";
import { getPath, setPath, delPath, locate } from "./paths";
import { outline, inspect, catalog } from "./outline";
import { launchTemplate, kineticTemplate } from "../templates";
import type { Doc } from "./schema";

const ok = (doc: Doc, ops: Op[], source: "you" | "ai" | "style" = "you") => {
  const r = applyTxn(doc, ops, { source });
  if (!r.ok) throw new Error(r.errors.join("\n"));
  return r;
};

describe("paths", () => {
  const d = launchTemplate();
  it("reads layer fields, tuple components, id-items and root fields", () => {
    expect(getPath(d, "phone/pos/x")).toBe(-420);
    expect(getPath(d, "phone/pos/0")).toBe(-420);
    expect(getPath(d, "phone/beh/rise/dur")).toBe(1.1);
    expect(getPath(d, "phone/keys/rot.y")).toHaveLength(3);
    expect(getPath(d, "comp/dur")).toBe(6);
    expect(getPath(d, "brand/colors/accent")).toBe("#7c6cff");
    expect(getPath(d, "nope/pos")).toBeUndefined();
  });
  it("creates intermediate containers on set", () => {
    const x = structuredClone(d);
    setPath(x, "title/keys/opacity", [[0, 0], [1, 1]]);
    setPath(x, "sub/rot/z", 12);
    expect(getPath(x, "sub/rot")).toEqual([0, 0, 12]);
    setPath(x, "sub/beh/wob", { use: "wiggle", at: 0 });
    expect(getPath(x, "sub/beh/wob/id")).toBe("wob");
  });
  it("deletes id-items and object keys, refuses tuple components", () => {
    const x = structuredClone(d);
    delPath(x, "phone/beh/bob");
    expect(getPath(x, "phone/beh/bob")).toBeUndefined();
    delPath(x, "title");
    expect(x.layers.find((l) => l.id === "title")).toBeUndefined();
    expect(() => delPath(x, "phone/pos/x")).toThrow();
  });
  it("reports missing intermediates", () => {
    expect(() => locate(d, "ghost/beh/x/at")).toThrow(/no item "ghost"/);
  });
});

describe("transactions", () => {
  it("set with delta retimes without model arithmetic", () => {
    const r = ok(launchTemplate(), [{ op: "set", path: "ring/in", delta: 0.3 }]);
    expect(getPath(r.doc, "ring/in")).toBeCloseTo(1.1);
  });
  it("key replaces a whole track, sorted and quantised", () => {
    const r = ok(launchTemplate(), [{ op: "key", path: "title/keys/rot.z", keys: [[1.00049, 5], [0, 0, "out"]] }]);
    expect(getPath(r.doc, "title/keys/rot.z")).toEqual([[0, 0, "out"], [1, 5]]);
  });
  it("add inserts a layer after another and rejects duplicates", () => {
    const r = ok(launchTemplate(), [{ op: "add", id: "tag", after: "title", layer: { type: "text", text: "New", size: 40 } }]);
    const ids = r.doc.layers.map((l) => l.id);
    expect(ids.indexOf("tag")).toBe(ids.indexOf("title") + 1);
    const bad = applyTxn(r.doc, [{ op: "add", id: "tag", layer: { type: "text", text: "x", size: 1 } }], { source: "ai" });
    expect(bad.ok).toBe(false);
    expect(bad.errors[0]).toMatch(/already exists/);
  });
  it("ord moves draw order and its inverse restores it", () => {
    const d = launchTemplate();
    const r = ok(d, [{ op: "ord", id: "title", after: null }]);
    expect(r.doc.layers[0].id).toBe("title");
    expect(applyPrims(r.doc, r.txn!.inverse).layers.map((l) => l.id)).toEqual(d.layers.map((l) => l.id));
  });
  it("one apply is one transaction; any invalid op rolls back everything", () => {
    const d = launchTemplate();
    const r = applyTxn(d, [{ op: "set", path: "title/size", value: 50 }, { op: "set", path: "title/color", value: "$nope" }], { source: "ai" });
    expect(r.ok).toBe(false);
    expect(r.doc).toBe(d);
    expect(r.errors.join()).toMatch(/unknown brand color \$nope/);
  });
  it("trim moves the in-point but keeps animation in place in comp time", () => {
    const d = launchTemplate();
    const r = ok(d, [{ op: "trim", id: "title", delta: 0.4 }]);
    expect(getPath(r.doc, "title/in")).toBeCloseTo(1.8);
    expect(getPath(r.doc, "title/beh/type/at")).toBeCloseTo(-0.4);
  });
  it("bake turns a behavior into keys in one undoable step", () => {
    const d = launchTemplate();
    const r = ok(d, [{ op: "bake", path: "sub/beh/in" }]);
    expect(getPath(r.doc, "sub/beh/in")).toBeUndefined();
    expect((getPath(r.doc, "sub/keys/pos.y") as unknown[]).length).toBeGreaterThan(4);
    expect(applyPrims(r.doc, r.txn!.inverse)).toEqual(d);
  });
  it("deleting a parent layer unparents its children in the same undo step", () => {
    const d = launchTemplate();
    const r = ok(d, [{ op: "del", path: "cta" }]);
    expect(getPath(r.doc, "cta-label/parent")).toBeUndefined();
    expect(applyPrims(r.doc, r.txn!.inverse)).toEqual(d);
  });
  it("describes an empty transaction", () => {
    expect(applyTxn(launchTemplate(), [], { source: "ai" }).txn!.intent).toBe("No changes");
  });
  it("bake refuses loops", () => {
    const r = applyTxn(launchTemplate(), [{ op: "bake", path: "phone/beh/bob" }], { source: "you" });
    expect(r.ok).toBe(false);
  });
  it("style writes every binding for that slider", () => {
    const r = ok(launchTemplate(), [{ op: "style", key: "bounce", value: 1 }], "style");
    expect(getPath(r.doc, "phone/beh/rise/bounce")).toBe(0.7);
    expect(getPath(r.doc, "cta/beh/pop/bounce")).toBe(0.8);
    expect(getPath(r.doc, "style/bounce")).toBe(1);
  });
  it("a direct edit detaches the binding so sliders never clobber a hand edit", () => {
    const d = launchTemplate();
    const r1 = ok(d, [{ op: "set", path: "phone/beh/rise/bounce", value: 0.05 }]);
    expect(r1.doc.bindings.some((b) => b.path === "phone/beh/rise/bounce")).toBe(false);
    const r2 = ok(r1.doc, [{ op: "style", key: "bounce", value: 1 }], "style");
    expect(getPath(r2.doc, "phone/beh/rise/bounce")).toBe(0.05);
    expect(getPath(r2.doc, "cta/beh/pop/bounce")).toBe(0.8);
    // and undo of the hand edit restores the binding
    expect(applyPrims(r1.doc, r1.txn!.inverse).bindings).toEqual(d.bindings);
  });
});

describe("validation", () => {
  const bad = (mut: (d: Doc) => void) => {
    const d = launchTemplate();
    mut(d);
    return validate(d).join("\n");
  };
  it("accepts the templates", () => {
    expect(validate(launchTemplate())).toEqual([]);
    expect(validate(kineticTemplate())).toEqual([]);
  });
  it("suggests the closest behavior for typos", () => {
    expect(bad((d) => ((d.layers[4] as { beh: { use: string }[] }).beh[0].use = "typeup"))).toMatch(/did you mean typeUp/);
  });
  it("rejects two owners of one channel at the same time", () => {
    expect(bad((d) => d.layers.find((l) => l.id === "sub")!.beh!.push({ id: "x", use: "drop", at: 0.2 }))).toMatch(/already owned by "in"/);
  });
  it("rejects owner + keys on the same channel and offers bake", () => {
    expect(bad((d) => (d.layers.find((l) => l.id === "sub")!.keys = { "pos.y": [[0, 0]] }))).toMatch(/bake "in"/);
  });
  it("catches unknown refs, cycles, channels, bad colors", () => {
    expect(bad((d) => ((d.layers.find((l) => l.id === "phone") as { screen?: string }).screen = "ghost"))).toMatch(/unknown asset "ghost"/);
    expect(bad((d) => (d.layers.find((l) => l.id === "cta")!.parent = "cta-label"))).toMatch(/cycle/);
    expect(bad((d) => (d.layers.find((l) => l.id === "cta")!.keys = { wobble: [[0, 1]] }))).toMatch(/not a channel of shape/);
    expect(bad((d) => (d.comp.bg = "red"))).toMatch(/color must be/);
    expect(bad((d) => (d.comp.cam = "phone"))).toMatch(/not a camera/);
    expect(bad((d) => d.layers.push({ ...d.layers[0] }))).toMatch(/duplicate layer id/);
  });
  it("rejects behaviors on the wrong layer type", () => {
    expect(bad((d) => d.layers.find((l) => l.id === "cta")!.beh!.push({ id: "t", use: "typeUp", at: 0 }))).toMatch(/does not apply to shape/);
  });
});

describe("inverse is exact (property)", () => {
  const ids = ["title", "sub", "phone", "cta", "ring"];
  const opArb: fc.Arbitrary<Op> = fc.oneof(
    fc.record({ op: fc.constant("set" as const), path: fc.constantFrom(...ids.map((i) => `${i}/in`)), delta: fc.double({ min: 0, max: 1, noNaN: true }) }),
    fc.record({ op: fc.constant("set" as const), path: fc.constantFrom(...ids.map((i) => `${i}/pos/y`)), value: fc.integer({ min: -500, max: 500 }) }),
    fc.record({ op: fc.constant("set" as const), path: fc.constantFrom(...ids.map((i) => `${i}/opacity`)), value: fc.double({ min: 0, max: 1, noNaN: true }) }),
    fc.record({ op: fc.constant("key" as const), path: fc.constantFrom("title/keys/rot.z", "cta/keys/pos.x", "sub/keys/scale"), keys: fc.array(fc.tuple(fc.double({ min: 0, max: 5, noNaN: true }), fc.integer({ min: -90, max: 90 })), { minLength: 1, maxLength: 4 }) as fc.Arbitrary<[number, number][]> }),
    fc.record({ op: fc.constant("ord" as const), id: fc.constantFrom(...ids), after: fc.constantFrom(null, "bg", "title", "phone") }),
    fc.record({ op: fc.constant("del" as const), path: fc.constantFrom("phone/beh/bob", "cta/beh/beat", "ring/fx/drift", "sub") }),
    fc.record({ op: fc.constant("style" as const), key: fc.constantFrom("energy" as const, "bounce" as const, "depth" as const), value: fc.double({ min: 0, max: 1, noNaN: true }) }),
    fc.record({ op: fc.constant("add" as const), id: fc.constantFrom("n1", "n2"), after: fc.constantFrom(undefined, "bg"), layer: fc.constant({ type: "shape", shape: "rect", w: 10, h: 10 }) }),
  );
  it("applying a txn then its inverse restores the document exactly", () => {
    fc.assert(
      fc.property(fc.array(opArb, { minLength: 1, maxLength: 12 }), (ops) => {
        let doc = launchTemplate();
        const history: { before: Doc; inv: ReturnType<typeof applyTxn>["txn"] }[] = [];
        for (const op of ops) {
          const r = applyTxn(doc, [op], { source: op.op === "style" ? "style" : "ai", validate: false });
          if (!r.ok) continue;
          history.push({ before: doc, inv: r.txn });
          doc = r.doc;
        }
        for (let i = history.length - 1; i >= 0; i--) {
          doc = applyPrims(doc, history[i].inv!.inverse);
          expect(doc).toEqual(history[i].before);
        }
      }),
      { numRuns: 300 },
    );
  });
  it("redo (prims) after undo reproduces the same document", () => {
    fc.assert(
      fc.property(fc.array(opArb, { minLength: 1, maxLength: 6 }), (ops) => {
        const d0 = launchTemplate();
        const r = applyTxn(d0, ops, { source: "ai", validate: false });
        if (!r.ok) return;
        const undone = applyPrims(r.doc, r.txn!.inverse);
        expect(undone).toEqual(d0);
        expect(applyPrims(undone, r.txn!.prims)).toEqual(r.doc);
      }),
      { numRuns: 300 },
    );
  });
});

describe("agent views", () => {
  it("outline is compact and lists every layer", () => {
    const d = launchTemplate();
    const o = outline(d);
    for (const l of d.layers) expect(o).toContain(l.id + " " + l.type);
    expect(o.length).toBeLessThan(1400);
  });
  it("inspect returns minified JSON for requested ids only", () => {
    const s = inspect(launchTemplate(), ["title", "missing"]);
    expect(JSON.parse(s).id).toBe("title");
  });
  it("catalog filters by query", () => {
    expect(catalog("camera")).toMatch(/dolly/);
    expect(catalog("camera")).not.toMatch(/typeUp/);
  });
  it("describeOp reads like a sentence", () => {
    expect(describeOp({ op: "set", path: "title/size", value: 140 })).toBe("Set title › size to 140");
    expect(describeOp({ op: "add", id: "x", layer: { type: "text" } })).toBe("Add text “x”");
  });
});
