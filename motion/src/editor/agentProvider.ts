import { catalog } from "../fmd/outline";
import type { PendingTurn } from "./bridge";

/**
 * Real in-app AI providers for the agent bridge (`window.fusion.bridge`). The editor itself
 * never calls a model — this module is just another bridge client, exactly like an external
 * script or MCP agent would be. It polls for pending turns, asks the connected provider for
 * ops, and answers through the same `bridge.respond` every other agent uses.
 */

const SYSTEM_PROMPT = `You are a motion-graphics editor AI working on a Fusion Motion Document (FMD) — a single JSON document that a small "ops" log edits, evaluated as a pure function of time and rendered live. You never write prose about what you'd do — you emit ops that do it.

CONTEXT YOU RECEIVE
- An outline: one line per layer (id, type, in–out, key fields), back-to-front paint order.
- If layers are selected, their full JSON too — edit those unless the request is clearly comp-wide.
- The user's request.

PATH GRAMMAR (used by every op)
"/" separates segments; the first segment is a layer id or a root field (v, name, comp, brand, assets, markers, style, bindings).
  phone/rot              a layer field
  phone/pos/y            a tuple component (x|y|z)
  phone/beh/rise/dur     a field of behavior "rise" on layer "phone"
  phone/keys/rot.y       a whole keyframe track for channel rot.y
  comp/dur, brand/colors/accent, style/energy

OPS (JSON, one array)
  {"op":"set","path":"...","value":...}        — set a field. Also creates a NEW layer (path = new id, value = full layer object incl. "type") or a NEW behavior (path = "<layer>/beh/<newBehId>", value = {use, at, ...params}, no "id" needed).
  {"op":"set","path":"...","delta":N}          — add N to a current number.
  {"op":"del","path":"..."}                     — delete a field, a behavior, or a whole layer (path = layer id).
  {"op":"ord","id":"...","after":"<id>"|null}   — reorder layers (after: null = send to back).
  {"op":"key","path":"<layer>/keys/<channel>","keys":[[t,value,ease?],...]} — replace a channel's keyframes. t is layer-local seconds (0 = layer's "in").
  {"op":"style","key":"energy"|"bounce"|"depth"|"speed","value":0..1} — the four global vibe sliders.
  {"op":"trim","id":"...","delta":N}            — shift a layer's in-point by N seconds, keeping its animation content in place.

RULES
- Only use layer ids that exist in the outline (or an id you're creating right now).
- Colors are "#rrggbb" (lowercase) or "$brandColorName" from brand.colors.
- New layer/behavior ids: start with a letter, then letters/digits/_/- only.
- A layer's "beh" field is ALWAYS an ARRAY, never an object — even when a new layer starts with only one behavior: "beh": [{"id":"in","use":"rise","at":0}]. Never write "beh": {"in": {...}}.
- A behavior "owns" the channels in its catalog entry — don't give two behaviors on the same layer overlapping time windows over the same channel.
- Prefer a catalog behavior over hand-written keyframes for a standard entrance/exit/loop; use "key" for anything bespoke (counters, custom paths, chart lines).
- Keep edits minimal and targeted — don't rewrite fields the user didn't ask about.
- If the request is ambiguous, make the single most reasonable choice — never ask a question back.

EXAMPLE — adding a whole new layer with an entrance behavior:
{"op":"set","path":"subtitle","value":{"type":"text","text":"Built for teams","size":34,"color":"$ink","in":2,"out":6,"pos":[100,20,0],"beh":[{"id":"in","use":"rise","at":0,"dist":90}]}}

BEHAVIOR CATALOG
${catalog()}

LAYER TYPES (fields beyond the common id/in/out/parent/pos/rot/scale/opacity/blur/keys/beh/expr)
  text     text, size, font?, weight?, color?, align?, tracking?, lineHeight?, spans?[{text,color?,weight?,size?}], value? (rolling number), anim?[{id,sel:{by,shape,start,end},add:{pos?,rot?,scale?,opacity?,wipe?}}]
  shape    shape:"rect"|"ellipse", w, h, radius?, fill?, stroke?, strokeWidth?, shadow?, glass?
  image    src (asset id), w, h?, radius?, shadow?, glass?
  device   model:"iphone"|"browser", screen? (asset id), w?, color?
  cloner   mode:"radial"|"grid"|"linear", n, r?, cols?, gap?, spin?, orient?, child:{kind:"shape"|"image"|"text", shape?, w, h?, fill?, src?, text?, colors?[]}, reveal?{dur,bounce?,at?}
  camera   fov?, target?
  group    clip?{w,h,radius}
  html     html (string, {{var}} placeholders), w, h, radius?, vars?{name:number}
  path     points:[[x,y],...], smooth?, closed?, stroke?, width?, trimStart?, trimEnd?, glow?, fillTo?, fill?
  mesh     geom:"sphere"|"box"|"torus"|"cylinder"|"capsule"|"cone"|"balloon"|"pear"|"coin"|"ring"|"slab", size, material:"chrome"|"foil"|"metal"|"gold"|"glass"|"plastic"|"matte"|"clay"|"emissive", color?, map? (asset id)
  gradient colors:[..2-4], kind?:"linear"|"radial", angle?, noise?
  sky      top?, horizon?, clouds?, sun?, hills?, mountains?, grass?, stars?
  adjust   exposure?, contrast?, saturation?, fadeColor?, fade?, dissolve? (affects everything below it)

RESPONSE FORMAT — reply with ONLY a raw JSON object, no markdown fences, no commentary outside it:
{"message": "one short, casual sentence about what you changed", "ops": [ ...ops... ], "chips": [{"label":"short follow-up idea","ops":[...]}]}
"chips" is optional (0-3 small one-click follow-ups). If you truly cannot help, return {"message":"...", "ops":[]}.`;

