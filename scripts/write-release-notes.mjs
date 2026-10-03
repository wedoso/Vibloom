import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function releaseNotesForTag(changelog, tag) {
  if (!/^v\d+\.\d+\.\d+$/u.test(tag)) throw new Error("A stable v* release tag is required.");
  const section = changelog.replace(/\r\n?/gu, "\n").split(/^## /mu).find(entry => entry.startsWith(`[${tag.slice(1)}]`));
  const notes = section?.split("\n").slice(1).join("\n").trim();
  if (!notes) throw new Error(`No changelog entry found for ${tag}.`);
  return `${notes}\n\n[Full changelog](https://github.com/wedoso/Vibloom/blob/${tag}/CHANGELOG.md)\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [, , tag, output] = process.argv;
  if (!output) throw new Error("Provide a release tag and output file.");
  const changelog = await readFile(new URL("../CHANGELOG.md", import.meta.url), "utf8");
  await writeFile(output, releaseNotesForTag(changelog, tag));
}
