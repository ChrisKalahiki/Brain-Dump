import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DEV_ORIGIN as ORIGIN, dumpFile, makeSandbox, readVaultFile, run, WEEKLY_TEMPLATE, writeVaultFile, type Sandbox } from "./harness.ts";

const DUMP = "Inbox/2026-10-05 1940 Brain-Dump - filing.md";
const WEEK = "Research/Weekly Meetings/10-05-26 Weekly Update.md";
const LINK = "- Filed [[2026-10-05 1940 Brain-Dump - filing|Brain-Dump filing]]";

function apply(sandbox: Sandbox, plan: unknown) {
  return run(sandbox, ["apply"], { stdin: typeof plan === "string" ? plan : JSON.stringify(plan) });
}

function fileTodo(index: number, line: string, note = WEEK) {
  return { index, outcome: "filed", note, section: "# To-Do:", lines: [line] };
}

describe("brain-dump apply", () => {
  test("fills the To-Do and Notes placeholders, ticks the Item and moves the finished Dump to Filed", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, DUMP, dumpFile(ORIGIN, "## Todos\n- [ ] #todo Ship the file skill.\n"));
    writeVaultFile(sandbox, WEEK, WEEKLY_TEMPLATE);
    const plan = {
      dump: DUMP,
      items: [fileTodo(1, "- [ ] Ship the file skill. #todo")],
      inserts: [{ note: WEEK, section: "# Notes:", lines: [LINK] }],
    };

    // #when
    apply(sandbox, plan);

    // #then
    expect([readVaultFile(sandbox, WEEK), existsSync(join(sandbox.vault, DUMP)), readVaultFile(sandbox, "Inbox/Filed/2026-10-05 1940 Brain-Dump - filing.md")]).toEqual([
      WEEKLY_TEMPLATE.replace("# To-Do: #todo \n- [ ] \n", "# To-Do: #todo \n- [ ] Ship the file skill. #todo\n").replace("# Notes:\n- \n", `# Notes:\n${LINK}\n`),
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

    // #when
    apply(sandbox, { dump: DUMP, items: [fileTodo(1, "- [ ] New task. #todo")], inserts: [] });

    // #then
    expect(readVaultFile(sandbox, WEEK)).toBe("# To-Do: #todo\n- [ ] Existing task\n\t- detail\n- [ ] New task. #todo\n\n---\n# Notes:\n- kept\n");
  });

  test("treats a lower-level heading as part of the section", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, DUMP, dumpFile(ORIGIN, "## Todos\n- [ ] #todo A.\n"));
    writeVaultFile(sandbox, WEEK, "# Notes:\n- intro\n## Papers\n- paper\n\n---\n# Key Takeaways\n");

    // #when
    apply(sandbox, { dump: DUMP, items: [{ index: 1, outcome: "skipped" }], inserts: [{ note: WEEK, section: "# Notes:", lines: ["- added"] }] });

    // #then
    expect(readVaultFile(sandbox, WEEK)).toBe("# Notes:\n- intro\n## Papers\n- paper\n- added\n\n---\n# Key Takeaways\n");
  });

  test("keeps a CRLF Dump's line endings when ticking", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, DUMP, dumpFile(ORIGIN, "## Todos\n- [ ] #todo A.\n- [ ] #todo B.\n").replaceAll("\n", "\r\n"));

    // #when
    apply(sandbox, { dump: DUMP, items: [{ index: 1, outcome: "dropped" }], inserts: [] });

    // #then
    expect(readVaultFile(sandbox, DUMP)).toBe(dumpFile(ORIGIN, "## Todos\n- [-] #todo A.\n- [ ] #todo B.\n").replaceAll("\n", "\r\n"));
  });

  test("writes nothing when any Item targets a note that does not exist", () => {
    // #given
    const sandbox = makeSandbox();
    const dump = dumpFile(ORIGIN, "## Todos\n- [ ] #todo A.\n- [ ] #todo B.\n");
    writeVaultFile(sandbox, DUMP, dump);
    writeVaultFile(sandbox, WEEK, WEEKLY_TEMPLATE);
    const plan = {
      dump: DUMP,
      items: [fileTodo(1, "- [ ] A. #todo"), fileTodo(2, "- [ ] B. #todo", "Research/Weekly Meetings/09-28-26 Weekly Update.md")],
      inserts: [],
    };

    // #when
    const result = apply(sandbox, plan);

    // #then
    expect([result.exitCode, readVaultFile(sandbox, WEEK), readVaultFile(sandbox, DUMP)]).toEqual([1, WEEKLY_TEMPLATE, dump]);
  });

  test("marks dropped Items [-], leaves skipped Items open and keeps the Dump in the Inbox", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, DUMP, dumpFile(ORIGIN, "## Todos\n- [ ] #todo A.\n- [ ] #todo B.\n"));

    // #when
    const result = apply(sandbox, { dump: DUMP, items: [{ index: 1, outcome: "dropped" }, { index: 2, outcome: "skipped" }], inserts: [] });

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

    // #when
    const result = apply(sandbox, { dump: DUMP, items: [{ index: 2, outcome: "dropped" }], inserts: [] });

    // #then
    expect(JSON.parse(result.stdout).movedTo).toBe("Inbox/Filed/2026-10-05 1940 Brain-Dump - filing.md");
  });

  describe("rejects the plan without writing", () => {
    const cases: [string, (sandbox: Sandbox) => unknown, string][] = [
      ["an Item that is already filed", () => ({ dump: DUMP, items: [{ index: 1, outcome: "dropped" }], inserts: [] }), "Item 1 of 2026-10-05 1940 Brain-Dump - filing is already filed"],
      ["an Item the Dump does not have", () => ({ dump: DUMP, items: [{ index: 9, outcome: "dropped" }], inserts: [] }), "2026-10-05 1940 Brain-Dump - filing has no Item 9"],
      ["an Item listed twice", () => ({ dump: DUMP, items: [{ index: 2, outcome: "dropped" }, { index: 2, outcome: "skipped" }], inserts: [] }), "Item 2 appears twice in the plan"],
      ["a section the note does not have", () => ({ dump: DUMP, items: [{ ...fileTodo(2, "- [ ] B. #todo"), section: "# Ideas:" }], inserts: [] }), `${WEEK} has no "# Ideas:" section`],
      ["a section given only by its prefix", () => ({ dump: DUMP, items: [{ ...fileTodo(2, "- [ ] B. #todo"), section: "# To" }], inserts: [] }), `${WEEK} has no "# To" section`],
      ["a Dump outside the Inbox", () => ({ dump: WEEK, items: [], inserts: [] }), `${WEEK} is not an unfiled Dump in the Inbox`],
      ["a note path outside the Vault", () => ({ dump: DUMP, items: [], inserts: [{ note: "../escape.md", section: "# To-Do:", lines: ["x"] }] }), "../escape.md is outside the Vault"],
      [
        "a finished Dump whose name is taken in Filed",
        (sandbox) => {
          writeVaultFile(sandbox, "Inbox/Filed/2026-10-05 1940 Brain-Dump - filing.md", "");
          return { dump: DUMP, items: [{ index: 2, outcome: "dropped" }], inserts: [] };
        },
        "Inbox/Filed already has 2026-10-05 1940 Brain-Dump - filing.md",
      ],
    ];

    for (const [name, makePlan, reason] of cases) {
      test(name, () => {
        // #given
        const sandbox = makeSandbox();
        const dump = dumpFile(ORIGIN, "## Todos\n- [x] #todo A.\n- [ ] #todo B.\n");
        writeVaultFile(sandbox, DUMP, dump);
        writeVaultFile(sandbox, WEEK, WEEKLY_TEMPLATE);
        const plan = makePlan(sandbox);

        // #when
        const result = apply(sandbox, plan);

        // #then
        expect([result.exitCode, result.stderr, readVaultFile(sandbox, DUMP), readVaultFile(sandbox, WEEK)]).toEqual([
          1,
          `brain-dump: Filing Plan rejected: ${reason}\n`,
          dump,
          WEEKLY_TEMPLATE,
        ]);
      });
    }
  });

  test("rejects a plan whose shape is wrong", () => {
    // #given
    const sandbox = makeSandbox();

    // #when
    const result = apply(sandbox, { dump: DUMP, items: [{ index: 1, outcome: "filed" }], inserts: [] });

    // #then
    expect(result.exitCode).toBe(2);
  });

  test("appends a filed Learning with its backlink at the end of a Topic Note, without a section", () => {
    // #given
    const sandbox = makeSandbox();
    const topic = "Research/Main Notes/Agent Skills.md";
    writeVaultFile(sandbox, DUMP, dumpFile(ORIGIN, "## Learnings\n- [ ] Codex reads ~/.agents/skills.\n"));
    writeVaultFile(sandbox, topic, "---\ntags:\n  - LLMs\n---\n# Agent Skills\n- existing\n\n");
    const lines = ["- Codex reads ~/.agents/skills.", "\t- From [[2026-10-05 1940 Brain-Dump - filing|dump 10-05-26]]"];

    // #when
    apply(sandbox, { dump: DUMP, items: [{ index: 1, outcome: "filed", note: topic, lines }], inserts: [] });

    // #then
    expect(readVaultFile(sandbox, topic)).toBe(`---\ntags:\n  - LLMs\n---\n# Agent Skills\n- existing\n${lines.join("\n")}\n\n`);
  });

  test("keeps a multi-line Item together when it fills a placeholder that other bullets follow", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, DUMP, dumpFile(ORIGIN, "## Todos\n- [ ] #todo A.\n"));
    writeVaultFile(sandbox, WEEK, "# Notes:\n- \n- later bullet\n\n---\n");
    const lines = ["- Decision.", "\t- Why: reason."];

    // #when
    apply(sandbox, { dump: DUMP, items: [{ index: 1, outcome: "filed", note: WEEK, section: "# Notes:", lines }], inserts: [] });

    // #then
    expect(readVaultFile(sandbox, WEEK)).toBe("# Notes:\n- Decision.\n\t- Why: reason.\n- later bullet\n\n---\n");
  });

  test("appends new Routes to the Routes note, creating it when missing", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, DUMP, dumpFile(ORIGIN, "## Learnings\n- [ ] A.\n- [ ] B.\n"));
    const plan = { dump: DUMP, items: [{ index: 1, outcome: "skipped" }], inserts: [], routes: [{ key: "Brain-Dump", note: "Brain-Dump" }] };
    const second = { ...plan, items: [{ index: 2, outcome: "skipped" }], routes: [{ key: "context-bridge", note: "Context Bridge MCP Main Note" }] };

    // #when
    apply(sandbox, plan);
    apply(sandbox, second);

    // #then
    expect(readVaultFile(sandbox, "Inbox/Filing Routes.md")).toBe(
      "Brain-Dump → [[Brain-Dump]]\ncontext-bridge → [[Context Bridge MCP Main Note]]\n",
    );
  });

  test("rejects stdin that is not JSON", () => {
    // #given
    const sandbox = makeSandbox();

    // #when
    const result = apply(sandbox, "ok");

    // #then
    expect([result.exitCode, result.stderr]).toEqual([2, "brain-dump: invalid Filing Plan: stdin is not JSON\n"]);
  });
});
