import type { Doc, Scene } from "../fmd/schema";
import type { Op } from "../fmd/ops";
import { ROOT_FIELDS } from "../fmd/paths";

/**
 * The scene plan ("storyboard") — pure helpers shared by the bridge, the in-app providers and the UI.
 *
 * A plan is `doc.scenes`: ordered shots laid end to end. Every layer a scene builds is id-prefixed
 * with the scene id (`s2-title`), so a scene can be rebuilt by deleting its layers and building again,
 * and retimed by shifting them.
 */

export const ASPECTS: Record<string, [number, number]> = { "16:9": [1920, 1080], "9:16": [1080, 1920], "1:1": [1080, 1080], "4:5": [1080, 1350] };
export const aspectOf = (w: number, h: number) => Object.entries(ASPECTS).find(([, [aw, ah]]) => aw * h === ah * w)?.[0] ?? `${w}×${h}`;

const ID_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export const sceneTotal = (scenes: { dur: number }[]) => r3(scenes.reduce((a, s) => a + s.dur, 0));
export const scenePrefix = (id: string) => `${id}-`;

/** Starts laid end to end in list order. */
export function layoutScenes<T extends { dur: number; start?: number }>(scenes: T[]): (T & { start: number })[] {
  let t = 0;
  return scenes.map((s) => {
    const out = { ...s, start: r3(t) };
    t += s.dur;
    return out;
  });
}

function num(v: unknown): number | undefined {
  if (typeof v === "number" && isFinite(v)) return v;
  if (typeof v === "string") {
    const m = /(-?\d+(?:\.\d+)?)/.exec(v);
    if (m) return Number(m[1]);
  }
  return undefined;
}
const str = (...vs: unknown[]) => {
  for (const v of vs) if (typeof v === "string" && v.trim()) return v.trim();
  return "";
};

/**
 * Turns whatever a model or agent sent as a plan into valid, laid-out scenes. Tolerates `{scenes:[…]}`
 * or a bare array, `duration`/`seconds` for `dur`, `description`/`visual` for `brief`, bad or duplicate
 * ids. With `length`, durations are scaled to fill it (snapped to quarter seconds).
 */
export function normalizeScenes(raw: unknown, opts: { length?: number } = {}): Scene[] {
  const list: unknown[] = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { scenes?: unknown }).scenes) ? (raw as { scenes: unknown[] }).scenes : [];
  const used = new Set<string>();
  let scenes = list
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
    .slice(0, 24)
    .map((s, i) => {
      const dur = Math.min(60, Math.max(0.5, num(s.dur ?? s.duration ?? s.seconds ?? s.length) ?? 3));
      const brief = str(s.brief, s.description, s.visual, s.action, s.what, s.summary);
      const title = str(s.title, s.name, s.heading) || (brief ? brief.split(/[.,:;—]/)[0].slice(0, 32) : `Scene ${i + 1}`);
      let id = typeof s.id === "string" && ID_RE.test(s.id) && !used.has(s.id) ? s.id : "";
      if (!id) {
        let k = i + 1;
        while (used.has(`s${k}`)) k++;
        id = `s${k}`;
      }
      used.add(id);
      const status = s.status === "done" ? ("done" as const) : ("planned" as const);
      return { id, title: title.slice(0, 60), start: 0, dur: r2(dur), brief: brief.slice(0, 1200), status };
    });
  if (opts.length && opts.length > 0 && scenes.length) scenes = fitScenes(scenes, opts.length);
  return layoutScenes(scenes);
}

/** Scale durations so they add up to `length` (quarter-second snapping, the last scene absorbs rounding). */
export function fitScenes<T extends { dur: number }>(scenes: T[], length: number): T[] {
  const total = sceneTotal(scenes);
  if (!total || Math.abs(total - length) < 0.01) return scenes;
  const k = length / total;
  const out = scenes.map((s) => ({ ...s, dur: Math.max(0.5, Math.round(s.dur * k * 4) / 4) }));
  const rest = r3(length - sceneTotal(out.slice(0, -1)));
  if (rest >= 0.5) out[out.length - 1] = { ...out[out.length - 1], dur: rest };
  return out;
}

/** Layers that belong to a scene (by id prefix). */
export function sceneLayerIds(doc: Doc, sceneId: string): string[] {
  const p = scenePrefix(sceneId);
  return doc.layers.filter((l) => l.id.startsWith(p)).map((l) => l.id);
}

