import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import packageMetadata from "./package.json" with { type: "json" };

export default defineConfig({
  // Relative assets make the same build portable to a domain root,
  // a GitHub Pages repository subpath, or any static file server.
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(packageMetadata.version),
  },
  plugins: [react()],
  // Worker-only dependencies otherwise trigger a page reload on the first
  // vocal request, interrupting playback and restarting its model download.
  optimizeDeps: { entries: ["index.html"], include: ["demucs-web", "onnxruntime-web/webgpu"] },
  server: { watch: { ignored: ["**/.cache/**", "**/outputs/**", "**/work/**", "**/release/**"] } },
  worker: { format: "es" },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
});
