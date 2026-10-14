import { readFileSync } from "node:fs";
import { relative } from "node:path";
import type { ItemKind } from "./inbox.ts";
import { INBOX } from "./layout.ts";
import { noteFiles } from "./notes.ts";
import type { Vault } from "./vault.ts";

// The Items Filing leaves in curated notes, written and read back here: a bullet with a `From [[dump]]` or `Why:` line under it, or a `#todo` bullet.

export const TODO_TAG = /(^|\s)#todo(?=\s|$)/;
const EVERY_TODO_TAG = new RegExp(TODO_TAG.source, "g");
const BULLET = /^(\s*)- (.+)$/;
const WHY_LINE = /^- Why: (.+)$/;
/** A filed Learning's or Decision's backlink to its Dump, as its trimmed child line. */
export const FROM_LINE = /^- From \[\[([^\]|#]+)/;
/** A filed Item's backlink, or a Weekly Note's `Filed [[…]]` link line, trimmed; captures the link with any alias. */
export const BACKLINK_LINE = /^- (?:From|Filed) \[\[([^\]]+)\]\]/;

/** A note in the allowlist outside the Inbox: `note` is its Vault-relative path. */
export type CuratedNote = { note: string; lines: string[] };

export function curatedNotes(vault: Vault): CuratedNote[] {
  return noteFiles(vault)
    .map((path) => ({ path, note: relative(vault.root, path) }))
    .filter(({ note }) => !note.startsWith(`${INBOX}/`))
    .map(({ path, note }) => ({ note, lines: readFileSync(path, "utf8").split(/\r?\n/) }));
}

/** `text` keeps its checkbox; `from` is the backlinked Dump's title; `line` is 0-based. */
export type CuratedBullet = { text: string; why: string | undefined; from: string | undefined; line: number };

export function curatedBullets(lines: string[]): CuratedBullet[] {
  return lines.flatMap((line, index) => {
    const bullet = BULLET.exec(line);
    if (!bullet?.[2] || WHY_LINE.test(line.trim()) || FROM_LINE.test(line.trim())) return [];
    const indent = bullet[1]?.length ?? 0;
    const children = childLines(lines, index, indent);
    const why = children.map((child) => WHY_LINE.exec(child)?.[1]).find(Boolean);
    const from = children.map((child) => FROM_LINE.exec(child)?.[1]?.trim()).find(Boolean);
    const text = bullet[2];
    if (from === undefined && why === undefined && !TODO_TAG.test(text)) return [];
    return [{ text, why, from, line: index }];
  });
}

/** The lines Filing appends for an Item from the Dump `dump`; `text` is the Item's own wording or the user's edit of it. */
export function renderFiledItem({ kind, text, rationale }: { kind: ItemKind; text: string; rationale: string | null }, dump: { title: string; date: string }): string[] {
  if (kind === "Todo") return [`- [ ] ${text.replace(EVERY_TODO_TAG, "").trim()} #todo`];
  const [year = "", month = "", day = ""] = dump.date.split("-");
  const from = `\t- From [[${dump.title}|dump ${month}-${day}-${year.slice(-2)}]]`;
  return kind === "Decision" ? [`- ${text}`, `\t- Why: ${rationale}`, from] : [`- ${text}`, from];
}

/** A Weekly Note's link to a Dump Filing finished, aliased by its label and slug. */
export function renderLinkLine({ title, label, slug }: { title: string; label: string; slug: string }): string {
  return `- Filed [[${title}|${label} ${slug}]]`;
}

/** An Item's text without its checkbox or `#todo`, in lower case with whitespace collapsed: a filed Todo gains a checkbox and moves its `#todo` to the end. */
export function itemKey(text: string): string {
  return text.replace(/^\[.\] /, "").replace(TODO_TAG, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

/** The bullet's direct children, trimmed: the indented lines right under it at the first child's depth. */
function childLines(lines: string[], index: number, indent: number): string[] {
  const children: string[] = [];
  let depth: number | undefined;
  for (const line of lines.slice(index + 1)) {
    const lineIndent = /^\s*/.exec(line)?.[0].length ?? 0;
    if (line.trim() === "" || lineIndent <= indent) break;
    depth ??= lineIndent;
    if (lineIndent === depth) children.push(line.trim());
  }
  return children;
}