/** Behaviours a scene added to shared layers (e.g. `cam/beh/s2-shake`). */
function sceneBehPaths(doc: Doc, sceneId: string): string[] {
  const p = scenePrefix(sceneId);
  const out: string[] = [];
  for (const l of doc.layers) if (!l.id.startsWith(p)) for (const b of l.beh ?? []) if (b.id.startsWith(p)) out.push(`${l.id}/beh/${b.id}`);
  return out;
}

/** Ops that remove everything a scene built — the first half of a rebuild. */
export function clearSceneOps(doc: Doc, sceneId: string): Op[] {
  return [...sceneBehPaths(doc, sceneId).map((path) => ({ op: "del" as const, path })), ...sceneLayerIds(doc, sceneId).map((path) => ({ op: "del" as const, path }))];
}

/**
 * Ops that turn the current plan into `next` as one undoable step: the scene list, the comp length,
 * and — for scenes that are already built — their layers moved to the scene's new start (or removed
 * with the scene).
 */
export function planEditOps(doc: Doc, nextRaw: Scene[]): Op[] {
  const next = layoutScenes(nextRaw);
  const ops: Op[] = [];
  for (const old of doc.scenes) {
    const now = next.find((s) => s.id === old.id);
    if (!now) {
      ops.push(...clearSceneOps(doc, old.id));
      continue;
    }
    const d = r3(now.start - old.start);
    if (!d) continue;
    for (const id of sceneLayerIds(doc, old.id)) {
      const L = doc.layers.find((l) => l.id === id)!;
      ops.push({ op: "set", path: `${id}/in`, value: r3((L.in ?? 0) + d) });
      if (L.out !== undefined) ops.push({ op: "set", path: `${id}/out`, value: r3(L.out + d) });
    }
    for (const path of sceneBehPaths(doc, old.id)) {
      const [lid, , bid] = path.split("/");
      const b = doc.layers.find((l) => l.id === lid)?.beh?.find((x) => x.id === bid);
      if (b) ops.push({ op: "set", path: `${path}/at`, value: r3(b.at + d) });
    }
  }
  ops.push({ op: "set", path: "scenes", value: next });
  const total = sceneTotal(next);
  if (total > 0 && Math.abs(total - doc.comp.dur) > 0.001) ops.push({ op: "set", path: "comp/dur", value: total });
  return ops;
}

/* ------------------------------------------------------------------ *
 * Scene builds: keep a scene's layers inside its namespace and window  *
 * ------------------------------------------------------------------ */

export interface SceneCtx {
  sceneId: string;
  start: number;
  end: number;
  /** move new layers by this much (the scene moved while it was being built) */
  shift?: number;
  /** scene ids other than this one: their layers are off-limits */
  others?: string[];
}

const first = (path: string) => path.split("/")[0];
const rest = (path: string) => {
  const i = path.indexOf("/");
  return i < 0 ? "" : path.slice(i);
};

/** Layer ids an op list creates (as opposed to edits of layers that exist). */
export function createdIds(doc: Doc, ops: Op[]): string[] {
  const have = new Set(doc.layers.map((l) => l.id));
  const out: string[] = [];
  for (const op of ops) {
    if (!op || typeof op !== "object") continue;
    if (op.op === "add" && typeof op.id === "string") out.push(op.id);
    else if (op.op === "set" && typeof op.path === "string" && !op.path.includes("/") && !ROOT_FIELDS.has(op.path) && !have.has(op.path)) {
      const v = op.value as Record<string, unknown> | undefined;
      if (v && typeof v === "object" && typeof v.type === "string") out.push(op.path);
    }
  }
  return [...new Set(out)];
}

/**
 * Rewrites a scene's ops so every layer it creates is `<sceneId>-…` (references — parents, `after`,
 * paths, `comp/cam` — follow), gives new layers the scene window when they have no in/out, applies a
 * pending time shift, and drops ops that would touch another scene's layers. Returns ops aligned to
 * the input (`null` where an op was dropped) so errors can be traced back to what the agent sent.
 */
