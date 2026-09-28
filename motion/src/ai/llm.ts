/**
 * Model transport for the in-app providers. Every call goes to a same-origin dev-server path; the
 * Vite proxy attaches the key server-side (see vite.config.ts), so no key ever reaches the browser.
 *
 * Two wire formats: OpenAI-compatible chat completions (Mistral, DeepSeek via AgentRouter) and the
 * Anthropic Messages API (Claude), streamed over SSE so long scene builds never hit a request timeout.
 */

export type Wire = "openai" | "anthropic";

export interface ModelConfig {
  id: string;
  label: string;
  wire: Wire;
  endpoint: string;
  model: string;
  /** OpenAI wire: the endpoint honours {"type":"json_object"} */
  jsonMode?: boolean;
  extraBody?: Record<string, unknown>;
  /** output ceiling for big jobs (scene builds); small jobs use less */
  maxTokens: number;
}

export interface CallOpts {
  system: string;
  user: string;
  maxTokens?: number;
  /** Anthropic `output_config.effort` */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  signal?: AbortSignal;
}

export interface CallResult {
  text: string;
  /** the reply was cut off at the token ceiling */
  truncated: boolean;
  usage?: { in: number; out: number };
}

export class ModelError extends Error {
  constructor(
    message: string,
    public status?: number,
    public retryable = false,
    /** the provider can't be reached from this server at all (e.g. its firewall answered) — try another one */
    public blocked = false,
  ) {
    super(message);
  }
}

const looksLikeHtml = (body: string) => /^\s*</.test(body);
/** A web page where an API reply should be: the /api function is missing from this deployment. */
const pageError = (cfg: ModelConfig, status?: number) =>
  new ModelError(`${cfg.label}: the AI endpoint answered with a web page, not an API reply. The /api function isn't running on this deployment (on Vercel, set the Root Directory to motion and redeploy).`, status, false, true);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One model call with a small retry for rate limits and transient 5xx/overload. */
export async function callModel(cfg: ModelConfig, o: CallOpts, fetchImpl: typeof fetch = fetch): Promise<CallResult> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return cfg.wire === "anthropic" ? await callAnthropic(cfg, o, fetchImpl) : await callOpenAI(cfg, o, fetchImpl);
    } catch (e) {
      last = e;
      if (!(e instanceof ModelError) || !e.retryable || o.signal?.aborted) throw e;
      await sleep(1500 * (attempt + 1) + Math.random() * 500);
    }
  }
  throw last;
}

async function httpError(cfg: ModelConfig, res: Response): Promise<ModelError> {
  const body = await res.text().catch(() => "");
  if (looksLikeHtml(body)) return pageError(cfg, res.status);
  let detail = body;
  try {
    const j = JSON.parse(body);
    if (j?.error?.type === "upstream_blocked") return new ModelError(`${cfg.label}: ${j.error.message}`, res.status, false, true);
    detail = j?.error?.message ?? j?.message ?? body;
  } catch {
    /* plain text */
  }
  const retryable = res.status === 429 || res.status === 408 || res.status === 529 || res.status >= 500;
  const hint = res.status === 401 || res.status === 403 ? " — check the API key (motion/.env locally, or the hosting environment variables)" : "";
  return new ModelError(`${cfg.label} ${res.status}${detail ? ": " + String(detail).slice(0, 180) : ""}${hint}`, res.status, retryable);
}

async function callOpenAI(cfg: ModelConfig, o: CallOpts, f: typeof fetch): Promise<CallResult> {
  const res = await f(cfg.endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: o.signal,
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.4,
      max_tokens: o.maxTokens ?? cfg.maxTokens,
      ...(cfg.jsonMode ? { response_format: { type: "json_object" } } : {}),
      ...cfg.extraBody,
      messages: [
        { role: "system", content: o.system },
        { role: "user", content: o.user },
      ],
    }),
  });
  if (!res.ok) throw await httpError(cfg, res);
  const raw = await res.text();
  if (looksLikeHtml(raw)) throw pageError(cfg, res.status);
  let data: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    data = JSON.parse(raw);
  } catch {
    throw new ModelError(`${cfg.label} sent a reply that isn't JSON`, res.status, true);
  }
  if (data?.error) throw new ModelError(`${cfg.label}: ${data.error.message ?? "error"}`, undefined, /content-blocked|overload|timeout/i.test(String(data.error.message ?? data.error.code)));
  const choice = data.choices?.[0];
  const text = choice?.message?.content;
  if (typeof text !== "string" || !text.trim()) throw new ModelError(`${cfg.label} returned an empty reply`, undefined, true);
  return { text, truncated: choice.finish_reason === "length", usage: data.usage ? { in: data.usage.prompt_tokens ?? 0, out: data.usage.completion_tokens ?? 0 } : undefined };
}

