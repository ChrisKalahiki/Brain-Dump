import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { contentHash } from "../src/content-hash.ts";
import { prepareDump } from "../src/dump.ts";
import { INBOX, WEEKLY_FOLDER } from "../src/layout.ts";
import type { Origin } from "../src/origin.ts";
import { DRAFTING_MODEL } from "../src/drafting.ts";
import { makeSkillSandbox, removeSkillSandbox, runClaude } from "./agent.ts";
import type { CaseResult, Eval } from "./eval.ts";
import { checkPlan, type ExpectedRow } from "./plan.ts";

// `file` up to its Filing Plan: `/file` with only the helper's commands, on a fixture Vault whose Inbox holds one Dump. No reply is sent, so the run
// must write nothing to the Vault.

const FIXTURES = "evals/fixtures/file";
const FIXTURES_PATH = join(import.meta.dir, "..", FIXTURES);

/** The titles of this week's Weekly Note and of the one for the Dump's own week, which are dated from today. */
type Weeks = { thisWeek: string; sessionWeek: string };

type FileCase = {
  /** Also the Dump's body, `dumps/<name>.md`. */
  name: string;
  slug: string;
  /** A Dump from a Claude Code Session in that project, or from a ChatGPT chat when absent. */
  project?: string;
  daysAgo: number;
  /** Keyed by Item index, `+` for the link line. */
  expected: (weeks: Weeks) => Record<string, ExpectedRow>;
};

// The fixture Vault has Routes `harbor → [[Harbor]]`, `SQLite → [[SQLite]]` and `harbor → To-Do › Harbor`, a `Harbor` group in this week's and last
// week's notes, and a SQLite bullet the `similar` Dump nearly repeats.
const CASES: FileCase[] = [
  {
    name: "routine",
    slug: "cache limits",
    project: "harbor",
    daysAgo: 0,
    expected: ({ thisWeek }) => ({
      "1": { note: "SQLite", marks: ["routine"] },
      "2": { note: "Harbor", marks: ["routine"] },
      "3": { note: thisWeek, group: "Harbor", marks: ["routine"] },
      "+": { note: thisWeek, marks: [] },
    }),
  },
  {
    name: "new-note",
    slug: "typst watch mode",
    daysAgo: 0,
    expected: ({ thisWeek }) => ({ "1": { note: "Typst", marks: ["new"] }, "+": { note: thisWeek, marks: [] } }),
  },
  {
    // The group's name is the skill's to choose; only that it is NEW is fixed.
    name: "new-group",
    slug: "status json flag",
    project: "tidewatch",
    daysAgo: 0,
    expected: ({ thisWeek }) => ({ "1": { note: thisWeek, marks: ["new-group"] }, "+": { note: thisWeek, marks: [] } }),
  },
  {
    // The SQLite Route would make it routine, but an Item with `similar` never is.
    name: "similar",
    slug: "wal readers",
    project: "harbor",
    daysAgo: 0,
    expected: ({ thisWeek }) => ({ "1": { note: "SQLite", marks: ["similar"] }, "+": { note: thisWeek, marks: [] } }),
  },
  {
    // From two weeks ago, a week with no Weekly Note: the Todo goes to this week, the link line to a NEW note for the Session's week.
    name: "link-line",
    slug: "station flag docs",
    project: "harbor",
    daysAgo: 14,
    expected: ({ thisWeek, sessionWeek }) => ({ "1": { note: thisWeek, group: "Harbor", marks: ["routine"] }, "+": { note: sessionWeek, marks: ["new"] } }),
  },
];

export const FILE_EVAL: Eval = {
  name: "file",
  model: DRAFTING_MODEL,
  entries: ["src/cli.ts", "evals/file.ts"],
  inputs: ["skills/file/SKILL.md", ...files(FIXTURES_PATH).map((path) => join(FIXTURES, relative(FIXTURES_PATH, path)))],
  cases: CASES.map((fileCase) => ({ name: fileCase.name, run: () => runCase(fileCase) })),
};

