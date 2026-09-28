/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import type { ClientRequest } from "node:http";
import { handleBrandRequest } from "./src/server/brand";

/**
 * AI keys live in motion/.env (never VITE_-prefixed, so they never reach the browser bundle). The
 * browser calls same-origin /api/<provider> paths; the dev server attaches the key. Keys are re-read
 * on every request, so adding one to .env works without restarting the dev server.
 */
const KEYS = { anthropic: "ANTHROPIC_API_KEY", agentrouter: "AGENTROUTER_API_KEY", mistral: "MISTRAL_API_KEY" } as const;

export default defineConfig(({ mode }) => {
  const key = (name: string) => loadEnv(mode, process.cwd(), "")[name] || process.env[name] || "";
  // strip browser identity so providers treat these as server-to-server calls
  const scrub = (req: ClientRequest) => {
    for (const h of ["origin", "referer", "cookie", "authorization", "x-api-key"]) req.removeHeader(h);
  };

  /** GET /api/ai/providers → which providers have a key (booleans only — never the keys). */
  const providers: Plugin = {
    name: "fusion-ai-providers",
    configureServer(server) {
      server.middlewares.use("/api/ai/providers", (_req, res) => {
        res.setHeader("content-type", "application/json");
        res.setHeader("cache-control", "no-store");
        res.end(JSON.stringify(Object.fromEntries(Object.entries(KEYS).map(([id, env]) => [id, !!key(env)]))));
      });
      // GET /api/brand?url=… and /api/brand/image?url=… — the brand fetcher (src/server/brand.ts)
      server.middlewares.use("/api/brand", async (req, res) => {
        const u = new URL(req.url ?? "/", "http://dev");
        const out = await handleBrandRequest(u.pathname.replace(/^\/+|\/+$/g, ""), u.searchParams);
        res.statusCode = out.status;
        out.headers.forEach((v, k) => res.setHeader(k, v));
        res.end(Buffer.from(await out.arrayBuffer()));
      });
    },
  };

  return {
    plugins: [react(), providers],
    resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
    server: {
      port: 5180,
      strictPort: true,
      proxy: {
        // Claude (Anthropic Messages API)
        "/api/anthropic": {
          target: "https://api.anthropic.com",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/anthropic/, ""),
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              scrub(proxyReq);
              const k = key(KEYS.anthropic);
              if (k) proxyReq.setHeader("x-api-key", k);
              proxyReq.setHeader("anthropic-version", "2023-06-01");
            });
          },
        },
        "/api/mistral": {
          target: "https://api.mistral.ai",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/mistral/, ""),
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              scrub(proxyReq);
              const k = key(KEYS.mistral);
              if (k) proxyReq.setHeader("Authorization", `Bearer ${k}`);
            });
          },
        },
        // AgentRouter (DeepSeek) also requires a coding-agent User-Agent
        "/api/agentrouter": {
          target: "https://agentrouter.org",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/agentrouter/, "/v1"),
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              scrub(proxyReq);
              const k = key(KEYS.agentrouter);
              if (k) proxyReq.setHeader("Authorization", `Bearer ${k}`);
              proxyReq.setHeader("User-Agent", "opencode/1.17.12");
            });
          },
        },
      },
    },
    test: { include: ["src/**/*.test.ts"], environment: "node" },
  };
});
