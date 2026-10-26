import { describe, expect, test } from "bun:test";
import { renderFiledItem } from "../src/curated.ts";
import type { WeekTodos } from "../src/todo-groups.ts";
import { makeSandbox, readVaultFile, run, vaultFileHash, writeVaultFile, type Sandbox } from "./harness.ts";

const WEEKLY = "Research/Weekly Meetings";
const NOTE = `${WEEKLY}/10-05-26 Weekly Update.md`;
const DATE = "2026-10-08";
const [FILED] = renderFiledItem({ kind: "Todo", text: "#todo Work on ToA manuscript.", rationale: null }, { title: "2026-10-05 1940 Brain-Dump - filing", date: "2026-10-05" });
const CONTENTS = [
  "# Updates:",
  "- [ ] Not a Todo, it is in Updates",
  "---",
  "# To-Do:",
  "- SaTC",
  `\t${FILED}`,
  "\t\t- [ ] Find CHI papers",
  "\t\t- a note",
  "\t- [x] Data analysis",
  "- [-] Loose dropped",
  "- [/] Started",
  "",
].join("\n");

function sandboxWith(contents = CONTENTS): Sandbox {
  const sandbox = makeSandbox();
  writeVaultFile(sandbox, NOTE, contents);
  return sandbox;
}

function markTodos(sandbox: Sandbox, lines: string[], { date = DATE, hash = vaultFileHash(sandbox, NOTE) } = {}) {
  return run(sandbox, ["mark-todos", "--date", date, "--hash", hash, ...lines.flatMap((line) => ["--line", line])]);
}

function states(sandbox: Sandbox): [number, string][] {
  const week: WeekTodos = JSON.parse(run(sandbox, ["todos", "--date", DATE]).stdout);
  return week.todos.map(({ line, state }) => [line, state]);
}

