import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, normalize, relative } from "node:path";
import { STATE_MARKS } from "./dump-body.ts";
import { BrainDumpError, UsageError } from "./errors.ts";
import { readDump, type StoredDump } from "./inbox.ts";
import { renderRoute, ROUTES_NOTE, type Route } from "./routes.ts";
import type { Vault } from "./vault.ts";

/** Where lines go: a note's section, or the end of the note when `section` is absent. */
type Placement = { note: string; section?: string };

export type PlannedItem =
  | ({ index: number; outcome: "filed"; lines: string[] } & Placement)
  | { index: number; outcome: "dropped" | "skipped" };

export type FilingPlan = {
  dump: string;
  items: PlannedItem[];
  inserts: (Placement & { lines: string[] })[];
  routes?: Route[];
};

export type FilingResult = {
  filed: number;
  dropped: number;
  skipped: number;
  movedTo: string | null;
};

const PLAN_SHAPE =
  'expected {"dump": string, "items": [{"index": number, "outcome": "filed", "note": string, "section"?: string, "lines": string[]} | {"index": number, "outcome": "dropped"|"skipped"}], "inserts": [{"note": string, "section"?: string, "lines": string[]}], "routes"?: [{"key": string, "note": string}]}';
const PLACEHOLDER = /^- (\[ \] ?)?$/;
const HEADING = /^(#+) /;

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

/** Validates the whole plan against the Vault, then writes notes before the Dump, so an interrupted apply can only duplicate a line on the next run, never lose one. */
export function applyFilingPlan(vault: Vault, plan: FilingPlan): FilingResult {
  const dumpPath = resolveInVault(vault, plan.dump);
  if (dirname(dumpPath) !== vault.inbox) reject(`${plan.dump} is not an unfiled Dump in the Inbox`);
  const dump = readDump(vault, dumpPath);
  const dumpLines = markItems(dump, plan.items);
  const notes = new NoteEdits(vault);
  for (const item of plan.items) if (item.outcome === "filed") notes.insert(item, item.lines);
  for (const insert of plan.inserts) notes.insert(insert, insert.lines);
  if (plan.routes?.length) notes.insert({ note: ROUTES_NOTE }, plan.routes.map(renderRoute), { create: true });

  const closed = new Set(plan.items.filter(({ outcome }) => outcome !== "skipped").map(({ index }) => index));
  const finished = dump.items.every((item) => item.state !== "open" || closed.has(item.index));
  const filedFolder = join(vault.inbox, "Filed");
  const filedPath = join(filedFolder, basename(dumpPath));
  if (finished && existsSync(filedPath)) reject(`Inbox/Filed already has ${basename(dumpPath)}`);

  notes.write();
  replaceFile(dumpPath, dumpLines.join(dump.eol));
  if (finished) {
    mkdirSync(filedFolder, { recursive: true });
    renameSync(dumpPath, filedPath);
  }
  const count = (outcome: PlannedItem["outcome"]): number => plan.items.filter((item) => item.outcome === outcome).length;
  return { filed: count("filed"), dropped: count("dropped"), skipped: count("skipped"), movedTo: finished ? relative(vault.root, filedPath) : null };
}

function markItems(dump: StoredDump, planned: PlannedItem[]): string[] {
  const lines = [...dump.lines];
  const seen = new Set<number>();
  for (const { index, outcome } of planned) {
    const item = dump.items.find((candidate) => candidate.index === index);
    if (!item) reject(`${dump.title} has no Item ${index}`);
    if (item.state !== "open") reject(`Item ${index} of ${dump.title} is already ${item.state}`);
    if (seen.has(index)) reject(`Item ${index} appears twice in the plan`);
    seen.add(index);
    if (outcome !== "skipped") lines[item.line] = `- [${STATE_MARKS[outcome]}]${(lines[item.line] ?? "").slice("- [ ]".length)}`;
  }
  return lines;
}

class NoteEdits {
  private readonly notes = new Map<string, { lines: string[]; eol: string }>();

  constructor(private readonly vault: Vault) {}

  insert({ note, section }: Placement, block: string[], { create = false } = {}): void {
    const { lines } = this.load(note, create);
    let start = -1;
    let end = lines.length;
    if (section !== undefined) {
      start = lines.findIndex((candidate) => isHeading(candidate, section));
      if (start === -1) reject(`${note} has no "${section}" section`);
      const level = HEADING.exec(lines[start] ?? "")?.[1]?.length ?? 1;
      end = start + 1;
      while (end < lines.length && !endsSection(lines[end] ?? "", level)) end++;
      const placeholder = lines.slice(start + 1, end).findIndex((candidate) => PLACEHOLDER.test(candidate));
      if (placeholder !== -1) {
        lines.splice(start + 1 + placeholder, 1, ...block);
        return;
      }
    }
    let last = end - 1;
    while (last > start && lines[last]?.trim() === "") last--;
    lines.splice(last + 1, 0, ...block);
  }

  write(): void {
    for (const [path, { lines, eol }] of this.notes) replaceFile(path, lines.join(eol));
  }

  private load(note: string, create: boolean): { lines: string[]; eol: string } {
    const path = resolveInVault(this.vault, note);
    const loaded = this.notes.get(path);
    if (loaded) return loaded;
    if (!existsSync(path) && !create) reject(`${note} does not exist`);
    const contents = existsSync(path) ? readFileSync(path, "utf8") : "";
    const eol = contents.includes("\r\n") ? "\r\n" : "\n";
    const fresh = { lines: contents.split(eol), eol };
    this.notes.set(path, fresh);
    return fresh;
  }
}

function isHeading(line: string, section: string): boolean {
  const trimmed = line.trim();
  return HEADING.test(trimmed) && (trimmed === section || trimmed.startsWith(`${section} `));
}

function endsSection(line: string, level: number): boolean {
  const heading = HEADING.exec(line);
  return line.trim() === "---" || (heading?.[1] !== undefined && heading[1].length <= level);
}

function replaceFile(path: string, contents: string): void {
  const temporary = `${path}.brain-dump-tmp`;
  writeFileSync(temporary, contents);
  renameSync(temporary, path);
}

function resolveInVault(vault: Vault, relativePath: string): string {
  const path = normalize(join(vault.root, relativePath));
  if (isAbsolute(relativePath) || !path.startsWith(`${vault.root}/`)) reject(`${relativePath} is outside the Vault`);
  return path;
}

function isFilingPlan(value: unknown): value is FilingPlan {
  if (!isRecord(value) || typeof value.dump !== "string") return false;
  const routesOk = value.routes === undefined || (Array.isArray(value.routes) && value.routes.every(isRoute));
  return Array.isArray(value.items) && value.items.every(isPlannedItem) && Array.isArray(value.inserts) && value.inserts.every(isInsert) && routesOk;
}

function isPlannedItem(value: unknown): boolean {
  if (!isRecord(value) || !Number.isInteger(value.index)) return false;
  if (value.outcome === "dropped" || value.outcome === "skipped") return true;
  return value.outcome === "filed" && isInsert(value);
}

function isInsert(value: unknown): boolean {
  return isRecord(value) && isPlacement(value) && isLines(value.lines);
}

function isPlacement(value: Record<string, unknown>): boolean {
  return typeof value.note === "string" && (value.section === undefined || typeof value.section === "string");
}

function isLines(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.every((line) => typeof line === "string");
}

function isRoute(value: unknown): boolean {
  return isRecord(value) && typeof value.key === "string" && value.key.trim() !== "" && typeof value.note === "string" && value.note.trim() !== "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function reject(reason: string): never {
  throw new BrainDumpError(`Filing Plan rejected: ${reason}`);
}
