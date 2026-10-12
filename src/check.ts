import { readFileSync } from "node:fs";
import { basename, dirname, relative } from "node:path";
import { now } from "./clock.ts";
import { curatedBullets, itemKey } from "./curated.ts";
import { BrainDumpError } from "./errors.ts";
import { isStoredDump, readDump, type StoredDump } from "./inbox.ts";
import { INBOX, ROUTES_NOTE, WEEKLY_FOLDER } from "./layout.ts";
import { linkTarget, noteFiles } from "./notes.ts";
import { readRoutes, renderRoute } from "./routes.ts";
import type { Vault } from "./vault.ts";

// check: a read-only report of Vault problems, each with its fix, scoped to the write allowlist. Thresholds are constants so nothing in the Vault can silence a finding.

const STALE_AFTER_DAYS = 14;
const OVERSIZED_AT = 40;
const DAY_MS = 24 * 60 * 60 * 1000;
const BACKLINK = /^- (?:From|Filed) \[\[([^\]]+)\]\]/;
const FILED_ITEM = /^- From \[\[/;
const DIGEST_ID = /^\^digest-\d{6}(?:-\d+)?\s*$/;

export const FINDING_KINDS = ["Broken backlink", "Dead Route", "Stale Dump", "Stuck Dump", "Oversized note", "Duplicate Item", "Malformed Dump"] as const;

export type FindingKind = (typeof FINDING_KINDS)[number];

export type Finding = { kind: FindingKind; note: string; detail: string; fix: string };

type Note = { note: string; lines: string[] };

/** Every finding, grouped by kind in `FINDING_KINDS` order, then by note. */
export function checkVault(vault: Vault): Finding[] {
  const files = noteFiles(vault);
  const curated = files.filter((path) => !relative(vault.root, path).startsWith(`${INBOX}/`)).map((path) => readNote(vault, path));
  const dumpFiles = files.filter((path) => isStoredDump(vault, path));
  const dumpTitles = new Set(dumpFiles.map((path) => basename(path, ".md").toLowerCase()));
  const dumps = dumpFiles.map((path) => parseDump(vault, path));
  const findings = [
    ...curated.flatMap((note) => brokenBacklinks(note, dumpTitles)),
    ...deadRoutes(vault, files),
    ...dumps.flatMap((dump) => ("problem" in dump ? [] : [...staleDump(dump), ...stuckDump(dump)])),
    ...curated.filter(({ note }) => !note.startsWith(`${WEEKLY_FOLDER}/`)).flatMap(oversizedNote),
    ...curated.flatMap(duplicateItems),
    ...dumps.flatMap((dump) => ("problem" in dump ? [{ kind: "Malformed Dump" as const, note: dump.file, detail: dump.problem, fix: "hand edit" }] : [])),
  ];
  return findings.sort((a, b) => FINDING_KINDS.indexOf(a.kind) - FINDING_KINDS.indexOf(b.kind) || a.note.localeCompare(b.note));
}

export function renderFinding({ kind, note, detail, fix }: Finding): string {
  return `${kind} · [[${basename(note, ".md")}]] · ${detail} → ${fix}`;
}

function readNote(vault: Vault, path: string): Note {
  return { note: relative(vault.root, path), lines: readFileSync(path, "utf8").split(/\r?\n/) };
}

function brokenBacklinks({ note, lines }: Note, dumpTitles: Set<string>): Finding[] {
  return lines.flatMap((line, index) => {
    const link = BACKLINK.exec(line.trim())?.[1];
    if (link === undefined) return [];
    const target = linkTarget(link);
    if (dumpTitles.has(basename(target).toLowerCase())) return [];
    return [{ kind: "Broken backlink", note, detail: `line ${index + 1}: [[${target}]] is not a Dump`, fix: "hand edit, or restore the Dump" }];
  });
}

/** Routes to a note whose title no note in the allowlist has; Routes to a Todo Group are created on demand, so never dead. */
function deadRoutes(vault: Vault, files: string[]): Finding[] {
  const titles = new Set(files.map((path) => basename(path, ".md").toLowerCase()));
  return readRoutes(vault).flatMap((route) =>
    "title" in route && !titles.has(basename(linkTarget(route.title)).toLowerCase())
      ? [{ kind: "Dead Route" as const, note: ROUTES_NOTE, detail: `${renderRoute(route)} targets no note`, fix: "edit the Routes note" }]
      : [],
  );
}

/** Skipped Items count as open, so a Dump the user keeps skipping goes stale too. */
function staleDump(dump: StoredDump): Finding[] {
  const open = openItems(dump);
  const age = (Date.parse(localDate(now())) - Date.parse(dump.date)) / DAY_MS;
  if (open === 0 || age <= STALE_AFTER_DAYS) return [];
  return [{ kind: "Stale Dump", note: dump.file, detail: `${countOf(open, "open Item")}, ${age} days after its date`, fix: "/file, or drop N in its Filing Plan" }];
}

function stuckDump(dump: StoredDump): Finding[] {
  const open = openItems(dump);
  const inInbox = dirname(dump.file) === INBOX;
  if (inInbox === open > 0) return [];
  const detail = inInbox ? `no open Items left, but still in ${INBOX}` : `${countOf(open, "open Item")}, but already in ${dirname(dump.file)}`;
  return [{ kind: "Stuck Dump", note: dump.file, detail, fix: "re-run /file, or move it by hand" }];
}

/** A Digest covers everything above its `^digest-…` line (ADR 0008), so only filed Items after the last one count. */
function oversizedNote({ note, lines }: Note): Finding[] {
  const digest = lines.findLastIndex((line) => DIGEST_ID.test(line.trim()));
  const filed = lines.slice(digest + 1).filter((line) => FILED_ITEM.test(line.trim())).length;
  if (filed < OVERSIZED_AT) return [];
  const detail = digest === -1 ? `${filed} filed Items and no Digest` : `${filed} filed Items since its latest Digest`;
  return [{ kind: "Oversized note", note, detail, fix: `/consolidate [[${basename(note, ".md")}]]` }];
}

/** Exact matches only, after `itemKey`'s normalising; the backlink is left out, so one Item filed from two Dumps still counts. */
function duplicateItems({ note, lines }: Note): Finding[] {
  const byKey = new Map<string, string[]>();
  for (const { text, why } of curatedBullets(lines)) {
    const key = `${itemKey(text)}\n${itemKey(why ?? "")}`;
    byKey.set(key, [...(byKey.get(key) ?? []), text]);
  }
  return [...byKey.values()]
    .filter((texts) => texts.length > 1)
    .map((texts) => ({ kind: "Duplicate Item", note, detail: `"${texts[0]}" appears ${texts.length} times`, fix: "remove by hand, or leave for the next Digest" }));
}

function parseDump(vault: Vault, path: string): StoredDump | { file: string; problem: string } {
  const file = relative(vault.root, path);
  try {
    const dump = readDump(vault, path);
    const problem = headerProblem(dump.lines);
    return problem === undefined ? dump : { file, problem };
  } catch (error) {
    if (error instanceof BrainDumpError) return { file, problem: error.message };
    throw error;
  }
}

/** A Dump opens with a frontmatter block, then its `Session: ` origin line. */
function headerProblem(lines: string[]): string | undefined {
  const close = lines[0] === "---" ? lines.indexOf("---", 1) : -1;
  if (close === -1) return "no frontmatter";
  if (!lines[close + 1]?.startsWith("Session: ")) return "no Session: origin line after the frontmatter";
  return undefined;
}

function openItems(dump: StoredDump): number {
  return dump.items.filter((item) => item.state === "open").length;
}

function countOf(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function localDate(at: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}
