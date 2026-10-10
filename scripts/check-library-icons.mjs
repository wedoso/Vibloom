/* global window */
import assert from "node:assert/strict";
import { build } from "vite";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
const at = process.argv.indexOf("--playwright-module");
const { chromium, webkit } = await import(at < 0 ? "playwright" : pathToFileURL(path.resolve(process.argv[at + 1])).href);
const root = path.resolve(".cache/library-icons"), output = path.resolve("outputs/library-icons");
await mkdir(root, { recursive: true }); await mkdir(output, { recursive: true });
await writeFile(path.join(root, "index.html"), '<style>body{margin:0}#root{width:36px;height:36px;color:#527360;background:#f7f9fc;display:grid;place-items:center}</style><div id="root"></div><script type="module" src="./check.tsx"></script>');
await writeFile(path.join(root, "check.tsx"), `
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { LibraryIcon, LibraryIcons } from '../../src/library/LibraryIcons';
const root=createRoot(document.getElementById('root')!);
(window as any).show=(name:any,size:number,shared:boolean)=>flushSync(()=>root.render(<LibraryIcons shared={shared}><span style={{color:"#a04d5a"}}><LibraryIcon name={name} size={size}/></span></LibraryIcons>));
`);
await build({ configFile: false, root, base: "./", logLevel: "error", esbuild: { jsx: "automatic" }, build: { outDir: "dist", emptyOutDir: true } });
const base = path.join(root, "dist"), results = [];
const server = createServer(async (req, res) => {
  try {
    const file = path.resolve(base, `.${new URL(req.url, "http://test").pathname === "/" ? "/index.html" : new URL(req.url, "http://test").pathname}`);
    assert.ok(file.startsWith(base + path.sep)); res.setHeader("Content-Type", file.endsWith(".html") ? "text/html" : "text/javascript"); res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
try {
  for (const [name, engine] of Object.entries({ chromium, webkit })) {
    const browser = await engine.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 160, height: 160 }, deviceScaleFactor: 2 });
      await page.goto(`http://127.0.0.1:${server.address().port}/`); await page.waitForFunction(() => !!window.show);
      let cases = 0;
      for (const icon of ["ArrowLeftRight", "AudioLines", "Check", "CircleAlert", "Clock3", "FileText", "GripVertical", "LoaderCircle", "MicVocal", "MoreHorizontal"]) for (const size of [8, 14, 20]) {
        await page.evaluate(({ icon, size }) => window.show(icon, size, false), { icon, size });
        const reference = await page.locator("#root").screenshot();
        await page.evaluate(({ icon, size }) => window.show(icon, size, true), { icon, size });
        const actual = await page.locator("#root").screenshot();
        if (!reference.equals(actual)) {
          await writeFile(path.join(output, `${name}-${icon}-${size}-original.png`), reference);
          await writeFile(path.join(output, `${name}-${icon}-${size}-shared.png`), actual);
          assert.fail(`Changed pixels: ${name}/${icon}/${size}`);
        }
        cases++;
      }
      results.push({ engine: name, exactPngCases: cases }); console.log("PASS", name, cases, "identical PNG pairs");
    } finally { await browser.close(); }
  }
  await writeFile(path.join(output, "report.json"), JSON.stringify(results, null, 2));
} finally { await new Promise(resolve => server.close(resolve)); }
