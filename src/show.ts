import { lstatSync, realpathSync } from "node:fs";
import { basename, isAbsolute, join, normalize, relative } from "node:path";
import { readHashed } from "./content-hash.ts";
import { latestDigest } from "./digest.ts";
import { BrainDumpError } from "./errors.ts";
import { SHOW_READ_ONLY_NOTES, WRITE_ALLOWLIST } from "./layout.ts";
import { filedText, nearest, readSections, resolveSection, sectionText } from "./note-sections.ts";
import { linkTarget, noteFiles } from "./notes.ts";
import type { Vault } from "./vault.ts";

const TEXT_CAP = 60_000;

export type ShownNote = { note: string; hash: string; text: string; truncated: boolean };
export type ShownSection = ShownNote & { section: string };

/** The note from its latest Digest onward, or whole when it has none, capped unless `full`. `hash` covers the whole file, for a plan's `expect`. */
export function showNote(vault: Vault, name: string, { full = false } = {}): ShownNote {
  const path = findNote(vault, name, { readOnly: true });
  const { contents, hash } = readHashed(path);
  const text = full ? contents : contents.slice(digestOffset(contents));
  return { note: relative(vault.root, path), hash, ...capped(text, full) };
}

/** The Section a `[[Note#Heading]]` link names, with its nested Sections and without filed lines; an unknown note or Section is refused with the nearest names. */
export function showSection(vault: Vault, name: string, { full = false } = {}): ShownSection {
  const path = findNote(vault, name, { suggest: true, readOnly: true });
  const { contents, hash } = readHashed(path);
  const note = readSections(basename(path, ".md"), contents);
  const section = resolveSection(note, name);
  return { note: relative(vault.root, path), section: section.name, hash, ...capped(sectionText(note, section), full) };
}

/** The note's filed lines, its backlinked Items and Digests, in order. */
export function showFiled(vault: Vault, name: string, { full = false } = {}): ShownNote {
  const path = findNote(vault, name, { readOnly: true });
  const { contents, hash } = readHashed(path);
  return { note: relative(vault.root, path), hash, ...capped(filedText(readSections(basename(path, ".md"), contents)), full) };
}

function capped(text: string, full: boolean): { text: string; truncated: boolean } {
  const truncated = text.length > TEXT_CAP && !full;
  return { text: truncated ? text.slice(0, TEXT_CAP) : text, truncated };
}

/** Where the latest Digest's header line starts, or 0 when the note has none; `\r` stays on each line, so the offsets hold for CRLF notes too. */
function digestOffset(contents: string): number {
  const lines = contents.split("\n");
  const header = latestDigest(lines)?.header ?? 0;
  return lines.slice(0, header).reduce((offset, line) => offset + line.length + 1, 0);
}

/** `name` is a Vault-relative path, a title, or a `[[wikilink]]`; write-allowed notes are available by default (ADR 0007, ADR 0012); show may opt into approved read-only files. `suggest` names the nearest titles when none matches. */
export function findNote(vault: Vault, name: string, { suggest = false, readOnly = false } = {}): string {
  const link = linkTarget(name);
  const notes = [...noteFiles(vault, WRITE_ALLOWLIST), ...(readOnly ? showReadOnlyFiles(vault) : [])].sort();
  const byPath = link.includes("/") || link.endsWith(".md");
  const matches = byPath
    ? notes.filter((path) => !isAbsolute(link) && path === normalize(join(vault.root, link.endsWith(".md") ? link : `${link}.md`)))
    : notes.filter((path) => basename(path, ".md").toLowerCase() === link.toLowerCase());
  if (matches.length === 0) {
    const titles = suggest ? nearest(basename(link), notes.map((path) => basename(path, ".md"))) : [];
    throw new BrainDumpError(`${name} is not a note in the write allowlist${titles.length > 0 ? `; nearest: ${titles.join(", ")}` : ""}`);
  }
  if (matches.length > 1) {
    const listed = matches.map((path) => relative(vault.root, path));
    throw new BrainDumpError(`${name} matches ${listed.slice(0, -1).join(", ")} and ${listed.at(-1)}; pass its path`);
  }
  return matches[0] ?? "";
}

/** Refuse symlinks in the approved path, including parent folders; missing files stay unavailable. */
function showReadOnlyFiles(vault: Vault): string[] {
  return SHOW_READ_ONLY_NOTES.flatMap((note) => {
    const path = join(vault.root, note);
    try {
      return lstatSync(path).isFile() && realpathSync(path) === join(realpathSync(vault.root), note) ? [path] : [];
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && ["ENOENT", "ENOTDIR", "EACCES", "ELOOP"].includes(String(error.code))) return [];
      throw error;
    }
  });
}
