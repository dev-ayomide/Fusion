import { useStore } from "./store";
import { Doc as DocSchema, type Doc } from "../fmd/schema";
import { loadStoredAssets } from "../assets/assets";

const KEY = "fusion-motion:project:v1";

export function savedProject(): { doc: Doc; savedAt: number } | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as { doc: unknown; savedAt: number };
    const parsed = DocSchema.safeParse(migrate(p.doc));
    return parsed.success ? { doc: parsed.data, savedAt: p.savedAt } : null;
  } catch {
    return null;
  }
}

/** Upgrade older documents on load; the evaluator only ever sees the current version. */
export function migrate(doc: unknown): unknown {
  return doc;
}

export async function restoreAssets(doc: Doc) {
  await loadStoredAssets(Object.keys(doc.assets));
}

let timer = 0;
export function startAutosave() {
  let last: Doc | null = null;
  return useStore.subscribe((s) => {
    if (s.screen !== "editor" || s.doc === last) return;
    last = s.doc;
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify({ doc: s.doc, savedAt: Date.now() }));
      } catch {
        /* storage full or blocked — the session still works */
      }
    }, 400);
  });
}

export function clearSaved() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
