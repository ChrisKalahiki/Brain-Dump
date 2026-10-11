import { readFileSync } from "node:fs";
import { basename, dirname, relative } from "node:path";
import { BrainDumpError, UsageError } from "./errors.ts";
import { isDumpFile, readDump, type StoredDump } from "./inbox.ts";
import { FILED_FOLDER, INBOX } from "./layout.ts";
import { noteFiles } from "./notes.ts";
import type { Vault } from "./vault.ts";

// Recall (ADR 0007): agents look up the Items the Vault holds through the helper, never with their own file tools.

const RESULT_CAP = 20;
const TODO_TAG = /(^|\s)#todo(?=\s|$)/;
const BULLET = /^(\s*)- (?:\[.\] )?(.+)$/;
const WHY_LINE = /^- Why: (.+)$/;
const FROM_LINE = /^- From \[\[([^\]|#]+)/;
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
    .map((item) => ({ item, hits: countHits(`${item.text}\n${item.why ?? ""}`.toLowerCase(), terms) }))
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

function countHits(text: string, terms: string[]): number {
  return terms.reduce((hits, term) => hits + (term === "" ? 0 : text.split(term).length - 1), 0);
}

/** Open Items still in Inbox Dumps, plus filed Items in curated notes: a bullet with a `From [[dump]]` line, or a `#todo` bullet. Dropped Items stay behind in their Dumps. */
function collectItems(vault: Vault): FoundItem[] {
  const files = noteFiles(vault);
  const dumps = files.filter((path) => isDumpInInbox(vault, path)).flatMap((path) => readableDump(vault, path)).map((dump) => ({ dump, info: describeDump(dump) }));
  const dumpsByTitle = new Map(dumps.map(({ dump, info }) => [dump.title, info]));
  const filedTodos = new Map(
    dumps.flatMap(({ dump, info }) => dump.items.filter((item) => item.kind === "Todo" && item.state === "filed").map((item): [string, DumpInfo] => [todoKey(item.text), info])),
  );
  const unfiled = dumps
    .filter(({ dump }) => dirname(dump.file) === INBOX)
    .flatMap(({ dump, info }) => dump.items.filter((item) => item.state === "open").map((item) => found(dump.file, item.text, item.rationale, true, info, item.line)));
  const curated = files
    .filter((path) => !relative(vault.root, path).startsWith(`${INBOX}/`))
    .flatMap((path) => {
      const note = relative(vault.root, path);
      return curatedBullets(readFileSync(path, "utf8").split(/\r?\n/)).map(({ text, why, from, line }) => {
        const info = from === undefined ? filedTodos.get(todoKey(text)) : dumpsByTitle.get(from);
        return found(note, text, why, false, info, line);
      });
    });
  return [...unfiled, ...curated];
}

function found(note: string, text: string, why: string | null | undefined, unfiled: boolean, dumpInfo: DumpInfo | undefined, position: number): FoundItem {
  const kind = why ? "decision" : TODO_TAG.test(text) ? "todo" : "learning";
  return { note, kind, text, why: why ?? null, unfiled, dump: dumpInfo?.file ?? null, origin: dumpInfo?.origin ?? null, dumpInfo, position };
}

function isDumpInInbox(vault: Vault, path: string): boolean {
  const folder = relative(vault.root, dirname(path));
  return isDumpFile(path) && (folder === INBOX || folder === FILED_FOLDER);
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

/** A filed Todo moves its `#todo` to the end, so compare without it. */
function todoKey(text: string): string {
  return text.replace(TODO_TAG, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

type CuratedBullet = { text: string; why: string | undefined; from: string | undefined; line: number };

function curatedBullets(lines: string[]): CuratedBullet[] {
  return lines.flatMap((line, index) => {
    const bullet = BULLET.exec(line);
    if (!bullet?.[2] || WHY_LINE.test(line.trim()) || FROM_LINE.test(line.trim())) return [];
    const indent = bullet[1]?.length ?? 0;
    const children = childLines(lines, index, indent);
    const why = children.map((child) => WHY_LINE.exec(child)?.[1]).find(Boolean);
    const from = children.map((child) => FROM_LINE.exec(child)?.[1]?.trim()).find(Boolean);
    const text = bullet[2];
    if (from === undefined && !TODO_TAG.test(text)) return [];
    return [{ text, why, from, line: index }];
  });
}

/** The bullet's direct children, trimmed: the indented lines right under it at the first child's depth. */
function childLines(lines: string[], index: number, indent: number): string[] {
  const children: string[] = [];
  let depth: number | undefined;
  for (const line of lines.slice(index + 1)) {
    const lineIndent = /^\s*/.exec(line)?.[0].length ?? 0;
    if (line.trim() === "" || lineIndent <= indent) break;
    depth ??= lineIndent;
    if (lineIndent === depth) children.push(line.trim());
  }
  return children;
}

/** Every line in the allowlist with a wikilink to `note`, whatever its folder, alias or heading. */
function findLinks(vault: Vault, note: string): { note: string; line: string }[] {
  const wanted = linkTitle(note.replace(/^\[\[|\]\]$/g, ""));
  return noteFiles(vault).flatMap((path) =>
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter((line) => [...line.matchAll(/\[\[([^\]]+)\]\]/g)].some((link) => linkTitle(link[1] ?? "") === wanted))
      .map((line) => ({ note: relative(vault.root, path), line })),
  );
}

function linkTitle(link: string): string {
  const target = link.split("|")[0]?.split("#")[0]?.trim() ?? "";
  return basename(target, ".md").toLowerCase();
}
