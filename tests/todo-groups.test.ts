import { describe, expect, test } from "bun:test";
import { makeSandbox, run, writeVaultFile } from "./harness.ts";

const WEEKLY = "Research/Weekly Meetings";

describe("brain-dump todo-groups", () => {
  test("prints this week's Todo Groups as a nested tree, leaving out Todos and the bullets under them", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(
      sandbox,
      `${WEEKLY}/10-05-26 Weekly Update.md`,
      [
        "# Updates:",
        "- SaTC",
        "---",
        "# To-Do: #todo ",
        "- SaTC",
        "\t- [ ] Upload analysis scripts",
        "- Workshop papers",
        "\t- [x] Look at workshops",
        "\t\t- AAAI Workshops",
        "- Dissertation",
        "\t- IRB",
        "\t\t- [ ] Finish IRB application",
        "\t- [ ] Update consent form",
        "- [ ] Loose todo #todo",
        "\t- a note under it",
        "",
        "---",
        "# Notes:",
        "- Filed",
      ].join("\n"),
    );

    // #when
    const result = run(sandbox, ["todo-groups", "--date", "2026-10-08"]);

    // #then
    expect(JSON.parse(result.stdout)).toEqual({
      thisWeek: {
        note: `${WEEKLY}/10-05-26 Weekly Update.md`,
        exists: true,
        groups: [
          { name: "SaTC", children: [] },
          { name: "Workshop papers", children: [] },
          { name: "Dissertation", children: [{ name: "IRB", children: [] }] },
        ],
      },
      lastWeek: null,
    });
  });

  test("reads four spaces as one level, so a note mixing tabs and spaces still nests", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(
      sandbox,
      `${WEEKLY}/10-05-26 Weekly Update.md`,
      "# To-Do:\n- Sisyphus\n    - CHRONOS\n\t\t- Phase 2\n    - [ ] Write update\n- MCP Paper:\n",
    );

    // #when
    const result = run(sandbox, ["todo-groups", "--date", "2026-10-05"]);

    // #then
    expect(JSON.parse(result.stdout).thisWeek.groups).toEqual([
      { name: "Sisyphus", children: [{ name: "CHRONOS", children: [{ name: "Phase 2", children: [] }] }] },
      { name: "MCP Paper:", children: [] },
    ]);
  });

  test("on a week with no note yet, returns no groups and reads last week's from the latest earlier note, across a skipped week", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, `${WEEKLY}/09-21-26 Weekly Update.md`, "# To-Do:\n- Old\n");
    writeVaultFile(sandbox, `${WEEKLY}/09-28-26 Weekly Update.md`, "# To-Do:\n- SaTC\n- Dissertation\n");

    // #when
    const result = run(sandbox, ["todo-groups", "--date", "2026-10-13"]);

    // #then
    expect(JSON.parse(result.stdout)).toEqual({
      thisWeek: { note: `${WEEKLY}/10-12-26 Weekly Update.md`, exists: false, groups: [] },
      lastWeek: {
        note: `${WEEKLY}/09-28-26 Weekly Update.md`,
        groups: [
          { name: "SaTC", children: [] },
          { name: "Dissertation", children: [] },
        ],
      },
    });
  });
});
