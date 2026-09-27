/**
 * Path grammar: `/` separates segments, dots belong to channel names, no brackets, no indices.
 *   phone/rot               layer field
 *   phone/pos/y             tuple component (x|y|z or 0|1|2)
 *   phone/beh/rise/dur      item of an id-collection, then its field
 *   phone/keys/rot.y        a whole key track
 *   comp/dur, brand/colors/accent, style/energy
 * The first segment is either a root field or a layer id.
 */
type Json = unknown;
type Obj = Record<string, Json>;

export const ROOT_FIELDS = new Set(["v", "name", "comp", "brand", "assets", "markers", "style", "bindings", "scenes", "audio"]);
/** Arrays whose items are addressed by their `id`. */
export const ID_COLLECTIONS = new Set(["beh", "fx", "anim", "markers", "layers", "scenes", "audio"]);
const AX: Record<string, number> = { x: 0, y: 1, z: 2 };

export interface Loc {
  /** container holding the leaf */
  parent: Obj | Json[];
  /** key in an object, index in an array */
  key: string | number;
  /** true when parent is an id-collection (key is an index, item has `id`) */
  idItem: boolean;
  /** the final segment as written */
  seg: string;
  exists: boolean;
}

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function splitPath(path: string): string[] {
  const segs = path.split("/").filter((s) => s.length > 0);
  if (!segs.length) throw new PathError(path, "empty path");
  return segs;
}

export class PathError extends Error {
  constructor(public path: string, msg: string) {
    super(`${path}: ${msg}`);
  }
}

/**
 * Locate the leaf for `path`. With `create`, missing intermediate objects are created
 * (never missing layers or id-items — those must be created by setting them whole).
 */
export function locate(doc: Obj, path: string, create = false): Loc {
  const segs = splitPath(path);
  let node: Json;
  let collectionName: string;
  let i: number;
  if (ROOT_FIELDS.has(segs[0])) {
    node = doc;
    collectionName = "";
    i = 0;
  } else {
    node = doc.layers as Json[];
    collectionName = "layers";
    i = 0;
  }
  for (; i < segs.length; i++) {
    const seg = segs[i];
    const last = i === segs.length - 1;
    let key: string | number;
    let idItem = false;
    if (Array.isArray(node)) {
      if (ID_COLLECTIONS.has(collectionName)) {
        key = node.findIndex((it) => isObj(it) && it.id === seg);
        idItem = true;
        if (key < 0) {
          if (!last) throw new PathError(path, `no item "${seg}" in ${collectionName || "layers"}`);
          return { parent: node, key: node.length, idItem, seg, exists: false };
        }
      } else {
        key = seg in AX ? AX[seg] : Number(seg);
        if (!Number.isInteger(key) || key < 0) throw new PathError(path, `"${seg}" is not a tuple index (use x|y|z or 0..n)`);
      }
    } else if (isObj(node)) {
      key = seg;
    } else {
      throw new PathError(path, `cannot descend into ${JSON.stringify(node)} at "${seg}"`);
    }
    const parent = node as Obj | Json[];
    const child = (parent as Record<string | number, Json>)[key];
    if (last) return { parent, key, idItem, seg, exists: child !== undefined };
    if (child === undefined || child === null) {
      if (!create) throw new PathError(path, `"${seg}" does not exist`);
      // tuples we know about get created as tuples, everything else as objects
      const nextSeg = segs[i + 1];
      const fresh: Json = ID_COLLECTIONS.has(seg) ? [] : nextSeg in AX ? [0, 0, 0] : {};
      (parent as Record<string | number, Json>)[key] = fresh;
      node = fresh;
    } else node = child;
    collectionName = seg;
  }
  throw new PathError(path, "unreachable");
}

export function getPath(doc: Obj, path: string): Json {
  try {
    const loc = locate(doc, path);
    return loc.exists ? (loc.parent as Record<string | number, Json>)[loc.key] : undefined;
  } catch {
    return undefined;
  }
}

/** Index of an id-item (layer, behavior…) within its collection, or -1. */
export function itemIndex(doc: Obj, path: string): number {
  try {
    const loc = locate(doc, path);
    return loc.idItem && loc.exists ? (loc.key as number) : -1;
  } catch {
    return -1;
  }
}

export function setPath(doc: Obj, path: string, value: Json, index?: number): void {
  const loc = locate(doc, path, true);
  if (loc.idItem) {
    const arr = loc.parent as Json[];
    const item = isObj(value) ? { ...value, id: loc.seg } : value;
    if (loc.exists) {
      arr[loc.key as number] = item;
      if (index !== undefined && index !== loc.key) {
        arr.splice(loc.key as number, 1);
        arr.splice(Math.min(index, arr.length), 0, item);
      }
    } else arr.splice(index === undefined ? arr.length : Math.min(index, arr.length), 0, item);
    return;
  }
  (loc.parent as Record<string | number, Json>)[loc.key] = value;
}

export function delPath(doc: Obj, path: string): void {
  const loc = locate(doc, path);
  if (!loc.exists) return;
  if (Array.isArray(loc.parent)) {
    if (loc.idItem) loc.parent.splice(loc.key as number, 1);
    else throw new PathError(path, "cannot delete a tuple component");
  } else delete loc.parent[loc.key as string];
}
