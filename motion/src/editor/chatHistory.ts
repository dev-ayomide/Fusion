import type { Turn } from "./store";

/**
 * The assistant conversation, saved per project in this browser (localStorage) so it survives a
 * reload and comes back when a video is reopened. Only settled turns are kept: a reply still being
 * written is dropped (the request stays as a user message), and changes still under review are
 * saved as not kept, since the preview they belong to is gone after a reload.
 */

const KEY = (projectId: string) => `fusion-chat-${projectId}`;
/** Keep storage bounded: oldest turns lose their op lists first, then the oldest turns go. */
const MAX_CHARS = 1_500_000;
const MAX_TURNS = 200;

export function settleForStorage(turns: Turn[]): Turn[] {
  const out: Turn[] = [];
  for (const t of turns) {
    if (t.role === "agent" && (t.status === "waiting" || t.status === "streaming")) continue;
    const s: Turn = { ...t, context: undefined };
    if (s.status === "review") s.status = "discarded";
    out.push(s);
  }
  return out.slice(-MAX_TURNS);
}

export function saveChat(projectId: string, turns: Turn[]) {
  const list = settleForStorage(turns);
  try {
    let json = JSON.stringify(list);
    for (let i = 0; json.length > MAX_CHARS && i < list.length; i++) {
      list[i] = { ...list[i], ops: undefined, accepted: undefined, opErrors: undefined };
      json = JSON.stringify(list);
    }
    while (json.length > MAX_CHARS && list.length) {
      list.shift();
      json = JSON.stringify(list);
    }
    if (list.length) localStorage.setItem(KEY(projectId), json);
    else localStorage.removeItem(KEY(projectId));
  } catch {
    /* storage full or unavailable: the chat just won't survive a reload */
  }
}

export function loadChat(projectId: string): Turn[] {
  try {
    const raw = localStorage.getItem(KEY(projectId));
    const list = raw ? (JSON.parse(raw) as Turn[]) : [];
    return Array.isArray(list) ? list.filter((t) => t && typeof t.id === "string" && typeof t.role === "string") : [];
  } catch {
    return [];
  }
}

export function forgetChat(projectId: string) {
  try {
    localStorage.removeItem(KEY(projectId));
  } catch {
    /* ignore */
  }
}
