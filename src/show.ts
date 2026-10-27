import { basename, isAbsolute, join, normalize, relative } from "node:path";
import { readHashed } from "./content-hash.ts";
import { latestDigest } from "./digest.ts";
import { BrainDumpError } from "./errors.ts";
import { WRITE_ALLOWLIST } from "./layout.ts";
import { linkTarget, noteFiles } from "./notes.ts";
import type { Vault } from "./vault.ts";

const TEXT_CAP = 60_000;

export type ShownNote = { note: string; hash: string; text: string; truncated: boolean };

/** The note from its latest Digest onward, or whole when it has none, capped unless `full`. `hash` covers the whole file, for a plan's `expect`. */
export function showNote(vault: Vault, name: string, { full = false } = {}): ShownNote {
  const path = findNote(vault, name);
  const { contents, hash } = readHashed(path);
  const text = full ? contents : contents.slice(digestOffset(contents));
  const truncated = text.length > TEXT_CAP && !full;
  return { note: relative(vault.root, path), hash, text: truncated ? text.slice(0, TEXT_CAP) : text, truncated };
}

/** Where the latest Digest's header line starts, or 0 when the note has none; `\r` stays on each line, so the offsets hold for CRLF notes too. */
function digestOffset(contents: string): number {
  const lines = contents.split("\n");
  const header = latestDigest(lines)?.header ?? 0;
  return lines.slice(0, header).reduce((offset, line) => offset + line.length + 1, 0);
}

/** `name` is a Vault-relative path, a title, or a `[[wikilink]]`; only notes in the write allowlist, Briefings included, can be shown (ADR 0007, ADR 0012). */
export function findNote(vault: Vault, name: string): string {
  const link = linkTarget(name);
  const notes = noteFiles(vault, WRITE_ALLOWLIST);
  const byPath = link.includes("/") || link.endsWith(".md");
  const matches = byPath
    ? notes.filter((path) => !isAbsolute(link) && path === normalize(join(vault.root, link.endsWith(".md") ? link : `${link}.md`)))
    : notes.filter((path) => basename(path, ".md").toLowerCase() === link.toLowerCase());
  if (matches.length === 0) throw new BrainDumpError(`${name} is not a note in the write allowlist`);
  if (matches.length > 1) {
    const listed = matches.map((path) => relative(vault.root, path));
    throw new BrainDumpError(`${name} matches ${listed.slice(0, -1).join(", ")} and ${listed.at(-1)}; pass its path`);
  }
  return matches[0] ?? "";
}
