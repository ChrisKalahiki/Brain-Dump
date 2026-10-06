import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, normalize } from "node:path";
import { BrainDumpError, UsageError } from "./errors.ts";
import { readDump, type StoredDump } from "./inbox.ts";
import type { Vault } from "./vault.ts";

export type ItemOutcome = "filed" | "dropped" | "skipped";

export type FilingPlan = {
  dump: string;
  items: { index: number; outcome: ItemOutcome }[];
  inserts: { note: string; section: string; lines: string[] }[];
};

export type FilingResult = {
  filed: number;
  dropped: number;
  skipped: number;
  movedTo: string | null;
};

const OUTCOMES: readonly ItemOutcome[] = ["filed", "dropped", "skipped"];
const PLAN_SHAPE =
  'expected {"dump": string, "items": [{"index": number, "outcome": "filed"|"dropped"|"skipped"}], "inserts": [{"note": string, "section": string, "lines": string[]}]}';

export function parseFilingPlan(text: string): FilingPlan {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new UsageError("invalid Filing Plan: stdin is not JSON");
  }
  if (!isFilingPlan(value)) throw new UsageError(`invalid Filing Plan: ${PLAN_SHAPE}`);
  return value;
}

function isFilingPlan(value: unknown): value is FilingPlan {
  if (!isRecord(value) || typeof value.dump !== "string") return false;
  const itemsOk =
    Array.isArray(value.items) &&
    value.items.every(
      (item) => isRecord(item) && Number.isInteger(item.index) && OUTCOMES.some((outcome) => outcome === item.outcome),
    );
  const insertsOk =
    Array.isArray(value.inserts) &&
    value.inserts.every(
      (insert) =>
        isRecord(insert) &&
        typeof insert.note === "string" &&
        typeof insert.section === "string" &&
        Array.isArray(insert.lines) &&
        insert.lines.every((line) => typeof line === "string"),
    );
  return itemsOk && insertsOk;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const TICKS: Record<Exclude<ItemOutcome, "skipped">, string> = { filed: "x", dropped: "-" };
const PLACEHOLDER = /^- (\[ \] ?)?$/;
const HEADING = /^#+ /;

/** Validates the whole plan against the Vault, then applies it; nothing is written if any part is invalid. */
export function applyFilingPlan(vault: Vault, plan: FilingPlan): FilingResult {
  const dumpPath = resolveInVault(vault, plan.dump);
  if (normalize(join(dumpPath, "..")) !== vault.inbox) reject(`${plan.dump} is not an unfiled Dump in the Inbox`);
  const dump = readDump(vault, dumpPath);
  const dumpLines = tickItems(dump, plan.items);
  const notes = insertAll(vault, plan.inserts);
  const closing = new Set(plan.items.filter(({ outcome }) => outcome !== "skipped").map(({ index }) => index));
  const stillOpen = dump.items.some((item) => item.state === "open" && !closing.has(item.index));
  const filedPath = join(vault.inbox, "Filed", basename(dumpPath));
  if (!stillOpen && existsSync(filedPath)) reject(`Inbox/Filed already has ${basename(dumpPath)}`);

  for (const [path, lines] of notes) writeFileSync(path, lines.join("\n"));
  writeFileSync(dumpPath, dumpLines.join("\n"));
  let movedTo: string | null = null;
  if (!stillOpen) {
    mkdirSync(join(vault.inbox, "Filed"), { recursive: true });
    renameSync(dumpPath, filedPath);
    movedTo = join("Inbox", "Filed", basename(dumpPath));
  }
  const count = (outcome: ItemOutcome): number => plan.items.filter((item) => item.outcome === outcome).length;
  return { filed: count("filed"), dropped: count("dropped"), skipped: count("skipped"), movedTo };
}

function tickItems(dump: StoredDump, planned: FilingPlan["items"]): string[] {
  const lines = [...dump.lines];
  const seen = new Set<number>();
  for (const { index, outcome } of planned) {
    const item = dump.items.find((candidate) => candidate.index === index);
    if (!item) reject(`${dump.title} has no Item ${index}`);
    if (item.state !== "open") reject(`Item ${index} of ${dump.title} is already ${item.state}`);
    if (seen.has(index)) reject(`Item ${index} appears twice in the plan`);
    seen.add(index);
    if (outcome !== "skipped") lines[item.line] = lines[item.line]?.replace("- [ ]", `- [${TICKS[outcome]}]`) ?? "";
  }
  return lines;
}

function insertAll(vault: Vault, inserts: FilingPlan["inserts"]): Map<string, string[]> {
  const notes = new Map<string, string[]>();
  for (const { note, section, lines } of inserts) {
    const path = resolveInVault(vault, note);
    if (!notes.has(path)) {
      if (!existsSync(path)) reject(`${note} does not exist`);
      notes.set(path, readFileSync(path, "utf8").split("\n"));
    }
    const noteLines = notes.get(path) ?? [];
    for (const line of lines) insertIntoSection(noteLines, note, section, line);
  }
  return notes;
}

function insertIntoSection(lines: string[], note: string, section: string, line: string): void {
  const heading = lines.findIndex((candidate) => HEADING.test(candidate) && candidate.trim().startsWith(section));
  if (heading === -1) reject(`${note} has no "${section}" section`);
  let end = heading + 1;
  while (end < lines.length && lines[end]?.trim() !== "---" && !HEADING.test(lines[end] ?? "")) end++;
  const placeholder = lines.slice(heading + 1, end).findIndex((candidate) => PLACEHOLDER.test(candidate));
  if (placeholder !== -1) {
    lines[heading + 1 + placeholder] = line;
    return;
  }
  let last = end - 1;
  while (last > heading && lines[last]?.trim() === "") last--;
  lines.splice(last + 1, 0, line);
}

function resolveInVault(vault: Vault, relativePath: string): string {
  const path = normalize(join(vault.root, relativePath));
  if (isAbsolute(relativePath) || !path.startsWith(`${vault.root}/`)) reject(`${relativePath} is outside the Vault`);
  return path;
}

function reject(reason: string): never {
  throw new BrainDumpError(`Filing Plan rejected: ${reason}`);
}
