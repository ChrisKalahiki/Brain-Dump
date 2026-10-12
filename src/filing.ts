import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, normalize, relative } from "node:path";
import type { ClosedMark } from "./append-only.ts";
import { contentHash, readHashed } from "./content-hash.ts";
import { STATE_MARKS } from "./dump-body.ts";
import { BrainDumpError, UsageError } from "./errors.ts";
import { commit, type Write } from "./gateway.ts";
import { nearDuplicateFinder } from "./duplicates.ts";
import { listUnfiledDumps, readDump, type StoredDump } from "./inbox.ts";
import { FILED_FOLDER, ROUTES_NOTE, WEEKLY_FOLDER, WEEKLY_TEMPLATE_NOTE } from "./layout.ts";
import { titleKey } from "./notes.ts";
import { readRoutes, renderRoute, routeIdentity, type Route } from "./routes.ts";
import { findSection } from "./sections.ts";
import { formatGroupPath, parseTodoGroups, pathKey, resolveGroupPath, type GroupNode, type GroupPath } from "./todo-groups.ts";
import { isMondayWeeklyNote, readWeeklyTemplate } from "./weekly.ts";
import type { Vault } from "./vault.ts";

/** Where lines go: a note's section, or the end of the note when `section` is absent. */
type Placement = { note: string; section?: string };

export type PlannedItem =
  | ({ index: number; outcome: "filed"; lines: string[]; group?: GroupPath; /** The key of the Route a Routine Item's destination came from. */ route?: string } & Placement)
  | { index: number; outcome: "dropped" | "skipped" };

export type NoteCreation = { note: string } & ({ from: "weekly-template" } | { tags: string[] });

export type FilingPlan = {
  dump: string;
  /** The hash each existing file the plan writes had when the agent read it, by Vault-relative path. */
  expect: Record<string, string>;
  creates?: NoteCreation[];
  items: PlannedItem[];
  inserts: (Placement & { lines: string[] })[];
  routes?: Route[];
  createGroups?: GroupPath[];
  confirmLarge?: boolean;
};

export type FilingResult = {
  filed: number;
  dropped: number;
  skipped: number;
  movedTo: string | null;
  /** The hash of every file the plan wrote, by Vault-relative path, for later plans in the same run to expect. */
  hashes: Record<string, string>;
};

const PLAN_SHAPE =
  'expected {"dump": string, "expect": {[path: string]: string}, "items": [{"index": number, "outcome": "filed", "note": string, "section"?: string, "group"?: string[], "lines": string[], "route"?: string} | {"index": number, "outcome": "dropped"|"skipped"}], "inserts": [{"note": string, "section"?: string, "lines": string[]}], "routes"?: [{"key": string, "title": string} | {"key": string, "group": string[]}], "creates"?: [{"note": string, "from": "weekly-template"} | {"note": string, "tags": string[]}], "createGroups"?: string[][], "confirmLarge"?: boolean}';
const CLOSED_MARKS: Record<"filed" | "dropped", ClosedMark> = { filed: "x", dropped: "-" };
const PLACEHOLDER = /^- (\[ \] ?)?$/;
const TAG = /^[^\s#]+$/;

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
  const newRoutes = unknownRoutes(vault, plan.routes ?? []);
  checkFresh(vault, plan, newRoutes.length > 0);
  const dump = readDump(vault, dumpPath);
  checkRoutineItems(vault, dump, plan.items);
  const dumpLines = markItems(dump, plan.items);
  const notes = new NoteEdits(vault);
  const groups = plannedGroups(plan);
  for (const creation of plan.creates ?? []) notes.create(creation);
  for (const item of plan.items) {
    if (item.outcome !== "filed") continue;
    if (item.group === undefined) notes.insert(item, item.lines);
    else notes.insertInGroup(item, item.group, item.lines, groups);
  }
  for (const insert of plan.inserts) notes.insert(insert, insert.lines);
  if (newRoutes.length > 0) notes.insert({ note: ROUTES_NOTE }, newRoutes.map(renderRoute), { create: true });
  notes.requireCreatedNotesUsed();

  const closed = new Set(plan.items.filter(({ outcome }) => outcome !== "skipped").map(({ index }) => index));
  const finished = dump.items.every((item) => item.state !== "open" || closed.has(item.index));
  const filedPath = join(vault.root, FILED_FOLDER, basename(dumpPath));
  if (finished && existsSync(filedPath)) reject(`${FILED_FOLDER} already has ${basename(dumpPath)}`);

  const lineOf = new Map(dump.items.map((item) => [item.index, item.line]));
  const planned = new Map(
    plan.items.flatMap(({ index, outcome }): [number, ClosedMark][] => {
      const line = lineOf.get(index);
      return outcome === "skipped" || line === undefined ? [] : [[line, CLOSED_MARKS[outcome]]];
    }),
  );
  const filedDump: Write = { mode: "file-dump", path: dumpPath, contents: dumpLines.join(dump.eol), planned, moveTo: finished ? filedPath : undefined };
  const writes = [...notes.writes(), filedDump];
  commit(vault, "approved-plan", { command: "apply", label: dump.title }, writes, { confirmLarge: plan.confirmLarge });
  const count = (outcome: PlannedItem["outcome"]): number => plan.items.filter((item) => item.outcome === outcome).length;
  const hashes = Object.fromEntries(writes.map((write) => [relative(vault.root, (write.mode === "file-dump" && write.moveTo) || write.path), contentHash(write.contents)]));
  return { filed: count("filed"), dropped: count("dropped"), skipped: count("skipped"), movedTo: finished ? relative(vault.root, filedPath) : null, hashes };
}