export type ProviderId = "mistral" | "agentrouter";

interface ProviderConfig {
  label: string;
  endpoint: string;
  model: string;
  /** the endpoint honours OpenAI's {"type":"json_object"} response_format */
  jsonMode: boolean;
  extraBody?: Record<string, unknown>;
}

export const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  mistral: { label: "Mistral", endpoint: "/api/mistral/v1/chat/completions", model: "mistral-medium-latest", jsonMode: true },
  agentrouter: {
    label: "DeepSeek",
    endpoint: "/api/agentrouter/chat/completions",
    model: "deepseek-v4-flash",
    jsonMode: true,
    // ops replies are short and structured — thinking tokens would just eat the budget
    extraBody: { thinking: { type: "disabled" } },
  },
};

let timer: ReturnType<typeof setInterval> | null = null;
let activeProvider: ProviderId | null = null;
const inFlight = new Set<string>();

interface FusionApi {
  bridge: {
    connect(name: string): boolean;
    disconnect(): void;
    pending(): PendingTurn[];
    respond(turnId: string, r: { message: string; ops?: unknown[]; chips?: { label: string; ops: unknown[] }[]; delayMs?: number }): Promise<void>;
  };
}
const fusion = () => (window as unknown as { fusion: FusionApi }).fusion;

/** Strips ```json fences a model may add despite instructions not to. */
function extractJson(content: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(content);
  return fenced ? fenced[1].trim() : content.trim();
}

async function callProvider(cfg: ProviderConfig, user: string, attempt = 0): Promise<Response> {
  const res = await fetch(cfg.endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.3,
      ...(cfg.jsonMode ? { response_format: { type: "json_object" } } : {}),
      ...cfg.extraBody,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: user },
      ],
    }),
  });
  if (res.status === 429 && attempt < 2) {
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    return callProvider(cfg, user, attempt + 1);
  }
  return res;
}

async function askProvider(cfg: ProviderConfig, turn: PendingTurn, attempt = 0): Promise<{ message: string; ops: unknown[]; chips?: { label: string; ops: unknown[] }[] }> {
  const user = `${turn.outline}${turn.inspect ? "\n\nSELECTED LAYER JSON:\n" + turn.inspect : ""}${turn.docValid ? "" : "\n\n(note: the document currently has validation issues)"}\n\nREQUEST: ${turn.prompt}`;
  const res = await callProvider(cfg, user);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${cfg.label} ${res.status}${body ? ": " + body.slice(0, 200) : ""}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error(`${cfg.label} returned no content`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(content));
  } catch {
    // occasionally a model emits malformed JSON on complex requests — one silent retry
    // resolves this most of the time without the user ever seeing an error turn
    if (attempt < 1) return askProvider(cfg, turn, attempt + 1);
    throw new Error(`${cfg.label} did not return valid JSON`);
  }
  const p = parsed as { message?: unknown; ops?: unknown; chips?: unknown };
  return {
    message: typeof p.message === "string" ? p.message : "",
    ops: Array.isArray(p.ops) ? p.ops : [],
    chips: Array.isArray(p.chips) ? (p.chips as { label: string; ops: unknown[] }[]) : undefined,
  };
}

async function tick(cfg: ProviderConfig) {
  const bridge = fusion()?.bridge;
  if (!bridge) return;
  for (const turn of bridge.pending()) {
    if (inFlight.has(turn.turnId)) continue;
    inFlight.add(turn.turnId);
    askProvider(cfg, turn)
      .then((r) => bridge.respond(turn.turnId, { ...r, delayMs: 70 }))
      .catch((e: Error) => bridge.respond(turn.turnId, { message: `⚠️ ${e.message}`, ops: [] }))
      .finally(() => inFlight.delete(turn.turnId));
  }
}

export function connectProvider(id: ProviderId) {
  const cfg = PROVIDERS[id];
  if (timer) clearInterval(timer);
  inFlight.clear();
  fusion()?.bridge.connect(cfg.label);
  activeProvider = id;
  timer = setInterval(() => tick(cfg), 600);
  void tick(cfg);
}

export function disconnectProvider() {
  if (timer) clearInterval(timer);
  timer = null;
  activeProvider = null;
  inFlight.clear();
  fusion()?.bridge.disconnect();
}

export function activeProviderId() {
  return activeProvider;
}
