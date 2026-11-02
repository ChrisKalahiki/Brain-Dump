import { existsSync, statSync } from "node:fs";
import { basename, isAbsolute, join, normalize, relative } from "node:path";
import { readHashed } from "./content-hash.ts";
import { curatedBullets } from "./curated.ts";
import { latestDigest } from "./digest.ts";
import { BrainDumpError } from "./errors.ts";
import { INBOX, KNOWLEDGE_TREES, WEEKLY_FOLDER } from "./layout.ts";
import { ownText, readSections, sizeOf, type Section } from "./note-sections.ts";
import { frontmatterTags, noteFiles } from "./notes.ts";
import { findNote } from "./show.ts";
import type { Vault } from "./vault.ts";

// The Outline: every Curated Note but Weekly Notes, with its Sections nested as the note nests them, worked out from the notes each time.

const CAP = 48_000;
const CAP_VARIABLE = "BRAIN_DUMP_OUTLINE_CAP";
const LEGEND = "# Outline · note: path · tags · digest · filed Items · hash · Section: name [bullets/lines]";
const BEFORE_FIRST_HEADING = "(before first heading)";
const CUT = `(cut: narrow with outline <folder> or outline "[[Note]]")`;
/** Over the cap, Sections whose heading is deeper than `##` are dropped first. */
const CUT_LEVEL = 2;
/** The trees the Outline reads: the knowledge trees less the Inbox and Weekly Notes. */
const OUTLINE_TREES = KNOWLEDGE_TREES.filter((tree) => tree !== INBOX && tree !== WEEKLY_FOLDER);

/** `heading` is null for the lines before the first heading, whose size counts only those lines, frontmatter left out. */
export type OutlineSection = { name: string; heading: string | null; level: number; bullets: number; lines: number; sections: OutlineSection[] };
/** `digest` says whether the note has one; `filed` counts its backlinked Items; `hash` is the one `list-notes` and `show` report. */
export type OutlinedNote = { note: string; tags: string[]; digest: boolean; filed: number; hash: string; sections: OutlineSection[] };

/** `scope` is a folder in the knowledge trees or one note (`[[Note]]`, a title or a path); without one, every Curated Note but Weekly Notes, sorted by path. */
export function outline(vault: Vault, scope?: string): OutlinedNote[] {
  return scopedNotes(vault, scope).map((path) => {
    const { contents, hash } = readHashed(path);
    const sectioned = readSections(basename(path, ".md"), contents);
    const { root, lines } = sectioned;
    const intro = { name: root.name, heading: null, level: 0, ...sizeOf(withoutFrontmatter(ownText(sectioned, root).split("\n"))), sections: [] };
    return {
      note: relative(vault.root, path),
      tags: frontmatterTags(contents),
      digest: latestDigest(lines) !== undefined,
      filed: curatedBullets(lines).filter(({ why, from }) => why !== undefined || from !== undefined).length,
      hash,
      sections: [...(intro.lines > 0 ? [intro] : []), ...root.sections.map(outlineSection)],
    };
  });
}

/** The Outline as text, a legend line first. Over the cap it drops Sections below the second heading level, then lists notes only, and says how to narrow it. */
export function renderOutline(notes: OutlinedNote[], cap = outlineCap()): string {
  const full = textOf(notes, () => true);
  if (full.length <= cap) return full;
  const shallow = `${textOf(notes, (section) => section.level <= CUT_LEVEL)}${CUT}\n`;
  return shallow.length <= cap ? shallow : `${textOf(notes, () => false)}${CUT}\n`;
}

function textOf(notes: OutlinedNote[], kept: (section: OutlineSection) => boolean): string {
  const lines = notes.flatMap((note) => [noteLine(note), ...sectionLines(note.sections, 1, kept)]);
  return `${[LEGEND, ...lines].join("\n")}\n`;
}

function noteLine({ note, tags, digest, filed, hash }: OutlinedNote): string {
  return [note, ...(tags.length > 0 ? [tags.join(", ")] : []), ...(digest ? ["digest"] : []), `${filed} filed`, hash].join(" · ");
}

function sectionLines(sections: OutlineSection[], depth: number, kept: (section: OutlineSection) => boolean): string[] {
  return sections.filter(kept).flatMap((section) => [
    `${"  ".repeat(depth)}${section.heading === null ? BEFORE_FIRST_HEADING : `${"#".repeat(section.level)} ${section.heading}`} [${section.bullets}/${section.lines}]`,
    ...sectionLines(section.sections, depth + 1, kept),
  ]);
}

function outlineSection({ name, heading, level, bullets, lines, sections }: Section): OutlineSection {
  return { name, heading: heading ?? null, level, bullets, lines, sections: sections.map(outlineSection) };
}

function withoutFrontmatter(lines: string[]): string[] {
  const end = lines[0] === "---" ? lines.indexOf("---", 1) : -1;
  return end === -1 ? lines : lines.slice(end + 1);
}

function scopedNotes(vault: Vault, scope: string | undefined): string[] {
  if (scope === undefined) return noteFiles(vault, OUTLINE_TREES);
  if (scope.startsWith("[[") || scope.endsWith(".md")) return [outlinedNote(vault, scope)];
  return noteFiles(vault, [outlinedFolder(vault, scope)]);
}

function outlinedNote(vault: Vault, scope: string): string {
  const path = findNote(vault, scope);
  const note = relative(vault.root, path);
  if (within(note, WEEKLY_FOLDER)) throw weeklyRefusal(scope);
  if (!OUTLINE_TREES.some((tree) => within(note, tree))) throw new BrainDumpError(`${scope} is not a Curated Note, so it has no Outline`);
  return path;
}

function outlinedFolder(vault: Vault, scope: string): string {
  const folder = normalize(scope).replace(/\/+$/, "");
  if (isAbsolute(folder) || folder.startsWith("..")) throw new BrainDumpError(`${scope} is not a folder in the Vault`);
  if (within(folder, WEEKLY_FOLDER)) throw weeklyRefusal(scope);
  if (!OUTLINE_TREES.some((tree) => within(folder, tree))) throw new BrainDumpError(`${scope} is outside the knowledge trees; pass a folder in ${OUTLINE_TREES.join(", ")}`);
  const path = join(vault.root, folder);
  if (!existsSync(path) || !statSync(path).isDirectory()) throw new BrainDumpError(`${scope} is not a folder in the Vault`);
  return folder;
}

function weeklyRefusal(scope: string): BrainDumpError {
  return new BrainDumpError(`${scope}: Weekly Notes are not in the Outline; use recall <terms…>`);
}

function within(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}/`);
}

/** `BRAIN_DUMP_OUTLINE_CAP` lets tests force a cut. */
function outlineCap(): number {
  const override = process.env[CAP_VARIABLE]?.trim();
  return override && Number.isFinite(Number(override)) ? Number(override) : CAP;
}
