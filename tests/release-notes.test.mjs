import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { releaseNotesForTag } from "../scripts/write-release-notes.mjs";

const source = await readFile(new URL("../src/update/releaseNotes.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { changelogNotes, releaseNoteBlocks, fetchReleaseNotes } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("bundled and published notes select only the requested version", async () => {
  const changelog = await readFile(new URL("../CHANGELOG.md", import.meta.url), "utf8");
  const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const notes = changelogNotes(changelog, version);
  assert.ok(notes.includes("release notes"));
  assert.ok(notes.includes("mouth form"));
  assert.ok(releaseNotesForTag(changelog, `v${version}`).startsWith(notes));
  assert.ok(!notes.includes("## [1.5.3]"));
  assert.equal(changelogNotes(changelog, "9.9.9"), "");
  assert.throws(() => releaseNotesForTag(changelog, "v9.9.9"), /No changelog entry/u);
  assert.throws(() => releaseNotesForTag(changelog, "v1.6.0/../../file"), /stable/u);
});

test("release prose preserves headings, features and paragraphs without HTML rendering", () => {
  assert.deepEqual(releaseNoteBlocks("### Features\r\n- **Release notes** in `Vibloom`\r\n- [UI consistency](https://example.com)\r\n\r\nRead more\r\non GitHub.\r\n\r\n<img src=x onerror=alert(1)>"), [
    { kind: "heading", text: "Features" },
    { kind: "list", items: ["Release notes in Vibloom", "UI consistency"] },
    { kind: "paragraph", text: "Read more on GitHub." },
    { kind: "paragraph", text: "<img src=x onerror=alert(1)>" },
  ]);
  assert.deepEqual(releaseNoteBlocks(""), []);
});

test("desktop notes fetch the exact offered tag and reject mismatched or failed responses", async () => {
  const original = globalThis.fetch;
  const controller = new AbortController();
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, "https://api.github.com/repos/wedoso/Vibloom/releases/tags/v1.6.0");
      assert.equal(options.signal, controller.signal);
      return new Response(JSON.stringify({ tag_name: "v1.6.0", body: "- New feature" }));
    };
    assert.equal(await fetchReleaseNotes("1.6.0", controller.signal), "- New feature");
    globalThis.fetch = async () => new Response(JSON.stringify({ tag_name: "v1.5.3", body: "Wrong version" }));
    await assert.rejects(fetchReleaseNotes("1.6.0", controller.signal), /does not match/u);
    globalThis.fetch = async () => new Response("Rate limited", { status: 403 });
    await assert.rejects(fetchReleaseNotes("1.6.0", controller.signal), /403/u);
    globalThis.fetch = async () => new Response(JSON.stringify({ tag_name: "v1.6.0", body: null }));
    assert.equal(await fetchReleaseNotes("1.6.0", controller.signal), "");
  } finally { globalThis.fetch = original; }
});
