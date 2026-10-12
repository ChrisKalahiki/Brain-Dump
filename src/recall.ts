import { readFileSync } from "node:fs";
import { basename, dirname, relative } from "node:path";
import { BrainDumpError, UsageError } from "./errors.ts";
import { curatedBullets, itemKey, TODO_TAG } from "./curated.ts";
import { isStoredDump, readDump, type StoredDump } from "./inbox.ts";
import { INBOX } from "./layout.ts";
import { linkTarget, noteFiles } from "./notes.ts";
import type { Vault } from "./vault.ts";

// Recall (ADR 0007): agents look up the Items the Vault holds through the helper, never with their own file tools.

const RESULT_CAP = 20;
const PROJECT_LINK = / · \[\[([^\]]+)\]\]$/;

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

export type Recall = { results: RecalledItem[]; more: number } | { links: { note: string; line: string }[] };

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
  const items = collectItems(vault);
  if (query.mode === "project") return capped(items.filter((item) => item.dumpInfo?.project === query.name).sort(byRecency));
  const terms = query.terms.map((term) => term.toLowerCase());
  const scored = items
    .map((item) => ({ item, hits: countHits(`${item.text}\n${item.why ?? ""}`, terms) }))
    .filter(({ hits }) => hits > 0)
    .sort((a, b) => b.hits - a.hits || byRecency(a.item, b.item));
  return capped(scored.map(({ item }) => item));
}

type DumpInfo = { file: string; stamp: string; origin: string | null; project: string | undefined };

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
function collectItems(vault: Vault): FoundItem[] {
  const files = noteFiles(vault);
  const dumps = files
    .filter((path) => isStoredDump(vault, path))
    .flatMap((path) => readableDump(vault, path))
    .map((dump) => ({ dump, info: describeDump(dump) }));
  const dumpsByTitle = new Map(dumps.map(({ dump, info }) => [dump.title, info]));
  const filedTodos = filedTodoDumps(dumps);
  const unfiled = dumps
    .filter(({ dump }) => dirname(dump.file) === INBOX)
    .flatMap(({ dump, info }) =>
      dump.items
        .filter((item) => item.state === "open")
        .map((item) => toFoundItem({ note: dump.file, text: item.text, why: item.rationale, unfiled: true, dumpInfo: info, position: item.line })),
    );
  const curated = files
    .filter((path) => !relative(vault.root, path).startsWith(`${INBOX}/`))
    .flatMap((path) =>
      curatedBullets(readFileSync(path, "utf8").split(/\r?\n/)).map(({ text, why, from, line }) => {
        const dumpInfo = from === undefined ? (filedTodos.get(itemKey(text)) ?? undefined) : dumpsByTitle.get(from);
        return toFoundItem({ note: relative(vault.root, path), text, why, unfiled: false, dumpInfo, position: line });
      }),
    );
  return [...unfiled, ...curated];
}

/** A filed Todo has no backlink, so its Dump is the one Dump that filed the same text; `null` when several did. */
function filedTodoDumps(dumps: { dump: StoredDump; info: DumpInfo }[]): Map<string, DumpInfo | null> {
  const byText = new Map<string, DumpInfo | null>();
  for (const { dump, info } of dumps) {
    for (const item of dump.items) {
      if (item.kind !== "Todo" || item.state !== "filed") continue;
      const key = itemKey(item.text);
      byText.set(key, byText.has(key) && byText.get(key)?.file !== info.file ? null : info);
    }
  }
  return byText;
}

type ItemSource = { note: string; text: string; why: string | null | undefined; unfiled: boolean; dumpInfo: DumpInfo | undefined; position: number };

function toFoundItem({ note, text, why, unfiled, dumpInfo, position }: ItemSource): FoundItem {
  const kind = why ? "decision" : TODO_TAG.test(text) ? "todo" : "learning";
  return { note, kind, text, why: why ?? null, unfiled, dump: dumpInfo?.file ?? null, origin: dumpInfo?.origin ?? null, dumpInfo, position };
}

/** A malformed Dump is left for `check` to report, not allowed to break recall. */
function readableDump(vault: Vault, path: string): StoredDump[] {
  try {
    return [readDump(vault, path)];
  } catch (error) {
    if (error instanceof BrainDumpError) return [];
    throw error;
  }
}

function describeDump(dump: StoredDump): DumpInfo {
  const origin = dump.lines.find((line) => line.startsWith("Session: ")) ?? null;
  const project = origin === null ? undefined : PROJECT_LINK.exec(origin)?.[1];
  return { file: dump.file, stamp: dump.title.slice(0, "YYYY-MM-DD HHMM".length), origin, project };
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
