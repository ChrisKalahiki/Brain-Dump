import { existsSync, linkSync, mkdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, relative, sep } from "node:path";
import { appendOnlyViolation, checkboxOnlyViolation, todoMarkViolation, type ClosedMark, type Violation } from "./append-only.ts";
import { BrainDumpError, describeFsError, errnoCode } from "./errors.ts";
import { BRIEFING_NOTE, BRIEFINGS_FOLDER, FILED_FOLDER, INBOX, ROUTES_NOTE, WEEKLY_FOLDER, WRITE_ALLOWLIST } from "./layout.ts";
import { discardRun, finishRun, sha256, startRun, type Change, type RunInfo } from "./runs.ts";
import { refuseSecret } from "./secrets.ts";
import type { Vault } from "./vault.ts";

// The one module that writes, renames or deletes Vault files (ADR 0005). Paths are absolute.

/**
 * One file in a commit: a new file, an append to an existing note, a Dump whose planned Items (by 0-based line) close and which may move to `Inbox/Filed`,
 * a Weekly Note whose named Todos (by 0-based line) change their mark (ADR 0011),
 * or a revert of one file a Run touched, from the hash it `left` back to its `before` hash and contents (ADR 0006). A `null` hash or contents means no file.
 */
export type Write =
  | { mode: "create"; path: string; contents: string }
  | { mode: "append"; path: string; contents: string }
  | { mode: "file-dump"; path: string; contents: string; planned: ReadonlyMap<number, ClosedMark>; moveTo?: string }
  | { mode: "todo-mark"; path: string; contents: string; lines: ReadonlySet<number> }
  | { mode: "revert"; path: string; left: string | null; before: string | null; contents: string | null };

/** Automation may only create new Dumps in the Inbox, and the Briefing writer only new Briefings (ADR 0012); everything else needs a plan the user approved (ADR 0004). */
export type Actor = "automation" | "briefing-writer" | "approved-plan";

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

/** A plan over this many notes needs the user's separate confirmation (ADR 0004). */
const PLAN_SIZE_LIMIT = 8;
/** A Briefing over this many bytes is refused (ADR 0012). */
const BRIEFING_SIZE_LIMIT = 200_000;

/** `original` is the target as re-read from disk at verification, kept to restore it if a later write fails. */
type Staged = Write & { temporary: string; original?: string };

/** Checks every rule, stages every file, re-reads each target from disk to verify it, journals it as a Run, then writes all of it, or restores everything it touched. `confirmLarge` is set only after the user separately approved a plan over the size limit. Returns the Run's id. */
export function commit(vault: Vault, actor: Actor, run: RunInfo, writes: Write[], { confirmLarge = false } = {}): string {
  checkWrites(vault, actor, writes, { confirmLarge });
  const staged: Staged[] = [];
  const newFolders: string[] = [];
  let installed = false;
  try {
    for (const write of writes) staged.push(stage(write, newFolders));
    for (const write of staged) verify(vault, write);
    const pending = startRun(vault, run, staged.map((write) => toChange(vault, write)));
    try {
      install(vault, staged);
    } catch (error) {
      // Only a BrainDumpError means install finished rolling back; anything else may have left the Vault half-written, so the Run stays pending.
      if (error instanceof BrainDumpError) discardRun(pending);
      throw error;
    }
    installed = true;
    finishRun(pending);
    return pending.journal.id;
  } finally {
    for (const { temporary } of staged) if (existsSync(temporary)) unlinkSync(temporary);
    if (!installed) for (const folder of newFolders.reverse()) rmSync(folder, { recursive: true, force: true });
  }
}

/** The rules `commit` checks before staging anything (path, actor, Briefing size and secrets, plan size), writing nothing. */
export function checkWrites(vault: Vault, actor: Actor, writes: Write[], { confirmLarge = false } = {}): void {
  for (const write of writes) checkRules(vault, actor, write);
  checkPlanSize(vault, writes, confirmLarge);
}

function checkRules(vault: Vault, actor: Actor, write: Write): void {
  const targets = write.mode === "file-dump" && write.moveTo !== undefined ? [write.path, write.moveTo] : [write.path];
  for (const target of targets) {
    if (!inAllowlist(vaultRelative(vault, target))) throw new WriteRefusedError(`${vaultRelative(vault, target)} is outside the write allowlist`);
  }
  const name = vaultRelative(vault, write.path);
  if (actor === "briefing-writer") {
    if (write.mode !== "create" || !BRIEFING_NOTE.test(name)) throw new WriteRefusedError(`the Briefing writer may only create Daily and Weekly Briefings, not write ${name}`);
    checkBriefing(name, write.contents);
    return;
  }
  if (write.mode === "revert") {
    if (actor === "automation") throw new WriteRefusedError(`automation may not undo a Run, so it may not revert ${name}`);
    return;
  }
  if (actor === "automation") {
    if (write.mode !== "create" || dirname(name) !== INBOX || name === ROUTES_NOTE) throw new WriteRefusedError(`automation may only create new Dumps in the Inbox, not write ${name}`);
    return;
  }
  if (inTree(name, BRIEFINGS_FOLDER)) throw new WriteRefusedError(`${name} is in ${BRIEFINGS_FOLDER}, which only the Briefing writer may write`);
  if (write.mode === "file-dump" ? !isDumpFiling(vault, write) : inTree(name, INBOX) && name !== ROUTES_NOTE) {
    throw new WriteRefusedError(`${name} is in the Inbox, which a plan changes only through its own Dump and the Routes note`);
  }
  if (write.mode === "todo-mark" && dirname(name) !== WEEKLY_FOLDER) throw new WriteRefusedError(`${name} is not a Weekly Note, so its Todos can't be marked`);
}

