import { withHandles } from "../runtime/ease";
import type { Op } from "../fmd/ops";
import type { Doc, Layer, Track } from "../fmd/schema";
import { channel, layerSpan } from "../runtime/evaluate";
import { CATALOG } from "../fmd/catalog";

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const TUPLE: Record<string, [string, number]> = {
  "pos.x": ["pos", 0], "pos.y": ["pos", 1], "pos.z": ["pos", 2],
  "rot.x": ["rot", 0], "rot.y": ["rot", 1], "rot.z": ["rot", 2],
};

export function findLayer(doc: Doc, id: string): Layer | undefined {
  return doc.layers.find((l) => l.id === id);
}

export function localTime(doc: Doc, L: Layer, t: number): number {
  return t - layerSpan(doc, L)[0];
}

/** Path of a channel's static value: pos.y → phone/pos/y, size → title/size, shadow.blur → card/shadow/blur. */
export function staticPath(id: string, ch: string): string {
  const t = TUPLE[ch];
  return t ? `${id}/${t[0]}/${"xyz"[t[1]]}` : `${id}/${ch.replace(/\./g, "/")}`;
}

export function keyIndexAt(track: Track | undefined, local: number, fps: number): number {
  if (!track) return -1;
  return track.findIndex((k) => Math.abs(k[0] - local) < 0.5 / fps);
}

/**
 * Setting a channel value from the UI: keyed channels auto-key at the playhead
 * (update the key under it or insert one); unkeyed channels change their static value.
 */
export function setChannelOps(doc: Doc, L: Layer, ch: string, value: number, t: number): Op[] {
  const track = L.keys?.[ch];
  if (track && track.length) {
    const local = r3(localTime(doc, L, t));
    const i = keyIndexAt(track, local, doc.comp.fps);
    const next = track.map((k) => [...k]) as [number, number, string?][];
    if (i >= 0) next[i][1] = r3(value);
    else next.push([local, r3(value)]);
    return [{ op: "key", path: `${L.id}/keys/${ch}`, keys: next }];
  }
  return [{ op: "set", path: staticPath(L.id, ch), value: r3(value) }];
}

/** Toggle a key at the playhead: add one with the current value, or remove the one under it. */
export function toggleKeyOps(doc: Doc, L: Layer, ch: string, t: number): Op[] {
  const local = r3(localTime(doc, L, t));
  const track = L.keys?.[ch];
  const cur = r3(channel(doc, L, ch, local));
  if (!track || !track.length) return [{ op: "key", path: `${L.id}/keys/${ch}`, keys: [[local, cur]] }];
  const i = keyIndexAt(track, local, doc.comp.fps);
  if (i >= 0) {
    if (track.length === 1) return [{ op: "del", path: `${L.id}/keys/${ch}` }, { op: "set", path: staticPath(L.id, ch), value: track[0][1] }];
    return [{ op: "key", path: `${L.id}/keys/${ch}`, keys: track.filter((_, j) => j !== i) as [number, number, string?][] }];
  }
  return [{ op: "key", path: `${L.id}/keys/${ch}`, keys: [...track, [local, cur]] as [number, number, string?][] }];
}

/** Channels owned by a behavior (so the inspector can explain why a field is driven). */
export function ownerOf(L: Layer, ch: string): string | null {
  for (const b of L.beh ?? []) {
    const s = CATALOG[b.use];
    if (s && s.mode === "own" && s.writes.includes(ch)) return b.id;
  }
  return null;
}

export function uniqueId(doc: Doc, stem: string): string {
  const base = stem.replace(/[^a-zA-Z0-9_-]/g, "").replace(/^[^a-zA-Z]+/, "") || "layer";
  if (!doc.layers.some((l) => l.id === base)) return base;
  let n = 2;
  while (doc.layers.some((l) => l.id === `${base}${n}`)) n++;
  return `${base}${n}`;
}

export function uniqueBehId(L: Layer, stem: string): string {
  const ids = new Set((L.beh ?? []).map((b) => b.id));
  if (!ids.has(stem)) return stem;
  let n = 2;
  while (ids.has(`${stem}${n}`)) n++;
  return `${stem}${n}`;
}