/**
 * Anthropic Messages API, streamed. Claude Opus 5.5 always thinks (adaptive) — effort is the control,
 * and sampling parameters / prefill are not accepted, so neither is sent. The long, stable system
 * prompt is marked for prompt caching.
 */
async function callAnthropic(cfg: ModelConfig, o: CallOpts, f: typeof fetch): Promise<CallResult> {
  const res = await f(cfg.endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    signal: o.signal,
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: o.maxTokens ?? cfg.maxTokens,
      stream: true,
      output_config: { effort: o.effort ?? "medium" },
      system: [{ type: "text", text: o.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: o.user }],
    }),
  });
  if (!res.ok) throw await httpError(cfg, res);
  if (/text\/html/i.test(res.headers.get("content-type") ?? "")) throw pageError(cfg, res.status);
  if (!res.body) throw new ModelError(`${cfg.label} returned no stream`, undefined, true);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const text: string[] = [];
  let stop: string | null = null;
  let stopDetail = "";
  const usage = { in: 0, out: 0 };
  const onEvent = (data: string) => {
    if (!data || data === "[DONE]") return;
    let ev: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      ev = JSON.parse(data);
    } catch {
      return;
    }
    switch (ev.type) {
      case "message_start":
        usage.in = (ev.message?.usage?.input_tokens ?? 0) + (ev.message?.usage?.cache_read_input_tokens ?? 0) + (ev.message?.usage?.cache_creation_input_tokens ?? 0);
        break;
      case "content_block_delta":
        // only text is the answer; thinking blocks are read by type and ignored
        if (ev.delta?.type === "text_delta") text.push(ev.delta.text);
        break;
      case "message_delta":
        if (ev.delta?.stop_reason) stop = ev.delta.stop_reason;
        if (ev.delta?.stop_details?.explanation) stopDetail = ev.delta.stop_details.explanation;
        if (ev.usage?.output_tokens) usage.out = ev.usage.output_tokens;
        break;
      case "error": {
        const t = ev.error?.type ?? "error";
        throw new ModelError(`${cfg.label}: ${ev.error?.message ?? t}`, undefined, t === "overloaded_error" || t === "api_error" || t === "rate_limit_error");
      }
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = chunk
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      onEvent(data);
    }
  }
  if (buf.trim()) onEvent(buf.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n"));
  if (stop === "refusal") throw new ModelError(`${cfg.label} declined this request${stopDetail ? ": " + stopDetail : ""}`);
  const out = text.join("");
  if (!out.trim()) throw new ModelError(`${cfg.label} returned an empty reply`, undefined, true);
  return { text: out, truncated: stop === "max_tokens", usage };
}

/* ------------------------------------------------------------------ *
 * Robust JSON: fences, prose around the object, trailing commas, and  *
 * replies cut off mid-array (keep every complete element).            *
 * ------------------------------------------------------------------ */

function stripToJson(s: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)(?:```|$)/.exec(s);
  let t = (fenced ? fenced[1] : s).trim();
  const i = t.search(/[{[]/);
  if (i > 0) t = t.slice(i);
  return t;
}

const noTrailingCommas = (s: string) => s.replace(/,(\s*[}\]])/g, "$1");

/** Cut a truncated JSON text after its last complete element and close what is still open. */
export function closeTruncated(s: string): string | null {
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  let best: { at: number; closers: string } | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") stack.push(c === "{" ? "}" : "]");
    else if (c === "}" || c === "]") {
      stack.pop();
      if (!stack.length) return s.slice(0, i + 1);
      best = { at: i + 1, closers: [...stack].reverse().join("") };
    }
  }
  return best ? s.slice(0, best.at) + best.closers : null;
}

/** Parse a model's JSON reply as leniently as is safe. Throws if nothing usable is found. */
export function parseLooseJson(content: string): unknown {
  const t = stripToJson(content);
  const tries = [t, noTrailingCommas(t)];
  for (const x of tries) {
    try {
      return JSON.parse(x);
    } catch {
      /* next */
    }
  }
  const closed = closeTruncated(noTrailingCommas(t));
  if (closed) {
    try {
      return JSON.parse(noTrailingCommas(closed));
    } catch {
      /* fall through */
    }
  }
  throw new Error("the reply was not valid JSON");
}
