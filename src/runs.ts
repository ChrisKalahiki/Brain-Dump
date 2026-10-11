import { createHash, randomBytes } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, writeSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join } from "node:path";
import { now } from "./clock.ts";
import { BrainDumpError, describeFsError, errnoCode } from "./errors.ts";
import type { Vault } from "./vault.ts";

// The per-machine run store, outside the synced Vault (ADR 0006). Paths in a journal are Vault-relative; Run ids are in UTC, like `time`.

const RETENTION_DAYS = 90;
const LISTED_RUNS = 20;
const RUN_ID = /^\d{8}-\d{6}-[0-9a-f]{4}$/;

export type Change =
  | { operation: "create"; path: string; after: string }
  | { operation: "append" | "checkbox"; path: string; before: string; after: string }
  | { operation: "move"; from: string; to: string; before: string; after: string };

export type RunInfo = { command: "apply" | "write-dump"; label: string };

type JournalEntry =
  | { operation: "create"; path: string; before: null; after: string }
  | { operation: "append" | "checkbox"; path: string; before: string; after: string }
  | { operation: "move"; from: string; to: string; before: string; after: string };

type Journal = RunInfo & { id: string; time: string; host: string; vault: string; status: "pending" | "applied"; files: JournalEntry[] };

export type RunSummary = Pick<Journal, "id" | "time" | "command" | "label" | "status"> & { files: number };

/** A Run journaled as `pending`, its Vault files not yet replaced. */
export type PendingRun = { folder: string; journal: Journal };

/** Prunes expired Runs, then durably records this one as `pending` with a copy of every file that existed before it. */
export function startRun(vault: Vault, info: RunInfo, changes: Change[]): PendingRun {
  const at = now();
  try {
    pruneRuns(at);
    const { id, folder } = makeRunFolder(at);
    for (const change of changes) {
      if (change.operation === "create") continue;
      const path = change.operation === "move" ? change.from : change.path;
      writeDurably(join(folder, "before", path), change.before);
    }
    const journal: Journal = { id, time: at.toISOString(), ...info, host: hostname(), vault: vault.root, status: "pending", files: changes.map(toEntry) };
    writeJournal(folder, journal);
    syncFolders(folder);
    syncFolder(runsFolder());
    return { folder, journal };
  } catch (error) {
    throw new BrainDumpError(`cannot record the Run in ${runsFolder()}: ${describeFsError(error)}`);
  }
}

/** The Vault is already written by now, so a failure here only warns: the Run stays `pending`, which undo handles like a crashed Run. */
export function finishRun({ folder, journal }: PendingRun): void {
  try {
    writeJournal(folder, { ...journal, status: "applied" });
  } catch (error) {
    process.stderr.write(`brain-dump: warning: Run ${journal.id} was applied but stays marked pending: ${describeFsError(error)}\n`);
  }
}

/** Forgets a Run whose writes were all rolled back, so nothing in the Vault changed. */
export function discardRun({ folder }: PendingRun): void {
  rmSync(folder, { recursive: true, force: true });
}

export function listRuns(): RunSummary[] {
  const journals = runIds().flatMap((id) => {
    const path = join(runsFolder(), id, "run.json");
    return existsSync(path) ? [JSON.parse(readFileSync(path, "utf8")) as Journal] : [];
  });
  journals.sort((a, b) => b.time.localeCompare(a.time) || b.id.localeCompare(a.id));
  return journals.slice(0, LISTED_RUNS).map(({ id, time, command, label, files, status }) => ({ id, time, command, label, files: files.length, status }));
}

function pruneRuns(at: Date): void {
  const cutoff = at.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  for (const id of runIds()) {
    if (runIdTime(id) < cutoff) rmSync(join(runsFolder(), id), { recursive: true, force: true });
  }
}

function makeRunFolder(at: Date): { id: string; folder: string } {
  mkdirSync(runsFolder(), { recursive: true });
  for (;;) {
    const id = `${idStamp(at)}-${randomBytes(2).toString("hex")}`;
    const folder = join(runsFolder(), id);
    try {
      mkdirSync(folder);
      return { id, folder };
    } catch (error) {
      if (errnoCode(error) !== "EEXIST") throw error;
    }
  }
}

function toEntry(change: Change): JournalEntry {
  if (change.operation === "create") return { ...change, before: null, after: sha256(change.after) };
  return { ...change, before: sha256(change.before), after: sha256(change.after) };
}

function writeJournal(folder: string, journal: Journal): void {
  const temporary = join(folder, "run.json.tmp");
  writeDurably(temporary, `${JSON.stringify(journal, null, 2)}\n`);
  renameSync(temporary, join(folder, "run.json"));
  syncFolder(folder);
}

function writeDurably(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const fd = openSync(path, "w");
  try {
    writeSync(fd, contents);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Makes every folder entry under `folder` durable, so a crash can't keep run.json but lose the `before/` copies. */
function syncFolders(folder: string): void {
  for (const entry of readdirSync(folder, { recursive: true, withFileTypes: true })) {
    if (entry.isDirectory()) syncFolder(join(entry.parentPath, entry.name));
  }
  syncFolder(folder);
}

function syncFolder(path: string): void {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function runIds(): string[] {
  const folder = runsFolder();
  return existsSync(folder) ? readdirSync(folder).filter((name) => RUN_ID.test(name)) : [];
}

/** Read from the id itself, so even a Run that crashed before its journal was written is pruned. */
function runIdTime(id: string): number {
  const field = (start: number, end: number): number => Number(id.slice(start, end));
  return Date.UTC(field(0, 4), field(4, 6) - 1, field(6, 8), field(9, 11), field(11, 13), field(13, 15));
}

function idStamp(at: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}-${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}`;
}

function sha256(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}

function runsFolder(): string {
  return join(homedir(), ".local", "state", "brain-dump", "runs");
}
