/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig(({ mode }) => {
  // loaded here (not via VITE_ prefix) so the key stays server-side and never reaches the browser bundle
  const env = loadEnv(mode, process.cwd(), "");
  const mistralKey = env.MISTRAL_API_KEY;
  const agentRouterKey = env.AGENTROUTER_API_KEY;

  return {
    plugins: [react()],
    resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
    server: {
      port: 5180,
      strictPort: true,
      proxy: {
        // the browser calls these same-origin paths; the dev server attaches the real key (and,
        // for AgentRouter, a coding-agent User-Agent it requires) so neither reaches client code
        "/api/mistral": {
          target: "https://api.mistral.ai",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/mistral/, ""),
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              if (mistralKey) proxyReq.setHeader("Authorization", `Bearer ${mistralKey}`);
            });
          },
        },
        "/api/agentrouter": {
          target: "https://agentrouter.org",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/agentrouter/, "/v1"),
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              if (agentRouterKey) proxyReq.setHeader("Authorization", `Bearer ${agentRouterKey}`);
              proxyReq.setHeader("User-Agent", "opencode/1.17.12");
            });
          },
        },
      },
    },
    test: { include: ["src/**/*.test.ts"], environment: "node" },
  };
});
