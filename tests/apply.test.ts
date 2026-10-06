import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { dumpFile, makeSandbox, readVaultFile, run, WEEKLY_TEMPLATE, writeVaultFile } from "./harness.ts";

const ORIGIN = "Session: Claude Code · `~/Projects/Brain-Dump` @ `main` · 2026-10-05 19:40 · [[Brain-Dump]]";
const DUMP = "Inbox/2026-10-05 1940 Brain-Dump - filing.md";
const WEEK = "Research/Weekly Meetings/10-05-26 Weekly Update.md";

describe("brain-dump apply", () => {
  test("fills the To-Do and Notes placeholders, ticks the Item and moves the finished Dump to Filed", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, DUMP, dumpFile(ORIGIN, "## Todos\n- [ ] #todo Ship the file skill.\n"));
    writeVaultFile(sandbox, WEEK, WEEKLY_TEMPLATE);
    const plan = {
      dump: DUMP,
      items: [{ index: 1, outcome: "filed" }],
      inserts: [
        { note: WEEK, section: "# To-Do:", lines: ["- [ ] Ship the file skill. #todo"] },
        { note: WEEK, section: "# Notes:", lines: ["- Filed [[2026-10-05 1940 Brain-Dump - filing|Brain-Dump filing]]"] },
      ],
    };

    // #when
    run(sandbox, ["apply"], { stdin: JSON.stringify(plan) });

    // #then
    expect([readVaultFile(sandbox, WEEK), existsSync(join(sandbox.vault, DUMP)), readVaultFile(sandbox, "Inbox/Filed/2026-10-05 1940 Brain-Dump - filing.md")]).toEqual([
      WEEKLY_TEMPLATE.replace("# To-Do: #todo \n- [ ] \n", "# To-Do: #todo \n- [ ] Ship the file skill. #todo\n").replace(
        "# Notes:\n- \n",
        "# Notes:\n- Filed [[2026-10-05 1940 Brain-Dump - filing|Brain-Dump filing]]\n",
      ),
      false,
      dumpFile(ORIGIN, "## Todos\n- [x] #todo Ship the file skill.\n"),
    ]);
  });

  test("appends after a section's last line, before its ---, leaving existing text untouched", () => {
    // #given
    const sandbox = makeSandbox();
    const note = "# To-Do: #todo\n- [ ] Existing task\n\t- detail\n\n---\n# Notes:\n- kept\n";
    writeVaultFile(sandbox, DUMP, dumpFile(ORIGIN, "## Todos\n- [ ] #todo New task.\n"));
    writeVaultFile(sandbox, WEEK, note);
    const plan = { dump: DUMP, items: [{ index: 1, outcome: "filed" }], inserts: [{ note: WEEK, section: "# To-Do:", lines: ["- [ ] New task. #todo"] }] };

    // #when
    run(sandbox, ["apply"], { stdin: JSON.stringify(plan) });

    // #then
    expect(readVaultFile(sandbox, WEEK)).toBe("# To-Do: #todo\n- [ ] Existing task\n\t- detail\n- [ ] New task. #todo\n\n---\n# Notes:\n- kept\n");
  });

  test("writes nothing when any insert targets a note that does not exist", () => {
    // #given
    const sandbox = makeSandbox();
    const dump = dumpFile(ORIGIN, "## Todos\n- [ ] #todo A.\n- [ ] #todo B.\n");
    writeVaultFile(sandbox, DUMP, dump);
    writeVaultFile(sandbox, WEEK, WEEKLY_TEMPLATE);
    const plan = {
      dump: DUMP,
      items: [{ index: 1, outcome: "filed" }, { index: 2, outcome: "filed" }],
      inserts: [
        { note: WEEK, section: "# To-Do:", lines: ["- [ ] A. #todo"] },
        { note: "Research/Weekly Meetings/09-28-26 Weekly Update.md", section: "# To-Do:", lines: ["- [ ] B. #todo"] },
      ],
    };

    // #when
    const result = run(sandbox, ["apply"], { stdin: JSON.stringify(plan) });

    // #then
    expect([result.exitCode, readVaultFile(sandbox, WEEK), readVaultFile(sandbox, DUMP)]).toEqual([1, WEEKLY_TEMPLATE, dump]);
  });

  test("marks dropped Items [-], leaves skipped Items open and keeps the Dump in the Inbox", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, DUMP, dumpFile(ORIGIN, "## Todos\n- [ ] #todo A.\n- [ ] #todo B.\n"));
    const plan = { dump: DUMP, items: [{ index: 1, outcome: "dropped" }, { index: 2, outcome: "skipped" }], inserts: [] };

    // #when
    const result = run(sandbox, ["apply"], { stdin: JSON.stringify(plan) });

    // #then
    expect([JSON.parse(result.stdout), readVaultFile(sandbox, DUMP)]).toEqual([
      { filed: 0, dropped: 1, skipped: 1, movedTo: null },
      dumpFile(ORIGIN, "## Todos\n- [-] #todo A.\n- [ ] #todo B.\n"),
    ]);
  });

  test("moves the Dump to Filed when its last open Item is dropped", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, DUMP, dumpFile(ORIGIN, "## Todos\n- [x] #todo A.\n- [ ] #todo B.\n"));
    const plan = { dump: DUMP, items: [{ index: 2, outcome: "dropped" }], inserts: [] };

    // #when
    const result = run(sandbox, ["apply"], { stdin: JSON.stringify(plan) });

    // #then
    expect(JSON.parse(result.stdout).movedTo).toBe("Inbox/Filed/2026-10-05 1940 Brain-Dump - filing.md");
  });

  test("rejects an Item that is already filed", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, DUMP, dumpFile(ORIGIN, "## Todos\n- [x] #todo A.\n- [ ] #todo B.\n"));
    const plan = { dump: DUMP, items: [{ index: 1, outcome: "dropped" }], inserts: [] };

    // #when
    const result = run(sandbox, ["apply"], { stdin: JSON.stringify(plan) });

    // #then
    expect([result.exitCode, result.stderr]).toEqual([
      1,
      "brain-dump: Filing Plan rejected: Item 1 of 2026-10-05 1940 Brain-Dump - filing is already filed\n",
    ]);
  });

  test("rejects a plan whose shape is wrong", () => {
    // #given
    const sandbox = makeSandbox();

    // #when
    const result = run(sandbox, ["apply"], { stdin: JSON.stringify({ dump: DUMP, items: [{ index: "1", outcome: "kept" }] }) });

    // #then
    expect([result.exitCode, result.stderr]).toEqual([
      2,
      'brain-dump: invalid Filing Plan: expected {"dump": string, "items": [{"index": number, "outcome": "filed"|"dropped"|"skipped"}], "inserts": [{"note": string, "section": string, "lines": string[]}]}\n',
    ]);
  });

  test("rejects a note path outside the Vault", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, DUMP, dumpFile(ORIGIN, "## Todos\n- [ ] #todo A.\n"));
    const plan = { dump: DUMP, items: [], inserts: [{ note: "../escape.md", section: "# To-Do:", lines: ["x"] }] };

    // #when
    const result = run(sandbox, ["apply"], { stdin: JSON.stringify(plan) });

    // #then
    expect(result.stderr).toBe("brain-dump: Filing Plan rejected: ../escape.md is outside the Vault\n");
  });
});
