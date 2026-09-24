import { Doc as DocSchema, type Doc, type Layer } from "./schema";
import { CATALOG, suggestBeh, channelsFor } from "./catalog";
import { delPath, getPath, itemIndex, locate, setPath, PathError } from "./paths";

/* ------------------------------------------------------------------ *
 * Primitives — the only things stored in the log.                     *
 * ------------------------------------------------------------------ */
export type Prim =
  | { op: "set"; path: string; value: unknown; index?: number }
  | { op: "del"; path: string }
  | { op: "ord"; id: string; after: string | null };

/* ------------------------------------------------------------------ *
 * Macros — what people and models write. Expanded before the log.     *
 * ------------------------------------------------------------------ */
export type Op =
  | { op: "set"; path: string; value?: unknown; delta?: number }
  | { op: "del"; path: string }
  | { op: "ord"; id: string; after: string | null }
  | { op: "key"; path: string; keys: [number, number, string?][] }
  | { op: "add"; id: string; after?: string | null; layer: Record<string, unknown> }
  | { op: "bake"; path: string }
  | { op: "style"; key: "energy" | "bounce" | "depth" | "speed"; value: number }
  | { op: "trim"; id: string; delta: number };

export type Source = "you" | "ai" | "style" | "template" | "paste" | "system";

export interface Txn {
  id: string;
  source: Source;
  intent: string;
  ops: Op[];
  prims: Prim[];
  inverse: Prim[];
  ts: number;
}

