import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findSection } from "./sections.ts";
import type { Vault } from "./vault.ts";
import { findPreviousWeeklyNote, findWeeklyNote } from "./weekly.ts";

export const TODO_SECTION = "# To-Do:";
const BULLET = /^[-*+] (.*)$/;
const CHECKBOX = /^\[.\]/;

export type TodoGroup = { name: string; children: TodoGroup[] };

/**
 * A Todo Group (or the section itself, at level -1) located in a note's lines.
 * `todoEnd` is the line after its last direct Todo's block, or after the group bullet when it has none;
 * `blockEnd` is the line after its last non-blank line, children included.
 */
export type GroupNode = { name: string; line: number; level: number; children: GroupNode[]; todoEnd: number; blockEnd: number };

export type WeekGroups = {
  thisWeek: { note: string; exists: boolean; groups: TodoGroup[] };
  lastWeek: { note: string; groups: TodoGroup[] } | null;
};

export function readTodoGroups(vault: Vault, isoDate: string): WeekGroups {
  const thisWeek = findWeeklyNote(vault, isoDate);
  const previous = findPreviousWeeklyNote(vault, isoDate);
  return {
    thisWeek: { ...thisWeek, groups: thisWeek.exists ? readNoteGroups(vault, thisWeek.note) : [] },
    lastWeek: previous === undefined ? null : { note: previous, groups: readNoteGroups(vault, previous) },
  };
}

function readNoteGroups(vault: Vault, note: string): TodoGroup[] {
  const path = join(vault.root, note);
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  const section = findSection(lines, TODO_SECTION);
  return section === undefined ? [] : parseTodoGroups(lines, section.start, section.end).children.map(toTree);
}

/** Reads the Todo Groups between a section heading at `start` and the section's `end`: a group is a plain bullet whose parent is the section or another group. */
export function parseTodoGroups(lines: string[], start: number, end: number): GroupNode {
  const root: GroupNode = { name: "", line: start, level: -1, children: [], todoEnd: start + 1, blockEnd: start + 1 };
  const stack: { level: number; group?: GroupNode; todoOf?: GroupNode }[] = [];
  for (let index = start + 1; index < end; index++) {
    const line = lines[index] ?? "";
    if (line.trim() === "") continue;
    const level = indentLevel(line);
    const bullet = BULLET.exec(line.trimStart());
    if (bullet) {
      while ((stack.at(-1)?.level ?? -1) >= level) stack.pop();
      const parent = stack.length === 0 ? root : stack.at(-1)?.group;
      const content = (bullet[1] ?? "").trim();
      if (parent !== undefined && content !== "" && !CHECKBOX.test(content)) {
        const group = { name: content, line: index, level, children: [], todoEnd: index + 1, blockEnd: index + 1 };
        parent.children.push(group);
        stack.push({ level, group });
      } else {
        stack.push({ level, todoOf: parent });
      }
    }
    root.blockEnd = index + 1;
    for (const { group, todoOf } of stack) {
      if (group) group.blockEnd = index + 1;
      if (todoOf) todoOf.todoEnd = index + 1;
    }
  }
  return root;
}

/** Group names match ignoring case, surrounding space and a trailing colon. */
export function groupKey(name: string): string {
  return name.trim().replace(/:$/, "").trim().toLowerCase();
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
