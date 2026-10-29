import { filedItemLines } from "./curated.ts";
import { digests } from "./digest.ts";
import { BrainDumpError } from "./errors.ts";

// A note read into Sections: a heading of any level opens one, running until the next heading of the same or a higher level.
// Filed lines (backlinked Items and Digests) belong to no Section.

const HEADING = /^(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const FENCE = /^\s*(`{3,}|~{3,})/;
const BULLET = /^\s*(?:[-*+]|\d+[.)])\s/;
const SUGGESTIONS = 5;

/**
 * `name` is its Obsidian heading link, `[[Note#Parent#Child]]`, and `path` its headings as that link writes them.
 * `heading` is as written, or undefined for the lines before the first heading; `line` is 0-based and `end` the first line after its nested Sections.
 * `bullets` and `lines` count the non-blank lines under its heading and its nested Sections', less filed lines.
 */
export type Section = {
  name: string;
  path: string[];
  heading: string | undefined;
  level: number;
  line: number;
  end: number;
  bullets: number;
  lines: number;
  sections: Section[];
};

/** `filed` holds the 0-based filed lines, in order. */
export type SectionedNote = { title: string; lines: string[]; filed: number[]; root: Section };

export function readSections(title: string, contents: string): SectionedNote {
  const lines = contents.split(/\r?\n/);
  const filed = [...new Set([...filedItemLines(lines), ...digests(lines).flatMap(({ header, end }) => range(header, end + 1))])].sort((a, b) => a - b);
  const root = section(`[[${title}]]`, [], undefined, 0, 0, lines.length);
  const open = [root];
  for (const { line, level, heading } of headings(lines)) {
    while ((open.at(-1)?.level ?? 0) >= level) {
      const closed = open.pop();
      if (closed) closed.end = line;
    }
    const parent = open.at(-1) ?? root;
    const path = [...parent.path, linkHeading(heading)];
    const opened = section(`[[${[title, ...path].join("#")}]]`, path, heading, level, line, lines.length);
    parent.sections.push(opened);
    open.push(opened);
  }
  const note = { title, lines, filed, root };
  countSize(note, root);
  return note;
}

/** The Section an Obsidian heading link names: its full heading path, or any of its headings in order ending with its own, so a unique deepest heading resolves alone. */
export function resolveSection(note: SectionedNote, name: string): Section {
  const wanted = headingPath(name).map(matchKey);
  const candidates = descendants(note.root);
  const matches = candidates.filter((section) => endsWithInOrder(section.path.map(matchKey), wanted));
  const [first, ...others] = matches;
  if (first === undefined) {
    const suggestions = nearest(name, candidates.map((section) => section.name));
    throw new BrainDumpError(`${name} is not a Section of ${note.title}${suggestions.length > 0 ? `; nearest: ${suggestions.join(", ")}` : ""}`);
  }
  if (others.length > 0) throw new BrainDumpError(`${name} matches lines ${listed(matches.map((section) => String(section.line + 1)))} of ${note.title}; pass its full path, e.g. ${first.name}`);
  return first;
}

/** The headings a link names after its note: `[[Note#A#B|alias]]` → `["A", "B"]`; none for a link to the whole note. */
export function headingPath(name: string): string[] {
  const link = name.replace(/^\[\[|\]\]$/g, "").split("|")[0] ?? "";
  return link.split("#").slice(1).filter((heading) => heading.trim() !== "");
}

/** Up to `limit` candidates nearest `target`: most words in common first, then fewest edits. */
export function nearest(target: string, candidates: string[], limit = SUGGESTIONS): string[] {
  const key = matchKey(target);
  const words = new Set(key.split(" "));
  return candidates
    .map((candidate) => {
      const candidateKey = matchKey(candidate);
      return { candidate, shared: new Set(candidateKey.split(" ").filter((word) => words.has(word))).size, edits: editDistance(key, candidateKey) };
    })
    .sort((a, b) => b.shared - a.shared || a.edits - b.edits)
    .slice(0, limit)
    .map(({ candidate }) => candidate);
}

/** The Section's lines with its nested Sections, less filed lines. */
export function sectionText(note: SectionedNote, section: Section): string {
  return textOf(note, range(section.line, section.end));
}

/** The Section's heading and the lines up to its first nested Section, less filed lines. */
export function ownText(note: SectionedNote, section: Section): string {
  return textOf(note, ownLines(section));
}

export function filedText(note: SectionedNote): string {
  return joined(note.filed.map((line) => note.lines[line] ?? ""));
}

function descendants(section: Section): Section[] {
  return section.sections.flatMap((nested) => [nested, ...descendants(nested)]);
}

function endsWithInOrder(path: string[], wanted: string[]): boolean {
  if (wanted.length === 0 || path.at(-1) !== wanted.at(-1)) return false;
  let next = 0;
  for (const heading of path) if (heading === wanted[next]) next++;
  return next >= wanted.length;
}

function listed(items: string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** How Obsidian compares headings: punctuation becomes a space, runs of whitespace one space, case ignored (its `stripHeading`). */
function matchKey(heading: string): string {
  return heading
    .replace(/[!"#$%&()*+,.:;<=>?@^`{|}~/[\]\\\r\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function editDistance(a: string, b: string): number {
  const charsB = [...b];
  let previous = Array.from({ length: charsB.length + 1 }, (_, index) => index);
  for (const [i, charA] of [...a].entries()) {
    const current = [i + 1];
    for (const [j, charB] of charsB.entries()) current.push(Math.min((previous[j + 1] ?? 0) + 1, (current[j] ?? 0) + 1, (previous[j] ?? 0) + (charA === charB ? 0 : 1)));
    previous = current;
  }
  return previous[charsB.length] ?? 0;
}

function section(name: string, path: string[], heading: string | undefined, level: number, line: number, end: number): Section {
  return { name, path, heading, level, line, end, bullets: 0, lines: 0, sections: [] };
}

function countSize(note: SectionedNote, section: Section): void {
  const filed = new Set(note.filed);
  const own = ownLines(section)
    .filter((line) => !filed.has(line) && (section.heading === undefined || line !== section.line))
    .map((line) => note.lines[line] ?? "")
    .filter((text) => text.trim() !== "");
  section.bullets = own.filter((text) => BULLET.test(text)).length;
  section.lines = own.length;
  for (const nested of section.sections) {
    countSize(note, nested);
    section.bullets += nested.bullets;
    section.lines += nested.lines;
  }
}

function ownLines(section: Section): number[] {
  return range(section.line, section.sections[0]?.line ?? section.end);
}

function textOf(note: SectionedNote, lines: number[]): string {
  const filed = new Set(note.filed);
  return joined(lines.filter((line) => !filed.has(line)).map((line) => note.lines[line] ?? ""));
}

/** Lines as one text ending in a single newline, trailing blank lines dropped. */
function joined(lines: string[]): string {
  const text = lines.join("\n").trimEnd();
  return text === "" ? "" : `${text}\n`;
}

function range(start: number, end: number): number[] {
  return Array.from({ length: Math.max(0, end - start) }, (_, offset) => start + offset);
}

function headings(lines: string[]): { line: number; level: number; heading: string }[] {
  let fence: string | undefined;
  return lines.flatMap((text, line) => {
    const marker = FENCE.exec(text)?.[1];
    if (marker !== undefined && (fence === undefined || marker.startsWith(fence))) {
      fence = fence === undefined ? marker : undefined;
      return [];
    }
    const match = fence === undefined ? HEADING.exec(text) : null;
    return match?.[1] && match[2] ? [{ line, level: match[1].length, heading: match[2] }] : [];
  });
}

/** A heading as Obsidian writes it into a link: `:`, `#`, `|`, `^`, `\`, `%%`, `[[` and `]]` become spaces (its `stripHeadingForLink`). */
function linkHeading(heading: string): string {
  return heading.replace(/([:#|^\\]|%%|\[\[|\]\])/g, " ").replace(/\s+/g, " ").trim();
}