/** A Briefing's format is paper-bot's, so only its size and secrets are checked (ADR 0012). */
function checkBriefing(name: string, contents: string): void {
  const bytes = Buffer.byteLength(contents);
  if (bytes > BRIEFING_SIZE_LIMIT) throw new WriteRefusedError(`${name} is ${bytes} bytes, more than the ${BRIEFING_SIZE_LIMIT} a Briefing may hold`);
  refuseSecret(contents, "Briefing");
}

function checkPlanSize(vault: Vault, writes: Write[], confirmLarge: boolean): void {
  const notes = new Set(writes.filter(({ mode, path }) => mode !== "file-dump" && mode !== "revert" && vaultRelative(vault, path) !== ROUTES_NOTE).map(({ path }) => path));
  if (notes.size > PLAN_SIZE_LIMIT && !confirmLarge) throw new WriteRefusedError(`the plan writes ${notes.size} notes, more than ${PLAN_SIZE_LIMIT}, so it needs confirmLarge`);
}

/** A Dump is filed where it lies, at the top of the Inbox, and can only move into `Inbox/Filed`. */
function isDumpFiling(vault: Vault, { path, moveTo }: Extract<Write, { mode: "file-dump" }>): boolean {
  return dirname(vaultRelative(vault, path)) === INBOX && (moveTo === undefined || dirname(vaultRelative(vault, moveTo)) === FILED_FOLDER);
}

function stage(write: Write, newFolders: string[]): Staged {
  const temporary = `${write.path}.brain-dump-tmp`;
  if (write.contents === null) return { ...write, temporary };
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
  if (write.mode === "revert") {
    verifyRevert(name, write);
    return;
  }
  if (write.mode === "create") {
    if (existsSync(write.path)) throw new NoteExistsError(`${name} already exists`);
    return;
  }
  write.original = readFileSync(write.path, "utf8");
  const next = readFileSync(write.temporary, "utf8");
  const violation = violationOf(write.original, next, write);
  if (violation !== undefined) throw new BrainDumpError(`brain-dump bug: ${name} ${describe(violation)}, so nothing was written. Please report this.`);
  if (write.mode === "file-dump" && write.moveTo !== undefined && existsSync(write.moveTo)) throw new NoteExistsError(`${vaultRelative(vault, write.moveTo)} already exists`);
}

function violationOf(original: string, next: string, write: Extract<Write, { mode: "append" | "file-dump" | "todo-mark" }>): Violation | undefined {
  switch (write.mode) {
    case "append":
      return appendOnlyViolation(original, next);
    case "file-dump":
      return checkboxOnlyViolation(original, next, write.planned);
    case "todo-mark":
      return todoMarkViolation(original, next, write.lines);
  }
}

/** Byte-identical to what the Run left, and the staged file byte-identical to the copy taken before it, or nothing is reverted. */
function verifyRevert(name: string, write: Extract<Staged, { mode: "revert" }>): void {
  write.original = existsSync(write.path) ? readFileSync(write.path, "utf8") : undefined;
  if (hashOf(write.original) !== write.left) throw new WriteRefusedError(`${name} changed since the Run it would revert`);
  const staged = write.contents === null ? undefined : readFileSync(write.temporary, "utf8");
  if (hashOf(staged) !== write.before) throw new BrainDumpError(`brain-dump bug: reverting ${name} would not restore it exactly, so nothing was written. Please report this.`);
}

function hashOf(contents: string | undefined): string | null {
  return contents === undefined ? null : sha256(contents);
}

function toChange(vault: Vault, write: Staged): Change {
  const path = vaultRelative(vault, write.path);
  const before = write.original ?? "";
  switch (write.mode) {
    case "create":
      return { operation: "create", path, after: write.contents };
    case "append":
      return { operation: "append", path, before, after: write.contents };
    case "todo-mark":
      return { operation: "checkbox", path, before, after: write.contents };
    case "file-dump":
      if (write.moveTo === undefined) return { operation: "checkbox", path, before, after: write.contents };
      return { operation: "move", from: path, to: vaultRelative(vault, write.moveTo), before, after: write.contents };
    case "revert":
      if (write.contents === null) return { operation: "delete", path, before };
      if (write.original === undefined) return { operation: "create", path, after: write.contents };
      return { operation: "revert", path, before, after: write.contents };
  }
}

/** New files first, linked so they never overwrite; then appends, marked Todos and reverted contents; then Dumps; then deletions last. Each step registers how to reverse it, and a failure reverses every step taken. */
function install(vault: Vault, staged: Staged[]): void {
  const undo: (() => void)[] = [];
  const restore = (path: string, original: string | undefined) => () => writeFileSync(path, original ?? "");
  let target = "";
  try {
    for (const write of staged.filter(isNewFile)) {
      target = write.path;
      linkSync(write.temporary, target);
      undo.push(() => unlinkSync(write.path));
    }
    for (const write of staged.filter(isReplacement)) {
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
    for (const write of staged.filter(isDeletion)) {
      unlinkSync(write.path);
      undo.push(restore(write.path, write.original));
    }
  } catch (error) {
    for (const step of undo.reverse()) step();
    if (errnoCode(error) === "EEXIST") throw new NoteExistsError(`${vaultRelative(vault, target)} already exists`);
    throw new WriteFailedError(describeFsError(error));
  }
}

function isNewFile(write: Staged): boolean {
  return write.mode === "create" || (write.mode === "revert" && write.left === null);
}

function isReplacement(write: Staged): boolean {
  return write.mode === "append" || write.mode === "todo-mark" || (write.mode === "revert" && write.left !== null && write.contents !== null);
}

function isDeletion(write: Staged): boolean {
  return write.mode === "revert" && write.contents === null;
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
