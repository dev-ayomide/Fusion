import { Doc as DocSchema, type Doc } from "../fmd/schema";
import { forgetChat } from "./chatHistory";
import { Stage } from "../render/stage";
import { fontsReady, ensureFont } from "../render/glyphs";
import { loadStoredAssets } from "../assets/assets";

/**
 * The projects library ("Your videos").
 *
 *  - a lightweight index (id, name, times, thumbnail) lives in localStorage so the landing page can
 *    render synchronously;
 *  - full documents live in IndexedDB (they can outgrow localStorage), with an in-memory cache;
 *  - thumbnails are real frames rendered offscreen by the same Stage as the editor.
 *
 * Storage can be unavailable (private mode, quota): every write degrades to "this session only".
 */

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** 320×180 JPEG data URL of a frame at ~30% of the duration. */
  thumb?: string;
  dur: number;
  layers: number;
}

const INDEX_KEY = "fusion-motion:projects:v1";
const LEGACY_KEY = "fusion-motion:project:v1";
const DB_NAME = "fusion-motion-projects";
const STORE = "docs";

/* ------------------------------ index ------------------------------ */

function readIndex(): ProjectMeta[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    const list = raw ? (JSON.parse(raw) as ProjectMeta[]) : [];
    return Array.isArray(list) ? list.filter((p) => p && typeof p.id === "string") : [];
  } catch {
    return [];
  }
}

let index: ProjectMeta[] = sortIndex(readIndex());
const listeners = new Set<() => void>();

function sortIndex(list: ProjectMeta[]) {
  return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
}

function writeIndex(next: ProjectMeta[]) {
  index = sortIndex(next);
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch {
    // quota: drop thumbnails of the oldest projects and try once more
    try {
      const slim = index.map((p, i) => (i < 12 ? p : { ...p, thumb: undefined }));
      localStorage.setItem(INDEX_KEY, JSON.stringify(slim));
    } catch {
      /* the session still works */
    }
  }
  listeners.forEach((f) => f());
}