export interface TxnResult {
  ok: boolean;
  doc: Doc;
  txn?: Txn;
  errors: string[];
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
let txnSeq = 0;

function layerIds(doc: Doc): string[] {
  return doc.layers.map((l) => l.id);
}

/** Expand one macro into primitives against the current (evolving) document. */
export function expand(doc: Doc, op: Op, source: Source): Prim[] {
  switch (op.op) {
    case "set": {
      if (op.delta !== undefined) {
        const cur = getPath(doc, op.path);
        if (typeof cur !== "number" && cur !== undefined) throw new PathError(op.path, "delta needs a number");
        return [{ op: "set", path: op.path, value: r3((typeof cur === "number" ? cur : 0) + op.delta) }];
      }
      if (op.value === undefined) throw new PathError(op.path, "set needs value or delta");
      return [{ op: "set", path: op.path, value: op.value }];
    }
    case "del": {
      // deleting a layer also unparents its children and clears it as the active camera
      if (!op.path.includes("/") && layerIds(doc).includes(op.path)) {
        const prims: Prim[] = doc.layers.filter((l) => l.parent === op.path).map((l) => ({ op: "del", path: `${l.id}/parent` }));
        if (doc.comp.cam === op.path) prims.push({ op: "del", path: "comp/cam" });
        prims.push({ op: "del", path: op.path });
        return prims;
      }
      return [{ op: "del", path: op.path }];
    }
    case "ord":
      return [{ op: "ord", id: op.id, after: op.after }];
    case "key": {
      const keys = [...op.keys]
        .map((k) => (k[2] ? [r3(k[0]), k[1], k[2]] : [r3(k[0]), k[1]]) as [number, number, string?])
        .sort((a, b) => a[0] - b[0]);
      if (!/\/keys\/[^/]+$/.test(op.path)) throw new PathError(op.path, "key path must look like <layer>/keys/<channel>");
      return [{ op: "set", path: op.path, value: keys }];
    }
    case "add": {
      if (layerIds(doc).includes(op.id)) throw new PathError(op.id, `a layer "${op.id}" already exists — use set to change it`);
      const prims: Prim[] = [{ op: "set", path: op.id, value: { ...op.layer, id: op.id } }];
      if (op.after !== undefined) prims.push({ op: "ord", id: op.id, after: op.after });
      return prims;
    }
    case "trim": {
      // move the in-point but keep the animation where it is in comp time
      const layer = doc.layers.find((l) => l.id === op.id);
      if (!layer) throw new PathError(op.id, "no such layer");
      const d = op.delta;
      const prims: Prim[] = [{ op: "set", path: `${op.id}/in`, value: r3(Math.max(0, (layer.in ?? 0) + d)) }];
      for (const b of layer.beh ?? []) prims.push({ op: "set", path: `${op.id}/beh/${b.id}/at`, value: r3(b.at - d) });
      for (const [ch, tr] of Object.entries(layer.keys ?? {}))
        prims.push({ op: "set", path: `${op.id}/keys/${ch}`, value: tr.map((k) => [r3(k[0] - d), ...k.slice(1)]) });
      return prims;
    }
    case "bake":
      return bakePrims(doc, op.path);
    case "style": {
      const prims: Prim[] = [{ op: "set", path: `style/${op.key}`, value: op.value }];
      for (const b of doc.bindings) {
        if (b.from !== `style.${op.key}`) continue;
        prims.push({ op: "set", path: b.path, value: r3(b.lo + (b.hi - b.lo) * op.value) });
      }
      void source;
      return prims;
    }
  }
}

/** Sample a behavior into keyframes (lazy import of the evaluator avoids a cycle at module load). */
let bakeSampler: ((doc: Doc, layerId: string, behId: string) => Record<string, [number, number][]>) | null = null;
export function registerBakeSampler(fn: typeof bakeSampler) {
  bakeSampler = fn;
}
function bakePrims(doc: Doc, path: string): Prim[] {
  const m = /^([^/]+)\/beh\/([^/]+)$/.exec(path);
  if (!m) throw new PathError(path, "bake path must be <layer>/beh/<id>");
  const [, lid, bid] = m;
  const layer = doc.layers.find((l) => l.id === lid);
  const beh = layer?.beh?.find((b) => b.id === bid);
  if (!layer || !beh) throw new PathError(path, "no such behavior");
  const spec = CATALOG[beh.use];
  if (!spec || spec.bake === "never") throw new PathError(path, `${beh.use} can't be baked (it loops or is per-glyph)`);
  if (spec.writes.some((w) => layer.keys?.[w])) throw new PathError(path, "channel already has keys");
  if (!bakeSampler) throw new PathError(path, "bake sampler not registered");
  const tracks = bakeSampler(doc, lid, bid);
  const prims: Prim[] = Object.entries(tracks).map(([ch, keys]) => ({ op: "set", path: `${lid}/keys/${ch}`, value: keys }));
  prims.push({ op: "del", path });
  return prims;
}

/** Apply one primitive mutably and return its inverse (computed from the preimage). */
function applyPrim(doc: Doc, p: Prim): Prim[] {
  const d = doc as unknown as Record<string, unknown>;
  if (p.op === "ord") {
    const i = doc.layers.findIndex((l) => l.id === p.id);
    if (i < 0) throw new PathError(p.id, "no such layer");
    const prevAfter = i === 0 ? null : doc.layers[i - 1].id;
    const [layer] = doc.layers.splice(i, 1);
    if (p.after === null) doc.layers.unshift(layer);
    else {
      const j = doc.layers.findIndex((l) => l.id === p.after);
      if (j < 0) {
        doc.layers.splice(i, 0, layer);
        throw new PathError(p.after, "ord: no such layer to go after");
      }
      doc.layers.splice(j + 1, 0, layer);
    }
    return [{ op: "ord", id: p.id, after: prevAfter }];
  }
  // a set may create intermediate containers; its inverse must remove the first one it created
  const created = p.op === "set" ? firstMissingPrefix(d, p.path) : null;
  const loc = locate(d, p.path, p.op === "set");
  const old = loc.exists ? structuredClone((loc.parent as Record<string | number, unknown>)[loc.key]) : undefined;
  const oldIndex = loc.idItem && loc.exists ? (loc.key as number) : undefined;
  if (p.op === "set") {
    setPath(d, p.path, structuredClone(p.value), p.index);
    if (old === undefined) return [{ op: "del", path: created ?? p.path }];
    return [{ op: "set", path: p.path, value: old, index: oldIndex }];
  }
  if (old === undefined) return [];
  delPath(d, p.path);
  return [{ op: "set", path: p.path, value: old, index: oldIndex }];
}

function firstMissingPrefix(doc: Record<string, unknown>, path: string): string | null {
  const segs = path.split("/").filter(Boolean);
  for (let i = 1; i < segs.length; i++) {
    const prefix = segs.slice(0, i).join("/");
    if (getPath(doc, prefix) === undefined) return prefix;
  }
  return null;
}

/** A direct edit of a bound path detaches the binding so style sliders never clobber it. */
function detachPrims(doc: Doc, prims: Prim[], source: Source): Prim[] {
  if (source === "style" || !doc.bindings.length) return [];
  const touched = new Set(prims.filter((p) => p.op !== "ord").map((p) => (p as { path: string }).path));
  const keep = doc.bindings.filter((b) => ![...touched].some((t) => b.path === t || b.path.startsWith(t + "/")));
  return keep.length === doc.bindings.length ? [] : [{ op: "set", path: "bindings", value: keep }];
}

/**
 * One apply = one transaction = one undo step.
 * Expands macros, applies primitives to a copy, validates, and returns the new doc or errors.
 */
export function applyTxn(doc: Doc, ops: Op[], opts: { source: Source; intent?: string; validate?: boolean }): TxnResult {
  const next = structuredClone(doc);
  const prims: Prim[] = [];
  const inverse: Prim[] = [];
  const errors: string[] = [];
  ops.forEach((op, i) => {
    try {
      const ps = expand(next, op, opts.source);
      ps.push(...detachPrims(next, ps, opts.source));
      for (const p of ps) {
        inverse.unshift(...applyPrim(next, p));
        prims.push(p);
      }
    } catch (e) {
      errors.push(`op ${i + 1} (${op.op}): ${(e as Error).message}`);
    }
  });
  if (errors.length) return { ok: false, doc, errors };
  if (opts.validate !== false) {
    const v = validate(next);
    if (v.length) return { ok: false, doc, errors: v };
  }
  const txn: Txn = { id: `t${Date.now().toString(36)}${(txnSeq++).toString(36)}`, source: opts.source, intent: opts.intent ?? describeOps(ops), ops, prims, inverse, ts: Date.now() };
  return { ok: true, doc: next, txn, errors: [] };
}

/** Apply stored primitives (redo) or an inverse (undo). No validation: they were valid when logged. */
export function applyPrims(doc: Doc, prims: Prim[]): Doc {
  const next = structuredClone(doc);
  for (const p of prims) applyPrim(next, p);
  return next;
}

/* ------------------------------------------------------------------ *
 * Validation: schema + semantics, compact messages a model can repair. *
 * ------------------------------------------------------------------ */
export function validate(doc: Doc): string[] {
  const errs: string[] = [];
  const parsed = DocSchema.safeParse(doc);
  if (!parsed.success) {
    for (const iss of parsed.error.issues.slice(0, 8)) errs.push(`${prettyIssuePath(doc, iss.path)}: ${iss.message}`);
    return errs;
  }
  const ids = new Set<string>();
  for (const l of doc.layers) {
    if (ids.has(l.id)) errs.push(`${l.id}: duplicate layer id`);
    ids.add(l.id);
  }
  for (const l of doc.layers) errs.push(...validateLayer(doc, l, ids));
  if (doc.comp.cam && !doc.layers.some((l) => l.id === doc.comp.cam && l.type === "camera")) errs.push(`comp/cam: "${doc.comp.cam}" is not a camera layer`);
  for (const b of doc.bindings) if (getPath(doc, b.path) === undefined) errs.push(`bindings: path ${b.path} does not exist`);
  return errs;
}

function prettyIssuePath(doc: Doc, path: PropertyKey[]): string {
  if (path[0] === "layers" && typeof path[1] === "number") {
    const l = doc.layers[path[1]];
    return [l?.id ?? `layer#${path[1]}`, ...path.slice(2).map(String)].join("/");
  }
  return path.map(String).join("/") || "doc";
}

function validateLayer(doc: Doc, l: Layer, ids: Set<string>): string[] {
  const errs: string[] = [];
  const colorRef = (c: string | undefined, where: string) => {
    if (c && c.startsWith("$") && !(c.slice(1) in doc.brand.colors)) errs.push(`${l.id}/${where}: unknown brand color ${c} (have ${Object.keys(doc.brand.colors).map((k) => "$" + k).join(", ")})`);
  };
  if (l.parent) {
    if (!ids.has(l.parent)) errs.push(`${l.id}/parent: no layer "${l.parent}"`);
    let p: string | undefined = l.parent;
    const seen = new Set([l.id]);
    while (p) {
      if (seen.has(p)) {
        errs.push(`${l.id}/parent: cycle`);
        break;
      }
      seen.add(p);
      p = doc.layers.find((x) => x.id === p)?.parent;
    }
  }
  const owners = new Map<string, string>();
  const behIds = new Set<string>();
  for (const b of l.beh ?? []) {
    if (behIds.has(b.id)) errs.push(`${l.id}/beh/${b.id}: duplicate behavior id`);
    behIds.add(b.id);
    const spec = CATALOG[b.use];
    if (!spec) {
      errs.push(`${l.id}/beh/${b.id}: unknown behavior "${b.use}" — did you mean ${suggestBeh(b.use).join(", ")}?`);
      continue;
    }
    if (spec.types && !spec.types.includes(l.type)) errs.push(`${l.id}/beh/${b.id}: ${b.use} does not apply to ${l.type} layers`);
    if (spec.mode === "add") continue;
    for (const w of spec.writes) {
      // two owners may share a channel only if their windows don't overlap (enter then exit)
      const prev = owners.get(w);
      if (prev) {
        const pb = l.beh!.find((x) => x.id === prev)!;
        const pEnd = pb.at + (pb.dur ?? CATALOG[pb.use].dur);
        const bEnd = b.at + (b.dur ?? spec.dur);
        if (b.at < pEnd && pb.at < bEnd) errs.push(`${l.id}/beh/${b.id}: ${w} is already owned by "${prev}" at the same time — change "at" or remove one`);
      } else owners.set(w, b.id);
      if (l.keys?.[w]) errs.push(`${l.id}/beh/${b.id}: ${w} has keys and an owner behavior — bake "${b.id}" or delete the keys`);
    }
  }
  for (const ch of Object.keys(l.keys ?? {})) if (!channelsFor(l.type).includes(ch)) errs.push(`${l.id}/keys/${ch}: not a channel of ${l.type} (use ${channelsFor(l.type).join(", ")})`);
  for (const ch of Object.keys(l.expr ?? {})) if (!channelsFor(l.type).includes(ch)) errs.push(`${l.id}/expr/${ch}: not a channel of ${l.type}`);
  const asset = (src: string | undefined, where: string) => {
    if (src && !(src in doc.assets)) errs.push(`${l.id}/${where}: unknown asset "${src}" (have ${Object.keys(doc.assets).join(", ") || "none"})`);
  };
  switch (l.type) {
    case "text":
      colorRef(l.color, "color");
      break;
    case "shape":
      colorRef(l.fill, "fill");
      colorRef(l.stroke, "stroke");
      break;
    case "gradient":
      l.colors.forEach((c, i) => colorRef(c, `colors/${i}`));
      break;
    case "image":
      asset(l.src, "src");
      break;
    case "device":
      asset(l.screen, "screen");
      colorRef(l.color, "color");
      break;
    case "cloner":
      colorRef(l.child.fill, "child/fill");
      l.child.colors?.forEach((c, i) => colorRef(c, `child/colors/${i}`));
      if (l.child.kind === "image") asset(l.child.src, "child/src");
      break;
  }
  return errs;
}

/* ------------------------------------------------------------------ *
 * Human-readable descriptions for diff cards and history.             *
 * ------------------------------------------------------------------ */
const fmtV = (v: unknown): string => {
  if (typeof v === "number") return String(r3(v));
  if (typeof v === "string") return v.length > 28 ? `"${v.slice(0, 26)}…"` : `"${v}"`;
  if (Array.isArray(v) && v.every((x) => typeof x === "number")) return `[${v.map((x) => r3(x as number)).join(", ")}]`;
  return "…";
};
const pretty = (path: string) => path.split("/").join(" › ");

export function describeOp(op: Op): string {
  switch (op.op) {
    case "set":
      return op.delta !== undefined ? `Shift ${pretty(op.path)} by ${op.delta > 0 ? "+" : ""}${r3(op.delta)}` : `Set ${pretty(op.path)} to ${fmtV(op.value)}`;
    case "del":
      return `Remove ${pretty(op.path)}`;
    case "ord":
      return op.after ? `Move ${op.id} above ${op.after}` : `Send ${op.id} to back`;
    case "key":
      return `Animate ${pretty(op.path.replace("/keys/", " "))} with ${op.keys.length} keys`;
    case "add":
      return `Add ${String(op.layer.type ?? "layer")} “${op.id}”`;
    case "bake":
      return `Bake ${pretty(op.path)} into keys`;
    case "style":
      return `Style ${op.key} → ${Math.round(op.value * 100)}`;
    case "trim":
      return `Trim ${op.id} in-point ${op.delta > 0 ? "+" : ""}${r3(op.delta)}s`;
  }
}

export function describeOps(ops: Op[]): string {
  if (!ops.length) return "No changes";
  if (ops.length === 1) return describeOp(ops[0]);
  return `${describeOp(ops[0])} + ${ops.length - 1} more`;
}

export function itemIndexOf(doc: Doc, path: string) {
  return itemIndex(doc, path);
}
