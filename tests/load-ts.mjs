import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const urls = new Map();
export async function tsUrl(file, transform = source => source) {
  if (urls.has(file)) return urls.get(file);
  let source = transform(ts.transpileModule(await readFile(new URL(file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
  for (const match of [...source.matchAll(/from\s+["'](\.[^"']+)["']/g)]) {
    if (match[1].endsWith('?url')) {
      const bytes = await readFile(new URL(match[1].slice(0,-4), file));
      const asset = `data:application/wasm;base64,${bytes.toString('base64')}`;
      const module = `data:text/javascript;base64,${Buffer.from(`export default ${JSON.stringify(asset)};`).toString('base64')}`;
      source = source.replace(match[0], `from ${JSON.stringify(module)}`);
      continue;
    }
    const dependency = new URL(`${match[1]}.ts`, file).href;
    source = source.replace(match[0], `from ${JSON.stringify(await tsUrl(dependency))}`);
  }
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  urls.set(file, url); return url;
}
export const loadTs = async (relative, transform) => import(await tsUrl(new URL(relative, import.meta.url).href, transform));
