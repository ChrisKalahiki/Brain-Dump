import { basename, dirname } from "node:path";
import { now } from "./clock.ts";
import { BACKLINK_LINE, curatedBullets, curatedNotes, FROM_LINE, itemKey, type CuratedNote } from "./curated.ts";
import { isStoredDump, readDumpOrProblem, type MalformedDump, type StoredDump } from "./inbox.ts";
import { INBOX, ROUTES_NOTE, WEEKLY_FOLDER } from "./layout.ts";
import { linkTarget, noteFiles, titleKey } from "./notes.ts";
import { datePart } from "./origin.ts";
import { readRoutes, renderRoute } from "./routes.ts";
import type { Vault } from "./vault.ts";

// check: a read-only report of Vault problems, each with its fix, scoped to the write allowlist. Thresholds are constants so nothing in the Vault can silence a finding.

const STALE_AFTER_DAYS = 14;
const OVERSIZED_AT = 40;
const DAY_MS = 24 * 60 * 60 * 1000;
const DIGEST_ID = /^\^digest-\d{6}(?:-\d+)?\s*$/;

export const FINDING_KINDS = ["Broken backlink", "Dead Route", "Stale Dump", "Stuck Dump", "Oversized note", "Duplicate Item", "Malformed Dump"] as const;

export type FindingKind = (typeof FINDING_KINDS)[number];

export type Finding = { kind: FindingKind; note: string; detail: string; fix: string };

/** Every finding, grouped by kind in `FINDING_KINDS` order, then by note. */
export function checkVault(vault: Vault): Finding[] {
  const files = noteFiles(vault);
  const curated = curatedNotes(vault);
  const dumpFiles = files.filter((path) => isStoredDump(vault, path));
  const dumpTitles = new Set(dumpFiles.map((path) => basename(path, ".md").toLowerCase()));
  const { readable, malformed } = readDumps(vault, dumpFiles);
  const findings = [
    ...curated.flatMap((note) => brokenBacklinks(note, dumpTitles)),
    ...deadRoutes(vault, files),
    ...readable.flatMap(staleDump),
    ...readable.flatMap(stuckDump),
    ...curated.filter(({ note }) => !note.startsWith(`${WEEKLY_FOLDER}/`)).flatMap(oversizedNote),
    ...curated.flatMap(duplicateItems),
    ...malformed.map(malformedDump),
  ];
  return findings.sort((a, b) => FINDING_KINDS.indexOf(a.kind) - FINDING_KINDS.indexOf(b.kind) || a.note.localeCompare(b.note));
}

export function renderFinding({ kind, note, detail, fix }: Finding): string {
  return `${kind} · [[${basename(note, ".md")}]] · ${detail} → ${fix}`;
}

function brokenBacklinks({ note, lines }: CuratedNote, dumpTitles: Set<string>): Finding[] {
  return lines.flatMap((line, index) => {
    const link = BACKLINK_LINE.exec(line.trim())?.[1];
    if (link === undefined) return [];
    const target = linkTarget(link);
    if (dumpTitles.has(basename(target).toLowerCase())) return [];
    return [{ kind: "Broken backlink", note, detail: `line ${index + 1}: [[${target}]] is not a Dump`, fix: "hand edit, or restore the Dump" }];
  });
}

/** Routes to a note whose title no note in the allowlist has; Routes to a Todo Group are created on demand, so never dead. */
function deadRoutes(vault: Vault, files: string[]): Finding[] {
  const titles = new Set(files.map(titleKey));
  return readRoutes(vault).flatMap((route) =>
    "title" in route && !titles.has(titleKey(route.title))
      ? [{ kind: "Dead Route" as const, note: ROUTES_NOTE, detail: `${renderRoute(route)} targets no note`, fix: "edit the Routes note" }]
      : [],
  );
}

/** Skipped Items count as open, so a Dump the user keeps skipping goes stale too. */
function staleDump(dump: StoredDump): Finding[] {
  const open = openItems(dump);
  const age = (Date.parse(datePart(now())) - Date.parse(dump.date)) / DAY_MS;
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
function oversizedNote({ note, lines }: CuratedNote): Finding[] {
  const digest = lines.findLastIndex((line) => DIGEST_ID.test(line.trim()));
  const filed = lines.slice(digest + 1).filter((line) => FROM_LINE.test(line.trim())).length;
  if (filed < OVERSIZED_AT) return [];
  const detail = digest === -1 ? `${filed} filed Items and no Digest` : `${filed} filed Items since its latest Digest`;
  return [{ kind: "Oversized note", note, detail, fix: `/consolidate [[${basename(note, ".md")}]]` }];
}

/** Exact matches of the Item's text only, after `itemKey`'s normalising: its Why and backlink are left out, so one Item filed from two Dumps still counts. */
function duplicateItems({ note, lines }: CuratedNote): Finding[] {
  const byKey = new Map<string, string[]>();
  for (const { text } of curatedBullets(lines)) {
    const key = itemKey(text);
    byKey.set(key, [...(byKey.get(key) ?? []), text]);
  }
  return [...byKey.values()]
    .filter((texts) => texts.length > 1)
    .map((texts) => ({ kind: "Duplicate Item", note, detail: `"${texts[0]}" appears ${texts.length} times`, fix: "remove by hand, or leave for the next Digest" }));
}

function malformedDump({ file, problem }: MalformedDump): Finding {
  return { kind: "Malformed Dump", note: file, detail: problem, fix: "hand edit" };
}

/** `readDump` parses only the sections, so the header is checked here. */
function readDumps(vault: Vault, paths: string[]): { readable: StoredDump[]; malformed: MalformedDump[] } {
  const readable: StoredDump[] = [];
  const malformed: MalformedDump[] = [];
  for (const path of paths) {
    const dump = readDumpOrProblem(vault, path);
    if ("problem" in dump) {
      malformed.push(dump);
      continue;
    }
    const problem = headerProblem(dump.lines);
    if (problem === undefined) readable.push(dump);
    else malformed.push({ file: dump.file, problem });
  }
  return { readable, malformed };
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

export function countOf(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