/** Every existing file the plan writes needs the hash it had when the agent read it; if any changed since, the whole plan is refused before anything is staged. */
function checkFresh(vault: Vault, plan: FilingPlan, writesRoutes: boolean): void {
  const expected = new Map(Object.entries(plan.expect).map(([note, hash]) => [resolveInVault(vault, note), hash]));
  const created = new Set((plan.creates ?? []).map(({ note }) => resolveInVault(vault, note)));
  const filed = plan.items.flatMap((item) => (item.outcome === "filed" ? [item.note] : []));
  const notes = [plan.dump, ...filed, ...plan.inserts.map(({ note }) => note), ...(writesRoutes ? [ROUTES_NOTE] : [])];
  const written = new Map(notes.map((note) => [resolveInVault(vault, note), note]));
  const routesPath = resolveInVault(vault, ROUTES_NOTE);
  const stale: string[] = [];
  const unpinned: string[] = [];
  for (const [path, note] of written) {
    if (created.has(path)) continue;
    const current = existsSync(path) ? readHashed(path).hash : undefined;
    const hash = expected.get(path);
    // The Routes note is created on demand, so having no hash for it means it didn't exist when the agent read it.
    if (hash === undefined && current !== undefined) (path === routesPath ? stale : unpinned).push(note);
    if (hash !== undefined && hash !== current) stale.push(note);
  }
  if (stale.length > 0) throw new BrainDumpError(`Filing Plan stale: ${listInEnglish(stale)} changed since it was read`);
  if (unpinned.length > 0) reject(`expect has no hash for ${listInEnglish(unpinned)}`);
}

/** A Routine Item's destination must come from a Route already in the Routes note and already exist, and the Item must have no near-duplicate; anything else is a skill mislabelling an Item as routine. */
function checkRoutineItems(vault: Vault, dump: StoredDump, items: PlannedItem[]): void {
  const routes = readRoutes(vault);
  let nearest: ReturnType<typeof nearDuplicateFinder> | undefined;
  for (const item of items) {
    if (item.outcome !== "filed" || item.route === undefined) continue;
    const claim = `Item ${item.index} claims Route "${item.route}"`;
    const keyed = routes.filter(({ key }) => key === item.route);
    if (keyed.length === 0) reject(`${claim}, which the Routes note doesn't have`);
    const destination = item.group === undefined ? `[[${basename(item.note, ".md")}]]` : `To-Do › ${formatGroupPath(item.group)}`;
    if (!keyed.some((route) => routesTo(route, item))) reject(`${claim}, which doesn't point at ${destination}`);
    if (isNewDestination(vault, item)) reject(`${claim}, but ${destination} doesn't exist yet${item.group === undefined ? "" : ` in ${item.note}`}`);
    const stored = dump.items.find(({ index }) => index === item.index);
    nearest ??= nearDuplicateFinder(vault, listUnfiledDumps(vault));
    const similar = stored && nearest(dump, stored);
    if (similar) reject(`${claim}, but it nearly duplicates "${similar.text}" in [[${basename(similar.note, ".md")}]]`);
  }
}

function routesTo(route: Route, { note, group }: { note: string; group?: GroupPath }): boolean {
  if ("title" in route) return group === undefined && titleKey(route.title) === titleKey(note);
  return group !== undefined && isMondayWeeklyNote(note) && pathKey(route.group) === pathKey(group);
}