/** Insert point: just above the topmost non-camera layer so new things appear in front. */
export function frontAfter(doc: Doc): string | null {
  const last = [...doc.layers].reverse().find((l) => l.type !== "camera");
  return last?.id ?? null;
}

/** Duplicate a layer (and keep its choreography — times are layer-local). */
export function duplicateOps(doc: Doc, id: string): { ops: Op[]; newId: string } | null {
  const L = findLayer(doc, id);
  if (!L) return null;
  const newId = uniqueId(doc, id);
  const copy = structuredClone(L) as Record<string, unknown>;
  delete copy.id;
  const pos = (L.pos ?? [0, 0, 0]) as [number, number, number];
  copy.pos = [pos[0] + 40, pos[1] - 40, pos[2]];
  return { ops: [{ op: "add", id: newId, after: id, layer: copy }], newId };
}

/** Remove a layer and anything parented to it would dangle — unparent children in the same txn. */
export function deleteOps(doc: Doc, ids: string[]): Op[] {
  const ops: Op[] = [];
  for (const l of doc.layers) if (l.parent && ids.includes(l.parent) && !ids.includes(l.id)) ops.push({ op: "del", path: `${l.id}/parent` });
  for (const id of ids) ops.push({ op: "del", path: id });
  if (doc.comp.cam && ids.includes(doc.comp.cam)) ops.push({ op: "del", path: "comp/cam" });
  return ops;
}

export const BEH_COLORS: Record<string, string> = { Enter: "#3ccf91", Exit: "#f7729a", Loop: "#4aa8ff", Text: "#b593ff", Camera: "#ffa24a" };
export function behColor(use: string): string {
  return BEH_COLORS[CATALOG[use]?.group ?? "Enter"] ?? "#8b919c";
}

/**
 * After Effects' keyframe assistants on one key. Eases live on the segment *arriving* at a key,
 * so "ease in" edits this key's segment (incoming handle) and "ease out" edits the next key's
 * segment (outgoing handle). F9 = both, ⇧F9 = in, ⌘⇧F9 = out; "linear" resets both sides.
 */
export function easeKeyOps(doc: Doc, k: { layer: string; channel: string; index: number }, mode: "easy" | "in" | "out" | "linear"): Op[] {
  const L = findLayer(doc, k.layer);
  const tr = L?.keys?.[k.channel];
  if (!L || !tr || !tr[k.index]) return [];
  const next = tr.map((key) => [...key] as [number, number, string?]);
  const j = k.index;
  const lin = mode === "linear";
  if (j > 0 && mode !== "out") next[j][2] = withHandles(next[j][2], { in: lin ? [1, 1] : [0.667, 1] });
  if (j < next.length - 1 && mode !== "in") next[j + 1][2] = withHandles(next[j + 1][2], { out: lin ? [0, 0] : [0.333, 0] });
  for (const key of next) if (key[2] === "linear") key.length = 2;
  return [{ op: "key", path: `${L.id}/keys/${k.channel}`, keys: next }];
}

/**
 * The moment a layer has fully appeared: its start plus its entrance and text animations. Used to
 * move the playhead after adding something, so what you just added is on screen.
 */
export function revealTime(doc: Doc, id: string): number | null {
  const L = findLayer(doc, id);
  if (!L) return null;
  let end = 0;
  for (const b of L.beh ?? []) {
    const spec = CATALOG[b.use];
    if (!spec || (spec.group !== "Enter" && spec.group !== "Text")) continue;
    // letter-by-letter entrances take longer the more text there is
    const stagger = Number((b as Record<string, unknown>).stagger ?? spec.params.stagger?.default ?? 0) || 0;
    const units = L.type === "text" ? Math.min(60, L.text.replace(/\s+/g, "").length) : 0;
    end = Math.max(end, (b.at ?? 0) + ((b.dur as number | undefined) ?? spec.dur) + stagger * units + 0.4);
  }
  return Math.min(Math.max(0, (L.out ?? doc.comp.dur) - 0.05), (L.in ?? 0) + end);
}
