import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "vite";

/** Version the complete offline shell, including public model assets. Never
 * include source maps or remote weights; music stays in the library stores. */
export function offlinePlugin(): Plugin {
  let output = "", root = "";
  return {
    name: "vibloom-offline", apply: "build",
    configResolved(config) { root = config.root; output = path.resolve(config.root, config.build.outDir); },
    async closeBundle() {
      const files: string[] = [];
      const walk = async (folder: string) => {
        for (const entry of await readdir(path.join(output, folder), { withFileTypes: true })) {
          const relative = path.posix.join(folder, entry.name);
          if (entry.isDirectory()) await walk(relative);
          else if (relative === "index.html" || relative === "manifest.webmanifest" || relative === "vibloom-icon.png"
            || relative.startsWith("live2d/") && /\.(js|json|moc3|png)$/u.test(relative)
            || relative.startsWith("assets/") && /\.(js|mjs|css|wasm|woff2?)$/u.test(relative)) {
            // Optional inference runtimes are cached after use, not on first visit.
            if (/\.wasm$/u.test(relative) && (await readFile(path.join(output, relative))).length > 2 * 1024 * 1024) continue;
            files.push(relative);
          }
        }
      };
      await walk(""); files.sort();
      const hash = createHash("sha256");
      for (const file of files) { hash.update(file); hash.update(await readFile(path.join(output, file))); }
      const runtime = await readFile(path.join(root, "build-tools/offline-worker.js"), "utf8");
      hash.update(runtime);
      await writeFile(path.join(output, "sw.js"), `const BUILD = ${JSON.stringify(hash.digest("hex").slice(0, 16))};\nconst SHELL = ${JSON.stringify(files)};\n${runtime}`);
    },
  };
}
