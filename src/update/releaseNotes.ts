export type ReleaseNoteBlock = { kind: "heading" | "paragraph"; text: string } | { kind: "list"; items: string[] };

export function changelogNotes(changelog: string, version: string): string {
  const sections = changelog.replace(/\r\n?/gu, "\n").split(/^## /mu);
  return sections.find(section => {
    const heading = section.split("\n", 1)[0];
    return heading.startsWith(`[${version}]`) || heading === version;
  })?.split("\n").slice(1).join("\n").trim() ?? "";
}

// Render release prose as text and lists, never as HTML from a remote release.
function plainText(text: string) {
  return text.replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1").replace(/\*\*([^*]+)\*\*/gu, "$1").replace(/`([^`]+)`/gu, "$1");
}

export function releaseNoteBlocks(notes: string): ReleaseNoteBlock[] {
  const blocks: ReleaseNoteBlock[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", text: plainText(paragraph.join(" ")) });
    paragraph = [];
  };
  for (const line of notes.replace(/\r\n?/gu, "\n").split("\n")) {
    const heading = line.match(/^#{1,6}\s+(.+)$/u);
    const item = line.match(/^\s*(?:[-*+] |\d+\. )(.+)$/u);
    if (!line.trim()) { flush(); continue; }
    if (heading) { flush(); blocks.push({ kind: "heading", text: plainText(heading[1]) }); }
    else if (item) {
      flush();
      const last = blocks.at(-1);
      if (last?.kind === "list") last.items.push(plainText(item[1]));
      else blocks.push({ kind: "list", items: [plainText(item[1])] });
    } else paragraph.push(line.trim());
  }
  flush();
  return blocks;
}

export async function fetchReleaseNotes(version: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(`https://api.github.com/repos/wedoso/Vibloom/releases/tags/v${encodeURIComponent(version)}`, {
    headers: { Accept: "application/vnd.github+json" }, signal,
  });
  if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
  const release = await response.json() as { tag_name?: string; body?: string };
  if (release.tag_name?.replace(/^v/u, "") !== version) throw new Error("Release notes version does not match the update.");
  return typeof release.body === "string" ? release.body.trim() : "";
}
