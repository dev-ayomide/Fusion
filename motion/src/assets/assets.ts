import * as THREE from "three";
import { MUSIC } from "../audio/music-catalog";

/**
 * Asset registry. Documents reference assets by id; bytes live in IndexedDB (content-hashed),
 * and this module hands renderers textures. Missing assets render as placeholders.
 */
export interface AssetRecord { id: string; blob: Blob; name: string; mime: string; w?: number; h?: number }

const urls = new Map<string, string>();
const textures = new Map<string, { tex: THREE.Texture; w: number; h: number } | "loading" | "error">();
const listeners = new Set<() => void>();
export function onAssetsChanged(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const notify = () => listeners.forEach((f) => f());

const DB = "fusion-motion";
function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("assets");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbPut(id: string, rec: AssetRecord) {
  try {
    const d = await db();
    await new Promise<void>((res, rej) => {
      const tx = d.transaction("assets", "readwrite");
      tx.objectStore("assets").put(rec, id);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch {
    /* storage can be unavailable (private mode); assets still work for this session */
  }
}
export async function loadStoredAssets(ids: string[]): Promise<void> {
  try {
    const d = await db();
    await Promise.all(
      ids.filter((id) => !urls.has(id)).map(
        (id) =>
          new Promise<void>((res) => {
            const r = d.transaction("assets").objectStore("assets").get(id);
            r.onsuccess = () => {
              const rec = r.result as AssetRecord | undefined;
              if (rec) urls.set(id, URL.createObjectURL(rec.blob));
              res();
            };
            r.onerror = () => res();
          }),
      ),
    );
    notify();
  } catch {
    /* ignore */
  }
}

async function sha(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const h = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(h)).slice(0, 6).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function imageSize(url: string): Promise<{ w: number; h: number }> {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res({ w: img.naturalWidth || 512, h: img.naturalHeight || 512 });
    img.onerror = () => res({ w: 512, h: 512 });
    img.src = url;
  });
}

/** Store a file; returns the doc entry. Ids are readable (from the file name) and unique. */
export async function importAsset(file: Blob & { name?: string }, existing: string[]): Promise<{ id: string; entry: { src: string; mime: string; name: string; w: number; h: number } }> {
  const hash = await sha(file);
  const stem = (file.name ?? "asset").replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 20) || "asset";
  let id = /^[a-z]/.test(stem) ? stem : `a-${stem}`;
  let n = 2;
  while (existing.includes(id)) id = `${stem}-${n++}`;
  const url = URL.createObjectURL(file);
  urls.set(id, url);
  const { w, h } = await imageSize(url);
  const mime = file.type || "image/png";
  await idbPut(id, { id, blob: file, name: file.name ?? id, mime, w, h });
  notify();
  return { id, entry: { src: `asset://sha256/${hash}`, mime, name: file.name ?? id, w, h } };
}

/* ------------------------------ audio ------------------------------ */
const AUDIO_EXT: Record<string, string> = { mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg", webm: "audio/webm", flac: "audio/flac" };
/** Accept attribute for audio file pickers. */
export const AUDIO_ACCEPT = "audio/*," + Object.keys(AUDIO_EXT).map((e) => "." + e).join(",");
export function isAudioFile(file: { type?: string; name?: string }): boolean {
  if (file.type?.startsWith("audio/")) return true;
  const ext = /\.([a-z0-9]+)$/i.exec(file.name ?? "")?.[1]?.toLowerCase();
  return !!ext && ext in AUDIO_EXT && !(file.type?.startsWith("video/") && ext !== "webm");
}
/**
 * Store an uploaded music/sound file (IndexedDB, content-hashed like images). The entry has no w/h;
 * its mime is audio/* so validation and the asset panels can tell it apart from pictures.
 */
export async function importAudioAsset(file: Blob & { name?: string }, existing: string[]): Promise<{ id: string; entry: { src: string; mime: string; name: string } }> {
  const hash = await sha(file);
  const base = (file.name ?? "audio").replace(/\.[^.]+$/, "");
  const stem = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 20) || "audio";
  let id = /^[a-z]/.test(stem) ? stem : `a-${stem}`;
  let n = 2;
  while (existing.includes(id)) id = `${stem}-${n++}`;
  const ext = /\.([a-z0-9]+)$/i.exec(file.name ?? "")?.[1]?.toLowerCase() ?? "";
  const mime = file.type?.startsWith("audio/") ? file.type : AUDIO_EXT[ext] ?? "audio/mpeg";
  urls.set(id, URL.createObjectURL(file));
  await idbPut(id, { id, blob: file, name: file.name ?? id, mime });
  notify();
  return { id, entry: { src: `asset://sha256/${hash}`, mime, name: file.name ?? id } };
}

/** Register an asset from a URL (templates, tests, the bridge). */
export function registerAssetUrl(id: string, url: string) {
  urls.set(id, url);
  textures.delete(id);
  notify();
}

/**
 * Built-in library assets need no upload: a doc asset whose src is `lib://<pack>/<name>` resolves
 * to a file bundled under /assets/<pack>/. Packs: emoji3d (Fluent 3D, MIT); music (CC0, generated by
 * bench/music-library.mjs — audio tracks reference lib://music/<name> directly in their src).
 */
export const LIBRARY: Record<string, { ext: string; names: string[] }> = {
  emoji3d: {
    ext: "webp",
    names: ["pear", "soccer", "football", "basketball", "tennis", "baseball", "rugby", "trophy", "moneybag", "money", "coin", "chart", "rocket", "star", "glow", "sparkles", "fire", "party", "gem", "target", "phone", "heart", "crown", "bulb"],
  },
  music: { ext: "mp3", names: MUSIC.map((t) => t.name) },
};
export function libraryUrl(src: string): string | null {
  const m = /^lib:\/\/([a-z0-9]+)\/([a-z0-9-]+)$/.exec(src);
  if (!m || !LIBRARY[m[1]]?.names.includes(m[2])) return null;
  return `${import.meta.env.BASE_URL}assets/${m[1]}/${m[2]}.${LIBRARY[m[1]].ext}`;
}
/** Register URLs for every library asset a doc references (cheap; called on each sync). */
export function ensureLibraryAssets(assets: Record<string, { src: string }>) {
  for (const [id, a] of Object.entries(assets)) {
    if (urls.has(id)) continue;
    const u = libraryUrl(a.src);
    if (u) urls.set(id, u);
  }
}

export function assetUrl(id: string): string | undefined {
  return urls.get(id);
}

/** Texture for an asset id, loaded lazily. Returns null until ready (callers render a placeholder). */
export function assetTexture(id: string | undefined): { tex: THREE.Texture; w: number; h: number } | null {
  if (!id) return null;
  const hit = textures.get(id);
  if (hit && hit !== "loading" && hit !== "error") return hit;
  if (hit) return null;
  const url = urls.get(id);
  if (!url) return null;
  textures.set(id, "loading");
  const img = new Image();
  img.onload = () => {
    const tex = new THREE.Texture(img);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.needsUpdate = true;
    textures.set(id, { tex, w: img.naturalWidth, h: img.naturalHeight });
    notify();
  };
  img.onerror = () => textures.set(id, "error");
  img.src = url;
  return null;
}

/** Wait until the given assets have textures (used before export so no frame shows a placeholder). */
export async function preloadTextures(ids: string[]): Promise<void> {
  const pending = ids.filter((id) => urls.has(id) && textures.get(id) !== "error");
  for (let i = 0; i < 100; i++) {
    const missing = pending.filter((id) => !assetTexture(id) && textures.get(id) !== "error");
    if (!missing.length) return;
    await new Promise((r) => setTimeout(r, 30));
  }
}
