import { existsSync, linkSync, mkdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, relative, sep } from "node:path";
import { appendOnlyViolation, checkboxOnlyViolation, type ClosedMark, type Violation } from "./append-only.ts";
import { BrainDumpError, describeFsError, errnoCode } from "./errors.ts";
import { FILED_FOLDER, INBOX, ROUTES_NOTE, WRITE_ALLOWLIST } from "./layout.ts";
import type { Vault } from "./vault.ts";

// The one module that writes, renames or deletes Vault files (ADR 0005). Paths are absolute.

/** One file in a commit: a new file, an append to an existing note, or a Dump whose planned Items (by 0-based line) close and which may move to `Inbox/Filed`. */
export type Write =
  | { mode: "create"; path: string; contents: string }
  | { mode: "append"; path: string; contents: string }
  | { mode: "file-dump"; path: string; contents: string; planned: ReadonlyMap<number, ClosedMark>; moveTo?: string };

/** Automation may only create new Dumps in the Inbox; everything else needs a plan the user approved (ADR 0004). */
export type Actor = "automation" | "approved-plan";

export class WriteRefusedError extends BrainDumpError {
  constructor(reason: string) {
    super(`write refused: ${reason}`);
  }
}

export class NoteExistsError extends WriteRefusedError {}

/** A filesystem failure while writing; `reason` is the bare cause, e.g. "permission denied". */
export class WriteFailedError extends BrainDumpError {
  constructor(readonly reason: string) {
    super(`could not write to the Vault: ${reason}`);
  }
}

/** `original` is the target as re-read from disk at verification, kept to restore it if a later write fails. */
type Staged = Write & { temporary: string; original?: string };

/** Checks every rule, stages every file, re-reads each target from disk to verify it, then writes all of it, or restores everything it touched. */
export function commit(vault: Vault, actor: Actor, writes: Write[]): void {
  for (const write of writes) checkRules(vault, actor, write);
  const staged: Staged[] = [];
  const newFolders: string[] = [];
  let installed = false;
  try {
    for (const write of writes) staged.push(stage(write, newFolders));
    for (const write of staged) verify(vault, write);
    install(vault, staged);
    installed = true;
  } finally {
    for (const { temporary } of staged) if (existsSync(temporary)) unlinkSync(temporary);
    if (!installed) for (const folder of newFolders.reverse()) rmSync(folder, { recursive: true, force: true });
  }
}

function checkRules(vault: Vault, actor: Actor, write: Write): void {
  const targets = write.mode === "file-dump" && write.moveTo !== undefined ? [write.path, write.moveTo] : [write.path];
  for (const target of targets) {
    if (!inAllowlist(vaultRelative(vault, target))) throw new WriteRefusedError(`${vaultRelative(vault, target)} is outside the write allowlist`);
  }
  const name = vaultRelative(vault, write.path);
  if (actor === "automation") {
    if (write.mode !== "create" || dirname(name) !== INBOX || name === ROUTES_NOTE) throw new WriteRefusedError(`automation may only create new Dumps in the Inbox, not write ${name}`);
    return;
  }
  if (write.mode === "file-dump" ? !isDumpFiling(vault, write) : inTree(name, INBOX) && name !== ROUTES_NOTE) {
    throw new WriteRefusedError(`${name} is in the Inbox, which a plan changes only through its own Dump and the Routes note`);
  }
}

/** A Dump is filed where it lies, at the top of the Inbox, and can only move into `Inbox/Filed`. */
function isDumpFiling(vault: Vault, { path, moveTo }: Extract<Write, { mode: "file-dump" }>): boolean {
  return dirname(vaultRelative(vault, path)) === INBOX && (moveTo === undefined || dirname(vaultRelative(vault, moveTo)) === FILED_FOLDER);
}

function stage(write: Write, newFolders: string[]): Staged {
  const temporary = `${write.path}.brain-dump-tmp`;
  try {
    const created = mkdirSync(dirname(write.path), { recursive: true });
    if (created !== undefined) newFolders.push(created);
    writeFileSync(temporary, write.contents);
  } catch (error) {
    throw new WriteFailedError(describeFsError(error));
  }
  return { ...write, temporary };
}

function verify(vault: Vault, write: Staged): void {
  const name = vaultRelative(vault, write.path);
  if (write.mode === "create") {
    if (existsSync(write.path)) throw new NoteExistsError(`${name} already exists`);
    return;
  }
  write.original = readFileSync(write.path, "utf8");
  const next = readFileSync(write.temporary, "utf8");
  const violation = write.mode === "append" ? appendOnlyViolation(write.original, next) : checkboxOnlyViolation(write.original, next, write.planned);
  if (violation !== undefined) throw new BrainDumpError(`brain-dump bug: ${name} ${describe(violation)}, so nothing was written. Please report this.`);
  if (write.mode === "file-dump" && write.moveTo !== undefined && existsSync(write.moveTo)) throw new NoteExistsError(`${vaultRelative(vault, write.moveTo)} already exists`);
}

/** New files first, linked so they never overwrite; then appends; then Dumps last. Each step registers how to reverse it, and a failure reverses every step taken. */
function install(vault: Vault, staged: Staged[]): void {
  const undo: (() => void)[] = [];
  const restore = (path: string, original: string | undefined) => () => writeFileSync(path, original ?? "");
  let target = "";
  try {
    for (const write of staged.filter(({ mode }) => mode === "create")) {
      target = write.path;
      linkSync(write.temporary, target);
      undo.push(() => unlinkSync(write.path));
    }
    for (const write of staged.filter(({ mode }) => mode === "append")) {
      renameSync(write.temporary, write.path);
      undo.push(restore(write.path, write.original));
    }
    for (const write of staged) {
      if (write.mode !== "file-dump") continue;
      if (write.moveTo === undefined) {
        renameSync(write.temporary, write.path);
        undo.push(restore(write.path, write.original));
        continue;
      }
      const moveTo = write.moveTo;
      const newFolder = mkdirSync(dirname(moveTo), { recursive: true });
      if (newFolder !== undefined) undo.push(() => rmSync(newFolder, { recursive: true, force: true }));
      target = moveTo;
      linkSync(write.temporary, moveTo);
      undo.push(() => unlinkSync(moveTo));
      unlinkSync(write.path);
      undo.push(restore(write.path, write.original));
    }
  } catch (error) {
    for (const step of undo.reverse()) step();
    if (errnoCode(error) === "EEXIST") throw new NoteExistsError(`${vaultRelative(vault, target)} already exists`);
    throw new WriteFailedError(describeFsError(error));
  }
}

function describe(violation: Violation): string {
  return "line" in violation ? `would lose, change or move line ${violation.line}: "${violation.text}"` : "would change its line endings";
}

function inAllowlist(name: string): boolean {
  return WRITE_ALLOWLIST.some((tree) => inTree(name, tree));
}

function inTree(name: string, tree: string): boolean {
  return name.startsWith(`${tree}${sep}`);
}

function vaultRelative(vault: Vault, path: string): string {
  return relative(vault.root, path);
}
