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
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
});