async function runCase(fileCase: FileCase): Promise<CaseResult> {
  const sandbox = makeSkillSandbox(["file"]);
  try {
    const weeks = setUpVault(sandbox.vault, fileCase);
    const before = snapshot(sandbox.vault);
    const reply = await runClaude({ prompt: "/file", cwd: sandbox.project, tools: ["Bash"], allowed: ["Bash(brain-dump:*)"], path: sandbox.path });
    const changed = changedFiles(before, snapshot(sandbox.vault));
    const vaultFailures = changed.length === 0 ? [] : [`the run changed the Vault: ${changed.join(", ")}`];
    if (!reply.ok) return { failures: [...vaultFailures, reply.error] };
    const planFailures = checkPlan(reply.reply, fileCase.expected(weeks));
    const shown = planFailures.length === 0 ? [] : [`the plan was:\n${reply.reply.replace(/^/gm, "      | ")}`];
    return { failures: [...vaultFailures, ...planFailures, ...shown] };
  } finally {
    removeSkillSandbox(sandbox);
  }
}

/** The fixture Vault, this week's and last week's Weekly Notes, and the case's Dump in the Inbox. */
function setUpVault(vault: string, { name, slug, project, daysAgo }: FileCase): Weeks {
  cpSync(join(FIXTURES_PATH, "vault"), vault, { recursive: true });
  const today = new Date();
  const thisWeek = weeklyTitle(today);
  mkdirSync(join(vault, WEEKLY_FOLDER), { recursive: true });
  writeFileSync(join(vault, WEEKLY_FOLDER, `${thisWeek}.md`), readFileSync(join(FIXTURES_PATH, "weekly", "this-week.md")));
  writeFileSync(join(vault, WEEKLY_FOLDER, `${weeklyTitle(daysBefore(today, 7))}.md`), readFileSync(join(FIXTURES_PATH, "weekly", "last-week.md")));
  const at = daysBefore(today, daysAgo);
  const origin: Origin =
    project === undefined
      ? { kind: "chat", tool: "ChatGPT", chatUrl: undefined, project: undefined, at }
      : { kind: "dev", tool: "ClaudeCode", project, location: join(homedir(), "Projects", project), branch: "main", at };
  const dump = prepareDump({ origin, slug, body: readFileSync(join(FIXTURES_PATH, "dumps", `${name}.md`), "utf8") });
  writeFileSync(join(vault, INBOX, `${dump.stem}.md`), dump.contents);
  return { thisWeek, sessionWeek: weeklyTitle(at) };
}

/** The same local time of day `days` calendar days earlier, so a daylight-saving change between can't move it to another date. */
function daysBefore(date: Date, days: number): Date {
  const earlier = new Date(date);
  earlier.setDate(date.getDate() - days);
  return earlier;
}

/** `MM-DD-YY Weekly Update`, dated the Monday of the date's local week. */
function weeklyTitle(date: Date): string {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - ((date.getDay() + 6) % 7));
  const part = (value: number) => String(value).padStart(2, "0");
  return `${part(monday.getMonth() + 1)}-${part(monday.getDate())}-${part(monday.getFullYear() % 100)} Weekly Update`;
}

/** Every file by content hash, and every folder, so a new empty folder counts as a change too. */
function snapshot(vault: string): Map<string, string> {
  return new Map(
    readdirSync(vault, { recursive: true, withFileTypes: true }).map((entry) => {
      const path = join(entry.parentPath, entry.name);
      return [relative(vault, path), entry.isDirectory() ? "folder" : contentHash(readFileSync(path))];
    }),
  );
}

function changedFiles(before: Map<string, string>, after: Map<string, string>): string[] {
  return [...new Set([...before.keys(), ...after.keys()])].filter((path) => before.get(path) !== after.get(path)).sort();
}

function files(folder: string): string[] {
  return readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}
