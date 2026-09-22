import path from "path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import { componentTagger } from "lovable-tagger";

const clientDir = path.dirname(fileURLToPath(import.meta.url));
const remotionDir = path.resolve(clientDir, "../remotion");

/**
 * Vite plugin to resolve @/ imports from remotion files correctly
 * When importing from remotion/src/scenes or remotion/src/components,
 * @/ should resolve to remotion/src/, not client/src/
 */
function remotionAliasPlugin(): Plugin {
  return {
    name: "remotion-alias-resolver",
    enforce: "pre",
    resolveId(source, importer) {
      // Only handle @/ imports
      if (!source.startsWith("@/")) return null;

      // Check if the importer is from the remotion workspace
      // Normalize paths for cross-platform compatibility (Windows uses backslashes)
      if (importer) {
        const normalizedImporter = importer.replace(/\\/g, "/");
        if (normalizedImporter.includes("remotion/src")) {
          // Resolve @/ to remotion/src/ for remotion files
          const resolved = source.replace("@/", `${remotionDir}/src/`);
          return this.resolve(resolved, importer, { skipSelf: true });
        }
      }

      // Otherwise, let the default alias resolution handle it (client/src/)
      return null;
    },
  };
}

/** Dev server only: you must set this in `client/.env` — no default (local vs deployed is your choice). */
function resolveBackendTargetForServe(raw: string | undefined): string {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) {
    throw new Error(
      "[vite] Set VITE_API_PROXY_TARGET in client/.env (see .env.example). " +
        "Example local: http://localhost:3001 — or your deployed API URL. Nothing is assumed by default.",
    );
  }
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      throw new Error(
        `[vite] VITE_API_PROXY_TARGET must start with http:// or https:// (got: ${trimmed})`,
      );
    }
    return trimmed;
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("[vite]")) throw e;
    throw new Error(
      `[vite] Invalid VITE_API_PROXY_TARGET "${trimmed}". Use a full URL, e.g. http://localhost:3001`,
    );
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, clientDir, "");
  // Proxy runs only in dev (`vite`); `vite build` does not need a real target.
  const backendTarget =
    command === "serve"
      ? resolveBackendTargetForServe(env.VITE_API_PROXY_TARGET)
      : env.VITE_API_PROXY_TARGET?.trim() || "http://127.0.0.1:9";

  return {
    server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
    watch: {
      ignored: ["**/remotion/**", "**/server/**"]
    },
    // Allow Vite to serve files from the remotion workspace
    fs: {
      allow: [
        clientDir,
        path.resolve(clientDir, "../remotion"),
      ],
    },
    proxy: {
      "/api": {
        target: backendTarget,
        changeOrigin: true,
      },
      "/previews": {
        target: backendTarget,
        changeOrigin: true,
      },
      "/exports": {
        target: backendTarget,
        changeOrigin: true,
      },
      "/uploads": {
        target: backendTarget,
        changeOrigin: true,
      },
    },
  },
    plugins: [
      remotionAliasPlugin(),
      react(),
      mode === "development" && componentTagger(),
    ].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(clientDir, "./src"),
        "@remotion-scenes": path.resolve(clientDir, "../remotion/src/scenes"),
        "@remotion-components": path.resolve(clientDir, "../remotion/src/components"),
      },
    },
    optimizeDeps: {
      exclude: ["@remotion-scenes", "@remotion-components"],
    },
    build: {
      outDir: path.resolve(clientDir, "dist"),
      emptyOutDir: true,
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              return 'vendor';
            }
          }
        }
      }
    },
  };
});
