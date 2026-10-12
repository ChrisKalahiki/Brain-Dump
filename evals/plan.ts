import { basename } from "node:path";

// The `file` eval's gate: the Filing Plan as the skill shows it, read from its table, its `≈` lines and its Routine list, against where each Item
// should go.

/** `routine`: listed under Routine; `new`: its note is marked NEW; `new-group`: a level of its Todo Group is; `similar`: marked `≈`. */
export type Mark = "routine" | "new" | "new-group" | "similar";

/**
 * The destination note's title, the last level of a Todo's group, and exactly the marks the row carries. The link line's place, table or Routine
 * list, isn't gated: beside a table the skill as often puts it in the table, so only its NEW mark counts.
 */
export type ExpectedRow = { note: string; group?: string; marks: Mark[] };

/** `id` is the Item's index, or `+` for the link line. */
type PlanRow = { id: string; destination: string; marks: Mark[] };

const TABLE_ROW = /^\s*\|(.*)\|\s*$/;
const TABLE_RULE = /^:?-+:?$/;
const ROUTINE_LINE = /^\s*(?:[-*]\s+)?(\d+|\+)\s*·\s*.*→\s*(.+?)\s*$/;
const SIMILAR_LINE = /^\s*(?:[-*]\s+)?≈\s*(\d+)\s*~/;
/** A Route the row names, and whatever the skill appended after it. */
const VIA_ROUTE = /\s*\(via Route [^)]*\).*$/;
const NEW = /\bNEW\b/;

/** Every way the plan misses `expected`, keyed by Item index or `+`; empty when it matches. */
export function checkPlan(reply: string, expected: Record<string, ExpectedRow>): string[] {
  const { rows, similarLines } = parsePlan(reply);
  const ids = [...new Set([...Object.keys(expected), ...rows.map(({ id }) => id)])].sort(byIndex);
  const failures = ids.flatMap((id): string[] => {
    const label = id === "+" ? "The link line" : `Item ${id}`;
    const listed = rows.filter((row) => row.id === id);
    const want = expected[id];
    const [row] = listed;
    if (want === undefined) return [`${label} is in the plan, but no such Item was expected`];
    if (row === undefined) return [`${label} is not in the plan`];
    if (listed.length > 1) return [`${label} is in the plan ${listed.length} times`];
    if (!goesTo(row.destination, want)) return [`${label} → "${row.destination}", expected ${want.group === undefined ? want.note : `${want.note} › ${want.group}`}`];
    const marks = id === "+" ? row.marks.filter((mark) => mark !== "routine") : row.marks;
    if (describeMarks(marks) !== describeMarks(want.marks)) return [`${label} → "${row.destination}" marked ${describeMarks(marks)}, expected ${describeMarks(want.marks)}`];
    return [];
  });
  const marked = new Set(rows.filter(({ marks }) => marks.includes("similar")).map(({ id }) => id));
  for (const id of [...new Set([...marked, ...similarLines])].sort(byIndex)) {
    if (!similarLines.has(id)) failures.push(`Item ${id} is marked ≈ but has no ≈ line below the table`);
    else if (!marked.has(id)) failures.push(`Item ${id} has a ≈ line but is not marked ≈`);
  }
  return failures;
}

function parsePlan(reply: string): { rows: PlanRow[]; similarLines: Set<string> } {
  const rows: PlanRow[] = [];
  const similarLines = new Set<string>();
  for (const line of reply.split("\n")) {
    const table = TABLE_ROW.exec(line);
    if (table?.[1] !== undefined) {
      const [first = "", , destination] = table[1].split("|").map((cell) => cell.trim());
      const id = /\d+|\+/.exec(first.replaceAll("*", ""))?.[0];
      if (id === undefined || destination === undefined || TABLE_RULE.test(first)) continue;
      rows.push({ id, destination: plain(destination.replace(VIA_ROUTE, "")), marks: [...(first.includes("≈") ? ["similar" as const] : []), ...newMarks(destination)] });
      continue;
    }
    // Markup is dropped first: a Routine line sometimes comes wrapped in backticks, or with its `+` escaped.
    const routine = ROUTINE_LINE.exec(line.replace(/`|\*\*|\\/g, ""));
    if (routine?.[1] && routine[2]) {
      const destination = routine[2].replace(VIA_ROUTE, "");
      rows.push({ id: routine[1], destination: plain(destination), marks: ["routine", ...newMarks(destination)] });
      continue;
    }
    const similar = SIMILAR_LINE.exec(line)?.[1];
    if (similar !== undefined) similarLines.add(similar);
  }
  return { rows, similarLines };
}

/** The note part names the note by title or path; a Todo's group is the last level after it. A part's aside in parentheses, and anything after it, is not its name. */
function goesTo(destination: string, { note, group }: ExpectedRow): boolean {
  const [notePart = "", ...rest] = destination.split(/\s*[·›]\s*/).map((part) => part.replace(/\s*\(.*$/, ""));
  const sameName = (a: string, b: string) => a.trim().replace(/:$/, "").toLowerCase() === b.trim().replace(/:$/, "").toLowerCase();
  if (!sameName(basename(notePart).replace(/\.md$/i, ""), note)) return false;
  return group === undefined || sameName(rest.at(-1) ?? "", group);
}

/** NEW before the first `›` marks the note; after it, a level of the Todo Group. */
function newMarks(destination: string): Mark[] {
  const [note = "", ...group] = destination.split("›");
  return [...(NEW.test(note) ? ["new" as const] : []), ...(group.some((level) => NEW.test(level)) ? ["new-group" as const] : [])];
}

/** The destination without its markup or NEW marks, including a NEW set apart in parentheses. */
function plain(destination: string): string {
  return destination
    .replace(/`|\*|\[\[|\]\]/g, "")
    .replace(/\(\s*NEW\s*\)|\bNEW\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function describeMarks(marks: Mark[]): string {
  return marks.length === 0 ? "[none]" : `[${[...marks].sort().join(", ")}]`;
}

function byIndex(a: string, b: string): number {
  return (a === "+" ? Infinity : Number(a)) - (b === "+" ? Infinity : Number(b));
}
