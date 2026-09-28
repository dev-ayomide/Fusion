import { describe, expect, it, vi } from "vitest";
import { handleAiRequest } from "./aiProxy";

const ENV = { ANTHROPIC_API_KEY: "sk-ant-test", MISTRAL_API_KEY: "mi-test" };
const post = (path: string, body = "{}", headers: Record<string, string> = {}) =>
  new Request(`https://fusion.example/api/proxy?route=${path}`, { method: "POST", body, headers: { "content-type": "application/json", ...headers } });

describe("AI proxy", () => {
  it("reports which providers have a key, never the keys", async () => {
    const res = await handleAiRequest(new Request("https://fusion.example/api/ai/providers"), "ai/providers", ENV);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ anthropic: true, agentrouter: false, mistral: true });
    expect(text).not.toContain("sk-ant");
  });

  it("forwards to Anthropic with the key and version, dropping browser identity headers", async () => {
    const f = vi.fn(async () => new Response("ok", { status: 200, headers: { "content-type": "text/event-stream", "content-encoding": "gzip" } }));
    const res = await handleAiRequest(post("anthropic/v1/messages", '{"x":1}', { cookie: "s=1", authorization: "Bearer browser", accept: "text/event-stream" }), "anthropic/v1/messages", ENV, f);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("content-encoding")).toBeNull();
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const h = new Headers(init.headers);
    expect(h.get("x-api-key")).toBe("sk-ant-test");
    expect(h.get("anthropic-version")).toBe("2023-06-01");
    expect(h.get("accept")).toBe("text/event-stream");
    expect(h.get("cookie")).toBeNull();
    expect(h.get("authorization")).toBeNull();
    expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe('{"x":1}');
  });

  it("maps AgentRouter onto /v1 with a bearer key and the agent user-agent", async () => {
    const f = vi.fn(async () => new Response("{}"));
    await handleAiRequest(post("agentrouter/chat/completions"), "agentrouter/chat/completions", { AGENTROUTER_API_KEY: "ar" }, f);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://agentrouter.org/v1/chat/completions");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer ar");
    expect(new Headers(init.headers).get("user-agent")).toBe("opencode/1.17.12");
  });

  it("streams the upstream body through as it arrives", async () => {
    const enc = new TextEncoder();
    let pull!: () => void;
    const gate = new Promise<void>((r) => (pull = r));
    const upstream = new ReadableStream({
      async start(c) {
        c.enqueue(enc.encode("event: a\n\n"));
        await gate;
        c.enqueue(enc.encode("event: b\n\n"));
        c.close();
      },
    });
    const res = await handleAiRequest(post("anthropic/v1/messages"), "anthropic/v1/messages", ENV, async () => new Response(upstream));
    const reader = res.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("event: a\n\n");
    pull();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("event: b\n\n");
  });

  it("drops the rewrite's ?route= but keeps other query params", async () => {
    const f = vi.fn(async () => new Response("{}"));
    const req = new Request("https://fusion.example/api/proxy?route=mistral/v1/chat/completions&beta=1", { method: "POST", body: "{}" });
    await handleAiRequest(req, "mistral/v1/chat/completions", ENV, f);
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe("https://api.mistral.ai/v1/chat/completions?beta=1");
  });

  it("refuses other sites, missing keys, wrong methods, unknown routes and path tricks", async () => {
    const f = vi.fn(async () => new Response("{}"));
    expect((await handleAiRequest(post("anthropic/v1/messages", "{}", { origin: "https://evil.example" }), "anthropic/v1/messages", ENV, f)).status).toBe(403);
    expect((await handleAiRequest(post("agentrouter/chat/completions"), "agentrouter/chat/completions", ENV, f)).status).toBe(503);
    expect((await handleAiRequest(new Request("https://fusion.example/x"), "anthropic/v1/messages", ENV, f)).status).toBe(405);
    expect((await handleAiRequest(post("nope/x"), "nope/x", ENV, f)).status).toBe(404);
    expect((await handleAiRequest(post("anthropic/../x"), "anthropic/../x", ENV, f)).status).toBe(400);
    expect(f).not.toHaveBeenCalled();
    // same-origin requests carrying our own Origin are fine
    expect((await handleAiRequest(post("anthropic/v1/messages", "{}", { origin: "https://fusion.example" }), "anthropic/v1/messages", ENV, f)).status).toBe(200);
  });

  it("turns a provider's firewall page into a typed 502 instead of passing HTML through", async () => {
    const res = await handleAiRequest(post("agentrouter/chat/completions"), "agentrouter/chat/completions", { AGENTROUTER_API_KEY: "ar" }, async () =>
      new Response("<!doctype html><html></html>", { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }),
    );
    expect(res.status).toBe(502);
    expect((await res.json()).error.type).toBe("upstream_blocked");
  });

  it("returns 502 when the provider can't be reached", async () => {
    const res = await handleAiRequest(post("mistral/v1/chat/completions"), "mistral/v1/chat/completions", ENV, async () => {
      throw new Error("ECONNRESET");
    });
    expect(res.status).toBe(502);
  });
});

