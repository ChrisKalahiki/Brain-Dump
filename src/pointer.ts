import { basename, dirname } from "node:path";
import { checkVault, countOf } from "./check.ts";
import { curatedBullets, curatedNotes } from "./curated.ts";
import { BrainDumpError, errnoCode } from "./errors.ts";
import { isStoredDump, readDumpOrProblem, type StoredDump } from "./inbox.ts";
import { INBOX } from "./layout.ts";
import { linkTarget, noteFiles } from "./notes.ts";
import { describeDump } from "./recall.ts";
import { readRoutes } from "./routes.ts";
import { findVault, type Vault } from "./vault.ts";

// The SessionStart pointer: at most a line naming this project's Vault notes and a line with the `check` count, so a Session knows the Vault has context.

const DEADLINE_MS = 1000;
const DEADLINE_VARIABLE = "BRAIN_DUMP_POINTER_DEADLINE_MS";
const NOTE_CAP = 3;

/** The notes line first, then the `check` line only if time remains; anything that fails or ends past the deadline is left out. */
export function pointerLines(project: string): string[] {
  const deadline = pointerDeadline();
  const inTime = (): boolean => performance.now() <= deadline;
  const vault = quietly(findVault);
  if (vault === undefined) return [];
  const lines: string[] = [];
  const notesLine = quietly(() => projectLine(vault, project));
  if (notesLine !== undefined && inTime()) lines.push(notesLine);
  if (!inTime()) return lines;
  const findings = quietly(() => checkVault(vault).length);
  if (findings && inTime()) lines.push(`brain-dump: ${countOf(findings, "Vault finding")} (run brain-dump check)`);
  return lines;
}

/** Milliseconds since the process started, so Bun's own startup counts against the budget. `BRAIN_DUMP_POINTER_DEADLINE_MS` lets tests force a miss. */
function pointerDeadline(): number {
  const override = Number(process.env[DEADLINE_VARIABLE]);
  return process.env[DEADLINE_VARIABLE] === undefined || Number.isNaN(override) ? DEADLINE_MS : override;
}

/** A hook must never fail Session start over a missing or unreadable Vault. */
function quietly<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch (error) {
    if (error instanceof BrainDumpError || errnoCode(error) !== undefined) return undefined;
    throw error;
  }
}

function projectLine(vault: Vault, project: string): string | undefined {
  const dumps = projectDumps(vault, project);
  const notes = projectNotes(vault, project, dumps);
  const unfiled = dumps.filter((dump) => dirname(dump.file) === INBOX).length;
  const segments: string[] = [];
  if (notes.length > 0) segments.push(`Vault notes for ${project}: ${notes.join(", ")}`);
  if (unfiled > 0) segments.push(`${countOf(unfiled, "unfiled Dump")}${notes.length === 0 ? ` for ${project}` : ""}`);
  if (segments.length === 0) return undefined;
  return `brain-dump: ${[...segments, "use the recall skill for more"].join(" · ")}`;
}

/** Dumps whose origin line names `project`, in the Inbox or filed. */
function projectDumps(vault: Vault, project: string): StoredDump[] {
  return noteFiles(vault)
    .filter((path) => isStoredDump(vault, path))
    .flatMap((path) => {
      const dump = readDumpOrProblem(vault, path);
      return "problem" in dump || describeDump(dump).project !== project ? [] : [dump];
    });
}

/** The project's Route target if it exists, then the notes holding the most Items backlinked to its Dumps; titles are matched exactly, never guessed. */
function projectNotes(vault: Vault, project: string, dumps: StoredDump[]): string[] {
  const titles = new Set(noteFiles(vault).map((path) => basename(path, ".md").toLowerCase()));
  const route = readRoutes(vault).find((candidate) => "title" in candidate && candidate.key === project);
  const routed = route !== undefined && "title" in route && titles.has(titleOf(route.title)) ? route.title : undefined;
  const dumpTitles = new Set(dumps.map((dump) => dump.title.toLowerCase()));
  const ranked = curatedNotes(vault)
    .map(({ note, lines }) => ({
      title: basename(note, ".md"),
      items: curatedBullets(lines).filter(({ from }) => from !== undefined && dumpTitles.has(from.toLowerCase())).length,
    }))
    .filter(({ title, items }) => items > 0 && (routed === undefined || title.toLowerCase() !== titleOf(routed)))
    .sort((a, b) => b.items - a.items || a.title.localeCompare(b.title))
    .map(({ title, items }) => `[[${title}]] (${countOf(items, "Item")})`);
  return [...(routed === undefined ? [] : [`[[${routed}]] (Route)`]), ...ranked].slice(0, NOTE_CAP);
}

function titleOf(link: string): string {
  return basename(linkTarget(link)).toLowerCase();
}
