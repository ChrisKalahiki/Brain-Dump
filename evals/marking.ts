import type { TodoState } from "../src/todo-groups.ts";

// The `todo` eval's gate: the Todos the skill proposes to mark, offers to mark along with them, or lists as candidates when it must ask, each read
// from a `<line> · <group path> · <text>` row under the Weekly Note's title.

export type ExpectedTodo = { note: string; line: number; state?: TodoState };

/** `proposed` rows start `-` and end `→ <state>`; `offered` ones, a parent's open sub-todos, start `+`; `candidates` have no state. */
export type ExpectedMarking = { proposed: ExpectedTodo[]; offered: ExpectedTodo[]; candidates: ExpectedTodo[] };

type Kind = keyof ExpectedMarking;

const ROW = /^\s*([-*+])\s+(\d+)\s*·.*?(?:→\s*(open|done|dropped)\b.*)?$/;
const NOTE = /(\d{2}-\d{2}-\d{2} Weekly Update)/;
const STATES: TodoState[] = ["open", "done", "dropped"];
const KINDS: Kind[] = ["proposed", "offered", "candidates"];
const VERBS: Record<Kind, [string, string]> = {
  proposed: ["proposed", "did not propose"],
  offered: ["offered", "did not offer"],
  candidates: ["listed as a candidate", "did not list as a candidate"],
};

/** Every way the reply misses `expected`, unexpected rows before missing ones within each kind; empty when it matches. */
export function checkMarking(reply: string, expected: ExpectedMarking): string[] {
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

function parseRows(reply: string): ExpectedMarking {
  const rows: ExpectedMarking = { proposed: [], offered: [], candidates: [] };
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
    const todo = { note, line: Number(number), ...(state === undefined ? {} : { state }) };
    if (state === undefined) rows.candidates.push(todo);
    else rows[bullet === "+" ? "offered" : "proposed"].push(todo);
  }
  return rows;
}

function describe({ note, line, state }: ExpectedTodo): string {
  return `${note} line ${line}${state === undefined ? "" : ` → ${state}`}`;
}
