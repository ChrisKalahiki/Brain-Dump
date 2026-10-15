import { basename, dirname } from "node:path";
import { checkVault, countOf } from "./check.ts";
import { now } from "./clock.ts";
import { BrainDumpError, errnoCode } from "./errors.ts";
import { INBOX } from "./layout.ts";
import { titleKey } from "./notes.ts";
import { readRoutes, type Route } from "./routes.ts";
import { lastSweep, type SweepSummary } from "./sweep.ts";
import { readVaultItems, type VaultItem, type VaultItems } from "./vault-items.ts";
import { findVault, type Vault } from "./vault.ts";

// The SessionStart pointer: at most a line naming this project's Vault notes, a line on the last Sweep and a line with the `check` count, so a Session knows the Vault has context.

const DEADLINE_MS = 1000;
const DEADLINE_VARIABLE = "BRAIN_DUMP_POINTER_DEADLINE_MS";
const NOTE_CAP = 3;
/** How long after a Sweep the pointer names it. */
const SWEEP_REPORT_MS = 24 * 60 * 60 * 1000;

/** The notes line first, then the Sweep line, then the `check` line only if time remains; anything that fails or ends past the deadline is left out. */
export function pointerLines(project: string): string[] {
  const deadline = pointerDeadline();
  const inTime = (): boolean => performance.now() <= deadline;
  const vault = quietly(findVault);
  if (vault === undefined) return [];
  const lines: string[] = [];
  const read = quietly(() => readVaultItems(vault));
  const notesLine = read && quietly(() => projectLine(vault, read, project));
  if (notesLine !== undefined && inTime()) lines.push(notesLine);
  const sweptLine = quietly(() => sweepLine(lastSweep(), now()));
  if (sweptLine !== undefined && inTime()) lines.push(sweptLine);
  if (!inTime()) return lines;
  const findings = read && quietly(() => checkVault(vault, read).length);
  if (findings && inTime()) lines.push(`brain-dump: ${countOf(findings, "Vault finding")} (run brain-dump check)`);
  return lines;
}

/** Milliseconds since the process started, so Bun's own startup counts against the budget. `BRAIN_DUMP_POINTER_DEADLINE_MS` lets tests force a miss. */
function pointerDeadline(): number {
  const override = process.env[DEADLINE_VARIABLE]?.trim();
  return override && Number.isFinite(Number(override)) ? Number(override) : DEADLINE_MS;
}

/** A missing or unreadable Vault leaves its line out rather than failing Session start; anything else is a bug and is left to surface. */
function quietly<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch (error) {
    if (error instanceof BrainDumpError || errnoCode(error) !== undefined) return undefined;
    throw error;
  }
}

function projectLine(vault: Vault, { items, dumps, files }: VaultItems, project: string): string | undefined {
  const notes = projectNotes(vault, project, items, files);
  const unfiled = dumps.filter((dump) => dump.project === project && dirname(dump.file) === INBOX).length;
  const segments: string[] = [];
  if (notes.length > 0) segments.push(`Vault notes for ${project}: ${notes.join(", ")}`);
  if (unfiled > 0) segments.push(`${countOf(unfiled, "unfiled Dump")}${notes.length === 0 ? ` for ${project}` : ""}`);
  if (segments.length === 0) return undefined;
  return `brain-dump: ${[...segments, "use the recall skill for more"].join(" · ")}`;
}

/** The project's Route target if it exists, then the notes holding the most Items backlinked to its Dumps. Keys and titles match whole, ignoring case as Obsidian does, never by guessing. */
function projectNotes(vault: Vault, project: string, items: VaultItem[], files: string[]): string[] {
  const titles = new Set(files.map(titleKey));
  const route = readRoutes(vault).find((candidate): candidate is Extract<Route, { title: string }> => "title" in candidate && candidate.key.toLowerCase() === project.toLowerCase());
  const routed = route !== undefined && titles.has(titleKey(route.title)) ? route.title : undefined;
  const itemCounts = new Map<string, number>();
  for (const { note, state, backlinked, dump } of items) {
    if (state === "filed" && backlinked && dump?.project === project) itemCounts.set(note, (itemCounts.get(note) ?? 0) + 1);
  }
  const ranked = [...itemCounts]
    .map(([note, itemCount]) => ({ title: basename(note, ".md"), itemCount }))
    .filter(({ title }) => routed === undefined || titleKey(title) !== titleKey(routed))
    .sort((a, b) => b.itemCount - a.itemCount || a.title.localeCompare(b.title))
    .map(({ title, itemCount }) => `[[${title}]] (${countOf(itemCount, "Item")})`);
  return [...(routed === undefined ? [] : [`[[${routed}]] (Route)`]), ...ranked].slice(0, NOTE_CAP);
}

/** Only a Sweep in the window that wrote a Dump or hit a problem; carry-over alone is the cap working, not a problem. */
function sweepLine(last: SweepSummary, at: Date): string | undefined {
  const age = at.getTime() - new Date(last.time).getTime();
  if (age < 0 || age > SWEEP_REPORT_MS) return undefined;
  const segments: string[] = [];
  if (last.written.length > 0) segments.push(`${countOf(last.written.length, "Dump")} written to the Inbox`);
  if (last.unreadable.length > 0) segments.push(countOf(last.unreadable.length, "unreadable log"));
  if (last.secretRefused.length > 0) segments.push(`${countOf(last.secretRefused.length, "draft")} refused for a secret`);
  if (last.errors.length > 0) segments.push(countOf(last.errors.length, "error"));
  if (segments.length === 0) return undefined;
  if (last.carriedOver.length > 0) segments.push(`${last.carriedOver.length} carried over`);
  return `brain-dump: last Sweep: ${segments.join(", ")} (run brain-dump sweep --last)`;
}
