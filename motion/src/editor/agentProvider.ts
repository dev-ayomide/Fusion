import { callModel, ModelError, parseLooseJson, type ModelConfig } from "../ai/llm";
import { systemFor, type TaskKind } from "../ai/prompts";
import { repairOps, sanitizeOps } from "../ai/repair";
import type { Op } from "../fmd/ops";
import { buildPreview, useStore, type Chip } from "./store";
import { prepareTurnOps, respond, type PendingTurn } from "./bridge";

/**
 * In-app AI providers. The editor itself never calls a model — this module is just another bridge
 * client, exactly like an external script or MCP agent: it polls `bridge.pending()`, asks the
 * connected model, and answers through `bridge.respond`. Keys stay on the dev server (vite.config.ts).
 */

export type ProviderId = "anthropic" | "deepseek" | "agentrouter" | "mistral";

export interface Provider extends ModelConfig {
  id: ProviderId;
  /** the motion/.env variable that enables it */
  env: string;
  vendor: string;
}

export const PROVIDERS: Record<ProviderId, Provider> = {
  anthropic: { id: "anthropic", label: "Claude Opus 5.5", vendor: "Anthropic", env: "ANTHROPIC_API_KEY", wire: "anthropic", endpoint: "/api/anthropic/v1/messages", model: "claude-opus-5-5", maxTokens: 64000 },
  // DeepSeek's own API (api.deepseek.com): OpenAI-style, JSON output, and no bot firewall, so it works from a server
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    vendor: "DeepSeek",
    env: "DEEPSEEK_API_KEY",
    wire: "openai",
    endpoint: "/api/deepseek/chat/completions",
    model: "deepseek-v4-pro",
    jsonMode: true,
    maxTokens: 32000,
    // ops replies are structured — thinking tokens would just eat the budget
    extraBody: { thinking: { type: "disabled" } },
  },
  agentrouter: {
    id: "agentrouter",
    label: "DeepSeek (AgentRouter)",
    vendor: "DeepSeek via AgentRouter",
    env: "AGENTROUTER_API_KEY",
    wire: "openai",
    endpoint: "/api/agentrouter/chat/completions",
    model: "deepseek-v4-flash",
    jsonMode: true,
    maxTokens: 16384,
    // ops replies are structured — thinking tokens would just eat the budget
    extraBody: { thinking: { type: "disabled" } },
  },
  mistral: { id: "mistral", label: "Mistral", vendor: "Mistral AI", env: "MISTRAL_API_KEY", wire: "openai", endpoint: "/api/mistral/v1/chat/completions", model: "mistral-medium-latest", jsonMode: true, maxTokens: 16000 },
};
/** Auto-connect preference. */
export const PROVIDER_ORDER: ProviderId[] = ["anthropic", "deepseek", "agentrouter", "mistral"];

/* ------------------------------- prompts ------------------------------- */

function userMessage(turn: PendingTurn): string {
  const scene = turn.scene;
  const sceneBlock = scene
    ? `SCENE ${scene.index + 1} of ${scene.count} — "${scene.title}"\nWINDOW: ${turn.window![0]}–${turn.window![1]} s (comp time, ${scene.dur} s long). Every new layer id starts with "${scene.prefix}".\nBRIEF: ${scene.brief || "(no brief — make it fit the plan)"}${scene.prev ? `\nPREVIOUS SCENE: ${scene.prev.title} — ${scene.prev.brief}` : "\nThis is the OPENING scene."}${scene.next ? `\nNEXT SCENE: ${scene.next.title} — ${scene.next.brief}` : "\nThis is the FINAL scene — end on a held, composed frame."}`
    : "";
  switch (turn.kind) {
    case "plan":
      return `${turn.prompt}\n\nReturn the scene plan JSON.`;
    case "setup":
      return `${turn.prompt}\n\nDOCUMENT OUTLINE:\n${turn.outline}\n\nReturn the setup ops JSON.`;
    case "scene":
      return `ART DIRECTION: ${turn.plan?.look || "(match the brand below)"}\n\nDOCUMENT OUTLINE (brand colours, fonts, the shared camera and every built scene):\n${turn.outline}\n\n${sceneBlock}\n\nBuild this scene now. Return the JSON.`;
    default:
      return `${turn.outline}${turn.inspect ? "\n\nFOCUSED LAYER JSON:\n" + turn.inspect.slice(0, 24000) : ""}${sceneBlock ? "\n\nSCOPED TO " + sceneBlock : ""}${turn.docValid ? "" : "\n\n(note: the document currently has validation issues)"}\n\nREQUEST: ${turn.prompt}`;
  }
}