/** Judged against the Vault as read, so a note or group this plan creates counts as new. A missing section or ambiguous group is left to the edit, which names it precisely. */
function isNewDestination(vault: Vault, { note, section, group }: Placement & { group?: GroupPath }): boolean {
  const path = resolveInVault(vault, note);
  if (!existsSync(path)) return true;
  if (group === undefined || section === undefined) return false;
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  const bounds = findSection(lines, section);
  return bounds !== undefined && resolveGroupPath(parseTodoGroups(lines, bounds.start, bounds.end), group).kind === "missing";
}

/** The Todo Groups the plan may create: each `createGroups` path and every group along it. Rejects a path no filed Todo goes into. */
function plannedGroups(plan: FilingPlan): PlannedGroups {
  const listed = plan.createGroups ?? [];
  const targets = plan.items.flatMap((item) => (item.outcome === "filed" && item.group ? [item.group] : []));
  for (const path of listed) {
    const used = targets.some((target) => pathKey(target.slice(0, path.length)) === pathKey(path));
    if (!used) reject(`Todo Group "${formatGroupPath(path)}" would be created with nothing filed into it`);
  }
  return {
    listed: new Set(listed.map(pathKey)),
    creatable: new Set(listed.flatMap((path) => path.map((_, depth) => pathKey(path.slice(0, depth + 1))))),
  };
}

