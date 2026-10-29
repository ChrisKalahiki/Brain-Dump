import { readFileSync } from "node:fs";
import { basename, relative } from "node:path";
import { bm25 } from "./bm25.ts";
import { TODO_TAG, type CuratedNote } from "./curated.ts";
import { renderOriginLine } from "./dump.ts";
import { words } from "./duplicates.ts";
import { UsageError } from "./errors.ts";
import type { StoredDump } from "./inbox.ts";
import { descendants, ownText, readSections } from "./note-sections.ts";
import { linkTarget, noteFiles } from "./notes.ts";
import { readVaultItems } from "./vault-items.ts";
import type { Vault } from "./vault.ts";

// Recall (ADR 0007): agents look up the Items the Vault holds through the helper, never with their own file tools.
// Term Recall also ranks Sections of curated notes by BM25, worked out on each call (ADR 0013).

const RESULT_CAP = 20;
const SECTION_CAP = 10;

export type RecallQuery = { mode: "terms"; terms: string[] } | { mode: "project"; name: string } | { mode: "links"; note: string };

export type RecalledItem = {
  note: string;
  kind: "decision" | "learning" | "todo";
  text: string;
  why: string | null;
  unfiled: boolean;
  dump: string | null;
  origin: string | null;
};

/** `section` is its full heading link; `score` is rounded to 3 places. */
export type RecalledSection = { note: string; section: string; score: number; bullets: number; lines: number };

export type ItemRecall = { results: RecalledItem[]; more: number };

export type Recall = (ItemRecall & { sections: RecalledSection[]; moreSections: number }) | ItemRecall | { links: { note: string; line: string }[] };

/** `currentProject` is asked for only when `--project` names none. */
export function parseRecallQuery(args: string[], currentProject: () => string): RecallQuery {
  const [first, ...rest] = args;
  const isFlag = (arg: string | undefined): boolean => arg?.startsWith("--") ?? false;
  if (first === "--project" && rest.length <= 1 && !isFlag(rest[0])) return { mode: "project", name: rest[0] ?? currentProject() };
  if (first === "--links" && rest.length === 1 && !isFlag(rest[0])) return { mode: "links", note: rest[0] ?? "" };
  if (args.length > 0 && !args.some(isFlag)) return { mode: "terms", terms: args };
  throw new UsageError("recall takes exactly one of <terms…>, --project [name] or --links [[Note]]");
}

export function recall(vault: Vault, query: RecallQuery): Recall {
  if (query.mode === "links") return { links: findLinks(vault, query.note) };
  const { items, notes } = collectItems(vault);
  if (query.mode === "project") return capped(items.filter((item) => item.dumpInfo?.project === query.name).sort(byRecency));
  const terms = query.terms.map((term) => term.toLowerCase());
  const scored = items
    .map((item) => ({ item, hits: countHits(`${item.text}\n${item.why ?? ""}`, terms) }))
    .filter(({ hits }) => hits > 0)
    .sort((a, b) => b.hits - a.hits || byRecency(a.item, b.item));
  const sections = rankSections(notes, query.terms);
  return { ...capped(scored.map(({ item }) => item)), sections: sections.slice(0, SECTION_CAP), moreSections: Math.max(0, sections.length - SECTION_CAP) };
}

/**
 * Every Section scoring above 0, best first, then by note path and line.
 * A Section's text is its ancestors' heading names and its own text, less filed lines; one with no words, like a note's empty lead, is not in the corpus.
 */
export function rankSections(notes: CuratedNote[], terms: string[]): RecalledSection[] {
  const sections = notes.flatMap(({ note, lines }) => {
    const sectioned = readSections(basename(note, ".md"), lines.join("\n"));
    return [sectioned.root, ...descendants(sectioned.root)]
      .map((section) => ({ note, section, words: words([...section.path.slice(0, -1), ownText(sectioned, section)].join("\n")) }))
      .filter((scored) => scored.words.length > 0);
  });
  const scores = bm25(
    sections.map((section) => section.words),
    words(terms.join(" ")),
  );
  return sections
    .map(({ note, section }, index) => ({ note, section, score: scores[index] ?? 0 }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.note.localeCompare(b.note) || a.section.line - b.section.line)
    .map(({ note, section, score }) => ({ note, section: section.name, score: Math.round(score * 1000) / 1000, bullets: section.bullets, lines: section.lines }));
}

type DumpInfo = { file: string; stamp: string; origin: string; project: string | null };

/** An Item plus what recall sorts and filters it by. */
type FoundItem = RecalledItem & { dumpInfo: DumpInfo | undefined; position: number };

function capped(items: FoundItem[]): { results: RecalledItem[]; more: number } {
  const results = items.slice(0, RESULT_CAP).map(({ dumpInfo, position, ...item }) => item);
  return { results, more: Math.max(0, items.length - RESULT_CAP) };
}

/** Newest Dump first; Items with no Dump last; then by note path and place in the note. */
function byRecency(a: FoundItem, b: FoundItem): number {
  const stamp = (b.dumpInfo?.stamp ?? "").localeCompare(a.dumpInfo?.stamp ?? "");
  return stamp || a.note.localeCompare(b.note) || a.position - b.position;
}

/** One hit per distinct term found, so an Item matching every term outranks one repeating a single term. */
function countHits(text: string, terms: string[]): number {
  const haystack = text.toLowerCase();
  return new Set(terms.filter((term) => term !== "" && haystack.includes(term))).size;
}

/** Open Items still in Inbox Dumps, plus filed Items in curated notes. Dropped Items stay behind in their Dumps. */
function collectItems(vault: Vault): { items: FoundItem[]; notes: CuratedNote[] } {
  const { items, notes } = readVaultItems(vault);
  const found = items.map(({ note, text, rationale, state, dump, line }): FoundItem => {
    const dumpInfo = dump && describeDump(dump);
    const kind = rationale ? "decision" : TODO_TAG.test(text) ? "todo" : "learning";
    return { note, kind, text, why: rationale, unfiled: state === "open", dump: dumpInfo?.file ?? null, origin: dumpInfo?.origin ?? null, dumpInfo, position: line };
  });
  return { items: found, notes };
}

function describeDump(dump: StoredDump): DumpInfo {
  return { file: dump.file, stamp: dump.title.slice(0, "YYYY-MM-DD HHMM".length), origin: renderOriginLine(dump.origin, dump.swept), project: dump.project };
}

/** Every line in the allowlist with a wikilink to `note`, whatever its folder, alias or heading. */
function findLinks(vault: Vault, note: string): { note: string; line: string }[] {
  const wanted = linkTitle(note);
  return noteFiles(vault).flatMap((path) =>
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter((line) => [...line.matchAll(/\[\[([^\]]+)\]\]/g)].some((link) => linkTitle(link[1] ?? "") === wanted))
      .map((line) => ({ note: relative(vault.root, path), line })),
  );
}

function linkTitle(link: string): string {
  return basename(linkTarget(link), ".md").toLowerCase();
}
