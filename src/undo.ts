import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BrainDumpError } from "./errors.ts";
import { commit, type Write } from "./gateway.ts";
import { fileStates, markRun, readBeforeCopy, readRun, readRuns, sha256, type FileState, type Journal, type RunStatus } from "./runs.ts";
import type { Vault } from "./vault.ts";

// Reverts a whole Run, exactly, through the gateway's Revert mode, only while every file is still as the Run left it (ADR 0006).

/** `restore` brings back the file's copy from before the Run, `delete` removes a file the Run created, `skip` leaves a file already as it was before. */
export type UndoAction = "restore" | "delete" | "skip";

export type UndoReport = { undoes: string; label: string; confirmed: boolean; files: { path: string; action: UndoAction }[]; run?: string };

/** Without `confirm`, reports what undo would do and writes nothing. */
export function undoRun(vault: Vault, id: string, { confirm = false } = {}): UndoReport {
  const journal = readRun(id);
  if (journal === undefined) throw new BrainDumpError(`no run ${id} on this machine`);
  if (journal.vault !== vault.root) throw new BrainDumpError(`cannot undo run ${id}: it was made in the Vault at ${journal.vault}, not the current Vault at ${vault.root}`);
  const files = fileStates(journal).map((state) => ({ ...state, current: currentHash(vault, state.path) }));
  const changed = files.filter(({ current, before, after }) => current !== before && current !== after);
  if (changed.length > 0) {
    const reasons = changed.map(({ path, current }) => `  ${path}: ${whyChanged(journal, path, current)}`);
    throw new BrainDumpError([`cannot undo run ${id}, because files changed since it:`, ...reasons].join("\n"));
  }
  const toRevert = files.filter(({ current, before }) => current !== before);
  if (toRevert.length === 0) throw new BrainDumpError(`nothing to undo: every file of run ${id} is already as it was before it`);
  const report: UndoReport = { undoes: id, label: journal.label, confirmed: confirm, files: files.map(({ path, current, before }) => ({ path, action: actionFor(current, before) })) };
  if (!confirm) return report;
  const writes = toRevert.map((state) => revertWrite(vault, journal, state));
  const run = commit(vault, "approved-plan", { command: "undo", label: `undo ${journal.label}`, undoes: id }, writes);
  markUndoChain(journal);
  return { ...report, run };
}

/** Undoing a Run flips the Run it undid back to applied, which flips that one's target to undone, down the chain of undos. */
function markUndoChain(journal: Journal): void {
  let status: RunStatus = "undone";
  for (let target: Journal | undefined = journal; target !== undefined; target = target.undoes === undefined ? undefined : readRun(target.undoes)) {
    markRun(target.id, status);
    status = status === "undone" ? "applied" : "undone";
  }
}

function actionFor(current: string | null, before: string | null): UndoAction {
  if (current === before) return "skip";
  return before === null ? "delete" : "restore";
}

function revertWrite(vault: Vault, journal: Journal, { path, before, after }: FileState): Write {
  return { mode: "revert", path: join(vault.root, path), left: after, before, contents: before === null ? null : readBeforeCopy(journal, path) };
}

/** Blames the latest later Run on this machine that touched the file, while the file is still as that Run left it. */
function whyChanged(journal: Journal, path: string, current: string | null): string {
  const later = readRuns().find((run) => run.vault === journal.vault && run.status !== "undone" && isLater(run, journal) && fileStates(run).some((state) => state.path === path));
  const leftByLater = later !== undefined && fileStates(later).some((state) => state.path === path && state.after === current);
  if (later !== undefined && leftByLater) return `undo run ${later.id} first`;
  return `changed outside Brain-Dump since ${(later ?? journal).time}`;
}

function isLater(run: Journal, than: Journal): boolean {
  return run.time > than.time || (run.time === than.time && run.id > than.id);
}

function currentHash(vault: Vault, path: string): string | null {
  const absolute = join(vault.root, path);
  return existsSync(absolute) ? sha256(readFileSync(absolute, "utf8")) : null;
}
