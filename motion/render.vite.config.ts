// A frozen twin of the dev server for long offline renders: no HMR, no file watching,
// so editing source while frames render can't reload the render pages.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  cacheDir: "node_modules/.vite-render",
  server: { port: 5181, strictPort: true, hmr: false, watch: null },
});