const budget = (cfg: Provider, kind: TaskKind) => {
  const claude = cfg.wire === "anthropic";
  switch (kind) {
    case "plan":
      return { maxTokens: claude ? 16000 : 4000, effort: "medium" as const };
    case "setup":
      return { maxTokens: claude ? 16000 : 4000, effort: "low" as const };
    case "scene":
      return { maxTokens: cfg.maxTokens, effort: "medium" as const };
    case "repair":
      return { maxTokens: claude ? 16000 : 6000, effort: "low" as const };
    default:
      return { maxTokens: claude ? 32000 : 8000, effort: "medium" as const };
  }
};

async function ask(cfg: Provider, kind: TaskKind, user: string, usage: { in: number; out: number }): Promise<Record<string, unknown>> {
  const system = systemFor(kind);
  let last: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await callModel(cfg, { system, user, ...budget(cfg, kind) });
    usage.in += r.usage?.in ?? 0;
    usage.out += r.usage?.out ?? 0;
    try {
      const parsed = parseLooseJson(r.text);
      if (parsed && typeof parsed === "object") return (Array.isArray(parsed) ? { ops: parsed } : parsed) as Record<string, unknown>;
    } catch (e) {
      last = e as Error;
    }
    // a malformed reply is usually a one-off — ask once more before surfacing an error
  }
  throw new Error(`${cfg.label} did not return valid JSON${last ? ` (${last.message})` : ""}`);
}

/** Per-agent-op validation errors, as the editor will judge them (after scene prefixing). */
function checker(turn: PendingTurn) {
  const meta = { kind: turn.kind, sceneId: turn.scene?.id, window: turn.window };
  return (ops: Op[]) => {
    const doc = useStore.getState().doc;
    const prepared = prepareTurnOps(meta, ops, doc);
    const { opErrors } = buildPreview(doc, prepared.ops, prepared.ops.map(() => true));
    const out: (string | null)[] = ops.map(() => null);
    opErrors.forEach((e, i) => {
      const j = prepared.from[i];
      if (e && j >= 0 && !out[j]) out[j] = e;
    });
    return out;
  };
}

async function handle(cfg: Provider, turn: PendingTurn) {
  const usage = { in: 0, out: 0 };
  const kind: TaskKind = turn.kind;
  const user = userMessage(turn);
  const reply = await ask(cfg, kind, user, usage);
  const message = typeof reply.message === "string" ? reply.message : "";
  if (kind === "plan") {
    await respond(turn.turnId, { message, plan: { scenes: reply.scenes ?? reply.plan, look: typeof reply.look === "string" ? reply.look : undefined } });
  } else {
    let ops = sanitizeOps(reply.ops);
    if (ops.length) {
      const rep = await repairOps(ops, checker(turn), (req) => ask(cfg, "repair", `${user}\n\nYOUR PREVIOUS OPS (${ops.length}) were checked.\n${req}`, usage));
      ops = rep.ops;
    }
    const chips = Array.isArray(reply.chips)
      ? (reply.chips as Chip[]).filter((c) => c && typeof c.label === "string" && (Array.isArray(c.ops) || typeof c.prompt === "string")).slice(0, 2)
      : undefined;
    await respond(turn.turnId, { message, ops, chips, delayMs: kind === "scene" || kind === "setup" ? Math.max(25, Math.min(90, 3000 / Math.max(1, ops.length))) : 70 });
  }
  if (usage.in || usage.out) useStore.getState().patchTurn(turn.turnId, { tokens: usage });
}

/* ------------------------------ connection ------------------------------ */

let timer: ReturnType<typeof setInterval> | null = null;
let activeProvider: ProviderId | null = null;
const inFlight = new Set<string>();

function fusion() {
  return (window as unknown as { fusion?: { bridge: { connect(name: string, o?: { provider?: string }): boolean; disconnect(): void; pending(): PendingTurn[] } } }).fusion;
}

/**
 * Providers that can't be reached from this server (e.g. a firewall answers instead of the API). Kept for the
 * browser session so a reload doesn't try them first again.
 */
