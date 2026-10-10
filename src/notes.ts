import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { INBOX, WRITE_ALLOWLIST } from "./layout.ts";
import type { Vault } from "./vault.ts";

export type NoteSummary = {
  note: string;
  title: string;
  folder: string;
  tags: string[];
};

/** Every note in the write allowlist outside the Inbox, so Filing never proposes a private note or a Dump. */
export function listNotes(vault: Vault): NoteSummary[] {
  return WRITE_ALLOWLIST.filter((tree) => tree !== INBOX)
    .map((tree) => join(vault.root, tree))
    .filter((tree) => existsSync(tree))
    .flatMap(markdownFiles)
    .sort()
    .map((path) => {
      const note = relative(vault.root, path);
      return { note, title: basename(note, ".md"), folder: dirname(note), tags: frontmatterTags(readFileSync(path, "utf8")) };
    });
}

function markdownFiles(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) return entry.name.startsWith(".") ? [] : markdownFiles(path);
    return entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
  });
}

function frontmatterTags(contents: string): string[] {
  const lines = contents.split(/\r?\n/);
  if (lines[0] !== "---") return [];
  const end = lines.indexOf("---", 1);
  const tagsLine = lines.slice(1, end).findIndex((line) => /^tags:\s*$/.test(line));
  if (end === -1 || tagsLine === -1) return [];
  const tags: string[] = [];
  for (const line of lines.slice(tagsLine + 2, end)) {
    const tag = /^\s+-\s+(.+?)\s*$/.exec(line);
    if (!tag?.[1]) break;
    tags.push(tag[1]);
  }
  return tags;
}
