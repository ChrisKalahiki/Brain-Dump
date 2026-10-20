import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readHashed } from "./content-hash.ts";
import { withoutTodoTag } from "./curated.ts";
import { findSection } from "./sections.ts";
import type { Vault } from "./vault.ts";
import { findPreviousWeeklyNote, locateWeeklyNote } from "./weekly.ts";

const TODO_SECTION = "# To-Do:";
const PATH_SEPARATOR = " › ";
const BULLET = /^[-*+] (.*)$/;
const CHECKBOX = /^\[(.)\]/;

export type TodoGroup = { name: string; children: TodoGroup[] };

/** A Todo Group path, outermost group first, e.g. `["Dissertation", "IRB"]`. */
export type GroupPath = string[];

/**
 * A Todo Group (or the section itself, at level -1) located in a note's lines.
 * `todoEnd` is the line after its last direct Todo's block, or after the group bullet when it has none;
 * `blockEnd` is the line after its last non-blank line, children included.
 */
export type GroupNode = { name: string; line: number; level: number; children: GroupNode[]; todoEnd: number; blockEnd: number };

export type WeekGroups = {
  thisWeek: { note: string; exists: boolean; hash: string | null; groups: TodoGroup[] };
  lastWeek: { note: string; groups: TodoGroup[] } | null;
};

export type TodoState = "open" | "done" | "dropped";

/** Marks other than these read as open, so a theme's extra marks never hide a Todo. */
const TODO_STATES: Record<string, TodoState> = { x: "done", X: "done", "-": "dropped" };

/** A checkbox bullet in a Weekly Note's to-do section; `parentIndex` points into the same list, `line` is 1-based. */
export type Todo = { text: string; state: TodoState; groupPath: GroupPath; parentIndex: number | null; line: number };

export type WeekTodos = { note: string; exists: boolean; hash: string | null; todos: Todo[] };

export function readTodos(vault: Vault, isoDate: string): WeekTodos {
  const week = locateWeeklyNote(vault, isoDate);
  const read = week.exists ? readHashed(join(vault.root, week.note)) : undefined;
  return { note: week.note, exists: week.exists, hash: read?.hash ?? null, todos: read === undefined ? [] : walkNote(read.contents)?.todos ?? [] };
}

export function readTodoGroups(vault: Vault, isoDate: string): WeekGroups {
  const thisWeek = locateWeeklyNote(vault, isoDate);
  const previous = findPreviousWeeklyNote(vault, isoDate);
  const read = thisWeek.exists ? readHashed(join(vault.root, thisWeek.note)) : undefined;
  return {
    thisWeek: { ...thisWeek, hash: read?.hash ?? null, groups: read === undefined ? [] : noteGroups(read.contents) },
    lastWeek: previous === undefined ? null : { note: previous, groups: readNoteGroups(vault, previous) },
  };
}

function readNoteGroups(vault: Vault, note: string): TodoGroup[] {
  const path = join(vault.root, note);
  return existsSync(path) ? noteGroups(readFileSync(path, "utf8")) : [];
}

function noteGroups(contents: string): TodoGroup[] {
  return walkNote(contents)?.root.children.map(toTree) ?? [];
}

function walkNote(contents: string): TodoSection | undefined {
  const lines = contents.split(/\r?\n/);
  const section = findSection(lines, TODO_SECTION);
  return section && walkSection(lines, section.start, section.end);
}

/** Reads the Todo Groups between a section heading at `start` and the section's `end`: a group is a plain bullet whose parent is the section or another group. */
export function parseTodoGroups(lines: string[], start: number, end: number): GroupNode {
  return walkSection(lines, start, end).root;
}

type TodoSection = { root: GroupNode; todos: Todo[] };

/** An open bullet while walking a section: a Todo Group, or a bullet under `todoOf`, which may itself be the Todo at `todoIndex`. */
type Frame = { level: number; group?: GroupNode; todoOf?: GroupNode; todoIndex?: number };

/**
 * Walks a to-do section once, finding its Todo Groups and its Todos: a Todo is a checkbox bullet at any depth,
 * parented to the nearest Todo it sits under, through any plain bullets between them.
 */
