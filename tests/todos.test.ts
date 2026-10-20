import { describe, expect, test } from "bun:test";
import { renderFiledItem } from "../src/curated.ts";
import type { WeekTodos } from "../src/todo-groups.ts";
import { makeSandbox, run, writeVaultFile, vaultFileHash } from "./harness.ts";

const WEEKLY = "Research/Weekly Meetings";
const NOTE = `${WEEKLY}/10-05-26 Weekly Update.md`;
const DUMP = { title: "2026-10-05 1940 Brain-Dump - filing", date: "2026-10-05" };

function todosOf(contents: string): WeekTodos {
  const sandbox = makeSandbox();
  writeVaultFile(sandbox, NOTE, contents);
  return JSON.parse(run(sandbox, ["todos", "--date", "2026-10-08"]).stdout);
}

describe("brain-dump todos", () => {
  test("prints the week's Todos in note order with their Todo Group path, from the note the date resolves to", () => {
    // #given
    const sandbox = makeSandbox();
    const [filed] = renderFiledItem({ kind: "Todo", text: "#todo Ship the file skill.", rationale: null }, DUMP);
    writeVaultFile(
      sandbox,
      NOTE,
      [
        "# Updates:",
        "- [ ] Not a Todo, it is in Updates",
        "---",
        "# To-Do: #todo ",
        "- SaTC",
        `\t${filed}`,
        "- Dissertation",
        "\t- IRB",
        "\t\t- [ ] Finish IRB application",
        "\t- [ ] Update consent form",
        "- [ ] Loose todo #todo",
        "",
        "---",
        "# Notes:",
        "- [ ] Not a Todo either",
      ].join("\n"),
    );

    // #when
    const result = run(sandbox, ["todos", "--date", "2026-10-08"]);

    // #then
    expect([result.exitCode, JSON.parse(result.stdout)]).toEqual([
      0,
      {
        note: NOTE,
        exists: true,
        hash: vaultFileHash(sandbox, NOTE),
        todos: [
          { text: "Ship the file skill.", state: "open", groupPath: ["SaTC"], parentIndex: null, line: 6 },
          { text: "Finish IRB application", state: "open", groupPath: ["Dissertation", "IRB"], parentIndex: null, line: 9 },
          { text: "Update consent form", state: "open", groupPath: ["Dissertation"], parentIndex: null, line: 10 },
          { text: "Loose todo", state: "open", groupPath: [], parentIndex: null, line: 11 },
        ],
      },
    ]);
  });

  test("reads [x] and [X] as done, [-] as dropped and any other mark as open", () => {
    // #when
    const output = todosOf("# To-Do:\n- [ ] a\n- [x] b\n- [X] c\n- [-] d\n- [/] e\n- [>] f\n");

    // #then
    expect(output.todos.map(({ text, state }) => [text, state])).toEqual([
      ["a", "open"],
      ["b", "done"],
      ["c", "done"],
      ["d", "dropped"],
      ["e", "open"],
      ["f", "open"],
    ]);
  });

  test("removes #todo wherever it stands and keeps links and other tags as written", () => {
    // #when
    const output = todosOf("# To-Do:\n- [ ] #todo Read [[Paper]] #reading\n- [ ] Ship #todo [it](https://example.com)\n- [ ] No tag here\n");

    // #then
    expect(output.todos.map(({ text }) => text)).toEqual(["Read [[Paper]] #reading", "Ship [it](https://example.com)", "No tag here"]);
  });

  test("leaves out an empty checkbox, such as the Weekly Template's placeholder", () => {
    // #when
    const output = todosOf("# To-Do: #todo \n- [ ] \n- [ ] #todo\n- [ ] Real one\n");

    // #then
    expect(output.todos).toEqual([{ text: "Real one", state: "open", groupPath: [], parentIndex: null, line: 4 }]);
  });

  test("parents subtodos to the nearest Todo above them, through note bullets, and leaves the note bullets out", () => {
    // #when
    const output = todosOf(
      [
        "# To-Do:",
        "- Workshops",
        "\t- [x] Look at workshops",
        "\t\t- AAAI Workshops",
        "\t\t\t- [ ] Check AAAI deadline",
        "\t\t- [ ] Shortlist two",
        "\t\t\t- [ ] Email the first",
        "\t- [ ] Book travel",
      ].join("\n"),
    );

    // #then
    expect(output.todos).toEqual([
      { text: "Look at workshops", state: "done", groupPath: ["Workshops"], parentIndex: null, line: 3 },
      { text: "Check AAAI deadline", state: "open", groupPath: ["Workshops"], parentIndex: 0, line: 5 },
      { text: "Shortlist two", state: "open", groupPath: ["Workshops"], parentIndex: 0, line: 6 },
      { text: "Email the first", state: "open", groupPath: ["Workshops"], parentIndex: 2, line: 7 },
      { text: "Book travel", state: "open", groupPath: ["Workshops"], parentIndex: null, line: 8 },
    ]);
  });

  test("reads four spaces as one level, so a note mixing tabs and spaces still nests", () => {
    // #when
    const output = todosOf("# To-Do:\n- Sisyphus\n    - CHRONOS\n\t\t- [ ] Ship phase 1\n\t\t    - [ ] Write it up\n    - [ ] Team update\n");

    // #then
    expect(output.todos).toEqual([
      { text: "Ship phase 1", state: "open", groupPath: ["Sisyphus", "CHRONOS"], parentIndex: null, line: 4 },
      { text: "Write it up", state: "open", groupPath: ["Sisyphus", "CHRONOS"], parentIndex: 0, line: 5 },
      { text: "Team update", state: "open", groupPath: ["Sisyphus"], parentIndex: null, line: 6 },
    ]);
  });

  test("on a week with no note yet, names the note that would be created and lists no Todos", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, NOTE, "# To-Do:\n- [ ] Last week's\n");

    // #when
    const result = run(sandbox, ["todos", "--date", "2026-10-13"]);

    // #then
    expect(JSON.parse(result.stdout)).toEqual({ note: `${WEEKLY}/10-12-26 Weekly Update.md`, exists: false, hash: null, todos: [] });
  });

  test("rejects a missing --date as a usage error", () => {
    // #given
    const sandbox = makeSandbox();

    // #when
    const result = run(sandbox, ["todos"]);

    // #then
    expect([result.exitCode, result.stderr]).toEqual([2, "brain-dump: --date is required\n"]);
  });

  test("rejects a date that is not YYYY-MM-DD", () => {
    // #given
    const sandbox = makeSandbox();

    // #when
    const result = run(sandbox, ["todos", "--date", "10/08/26"]);

    // #then
    expect([result.exitCode, result.stderr]).toEqual([2, 'brain-dump: --date "10/08/26" is not a YYYY-MM-DD date\n']);
  });
});