/** Newest first. The array identity changes only when the library changes (safe for useSyncExternalStore). */
export function listProjects(): ProjectMeta[] {
  return index;
}
export function subscribeProjects(fn: () => void) {
  listeners.add(fn);
  // another tab edited the library
  const onStorage = (e: StorageEvent) => {
    if (e.key === INDEX_KEY) {
      index = sortIndex(readIndex());
      fn();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}
export function getProjectMeta(id: string) {
  return index.find((p) => p.id === id);
}
function patchMeta(id: string, patch: Partial<ProjectMeta>) {
  if (!index.some((p) => p.id === id)) return;
  writeIndex(index.map((p) => (p.id === id ? { ...p, ...patch } : p)));
}

/* ------------------------------ documents ------------------------------ */

const cache = new Map<string, Doc>();

function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
let dbp: Promise<IDBDatabase> | null = null;
const getDb = () => (dbp ??= idb());

async function idbReq<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void): Promise<T | undefined> {
  try {
    const d = await getDb();
    return await new Promise<T | undefined>((res, rej) => {
      const tx = d.transaction(STORE, mode);
      const r = fn(tx.objectStore(STORE));
      tx.oncomplete = () => res(r ? (r.result as T) : undefined);
      tx.onerror = () => rej(tx.error);
    });
  } catch {
    return undefined;
  }
}

/** Upgrade older documents on load; the evaluator only ever sees the current version. */
export function migrateDoc(doc: unknown): unknown {
  return doc;
}

function parse(raw: unknown): Doc | null {
  const r = DocSchema.safeParse(migrateDoc(raw));
  return r.success ? r.data : null;
}

export async function loadProjectDoc(id: string): Promise<Doc | null> {
  const hit = cache.get(id);
  if (hit) return hit;
  const raw = await idbReq<unknown>("readonly", (s) => s.get(id));
  const doc = raw ? parse(raw) : null;
  if (doc) cache.set(id, doc);
  return doc;
}

/** Synchronous peek at a document already in memory (saved or loaded this session). */
export function cachedProjectDoc(id: string): Doc | undefined {
  return cache.get(id);
}

const newId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const nameOf = (doc: Doc) => (doc.name ?? "").trim() || "Untitled";

/** Write a document into the library (creating the entry if needed). */
export async function saveProjectDoc(id: string, doc: Doc) {
  cache.set(id, doc);
  const now = Date.now();
  const meta = getProjectMeta(id);
  const fields = { name: nameOf(doc), dur: doc.comp.dur, layers: doc.layers.length, updatedAt: now };
  if (meta) patchMeta(id, fields);
  else writeIndex([...index, { id, createdAt: now, ...fields }]);
  await idbReq("readwrite", (s) => s.put(doc, id));
}

export function createProject(doc: Doc): ProjectMeta {
  const id = newId();
  void saveProjectDoc(id, doc);
  scheduleThumb(id, 1500);
  return getProjectMeta(id)!;
}

export async function renameProject(id: string, name: string) {
  const clean = name.trim() || "Untitled";
  patchMeta(id, { name: clean, updatedAt: Date.now() });
  const doc = await loadProjectDoc(id);
  if (doc) {
    const next = { ...doc, name: clean };
    cache.set(id, next);
    await idbReq("readwrite", (s) => s.put(next, id));
  }
}

export async function duplicateProject(id: string): Promise<ProjectMeta | null> {
  const doc = await loadProjectDoc(id);
  const src = getProjectMeta(id);
  if (!doc) return null;
  const copy: Doc = { ...structuredClone(doc), name: `${nameOf(doc)} copy` };
  const nid = newId();
  await saveProjectDoc(nid, copy);
  if (src?.thumb) patchMeta(nid, { thumb: src.thumb });
  return getProjectMeta(nid)!;
}

export async function deleteProject(id: string) {
  forgetChat(id);
  cache.delete(id);
  writeIndex(index.filter((p) => p.id !== id));
  await idbReq("readwrite", (s) => s.delete(id));
}

/* ------------------------------ thumbnails ------------------------------ */

let stage: Stage | null = null;
let idleTimer = 0;
let queue: Promise<unknown> = Promise.resolve();

export function loadDocFonts(doc: Doc) {
  for (const L of doc.layers) {
    if (L.type !== "text") continue;
    ensureFont(L.font ?? doc.brand.font, L.weight ?? 600);
    for (const s of L.spans ?? []) ensureFont(s.font ?? L.font ?? doc.brand.font, s.weight ?? L.weight ?? 600);
  }
}

/**
 * Render one frame of `doc` to a JPEG data URL with a shared offscreen Stage.
 * Calls are serialised; the WebGL context is released after a short idle.
 */
export function renderDocThumb(doc: Doc, t: number, w = 320, h = 180, quality = 0.8): Promise<string> {
  const job = queue.then(async () => {
    clearTimeout(idleTimer);
    if (!stage) {
      const canvas = document.createElement("canvas");
      stage = new Stage(canvas, { preserveDrawingBuffer: true });
      stage.textResolution = 1;
    }
    stage.setSize(w, h, 1);
    loadDocFonts(doc);
    await fontsReady();
    await loadStoredAssets(Object.keys(doc.assets ?? {}));
    await stage.prepare(doc, t);
    stage.renderFrame(doc, t, { samples: 1 });
    stage.renderFrame(doc, t, { samples: 1 });
    const url = (stage.canvas as HTMLCanvasElement).toDataURL("image/jpeg", quality);
    idleTimer = window.setTimeout(() => {
      stage?.dispose();
      stage = null;
    }, 12_000);
    return url;
  });
  queue = job.catch(() => undefined);
  return job;
}

/** Frame used for a project's card: ~30% in, where most videos have their hero on screen. */
export const thumbTime = (doc: Doc) => (doc.layers.length ? Math.min(doc.comp.dur * 0.3, Math.max(0, doc.comp.dur - 0.1)) : 0);

const thumbTimers = new Map<string, number>();
const lastThumb = new Map<string, number>();
const THUMB_EVERY = 6000;

/** Regenerate a project's thumbnail, throttled (at most one render per project every few seconds). */
export function scheduleThumb(id: string, delay?: number) {
  if (thumbTimers.has(id)) return;
  const since = Date.now() - (lastThumb.get(id) ?? 0);
  const wait = delay ?? Math.max(1200, THUMB_EVERY - since);
  thumbTimers.set(
    id,
    window.setTimeout(() => {
      thumbTimers.delete(id);
      void refreshThumb(id);
    }, wait),
  );
}

export async function refreshThumb(id: string) {
  const pending = thumbTimers.get(id);
  if (pending) {
    clearTimeout(pending);
    thumbTimers.delete(id);
  }
  lastThumb.set(id, Date.now());
  const doc = await loadProjectDoc(id);
  if (!doc || !getProjectMeta(id)) return;
  try {
    const thumb = await renderDocThumb(doc, thumbTime(doc));
    if (getProjectMeta(id)) patchMeta(id, { thumb });
  } catch {
    /* no WebGL: cards fall back to a typographic placeholder */
  }
}

/** Fill in thumbnails for projects that have none (e.g. just migrated). */
export function ensureThumbs() {
  for (const p of index) if (!p.thumb) scheduleThumb(p.id, 300);
}

/* ------------------------------ migration ------------------------------ */

/** Move the pre-library single autosave ("fusion-motion:project:v1") into the library, once. */
export function migrateLegacy() {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return;
    const p = JSON.parse(raw) as { doc: unknown; savedAt?: number };
    const doc = parse(p.doc);
    if (doc) {
      const id = newId();
      const at = p.savedAt ?? Date.now();
      cache.set(id, doc);
      writeIndex([...index, { id, name: nameOf(doc), createdAt: at, updatedAt: at, dur: doc.comp.dur, layers: doc.layers.length }]);
      void idbReq("readwrite", (s) => s.put(doc, id));
    }
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* ignore */
  }
}

/* ------------------------------ time ------------------------------ */

export function relativeTime(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "yesterday";
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: new Date(ts).getFullYear() === new Date(now).getFullYear() ? undefined : "numeric" });
}