export function prefixSceneOps(doc: Doc, ops: Op[], ctx: SceneCtx): { ops: (Op | null)[]; renamed: Record<string, string>; dropped: string[] } {
  const p = scenePrefix(ctx.sceneId);
  const have = new Set(doc.layers.map((l) => l.id));
  const renamed: Record<string, string> = {};
  const taken = new Set(have);
  for (const id of createdIds(doc, ops)) {
    let to = id.startsWith(p) ? id : p + id.replace(/^[^a-zA-Z]+/, "");
    if (to !== id) {
      let k = 2;
      const base = to;
      while (taken.has(to)) to = `${base}-${k++}`;
    }
    taken.add(to);
    if (to !== id) renamed[id] = to;
  }
  const m = (id: unknown) => (typeof id === "string" && renamed[id] ? renamed[id] : id);
  const mp = (path: string) => m(first(path)) + rest(path);
  const others = (ctx.others ?? []).map(scenePrefix);
  const foreign = (id: string) => others.some((o) => id.startsWith(o) && !id.startsWith(p));
  const shift = ctx.shift ?? 0;
  const created = new Set(Object.values(renamed).concat(createdIds(doc, ops).filter((id) => !renamed[id])));
  const fixLayer = (v: Record<string, unknown>): Record<string, unknown> => {
    const L: Record<string, unknown> = { ...v };
    delete L.id;
    if (L.parent !== undefined) L.parent = m(L.parent);
    if (typeof L.in !== "number") L.in = ctx.start;
    else if (shift) L.in = r3((L.in as number) + shift);
    if (typeof L.out !== "number") L.out = ctx.end;
    else if (shift) L.out = r3((L.out as number) + shift);
    return L;
  };
  const dropped: string[] = [];
  const out = ops.map((op): Op | null => {
    if (!op || typeof op !== "object") return null;
    switch (op.op) {
      case "add":
        return { ...op, id: m(op.id) as string, after: op.after == null ? op.after : (m(op.after) as string), layer: fixLayer(op.layer ?? {}) };
      case "set": {
        if (typeof op.path !== "string") return op;
        const path = mp(op.path);
        const head = first(path);
        if (foreign(head)) {
          dropped.push(op.path);
          return null;
        }
        let value = op.value;
        const segs = path.split("/");
        if (segs.length === 3 && segs[1] === "beh" && !created.has(segs[0]) && value && typeof value === "object" && !Array.isArray(value)) {
          // a behaviour this scene adds to a shared layer (the camera): namespaced and kept inside the window
          if (!segs[2].startsWith(p)) segs[2] = p + segs[2];
          const b = { ...(value as Record<string, unknown>) };
          delete b.id;
          const shared = doc.layers.find((l) => l.id === segs[0]);
          const lin = shared?.in ?? 0;
          let at = typeof b.at === "number" ? b.at : ctx.start - lin;
          if (at + lin < ctx.start - 0.001) at = ctx.start - lin + at; // written scene-relative
          b.at = r3(at + shift);
          const room = r3(ctx.end - lin - (at as number));
          b.dur = typeof b.dur === "number" ? Math.min(b.dur, room) : room;
          return { ...op, path: segs.join("/"), value: b };
        }
        if (!path.includes("/") && created.has(path) && value && typeof value === "object" && !Array.isArray(value)) value = fixLayer(value as Record<string, unknown>);
        else if (path.endsWith("/parent") || path === "comp/cam") value = m(value);
        else if (path === "comp" && value && typeof value === "object") value = { ...(value as object), cam: m((value as { cam?: unknown }).cam) };
        return op.delta !== undefined ? { ...op, path } : { ...op, path, value };
      }
      case "del":
      case "key":
      case "bake": {
        if (typeof op.path !== "string") return op;
        const path = mp(op.path);
        if (foreign(first(path))) {
          dropped.push(op.path);
          return null;
        }
        return { ...op, path } as Op;
      }
      case "ord":
        return { ...op, id: m(op.id) as string, after: op.after == null ? op.after : (m(op.after) as string) };
      case "trim":
        if (foreign(String(m(op.id)))) {
          dropped.push(op.id);
          return null;
        }
        return { ...op, id: m(op.id) as string };
      default:
        return op;
    }
  });
  return { ops: out, renamed, dropped };
}

/** A human-readable one-liner of the plan, for chat and prompts. */
export function planSummary(scenes: Scene[]): string {
  return `${scenes.length} scene${scenes.length === 1 ? "" : "s"} · ${r2(sceneTotal(scenes))}s`;
}
