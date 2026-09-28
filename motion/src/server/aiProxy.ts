/**
 * The production twin of the dev-server proxy in vite.config.ts: the browser calls same-origin
 * /api/<provider>/… paths and this attaches the API key server-side, so keys never reach the bundle.
 * Used by api/proxy.ts on Vercel. Web-standard Request/Response only, so it runs on any Fetch runtime.
 *
 *   GET  /api/ai/providers          → { anthropic: bool, agentrouter: bool, mistral: bool }
 *   POST /api/anthropic/<path>      → https://api.anthropic.com/<path>      (x-api-key)
 *   POST /api/mistral/<path>        → https://api.mistral.ai/<path>         (Bearer)
 *   POST /api/agentrouter/<path>    → https://agentrouter.org/v1/<path>     (Bearer + agent User-Agent)
 *   GET  /api/brand?url=…           → a website's brand name, colours and logos (see brand.ts; no key)
 */

import { handleBrandRequest } from "./brand.js";

export const KEYS = { anthropic: "ANTHROPIC_API_KEY", agentrouter: "AGENTROUTER_API_KEY", mistral: "MISTRAL_API_KEY" } as const;
type Provider = keyof typeof KEYS;
type Env = Record<string, string | undefined>;

const UPSTREAM: Record<Provider, { base: string; headers: (key: string) => Record<string, string> }> = {
  anthropic: { base: "https://api.anthropic.com", headers: (k) => ({ "x-api-key": k, "anthropic-version": "2023-06-01" }) },
  mistral: { base: "https://api.mistral.ai", headers: (k) => ({ authorization: `Bearer ${k}` }) },
  // AgentRouter (DeepSeek) also requires a coding-agent User-Agent
  agentrouter: { base: "https://agentrouter.org/v1", headers: (k) => ({ authorization: `Bearer ${k}`, "user-agent": "opencode/1.17.12" }) },
};

const NAME: Record<Provider, string> = { anthropic: "Anthropic", mistral: "Mistral", agentrouter: "AgentRouter" };

/** Request headers worth forwarding; everything else (cookies, origin, the browser's own auth) is dropped. */
const PASS_REQUEST = ["content-type", "accept", "anthropic-beta"];
/** Response headers worth returning; encoding and length are dropped because fetch already decoded the body. */
const PASS_RESPONSE = ["content-type", "cache-control", "retry-after", "request-id", "x-request-id"];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/** Refuse calls from other sites. Same-origin browser requests either omit Origin or send our own. */
function foreignOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host !== new URL(req.url).host;
  } catch {
    return true;
  }
}

/**
 * Handle one /api/… request. `route` is the path after /api/ (e.g. "anthropic/v1/messages").
 * `fetchImpl` is injectable for tests.
 */
export async function handleAiRequest(req: Request, route: string, env: Env, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const parts = route.split("/").filter(Boolean);
  if (parts.some((p) => p === ".." || p === ".")) return json(400, { error: "bad path" });

  if (parts[0] === "ai" && parts[1] === "providers" && parts.length === 2) {
    if (req.method !== "GET") return json(405, { error: "method not allowed" });
    return json(200, Object.fromEntries(Object.entries(KEYS).map(([id, name]) => [id, !!env[name]])));
  }

  if (parts[0] === "brand" && parts.length <= 2) {
    if (req.method !== "GET") return json(405, { error: "method not allowed" });
    if (foreignOrigin(req)) return json(403, { error: "cross-origin requests are not allowed" });
    return handleBrandRequest(parts[1] ?? "", new URL(req.url).searchParams, undefined, fetchImpl);
  }

  const provider = parts[0] as Provider;
  if (!(provider in UPSTREAM)) return json(404, { error: "unknown route" });
  if (req.method !== "POST") return json(405, { error: "method not allowed" });
  if (foreignOrigin(req)) return json(403, { error: "cross-origin requests are not allowed" });
  const key = env[KEYS[provider]];
  if (!key) return json(503, { error: `${KEYS[provider]} is not set on the server` });

  const up = UPSTREAM[provider];
  const headers = new Headers(up.headers(key));
  for (const h of PASS_REQUEST) {
    const v = req.headers.get(h);
    if (v && !headers.has(h)) headers.set(h, v);
  }
  // keep the caller's query string, minus the ?route= the hosting rewrite adds
  const params = new URL(req.url).searchParams;
  params.delete("route");
  const search = params.size ? `?${params}` : "";
  const target = `${up.base}/${parts.slice(1).join("/")}${search}`;

  let res: Response;
  try {
    res = await fetchImpl(target, { method: "POST", headers, body: await req.arrayBuffer() });
  } catch (e) {
    return json(502, { error: `could not reach ${provider}: ${(e as Error).message}` });
  }
  // an API never answers with a web page: this is the provider's firewall (bot) challenge for server IPs
  if (/text\/html/i.test(res.headers.get("content-type") ?? "")) {
    await res.body?.cancel();
    return json(502, {
      error: {
        type: "upstream_blocked",
        message: `${NAME[provider]}'s firewall blocked this server and answered with a web page instead of its API. Add a Claude or Mistral key, or pick another model.`,
      },
    });
  }
  const out = new Headers({ "cache-control": "no-store" });
  for (const h of PASS_RESPONSE) {
    const v = res.headers.get(h);
    if (v) out.set(h, v);
  }
  // stream the body straight through: Claude's SSE reaches the browser as it arrives
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
}