function walkSection(lines: string[], start: number, end: number): TodoSection {
  const root: GroupNode = { name: "", line: start, level: -1, children: [], todoEnd: start + 1, blockEnd: start + 1 };
  const todos: Todo[] = [];
  const stack: Frame[] = [];
  for (let index = start + 1; index < end; index++) {
    const line = lines[index] ?? "";
    if (line.trim() === "") continue;
    const level = indentLevel(line);
    const bullet = BULLET.exec(line.trimStart());
    while ((stack.at(-1)?.level ?? -1) >= level) stack.pop();
    if (bullet) {
      const parent = stack.length === 0 ? root : stack.at(-1)?.group;
      const content = (bullet[1] ?? "").trim();
      const checkbox = CHECKBOX.exec(content);
      if (parent !== undefined && content !== "" && !checkbox) {
        const group = { name: content, line: index, level, children: [], todoEnd: index + 1, blockEnd: index + 1 };
        parent.children.push(group);
        stack.push({ level, group });
      } else {
        const todo = checkbox ? todoFromCheckbox(stack, checkbox[1] ?? " ", content.slice(checkbox[0].length), index) : undefined;
        const todoIndex = todo === undefined ? undefined : todos.push(todo) - 1;
        stack.push({ level, todoOf: parent, todoIndex });
      }
    }
    root.blockEnd = index + 1;
    for (const { group, todoOf } of stack) {
      if (group) group.blockEnd = index + 1;
      if (todoOf) todoOf.todoEnd = index + 1;
    }
  }
  return { root, todos };
}

/** The Todo a checkbox bullet holds, or none for an empty one such as the Weekly Template's placeholder. */
function todoFromCheckbox(stack: Frame[], mark: string, textAfterMark: string, index: number): Todo | undefined {
  const text = withoutTodoTag(textAfterMark);
  if (text === "") return undefined;
  return {
    text,
    state: TODO_STATES[mark] ?? "open",
    groupPath: stack.flatMap(({ group }) => (group ? [group.name] : [])),
    parentIndex: stack.findLast(({ todoIndex }) => todoIndex !== undefined)?.todoIndex ?? null,
    line: index + 1,
  };
}

/** Where a path leads in a parsed section: to a group, to the first `depth` with no match (under `parent`), or to a `depth` that matches several bullets. */
export type GroupLookup =
  | { kind: "found"; group: GroupNode }
  | { kind: "missing"; depth: number; parent: GroupNode }
  | { kind: "ambiguous"; depth: number; lines: number[] };

export function resolveGroupPath(root: GroupNode, path: GroupPath): GroupLookup {
  let group = root;
  for (const [depth, name] of path.entries()) {
    const matches = group.children.filter((child) => groupKey(child.name) === groupKey(name));
    if (matches.length > 1) return { kind: "ambiguous", depth, lines: matches.map(({ line }) => line) };
    const [match] = matches;
    if (match === undefined) return { kind: "missing", depth, parent: group };
    group = match;
  }
  return { kind: "found", group };
}

/** Names match ignoring case, surrounding space and a trailing colon, so `MCP Paper:` is `mcp paper`. */
function groupKey(name: string): string {
  return name.trim().replace(/:$/, "").trim().toLowerCase();
}

export function pathKey(path: GroupPath): string {
  return path.map(groupKey).join("\0");
}

export function formatGroupPath(path: GroupPath): string {
  return path.join(PATH_SEPARATOR);
}

export function parseGroupPath(text: string): GroupPath {
  return text.split(PATH_SEPARATOR.trim()).map((name) => name.trim());
}

function indentLevel(line: string): number {
  let level = 0;
  let spaces = 0;
  for (const char of line) {
    if (char === "\t") level++;
    else if (char === " ") {
      spaces++;
      if (spaces % 4 === 0) level++;
    } else break;
  }
  return level;
}

function toTree({ name, children }: GroupNode): TodoGroup {
  return { name, children: children.map(toTree) };
}
