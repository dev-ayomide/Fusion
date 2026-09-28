import { useStore } from "./store";
import type { Doc } from "../fmd/schema";
import { loadStoredAssets } from "../assets/assets";
import { openDoc } from "./startFlow";
import { loadChat, saveChat } from "./chatHistory";
import {
  cachedProjectDoc,
  createProject,
  listProjects,
  loadProjectDoc,
  migrateDoc,
  migrateLegacy,
  refreshThumb,
  saveProjectDoc,
  scheduleThumb,
} from "./projects";

/**
 * Autosave into the projects library.
 *
 * Every entry into the editor binds the open document to one library entry: the project
 * `openProject(id)` / `newProjectFromDoc(doc)` armed, or — when nothing was armed (a template,
 * the AI prompt, "blank canvas") — a brand-new entry. Edits then save into that entry only, so
 * opening something new never overwrites earlier work.
 */

let currentId: string | null = null;
/** Project to bind on the next entry into the editor (undefined = create a new one). */
let armed: string | undefined;

const saveListeners = new Set<() => void>();
let saveState: "idle" | "saving" | "saved" = "idle";
const setSaveState = (s: typeof saveState) => {
  saveState = s;
  saveListeners.forEach((f) => f());
};
export const getSaveState = () => saveState;
export function subscribeSaveState(fn: () => void) {
  saveListeners.add(fn);
  return () => saveListeners.delete(fn);
}

export function currentProjectId() {
  return currentId;
}

/** Upgrade older documents on load; the evaluator only ever sees the current version. */
export function migrate(doc: unknown): unknown {
  return migrateDoc(doc);
}

/** Most recently edited project (from memory, if it has been loaded this session). */
export function savedProject(): { doc: Doc; savedAt: number; id: string } | null {
  const p = listProjects()[0];
  const doc = p && cachedProjectDoc(p.id);
  return p && doc ? { doc, savedAt: p.updatedAt, id: p.id } : null;
}

export async function restoreAssets(doc: Doc) {
  await loadStoredAssets(Object.keys(doc.assets));
}

/** Put `doc` into the library as a new project and bind the editor to it. Call before openDoc(doc). */
export function newProjectFromDoc(doc: Doc): string {
  const meta = createProject(doc);
  armed = meta.id;
  return meta.id;
}

/** Load a library project into the editor. Resolves false if it can't be read. */
export async function openProject(id: string): Promise<boolean> {
  const doc = await loadProjectDoc(id);
  if (!doc) return false;
  await restoreAssets(doc);
  armed = id;
  openDoc(doc);
  return true;
}

/** A blank canvas nobody has touched yet (no content, no assets, default name). */
const isPristineBlank = (doc: Doc) =>
  (doc.name ?? "Untitled") === "Untitled" && !Object.keys(doc.assets).length && doc.layers.every((l) => l.type === "gradient" || l.type === "camera");

let timer = 0;
let pending: { id: string; doc: Doc } | null = null;

async function flush() {
  clearTimeout(timer);
  const p = pending;
  pending = null;
  if (!p) return;
  await saveProjectDoc(p.id, p.doc);
  setSaveState("saved");
}

export function startAutosave() {
  migrateLegacy();
  // warm the most recent document so "continue" is instant
  const recent = listProjects()[0];
  if (recent) void loadProjectDoc(recent.id);

  let lastDoc: Doc | null = null;
  let lastTurns = useStore.getState().turns;
  let chatTimer = 0;
  const saveChatSoon = () => {
    const id = currentId;
    if (!id) return;
    clearTimeout(chatTimer);
    chatTimer = window.setTimeout(() => saveChat(id, useStore.getState().turns), 300);
  };
  let lastScreen = useStore.getState().screen;
  const onHide = () => {
    void flush();
    if (currentId && useStore.getState().screen === "editor") saveChat(currentId, useStore.getState().turns);
  };
  window.addEventListener("pagehide", onHide);
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && onHide());

  return useStore.subscribe((s) => {
    if (s.screen !== lastScreen) {
      const was = lastScreen;
      lastScreen = s.screen;
      if (was === "editor") {
        // leaving the editor: save now and refresh the card's thumbnail
        const id = currentId;
        clearTimeout(chatTimer);
        if (id) saveChat(id, lastTurns);
        void flush().then(() => (id ? refreshThumb(id) : undefined));
      }
      if (s.screen === "editor") {
        currentId = armed ?? null;
        armed = undefined;
        lastDoc = null;
        setSaveState("idle");
        // bring back this video's conversation (only if nothing has started in the new session yet)
        if (currentId && !s.turns.length) {
          const saved = loadChat(currentId);
          if (saved.length) {
            lastTurns = saved;
            useStore.getState().set("turns", saved);
          }
        }
      }
    }
    if (s.screen === "editor" && s.turns !== lastTurns) {
      lastTurns = s.turns;
      saveChatSoon();
    }
    if (s.screen !== "editor" || s.doc === lastDoc) return;
    const first = lastDoc === null;
    lastDoc = s.doc;
    if (!currentId) {
      // an untouched blank canvas becomes a project on its first edit, not on open
      if (first && isPristineBlank(s.doc)) return;
      currentId = createProject(s.doc).id;
      setSaveState("saved");
      saveChatSoon();
      return;
    }
    if (first) return; // just opened: nothing changed yet
    pending = { id: currentId, doc: s.doc };
    setSaveState("saving");
    clearTimeout(timer);
    timer = window.setTimeout(() => void flush(), 400);
    scheduleThumb(currentId);
  });
}

/** Detach the editor from its library entry (the project itself is kept). */
export function clearSaved() {
  currentId = null;
  pending = null;
  clearTimeout(timer);
}