const BLOCKED_KEY = "fusion-blocked-providers";
function blockedProviders(): Set<ProviderId> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(BLOCKED_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}
function markBlocked(id: ProviderId) {
  const set = blockedProviders().add(id);
  try {
    sessionStorage.setItem(BLOCKED_KEY, JSON.stringify([...set]));
  } catch {
    /* storage unavailable: the fallback still works for this page */
  }
}

/** The next provider with a key that isn't known to be blocked, if any. */
function fallbackFor(id: ProviderId): ProviderId | null {
  const avail = useStore.getState().providers ?? {};
  const blocked = blockedProviders();
  return PROVIDER_ORDER.find((p) => p !== id && avail[p] && !blocked.has(p)) ?? null;
}

function tick(cfg: Provider) {
  const bridge = fusion()?.bridge;
  if (!bridge) return;
  // someone else (an external agent) connected: step aside
  if (useStore.getState().agent?.provider !== cfg.id) return stopPolling();
  for (const turn of bridge.pending()) {
    if (inFlight.has(turn.turnId)) continue;
    inFlight.add(turn.turnId);
    handle(cfg, turn)
      .catch((e: Error) => {
        // this provider can't be reached from here: hand the same turn to the next one instead of failing it
        if (e instanceof ModelError && e.blocked) {
          markBlocked(cfg.id);
          const next = fallbackFor(cfg.id);
          if (next && activeProvider === cfg.id) {
            if (useStore.getState().preview?.turnId === turn.turnId) useStore.getState().discardPreview();
            useStore.getState().toast(`${cfg.label} can't be reached from this server. Switched to ${PROVIDERS[next].label}.`);
            inFlight.delete(turn.turnId);
            connectProvider(next);
            return;
          }
        }
        const t = useStore.getState().turns.find((x) => x.id === turn.turnId);
        if (t && (t.status === "waiting" || t.status === "streaming")) {
          if (useStore.getState().preview?.turnId === turn.turnId) useStore.getState().discardPreview();
          useStore.getState().patchTurn(turn.turnId, { status: "error", text: e.message });
          if (t.kind === "plan") useStore.getState().setDirector({ phase: useStore.getState().doc.scenes.length ? "ready" : "idle" });
        }
      })
      .finally(() => inFlight.delete(turn.turnId));
  }
}

function stopPolling() {
  if (timer) clearInterval(timer);
  timer = null;
  activeProvider = null;
  inFlight.clear();
}

export function connectProvider(id: ProviderId) {
  const cfg = PROVIDERS[id];
  stopPolling();
  fusion()?.bridge.connect(cfg.label, { provider: id });
  activeProvider = id;
  timer = setInterval(() => tick(cfg), 600);
  tick(cfg);
}

export function disconnectProvider() {
  stopPolling();
  fusion()?.bridge.disconnect();
}

export function activeProviderId() {
  return activeProvider;
}

/** Which providers have a key on the dev server. */
export async function checkProviders(): Promise<Record<ProviderId, boolean>> {
  let avail = { anthropic: false, deepseek: false, agentrouter: false, mistral: false };
  try {
    const r = await fetch("/api/ai/providers", { cache: "no-store" });
    if (r.ok) avail = { ...avail, ...(await r.json()) };
  } catch {
    /* no dev server endpoint (static build) */
  }
  useStore.getState().set("providers", avail);
  return avail;
}

/**
 * Connect the best available provider with no clicks (Claude › DeepSeek › Mistral). Skipped when an
 * agent is already connected, and in automated browsers (tests drive the bridge themselves) unless
 * the URL asks for it (`?ai=auto` or `?ai=<provider id>`; `?ai=off` disables it everywhere).
 */
export async function autoConnect() {
  const avail = await checkProviders();
  const q = new URLSearchParams(location.search).get("ai");
  if (q === "off") return;
  if (navigator.webdriver && !q) return;
  if (useStore.getState().agent) return;
  const blocked = blockedProviders();
  const pick = (q && q in PROVIDERS && avail[q as ProviderId] ? (q as ProviderId) : null) ?? PROVIDER_ORDER.find((id) => avail[id] && !blocked.has(id)) ?? PROVIDER_ORDER.find((id) => avail[id]);
  if (pick) connectProvider(pick);
}
