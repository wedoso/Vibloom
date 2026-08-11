import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const item = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(item) : [item];
  }));
  return nested.flat();
}

async function updateFileInfo(file) {
  const contents = await readFile(file);
  return {
    name: path.basename(file),
    sha512: createHash("sha512").update(contents).digest("base64"),
    size: contents.byteLength,
  };
}

function metadata(version, files, releaseDate) {
  const primary = files[0];
  return [
    `version: ${version}`,
    "files:",
    ...files.flatMap((file) => [
      `  - url: ${file.name}`,
      `    sha512: ${file.sha512}`,
      `    size: ${file.size}`,
    ]),
    `path: ${primary.name}`,
    `sha512: ${primary.sha512}`,
    `releaseDate: '${releaseDate}'`,
    "",
  ].join("\n");
}

export async function prepareUpdateRelease(sourceDirectory, outputDirectory, expectedTag = "") {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const version = packageJson.version;
  if (expectedTag && expectedTag !== `v${version}`) throw new Error(`Release tag ${expectedTag} does not match package version v${version}.`);

  const candidates = await walk(sourceDirectory);
  const distributable = candidates.filter((file) => /\.(dmg|zip|exe|blockmap)$/u.test(file));
  const macZips = distributable.filter((file) => /-mac-(arm64|x64)\.zip$/u.test(file));
  const windowsInstallers = distributable.filter((file) => /-win-x64\.exe$/u.test(file));
  if (macZips.length !== 2) throw new Error(`Expected two macOS update ZIP files, found ${macZips.length}.`);
  if (windowsInstallers.length !== 1) throw new Error(`Expected one Windows NSIS installer, found ${windowsInstallers.length}.`);

  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });
  for (const file of distributable) await cp(file, path.join(outputDirectory, path.basename(file)));

  const releaseDate = new Date().toISOString();
  const macFiles = await Promise.all(macZips.sort().map(updateFileInfo));
  const windowsFiles = await Promise.all(windowsInstallers.map(updateFileInfo));
  await writeFile(path.join(outputDirectory, "latest-mac.yml"), metadata(version, macFiles, releaseDate));
  await writeFile(path.join(outputDirectory, "latest.yml"), metadata(version, windowsFiles, releaseDate));

  const assets = await readdir(outputDirectory);
  const sizes = await Promise.all(assets.map(async (asset) => ({ asset, size: (await stat(path.join(outputDirectory, asset))).size })));
  return { version, assets: sizes };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [, , sourceDirectory = "artifacts", outputDirectory = "release-assets"] = process.argv;
  const result = await prepareUpdateRelease(sourceDirectory, outputDirectory, process.env.RELEASE_TAG || "");
  console.log(`Prepared ${result.assets.length} release assets for Vibloom v${result.version}.`);
}
