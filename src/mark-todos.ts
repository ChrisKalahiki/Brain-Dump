import { basename, join } from "node:path";
import { contentHash, readHashed } from "./content-hash.ts";
import { BrainDumpError, UsageError } from "./errors.ts";
import { commit, type Write } from "./gateway.ts";
import { parseTodos, type TodoState } from "./todo-groups.ts";
import type { Vault } from "./vault.ts";
import { locateWeeklyNote } from "./weekly.ts";

// Marking (ADR 0011): the one change in place a Curated Note allows, a Todo's checkbox mark, as one Run.

export const STATES: TodoState[] = ["open", "done", "dropped"];
const MARKS: Record<TodoState, string> = { open: " ", done: "x", dropped: "-" };
const MARK = /^([ \t]*[-*+] \[)./;

/** `run` is `null` when every Todo was already in its state, so nothing was written; `hash` is the note's hash after marking. */
export type Marking = { run: string | null; note: string; hash: string; changed: number[]; unchanged: number[] };

/** Reads `--line` values, each `<line>=<state>` with the 1-based line `todos` reports. */
export function parseMarks(values: string[]): Map<number, TodoState> {
  if (values.length === 0) throw new UsageError("at least one --line <n>=<state> is required");
  const marks = new Map<number, TodoState>();
  for (const value of values) {
    const match = /^([1-9]\d*)=(.*)$/.exec(value);
    const state = STATES.find((candidate) => candidate === match?.[2]);
    if (match === null || state === undefined) throw new UsageError(`--line "${value}" is not <line>=<state> with a state of ${STATES.join(", ")}`);
    const line = Number(match[1]);
    if (marks.has(line)) throw new UsageError(`--line names line ${line} twice`);
    marks.set(line, state);
  }
  return marks;
}

/** Marks Todos in the date's Weekly Note, refusing the whole call if the note changed since `expected` was read or a line isn't a Todo. */
export function markTodos(vault: Vault, isoDate: string, expected: string, marks: ReadonlyMap<number, TodoState>): Marking {
  const week = locateWeeklyNote(vault, isoDate);
  if (!week.exists) throw new BrainDumpError(`no Weekly Note for ${isoDate}, so there are no Todos to mark`);
  const path = join(vault.root, week.note);
  const { contents, hash } = readHashed(path);
  if (hash !== expected) throw new BrainDumpError(`Marking stale: ${week.note} changed since it was read`);

  const todos = new Map(parseTodos(contents).map((todo) => [todo.line, todo]));
  const lines = contents.split("\n");
  const changed: number[] = [];
  const unchanged: number[] = [];
  for (const [line, state] of [...marks].sort(([a], [b]) => a - b)) {
    const todo = todos.get(line);
    if (todo === undefined) throw new BrainDumpError(`line ${line} of ${week.note} is not a Todo in its to-do section, so nothing was marked`);
    if (todo.state === state) {
      unchanged.push(line);
      continue;
    }
    lines[line - 1] = (lines[line - 1] ?? "").replace(MARK, `$1${MARKS[state]}`);
    changed.push(line);
  }
  if (changed.length === 0) return { run: null, note: week.note, hash, changed, unchanged };

  const next = lines.join("\n");
  const write: Write = { mode: "todo-mark", path, contents: next, lines: new Set(changed.map((line) => line - 1)) };
  const run = commit(vault, "approved-plan", { command: "mark-todos", label: basename(week.note, ".md") }, [write]);
  return { run, note: week.note, hash: contentHash(next), changed, unchanged };
}
