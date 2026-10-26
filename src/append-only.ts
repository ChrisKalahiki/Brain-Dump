// The append-only check (ADR 0005). Deliberately shares no code with the edit logic in filing.ts, so a bug there can't also approve its own result.

/** The first original line (1-based) an edit lost, changed or moved, or a change of line endings. */
export type Violation = { line: number; text: string } | { lineEndings: "changed" };

/** How a planned Item's checkbox closes: `x` filed, `-` dropped. */
export type ClosedMark = "x" | "-";

const EMPTY_PLACEHOLDERS = new Set(["- ", "- [ ]", "- [ ] "]);
const OPEN_CHECKBOX = "- [ ]";
/** An indented checkbox bullet split around its mark; the tail keeps any `\r`. */
const CHECKBOX_MARK = /^([ \t]*[-*+] \[)(.)(\].*)$/s;
const TODO_MARKS = new Set([" ", "x", "-"]);

/**
 * For an existing note: every original line survives byte-for-byte and in order, only an empty placeholder bullet may vanish, and the line endings stay the same.
 * Lines keep their `\r`, so a line whose ending changed counts as lost; the original's last line may gain the ending it never had when something is appended after it.
 */
export function appendOnlyViolation(original: string, next: string): Violation | undefined {
  const before = lineEndings(original);
  const after = lineEndings(next);
  if (after !== before && !(before === "none" && after !== "mixed")) return { lineEndings: "changed" };
  const originalLines = original.split("\n");
  const nextLines = next.split("\n");
  const last = originalLines.length - 1;
  let cursor = 0;
  for (const [index, line] of originalLines.entries()) {
    if (EMPTY_PLACEHOLDERS.has(withoutCr(line))) continue;
    const survives = (candidate: string | undefined): boolean => candidate === line || (index === last && candidate === `${line}\r`);
    while (cursor < nextLines.length && !survives(nextLines[cursor])) cursor++;
    if (cursor === nextLines.length) return { line: index + 1, text: withoutCr(line) };
    cursor++;
  }
  return undefined;
}

/** For a Dump being filed: the same lines, except that each `planned` line (0-based) closes its open checkbox with its planned mark. */
export function checkboxOnlyViolation(original: string, next: string, planned: ReadonlyMap<number, ClosedMark>): Violation | undefined {
  const originalLines = original.split("\n");
  const nextLines = next.split("\n");
  for (const [index, line] of originalLines.entries()) {
    const edited = nextLines[index];
    if (edited === line) continue;
    const mark = planned.get(index);
    const closed = mark !== undefined && line.startsWith(OPEN_CHECKBOX) && edited === `- [${mark}]${line.slice(OPEN_CHECKBOX.length)}`;
    if (!closed) return { line: index + 1, text: withoutCr(line) };
  }
  if (nextLines.length !== originalLines.length) return { line: originalLines.length, text: withoutCr(originalLines.at(-1) ?? "") };
  return undefined;
}

/** For a Weekly Note's Todos being marked (ADR 0011): the same lines, except that each `named` line (0-based) may change the mark inside its checkbox to ` `, `x` or `-`. */
export function todoMarkViolation(original: string, next: string, named: ReadonlySet<number>): Violation | undefined {
  const originalLines = original.split("\n");
  const nextLines = next.split("\n");
  for (const [index, line] of originalLines.entries()) {
    const edited = nextLines[index];
    if (edited === line) continue;
    const before = CHECKBOX_MARK.exec(line);
    const after = edited === undefined ? null : CHECKBOX_MARK.exec(edited);
    const marked = named.has(index) && before !== null && after !== null && before[1] === after[1] && before[3] === after[3] && TODO_MARKS.has(after[2] ?? "");
    if (!marked) return { line: index + 1, text: withoutCr(line) };
  }
  if (nextLines.length !== originalLines.length) return { line: originalLines.length, text: withoutCr(originalLines.at(-1) ?? "") };
  return undefined;
}

function lineEndings(text: string): "crlf" | "lf" | "mixed" | "none" {
  const breaks = text.split("\n").length - 1;
  const crlf = text.split("\r\n").length - 1;
  if (breaks === 0) return "none";
  if (crlf === breaks) return "crlf";
  return crlf === 0 ? "lf" : "mixed";
}

function withoutCr(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}
