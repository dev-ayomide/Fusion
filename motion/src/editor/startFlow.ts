import { useStore } from "./store";
import { playhead } from "./playhead";
import { TEMPLATES } from "../templates";
import { importAsset } from "../assets/assets";
import { requestPlan } from "../ai/director";
import type { Doc } from "../fmd/schema";

/** Open a document in the editor at t = 0. */
export function openDoc(doc: Doc) {
  const st = useStore.getState();
  st.loadDoc(doc);
  st.set("screen", "editor");
  playhead.set(0);
}

/**
 * The landing prompt's entry point: a blank project named from the prompt, uploaded images
 * imported as assets, then the prompt handed to the AI as a request for a scene plan of the whole
 * video (the storyboard). Building starts when the user presses Build. The landing page only calls this.
 */
export async function startProject(text: string, files: File[], opts: { length?: number; aspect?: string; look?: string } = {}) {
  const doc = TEMPLATES.find((t) => t.id === "blank")!.make();
  doc.name = text.trim().split(/[.,\n—]/)[0].slice(0, 40) || "Untitled";
  openDoc(doc);
  const st = useStore.getState();
  const ops = [];
  for (const f of files) {
    const { id, entry } = await importAsset(f, Object.keys(st.doc.assets).concat(ops.map((o) => o.path.split("/")[1])));
    ops.push({ op: "set" as const, path: `assets/${id}`, value: entry });
  }
  if (ops.length) st.commit(ops, { source: "you", intent: `Imported ${ops.length} image${ops.length > 1 ? "s" : ""}` });
  st.setTab("assistant");
  if (text.trim()) requestPlan(text.trim(), opts);
}
