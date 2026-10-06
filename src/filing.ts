import { existsSync, linkSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, normalize, relative } from "node:path";
import { STATE_MARKS } from "./dump-body.ts";
import { BrainDumpError, describeFsError, UsageError } from "./errors.ts";
import { readDump, type StoredDump } from "./inbox.ts";
import { readRoutes, renderRoute, ROUTES_NOTE, type Route } from "./routes.ts";
import { isMondayWeeklyNote, readWeeklyTemplate, WEEKLY_TEMPLATE_NOTE } from "./weekly.ts";
import type { Vault } from "./vault.ts";

/** Where lines go: a note's section, or the end of the note when `section` is absent. */
type Placement = { note: string; section?: string };

export type PlannedItem =
  | ({ index: number; outcome: "filed"; lines: string[] } & Placement)
  | { index: number; outcome: "dropped" | "skipped" };

export type NoteCreation = { note: string } & ({ from: "weekly-template" } | { tags: string[] });

export type FilingPlan = {
  dump: string;
  creates?: NoteCreation[];
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
  'expected {"dump": string, "items": [{"index": number, "outcome": "filed", "note": string, "section"?: string, "lines": string[]} | {"index": number, "outcome": "dropped"|"skipped"}], "inserts": [{"note": string, "section"?: string, "lines": string[]}], "routes"?: [{"key": string, "title": string}], "creates"?: [{"note": string, "from": "weekly-template"} | {"note": string, "tags": string[]}]}';
const PLACEHOLDER = /^- (\[ \] ?)?$/;
const TAG = /^[^\s#]+$/;
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
  for (const creation of plan.creates ?? []) notes.create(creation);
  for (const item of plan.items) if (item.outcome === "filed") notes.insert(item, item.lines);
  for (const insert of plan.inserts) notes.insert(insert, insert.lines);
  const newRoutes = unknownRoutes(vault, plan.routes ?? []);
  if (newRoutes.length > 0) notes.insert({ note: ROUTES_NOTE }, newRoutes.map(renderRoute), { create: true });
  notes.requireCreatedNotesUsed();

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

function unknownRoutes(vault: Vault, routes: Route[]): Route[] {
  const known = new Set(readRoutes(vault).map(renderRoute));
  return routes.filter((route) => {
    const line = renderRoute(route);
    if (known.has(line)) return false;
    known.add(line);
    return true;
  });
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

type EditedNote = { lines: string[]; eol: string; isNew: boolean; used: boolean };

class NoteEdits {
  private readonly notes = new Map<string, EditedNote>();

  constructor(private readonly vault: Vault) {}

  create(creation: NoteCreation): void {
    const path = resolveInVault(this.vault, creation.note);
    if (!path.endsWith(".md")) reject(`${creation.note} is not a Markdown note`);
    if (existsSync(path) || this.notes.has(path)) reject(`${creation.note} already exists`);
    const contents = "from" in creation ? this.weeklyTemplate(creation.note) : renderTagsFrontmatter(creation.tags);
    this.notes.set(path, { ...splitLines(contents), isNew: true, used: false });
  }

  requireCreatedNotesUsed(): void {
    for (const [path, { isNew, used }] of this.notes) {
      if (isNew && !used) reject(`${relative(this.vault.root, path)} would be created with nothing filed into it`);
    }
  }

  insert({ note, section }: Placement, block: string[], { create = false } = {}): void {
    const edited = this.load(note, create);
    edited.used = true;
    const { lines } = edited;
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

  /** Stages every note as a temporary file, then creates new notes (never overwriting, rolled back together on failure), then replaces existing ones. */
  write(): void {
    const staged = [...this.notes].map(([path, { lines, eol, isNew }]) => {
      mkdirSync(dirname(path), { recursive: true });
      const temporary = `${path}.brain-dump-tmp`;
      writeFileSync(temporary, lines.join(eol));
      return { path, temporary, isNew };
    });
    const created: string[] = [];
    try {
      for (const { path, temporary, isNew } of staged) {
        if (!isNew) continue;
        linkSync(temporary, path);
        created.push(path);
      }
      for (const { path, temporary, isNew } of staged) if (!isNew) renameSync(temporary, path);
    } catch (error) {
      for (const path of created) unlinkSync(path);
      throw new BrainDumpError(`could not write the notes: ${describeFsError(error)}`);
    } finally {
      for (const { temporary } of staged) if (existsSync(temporary)) unlinkSync(temporary);
    }
  }

  private weeklyTemplate(note: string): string {
    if (!isMondayWeeklyNote(note)) reject(`${note} is not a Monday Weekly Note in Research/Weekly Meetings`);
    const template = readWeeklyTemplate(this.vault);
    if (template === undefined) reject(`the Weekly Note template ${WEEKLY_TEMPLATE_NOTE} does not exist`);
    return template;
  }

  private load(note: string, create: boolean): EditedNote {
    const path = resolveInVault(this.vault, note);
    const loaded = this.notes.get(path);
    if (loaded) return loaded;
    const exists = existsSync(path);
    if (!exists && !create) reject(`${note} does not exist`);
    const fresh = { ...splitLines(exists ? readFileSync(path, "utf8") : ""), isNew: !exists, used: false };
    this.notes.set(path, fresh);
    return fresh;
  }
}

function splitLines(contents: string): { lines: string[]; eol: string } {
  const eol = contents.includes("\r\n") ? "\r\n" : "\n";
  return { lines: contents.split(eol), eol };
}

function renderTagsFrontmatter(tags: string[]): string {
  return tags.length === 0 ? "" : `---\ntags:\n${tags.map((tag) => `  - ${tag}\n`).join("")}---\n`;
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
  const createsOk = value.creates === undefined || (Array.isArray(value.creates) && value.creates.every(isNoteCreation));
  const routesOk = value.routes === undefined || (Array.isArray(value.routes) && value.routes.every(isRoute));
  return Array.isArray(value.items) && value.items.every(isPlannedItem) && Array.isArray(value.inserts) && value.inserts.every(hasPlacedLines) && routesOk && createsOk;
}

function isNoteCreation(value: unknown): boolean {
  if (!isRecord(value) || typeof value.note !== "string") return false;
  if (value.from !== undefined) return value.from === "weekly-template" && value.tags === undefined;
  return Array.isArray(value.tags) && value.tags.every((tag) => typeof tag === "string" && TAG.test(tag));
}

function isPlannedItem(value: unknown): boolean {
  if (!isRecord(value) || !Number.isInteger(value.index)) return false;
  if (value.outcome === "dropped" || value.outcome === "skipped") return true;
  return value.outcome === "filed" && hasPlacedLines(value);
}

function hasPlacedLines(value: unknown): boolean {
  return isRecord(value) && isPlacement(value) && isLines(value.lines);
}

function isPlacement(value: Record<string, unknown>): boolean {
  return typeof value.note === "string" && (value.section === undefined || typeof value.section === "string");
}

function isLines(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.every((line) => typeof line === "string");
}

function isRoute(value: unknown): boolean {
  return isRecord(value) && typeof value.key === "string" && value.key.trim() !== "" && typeof value.title === "string" && value.title.trim() !== "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function reject(reason: string): never {
  throw new BrainDumpError(`Filing Plan rejected: ${reason}`);
}