describe("brain-dump mark-todos", () => {
  test("marks a Todo done, as todos then reads it, and prints the Run and the note's new hash", () => {
    // #given
    const sandbox = sandboxWith();

    // #when
    const result = markTodos(sandbox, ["6=done"]);

    // #then
    const output = JSON.parse(result.stdout);
    expect([result.exitCode, { ...output, run: typeof output.run }, states(sandbox)]).toEqual([
      0,
      { run: "string", note: NOTE, hash: vaultFileHash(sandbox, NOTE), changed: [6], unchanged: [] },
      [
        [6, "done"],
        [7, "open"],
        [9, "done"],
        [10, "dropped"],
        [11, "open"],
      ],
    ]);
  });

  test("marks several Todos in one call, dropping, finishing and reopening them", () => {
    // #given
    const sandbox = sandboxWith();

    // #when
    const result = markTodos(sandbox, ["10=open", "6=dropped", "9=open", "7=done"]);

    // #then
    expect([result.exitCode, JSON.parse(result.stdout).changed, states(sandbox)]).toEqual([
      0,
      [6, 7, 9, 10],
      [
        [6, "dropped"],
        [7, "done"],
        [9, "open"],
        [10, "open"],
        [11, "open"],
      ],
    ]);
  });

  test("changes only the marks, keeping every other byte of the note", () => {
    // #given
    const sandbox = sandboxWith(CONTENTS.replaceAll("\n", "\r\n"));

    // #when
    markTodos(sandbox, ["6=done", "10=open"]);

    // #then
    expect(readVaultFile(sandbox, NOTE)).toBe(CONTENTS.replace("[ ] Work on ToA", "[x] Work on ToA").replace("[-] Loose", "[ ] Loose").replaceAll("\n", "\r\n"));
  });

  test("marks only the named parent, leaving its sub-todos as they were", () => {
    // #given
    const sandbox = sandboxWith();

    // #when
    markTodos(sandbox, ["6=done"]);

    // #then
    expect(states(sandbox).find(([line]) => line === 7)).toEqual([7, "open"]);
  });

  test("reports a Todo already in its state as unchanged, writing nothing and recording no Run when nothing changes", () => {
    // #given
    const sandbox = sandboxWith(CONTENTS.replace("[x] Data", "[X] Data"));
    const before = readVaultFile(sandbox, NOTE);

    // #when
    const result = markTodos(sandbox, ["9=done", "10=dropped", "11=open"]);

    // #then
    expect([result.exitCode, JSON.parse(result.stdout), readVaultFile(sandbox, NOTE), JSON.parse(run(sandbox, ["runs"]).stdout)]).toEqual([
      0,
      { run: null, note: NOTE, hash: vaultFileHash(sandbox, NOTE), changed: [], unchanged: [9, 10, 11] },
      before,
      [],
    ]);
  });

  test("marks a Todo showing a theme mark like any open Todo", () => {
    // #given
    const sandbox = sandboxWith();

    // #when
    markTodos(sandbox, ["11=done"]);

    // #then
    expect(readVaultFile(sandbox, NOTE)).toContain("\n- [x] Started\n");
  });

  test("marks Todos in last week's note, found by a date in that week", () => {
    // #given
    const sandbox = sandboxWith();
    const thisWeek = `${WEEKLY}/10-12-26 Weekly Update.md`;
    writeVaultFile(sandbox, thisWeek, "# To-Do:\n- [ ] This week\n");

    // #when
    const result = markTodos(sandbox, ["6=done"], { date: "2026-10-06" });

    // #then
    expect([JSON.parse(result.stdout).note, readVaultFile(sandbox, thisWeek), states(sandbox)[0]]).toEqual([NOTE, "# To-Do:\n- [ ] This week\n", [6, "done"]]);
  });

  test("refuses the whole call when the note changed since it was read, writing nothing", () => {
    // #given
    const sandbox = sandboxWith();
    const hash = vaultFileHash(sandbox, NOTE);
    writeVaultFile(sandbox, NOTE, `${CONTENTS}- [ ] Added by hand\n`);

    // #when
    const result = markTodos(sandbox, ["6=done"], { hash });

    // #then
    expect([result.exitCode, result.stderr, readVaultFile(sandbox, NOTE)]).toEqual([
      1,
      `brain-dump: Marking stale: ${NOTE} changed since it was read\n`,
      `${CONTENTS}- [ ] Added by hand\n`,
    ]);
  });

  test("refuses the whole call, writing nothing, when a named line is not a Todo in the to-do section", () => {
    // #given
    const cases: [string, string][] = [
      ["a Todo Group", "5"],
      ["a note under a Todo", "8"],
      ["a checkbox outside the to-do section", "2"],
      ["a blank line", "12"],
      ["a line past the end", "40"],
    ];

    // #when
    const results = cases.map(([name, line]) => {
      const sandbox = sandboxWith();
      const result = markTodos(sandbox, ["6=done", `${line}=done`]);
      return [name, result.exitCode, result.stderr, readVaultFile(sandbox, NOTE)];
    });

    // #then
    expect(results).toEqual(cases.map(([name, line]) => [name, 1, `brain-dump: line ${line} of ${NOTE} is not a Todo in its to-do section, so nothing was marked\n`, CONTENTS]));
  });

  test("refuses a date whose week has no Weekly Note", () => {
    // #given
    const sandbox = sandboxWith();

    // #when
    const result = markTodos(sandbox, ["6=done"], { date: "2026-10-20" });

    // #then
    expect([result.exitCode, result.stderr]).toEqual([1, "brain-dump: no Weekly Note for 2026-10-20, so there are no Todos to mark\n"]);
  });

  test("is undone exactly by undo", () => {
    // #given
    const sandbox = sandboxWith(CONTENTS.replaceAll("\n", "\r\n"));
    const { run: id } = JSON.parse(markTodos(sandbox, ["6=done", "9=dropped"]).stdout);

    // #when
    const result = run(sandbox, ["undo", id, "--confirm"]);

    // #then
    expect([result.exitCode, readVaultFile(sandbox, NOTE)]).toEqual([0, CONTENTS.replaceAll("\n", "\r\n")]);
  });

  test("fails with a usage error on a missing or malformed option", () => {
    // #given
    const sandbox = sandboxWith();
    const hash = vaultFileHash(sandbox, NOTE);
    const cases: [string, string[]][] = [
      ["no --date", ["--hash", hash, "--line", "6=done"]],
      ["no --hash", ["--date", DATE, "--line", "6=done"]],
      ["no --line", ["--date", DATE, "--hash", hash]],
      ["an unknown state", ["--date", DATE, "--hash", hash, "--line", "6=finished"]],
      ["a mark instead of a state", ["--date", DATE, "--hash", hash, "--line", "6=x"]],
      ["no line number", ["--date", DATE, "--hash", hash, "--line", "done"]],
      ["line 0", ["--date", DATE, "--hash", hash, "--line", "0=done"]],
      ["a line named twice", ["--date", DATE, "--hash", hash, "--line", "6=done", "--line", "6=open"]],
      ["a malformed date", ["--date", "10/08/2026", "--hash", hash, "--line", "6=done"]],
    ];

    // #when
    const exitCodes = cases.map(([name, args]) => [name, run(sandbox, ["mark-todos", ...args]).exitCode]);

    // #then
    expect([exitCodes, readVaultFile(sandbox, NOTE)]).toEqual([cases.map(([name]) => [name, 2]), CONTENTS]);
  });
});
