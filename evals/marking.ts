import { STATES } from "../src/mark-todos.ts";
import type { TodoState } from "../src/todo-groups.ts";

// The `todo` eval's gate: the Todos the skill proposes to mark, offers to mark along with them, or lists as candidates when it must ask, each read
// from a `<line> · <group path> · <text>` row under the Weekly Note's title.

export type MarkedTodo = { note: string; line: number; state?: TodoState };

/** `proposed` rows start `-` and end `→ <state>`; `offered` ones, a parent's open sub-todos, start `+`; `candidates` have no state. */
export type Marking = { proposed: MarkedTodo[]; offered: MarkedTodo[]; candidates: MarkedTodo[] };

type Kind = keyof Marking;

const ROW = new RegExp(`^\\s*([-*+])\\s+(\\d+)\\s*·.*?(?:→\\s*(${STATES.join("|")})\\b.*)?$`);
const NOTE = /(\d{2}-\d{2}-\d{2} Weekly Update)/;
const KINDS: Kind[] = ["proposed", "offered", "candidates"];
const VERBS: Record<Kind, [string, string]> = {
  proposed: ["proposed", "did not propose"],
  offered: ["offered", "did not offer"],
  candidates: ["listed as a candidate", "did not list as a candidate"],
};

/** Every way the reply misses `expected`, unexpected rows before missing ones within each kind; empty when it matches. */
export function checkMarking(reply: string, expected: Marking): string[] {
  const found = parseRows(reply);
  return KINDS.flatMap((kind) => {
    const want = new Set(expected[kind].map(describe));
    const got = new Set(found[kind].map(describe));
    const [listed, missed] = VERBS[kind];
    return [
      ...[...got].filter((row) => !want.has(row)).map((row) => `${listed} ${row}, which was not expected`),
      ...[...want].filter((row) => !got.has(row)).map((row) => `${missed} ${row}`),
    ];
  });
}

function parseRows(reply: string): Marking {
  const rows: Marking = { proposed: [], offered: [], candidates: [] };
  let note = "";
  for (const raw of reply.split("\n")) {
    // Markup is dropped first: a row sometimes comes wrapped in backticks.
    const line = raw.replace(/`|\*\*|\\/g, "");
    const row = ROW.exec(line);
    if (row === null) {
      note = NOTE.exec(line)?.[1] ?? note;
      continue;
    }
    const [, bullet, number, mark] = row;
    const state = STATES.find((candidate) => candidate === mark);
    if (state === undefined) rows.candidates.push({ note, line: Number(number) });
    else rows[bullet === "+" ? "offered" : "proposed"].push({ note, line: Number(number), state });
  }
  return rows;
}

function describe({ note, line, state }: MarkedTodo): string {
  return `${note} line ${line}${state === undefined ? "" : ` → ${state}`}`;
}