function unknownRoutes(vault: Vault, routes: Route[]): Route[] {
  const known = new Set(readRoutes(vault).map(routeIdentity));
  return routes.filter((route) => {
    const identity = routeIdentity(route);
    if (known.has(identity)) return false;
    known.add(identity);
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

type PlannedGroups = { listed: Set<string>; creatable: Set<string> };

/** `original` is the note as read, so rejections can name its own line numbers after earlier edits shift them. */
type EditedNote = { lines: string[]; original: string[]; eol: string; isNew: boolean; used: boolean };

class NoteEdits {
  private readonly notes = new Map<string, EditedNote>();
  private readonly createdGroups = new Set<string>();

  constructor(private readonly vault: Vault) {}

  create(creation: NoteCreation): void {
    const path = resolveInVault(this.vault, creation.note);
    if (!path.endsWith(".md")) reject(`${creation.note} is not a Markdown note`);
    if (existsSync(path) || this.notes.has(path)) reject(`${creation.note} already exists`);
    const contents = "from" in creation ? this.weeklyTemplate(creation.note) : renderTagsFrontmatter(creation.tags);
    const split = splitLines(contents);
    this.notes.set(path, { ...split, original: split.lines, isNew: true, used: false });
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
      const bounds = findSection(lines, section);
      if (bounds === undefined) reject(`${note} has no "${section}" section`);
      ({ start, end } = bounds);
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

  /** Adds `block` after the group's last direct Todo, or right under the group bullet when it has none, indented one level below the group. */
  insertInGroup({ note, section }: Placement, path: GroupPath, block: string[], { listed, creatable }: PlannedGroups): void {
    const edited = this.load(note, false);
    edited.used = true;
    const { lines, original } = edited;
    const sectionGroups = (source: string[]): GroupNode => {
      const bounds = section === undefined ? undefined : findSection(source, section);
      if (bounds === undefined) reject(`${note} has no "${section}" section`);
      return parseTodoGroups(source, bounds.start, bounds.end);
    };
    const createdKey = (depth: number): string => `${note}\0${pathKey(path.slice(0, depth + 1))}`;
    for (const depth of path.keys()) {
      const prefix = path.slice(0, depth + 1);
      const listedAndExisting = listed.has(pathKey(prefix)) && !this.createdGroups.has(createdKey(depth)) && resolveGroupPath(sectionGroups(lines), prefix).kind === "found";
      if (listedAndExisting) reject(`Todo Group "${formatGroupPath(prefix)}" already exists in ${note}`);
    }
    for (;;) {
      const root = sectionGroups(lines);
      const lookup = resolveGroupPath(root, path);
      if (lookup.kind === "ambiguous") {
        const inOriginal = resolveGroupPath(sectionGroups(original), path);
        const matched = inOriginal.kind === "ambiguous" ? inOriginal.lines : lookup.lines;
        reject(`"${formatGroupPath(path.slice(0, lookup.depth + 1))}" matches lines ${listInEnglish(matched.map((line) => String(line + 1)))} of ${note}`);
      }
      if (lookup.kind === "found") {
        const indent = "\t".repeat(lookup.group.level + 1);
        lines.splice(lookup.group.todoEnd, 0, ...block.map((line) => indent + line));
        return;
      }
      const { depth, parent } = lookup;
      if (!creatable.has(pathKey(path.slice(0, depth + 1)))) reject(`${note} has no Todo Group "${formatGroupPath(path.slice(0, depth + 1))}"`);
      for (let created = depth; created < path.length; created++) this.createdGroups.add(createdKey(created));
      const bullet = `${"\t".repeat(parent.level + 1)}- ${path[depth]}`;
      const placeholder = parent === root && root.children.length === 0 ? lines.slice(root.line + 1, root.blockEnd).findIndex((line) => PLACEHOLDER.test(line)) : -1;
      if (placeholder === -1) lines.splice(parent.blockEnd, 0, bullet);
      else lines.splice(root.line + 1 + placeholder, 1, bullet);
    }
  }

  writes(): Extract<Write, { mode: "create" | "append" }>[] {
    return [...this.notes].map(([path, { lines, eol, isNew }]) => ({ mode: isNew ? "create" : "append", path, contents: lines.join(eol) }));
  }

  private weeklyTemplate(note: string): string {
    if (!isMondayWeeklyNote(note)) reject(`${note} is not a Monday Weekly Note in ${WEEKLY_FOLDER}`);
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
    const split = splitLines(exists ? readFileSync(path, "utf8") : "");
    const fresh = { ...split, original: [...split.lines], isNew: !exists, used: false };
    this.notes.set(path, fresh);
    return fresh;
  }
}

function listInEnglish(items: string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function splitLines(contents: string): { lines: string[]; eol: string } {
  const eol = contents.includes("\r\n") ? "\r\n" : "\n";
  return { lines: contents.split(eol), eol };
}

function renderTagsFrontmatter(tags: string[]): string {
  return tags.length === 0 ? "" : `---\ntags:\n${tags.map((tag) => `  - ${tag}\n`).join("")}---\n`;
}

function resolveInVault(vault: Vault, relativePath: string): string {
  const path = normalize(join(vault.root, relativePath));
  if (isAbsolute(relativePath) || !path.startsWith(`${vault.root}/`)) reject(`${relativePath} is outside the Vault`);
  return path;
}

function isFilingPlan(value: unknown): value is FilingPlan {
  if (!isRecord(value) || typeof value.dump !== "string") return false;
  const expectOk = isRecord(value.expect) && Object.values(value.expect).every((hash) => typeof hash === "string");
  const createsOk = value.creates === undefined || (Array.isArray(value.creates) && value.creates.every(isNoteCreation));
  const routesOk = value.routes === undefined || (Array.isArray(value.routes) && value.routes.every(isRoute));
  const groupsOk = value.createGroups === undefined || (Array.isArray(value.createGroups) && value.createGroups.every(isGroupPath));
  const confirmLargeOk = value.confirmLarge === undefined || typeof value.confirmLarge === "boolean";
  return expectOk && Array.isArray(value.items) && value.items.every(isPlannedItem) && Array.isArray(value.inserts) && value.inserts.every(hasPlacedLines) && routesOk && createsOk && groupsOk && confirmLargeOk;
}

function isNoteCreation(value: unknown): boolean {
  if (!isRecord(value) || typeof value.note !== "string") return false;
  if (value.from !== undefined) return value.from === "weekly-template" && value.tags === undefined;
  return Array.isArray(value.tags) && value.tags.every((tag) => typeof tag === "string" && TAG.test(tag));
}

function isPlannedItem(value: unknown): boolean {
  if (!isRecord(value) || !Number.isInteger(value.index)) return false;
  if (value.outcome === "dropped" || value.outcome === "skipped") return true;
  const groupOk = value.group === undefined || (isGroupPath(value.group) && typeof value.section === "string");
  const routeOk = value.route === undefined || (typeof value.route === "string" && value.route.trim() !== "");
  return value.outcome === "filed" && hasPlacedLines(value) && groupOk && routeOk;
}

function isGroupPath(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.every((name) => typeof name === "string" && name.trim() !== "");
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
  if (!isRecord(value) || typeof value.key !== "string" || value.key.trim() === "") return false;
  if (value.group !== undefined) return value.title === undefined && isGroupPath(value.group);
  return typeof value.title === "string" && value.title.trim() !== "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function reject(reason: string): never {
  throw new BrainDumpError(`Filing Plan rejected: ${reason}`);
}