describe("brand fetcher route", () => {
  it("refuses private and non-web addresses", async () => {
    const { normalizeUrl } = await import("./brand");
    for (const bad of ["localhost:3000", "http://127.0.0.1", "http://10.0.0.5/x", "http://192.168.1.1", "file:///etc/passwd", "http://169.254.169.254/latest", "http://printer.local", "http://[::1]/"]) expect(normalizeUrl(bad)).toBeNull();
    expect(normalizeUrl("stripe.com")?.toString()).toBe("https://stripe.com/");
  });

  it("shapes OpenBrand output: distinct colours, best logo first", async () => {
    const { shapeBrand } = await import("./brand");
    const b = shapeBrand(
      {
        brand_name: "Stripe",
        colors: [{ hex: "#FFF", usage: "background" }, { hex: "#533afd", usage: "primary" }, { hex: "#533AFD" }, { hex: "nope" }],
        logos: [{ url: "https://x.com/favicon.ico", type: "favicon", resolution: { width: 48, height: 48 } }, { url: "https://x.com/logo.svg", type: "logo" }],
        backdrop_images: [{ url: "https://x.com/og.jpg" }],
      },
      "https://stripe.com/",
    );
    expect(b.colors).toEqual([{ hex: "#533afd", usage: "primary" }, { hex: "#ffffff", usage: "background" }]);
    expect(b.logos[0].url).toBe("https://x.com/logo.svg");
    expect(b.image).toBe("https://x.com/og.jpg");
  });

  it("GET /api/brand/image only returns images, and checks every redirect hop", async () => {
    const f = vi.fn(async (u: string) =>
      u.includes("start") ? new Response(null, { status: 302, headers: { location: "http://127.0.0.1/secret" } }) : new Response("png", { headers: { "content-type": "image/png" } }),
    );
    const bounced = await handleAiRequest(new Request("https://app.test/api/brand/image?url=https://cdn.test/start"), "brand/image", {}, f as unknown as typeof fetch);
    expect(bounced.status).toBe(502);
    expect(f).toHaveBeenCalledTimes(1);
    const ok = await handleAiRequest(new Request("https://app.test/api/brand/image?url=https://cdn.test/logo.png"), "brand/image", {}, f as unknown as typeof fetch);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/png");
    const html = vi.fn(async () => new Response("<html>", { headers: { "content-type": "text/html" } }));
    expect((await handleAiRequest(new Request("https://app.test/api/brand/image?url=https://cdn.test/x"), "brand/image", {}, html as unknown as typeof fetch)).status).toBe(502);
  });
});

describe("inline SVG logos", () => {
  it("get the xmlns and width an image needs", async () => {
    const { fixSvgDataUrl } = await import("./brand");
    const raw = '<svg height="22" viewBox="0 0 400 100" fill="currentColor"><path d="M0 0h1"/></svg>';
    const out = decodeURIComponent(fixSvgDataUrl(`data:image/svg+xml;base64,${btoa(raw)}`).split(",")[1]);
    expect(out).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(out).toContain('width="88"');
    expect(fixSvgDataUrl("https://x.com/a.svg")).toBe("https://x.com/a.svg");
  });
});
