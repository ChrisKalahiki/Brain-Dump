import { basename, isAbsolute, join, normalize, relative } from "node:path";
import { readHashed } from "./content-hash.ts";
import { BrainDumpError } from "./errors.ts";
import { linkTarget, noteFiles } from "./notes.ts";
import type { Vault } from "./vault.ts";

const TEXT_CAP = 60_000;
/** The opening line of a Digest callout (ADR 0008); a note's latest Digest is its last one. */
const DIGEST_START = /^> \[!summary\] Digest \d{2}-\d{2}-\d{2}(?: \(\d+\))?[ \t]*\r?$/gm;

export type ShownNote = { note: string; hash: string; text: string; truncated: boolean };

/** The note from its latest Digest onward, or whole when it has none, capped unless `full`. `hash` covers the whole file, for a plan's `expect`. */
export function showNote(vault: Vault, name: string, { full = false } = {}): ShownNote {
  const path = findNote(vault, name);
  const { contents, hash } = readHashed(path);
  const text = full ? contents : contents.slice([...contents.matchAll(DIGEST_START)].at(-1)?.index ?? 0);
  const truncated = text.length > TEXT_CAP && !full;
  return { note: relative(vault.root, path), hash, text: truncated ? text.slice(0, TEXT_CAP) : text, truncated };
}

/** `name` is a Vault-relative path, a title, or a `[[wikilink]]`; only notes in the write allowlist can be shown (ADR 0007). */
function findNote(vault: Vault, name: string): string {
  const link = linkTarget(name);
  const notes = noteFiles(vault);
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
