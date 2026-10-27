import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DRAFTING_MODEL } from "../src/drafting.ts";
import { INBOX, WEEKLY_FOLDER } from "../src/layout.ts";
import type { TodoState } from "../src/todo-groups.ts";
import { makeSkillSandbox, removeSkillSandbox, runClaude } from "./agent.ts";
import type { CaseResult, Eval } from "./eval.ts";
import { checkMarking, type Marking } from "./marking.ts";
import { changedFiles, daysBefore, snapshot, weeklyTitle } from "./sandbox-vault.ts";

// `todo` up to its proposal: `/todo` with what the user says and only the helper's commands, on a Vault holding this week's and last week's Weekly
// Notes. No reply is sent, so the run must write nothing to the Vault.

const FIXTURES = "evals/fixtures/todo";
const FIXTURES_PATH = join(import.meta.dir, "..", FIXTURES);
type Week = "thisWeek" | "lastWeek";

const NOTES: Record<Week, string> = { thisWeek: "this-week.md", lastWeek: "last-week.md" };
const WEEKS: Week[] = ["thisWeek", "lastWeek"];

/** A Todo by its week and its text in that week's fixture, so the expected line follows the fixture; a text listed twice is its next match. */
type FixtureTodo = { week: Week; text: string; state?: TodoState };

type TodoCase = { name: string; says: string; proposed?: FixtureTodo[]; offered?: FixtureTodo[]; candidates?: FixtureTodo[] };

// This week's note has two "Draft the introduction." Todos, a parent with two open sub-todos and a plain note under them; last week's note one
// Todo still open.
const CASES: TodoCase[] = [
  { name: "one-match", says: "I sent chapter 2 to my advisor", proposed: [{ week: "thisWeek", text: "Send chapter 2", state: "done" }] },
  {
    name: "ambiguous",
    says: "I finished drafting the introduction",
    candidates: [
      { week: "thisWeek", text: "Draft the introduction." },
      { week: "thisWeek", text: "Draft the introduction." },
    ],
  },
  {
    name: "cascade",
    says: "the README's cache section is written",
    proposed: [{ week: "thisWeek", text: "Write the cache section", state: "done" }],
    offered: [
      { week: "thisWeek", text: "Add the eviction diagram", state: "done" },
      { week: "thisWeek", text: "Document the size limit", state: "done" },
    ],
  },
  { name: "last-week", says: "I renewed the CHI registration", proposed: [{ week: "lastWeek", text: "Renew the CHI registration", state: "done" }] },
];

export const TODO_EVAL: Eval = {
  name: "todo",
  model: DRAFTING_MODEL,
  entries: ["src/cli.ts", "evals/todo.ts"],
  inputs: ["skills/todo/SKILL.md", ...WEEKS.map((week) => join(FIXTURES, NOTES[week]))],
  cases: CASES.map((todoCase) => ({ name: todoCase.name, run: () => runCase(todoCase) })),
};

async function runCase(todoCase: TodoCase): Promise<CaseResult> {
  const sandbox = makeSkillSandbox(["todo"]);
  try {
    const today = new Date();
    const titles: Record<Week, string> = { thisWeek: weeklyTitle(today), lastWeek: weeklyTitle(daysBefore(today, 7)) };
    // The helper makes the Inbox on its first call when it is missing, as no real Vault's is.
    mkdirSync(join(sandbox.vault, INBOX));
    mkdirSync(join(sandbox.vault, WEEKLY_FOLDER), { recursive: true });
    for (const week of WEEKS) writeFileSync(join(sandbox.vault, WEEKLY_FOLDER, `${titles[week]}.md`), fixture(week));
    const before = snapshot(sandbox.vault);
    const reply = await runClaude({ prompt: `/todo ${todoCase.says}`, cwd: sandbox.project, tools: ["Bash"], allowed: ["Bash(brain-dump:*)"], path: sandbox.path });
    const changed = changedFiles(before, snapshot(sandbox.vault));
    const vaultFailures = changed.length === 0 ? [] : [`the run changed the Vault: ${changed.join(", ")}`];
    if (!reply.ok) return { failures: [...vaultFailures, reply.error] };
    const markingFailures = checkMarking(reply.reply, expectedMarking(todoCase, titles));
    const shown = markingFailures.length === 0 ? [] : [`the reply was:\n${reply.reply.replace(/^/gm, "      | ")}`];
    return { failures: [...vaultFailures, ...markingFailures, ...shown] };
  } finally {
    removeSkillSandbox(sandbox);
  }
}

function expectedMarking({ proposed = [], offered = [], candidates = [] }: TodoCase, titles: Record<Week, string>): Marking {
  const resolve = (todos: FixtureTodo[]) => {
    const seen = new Map<string, number>();
    return todos.map(({ week, text, state }) => {
      const key = `${week}\0${text}`;
      const occurrence = seen.get(key) ?? 0;
      seen.set(key, occurrence + 1);
      return { note: titles[week], line: lineOf(week, text, occurrence), ...(state === undefined ? {} : { state }) };
    });
  };
  return { proposed: resolve(proposed), offered: resolve(offered), candidates: resolve(candidates) };
}

/** The 1-based line of the `occurrence`th checkbox in the week's fixture holding `text`. */
function lineOf(week: Week, text: string, occurrence: number): number {
  const lines = fixture(week).split("\n");
  const matches = lines.flatMap((line, index) => (line.includes("[ ]") && line.includes(text) ? [index + 1] : []));
  const line = matches[occurrence];
  if (line === undefined) throw new Error(`${NOTES[week]} has no open Todo "${text}" #${occurrence + 1}`);
  return line;
}

function fixture(week: Week): string {
  return readFileSync(join(FIXTURES_PATH, NOTES[week]), "utf8");
}
