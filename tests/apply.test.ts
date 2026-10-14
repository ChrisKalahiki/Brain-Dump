import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DEV_ORIGIN as ORIGIN, DUMP_AT, dumpFile, makeSandbox, readVaultFile, run, WEEKLY_TEMPLATE, writeVaultFile, type Sandbox, pinned, vaultFileHash } from "./harness.ts";

const DUMP = "Inbox/2026-10-05 1940 Brain-Dump - filing.md";
const WEEK = "Research/Weekly Meetings/10-05-26 Weekly Update.md";
const TOPIC = "Research/Main Notes/Agent Skills.md";
const LINK = "- Filed [[2026-10-05 1940 Brain-Dump - filing|Brain-Dump filing]]";
const FROM = "\t- From [[2026-10-05 1940 Brain-Dump - filing|dump 10-05-26]]";

function apply(sandbox: Sandbox, plan: unknown, args: string[] = []) {
  return run(sandbox, ["apply", ...args], { stdin: typeof plan === "string" ? plan : JSON.stringify(pinned(sandbox, plan)) });
}

function fileTodo(index: number, note = WEEK) {
  return { index, outcome: "filed", note, section: "# To-Do:" };
}

/** The template with `todo` filling its To-Do placeholder and `link` its Notes placeholder. */
function filledWeek(todo: string, link = LINK): string {
  return WEEKLY_TEMPLATE.replace("# To-Do: #todo \n- [ ] \n", `# To-Do: #todo \n${todo}\n`).replace("# Notes:\n- \n", `# Notes:\n${link}\n`);
}

describe("brain-dump apply", () => {
  test("fills the To-Do and Notes placeholders, ticks the Item and moves the finished Dump to Filed", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, DUMP, dumpFile(ORIGIN, "## Todos\n- [ ] #todo Ship the file skill.\n"));
    writeVaultFile(sandbox, WEEK, WEEKLY_TEMPLATE);

    // #when
    apply(sandbox, { dump: DUMP, items: [fileTodo(1)] });

    // #then
    expect([readVaultFile(sandbox, WEEK), existsSync(join(sandbox.vault, DUMP)), readVaultFile(sandbox, "Inbox/Filed/2026-10-05 1940 Brain-Dump - filing.md")]).toEqual([
      filledWeek("- [ ] Ship the file skill. #todo"),
      false,
      dumpFile(ORIGIN, "## Todos\n- [x] #todo Ship the file skill.\n"),
    ]);
  });

  test("reads a plan written as block YAML, which a Bash command can carry without braces", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, DUMP, dumpFile(ORIGIN, "## Todos\n- [ ] #todo Ship the file skill.\n"));
    writeVaultFile(sandbox, WEEK, WEEKLY_TEMPLATE);
    const plan = [
      `dump: "${DUMP}"`,
      "expect:",
      `  "${DUMP}": "${vaultFileHash(sandbox, DUMP)}"`,
      `  "${WEEK}": "${vaultFileHash(sandbox, WEEK)}"`,
      "items:",
      "  - index: 1",
      '    outcome: "filed"',
      `    note: "${WEEK}"`,
      '    section: "# To-Do:"',
      "",
    ].join("\n");

    // #when
    const result = apply(sandbox, plan);

    // #then
    expect([result.exitCode, result.stderr, readVaultFile(sandbox, WEEK)]).toEqual([0, "", filledWeek("- [ ] Ship the file skill. #todo")]);
  });

  test("appends after a section's last line, before its ---, leaving existing text untouched", () => {
    // #given
    const sandbox = makeSandbox();
    const note = "# To-Do: #todo\n- [ ] Existing task\n\t- detail\n\n---\n# Notes:\n- kept\n";
    writeVaultFile(sandbox, DUMP, dumpFile(ORIGIN, "## Todos\n- [ ] #todo New task.\n"));
    writeVaultFile(sandbox, WEEK, note);

    // #when
    apply(sandbox, { dump: DUMP, items: [fileTodo(1)] });

    // #then
    expect(readVaultFile(sandbox, WEEK)).toBe(`# To-Do: #todo\n- [ ] Existing task\n\t- detail\n- [ ] New task. #todo\n\n---\n# Notes:\n- kept\n${LINK}\n`);
  });

  test("treats a lower-level heading as part of the section", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, DUMP, dumpFile(ORIGIN, "## Learnings\n- [ ] A.\n"));
    writeVaultFile(sandbox, TOPIC, "# Agent Skills\n");
    writeVaultFile(sandbox, WEEK, "# Notes:\n- intro\n## Papers\n- paper\n\n---\n# Key Takeaways\n");

    // #when
    apply(sandbox, { dump: DUMP, items: [{ index: 1, outcome: "filed", note: TOPIC }] });

    // #then
    expect(readVaultFile(sandbox, WEEK)).toBe(`# Notes:\n- intro\n## Papers\n- paper\n${LINK}\n\n---\n# Key Takeaways\n`);
  });

  test("keeps a CRLF Dump's line endings when ticking", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, DUMP, dumpFile(ORIGIN, "## Todos\n- [ ] #todo A.\n- [ ] #todo B.\n").replaceAll("\n", "\r\n"));

    // #when
    apply(sandbox, { dump: DUMP, items: [{ index: 1, outcome: "dropped" }] });

    // #then
    expect(readVaultFile(sandbox, DUMP)).toBe(dumpFile(ORIGIN, "## Todos\n- [-] #todo A.\n- [ ] #todo B.\n").replaceAll("\n", "\r\n"));
  });

  test("writes nothing when any Item targets a note that does not exist", () => {
    // #given
    const sandbox = makeSandbox();
    const dump = dumpFile(ORIGIN, "## Todos\n- [ ] #todo A.\n- [ ] #todo B.\n");
    writeVaultFile(sandbox, DUMP, dump);
    writeVaultFile(sandbox, WEEK, WEEKLY_TEMPLATE);
    const plan = { dump: DUMP, items: [fileTodo(1), fileTodo(2, "Research/Weekly Meetings/09-28-26 Weekly Update.md")] };

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
    const result = apply(sandbox, { dump: DUMP, items: [{ index: 1, outcome: "dropped" }, { index: 2, outcome: "skipped" }] });

    // #then
    expect([JSON.parse(result.stdout), readVaultFile(sandbox, DUMP)]).toEqual([
      { filed: 0, dropped: 1, skipped: 1, movedTo: null, hashes: { [DUMP]: vaultFileHash(sandbox, DUMP) } },
      dumpFile(ORIGIN, "## Todos\n- [-] #todo A.\n- [ ] #todo B.\n"),
    ]);
  });

  test("moves the Dump to Filed when its last open Item is dropped", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, DUMP, dumpFile(ORIGIN, "## Todos\n- [x] #todo A.\n- [ ] #todo B.\n"));
    writeVaultFile(sandbox, WEEK, WEEKLY_TEMPLATE);

    // #when
    const result = apply(sandbox, { dump: DUMP, items: [{ index: 2, outcome: "dropped" }] });

    // #then
    expect(JSON.parse(result.stdout).movedTo).toBe("Inbox/Filed/2026-10-05 1940 Brain-Dump - filing.md");
  });

  test("renders Items from the Dump, with the user's edited wording in place of an Item's own", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, DUMP, dumpFile(ORIGIN, "## Learnings\n- [ ] Codex reads ~/.agents/skills.\n\n## Decisions\n- [ ] Use Bun.\n\t- Why: one runtime.\n\n## Todos\n- [ ] #todo Ship it.\n"));
    writeVaultFile(sandbox, TOPIC, "# Agent Skills\n");
    writeVaultFile(sandbox, WEEK, WEEKLY_TEMPLATE);
    const items = [
      { index: 1, outcome: "filed", note: TOPIC },
      { index: 2, outcome: "filed", note: TOPIC, text: "Use Bun everywhere." },
      { ...fileTodo(3), text: "Ship it #todo today." },
    ];

    // #when
    apply(sandbox, { dump: DUMP, items });

    // #then
    expect([readVaultFile(sandbox, TOPIC), readVaultFile(sandbox, WEEK)]).toEqual([
      `# Agent Skills\n- Codex reads ~/.agents/skills.\n${FROM}\n- Use Bun everywhere.\n\t- Why: one runtime.\n${FROM}\n`,
      filledWeek("- [ ] Ship it today. #todo"),
    ]);
  });

  describe("the link line", () => {
    test("is added once an earlier Run filed an Item and this plan finishes the Dump", () => {
      // #given
      const sandbox = makeSandbox();
      writeVaultFile(sandbox, DUMP, dumpFile(ORIGIN, "## Todos\n- [ ] #todo A.\n- [ ] #todo B.\n"));
      writeVaultFile(sandbox, WEEK, WEEKLY_TEMPLATE);

      // #when
      apply(sandbox, { dump: DUMP, items: [fileTodo(1), { index: 2, outcome: "skipped" }] });
      const afterFirst = readVaultFile(sandbox, WEEK);
      apply(sandbox, { dump: DUMP, items: [{ index: 2, outcome: "dropped" }] });

      // #then
      expect([afterFirst, readVaultFile(sandbox, WEEK)]).toEqual([filledWeek("- [ ] A. #todo", "- "), filledWeek("- [ ] A. #todo")]);
    });

    test("is not added when the Dump is finished with nothing filed", () => {
      // #given
      const sandbox = makeSandbox();
      writeVaultFile(sandbox, DUMP, dumpFile(ORIGIN, "## Todos\n- [ ] #todo A.\n"));
      writeVaultFile(sandbox, WEEK, WEEKLY_TEMPLATE);

      // #when
      apply(sandbox, { dump: DUMP, items: [{ index: 1, outcome: "dropped" }] });

      // #then
      expect(readVaultFile(sandbox, WEEK)).toBe(WEEKLY_TEMPLATE);
    });

    test("names a chat Dump by its tool, whatever Project it names", () => {
      // #given
      const sandbox = makeSandbox();
      const dump = "Inbox/2026-10-05 1940 ClaudeWeb - rate limits.md";
      const origin = { kind: "chat" as const, tool: "ClaudeWeb" as const, chatUrl: undefined, project: "Brain-Dump", at: new Date(DUMP_AT) };
      writeVaultFile(sandbox, dump, dumpFile(origin, "## Todos\n- [ ] #todo A.\n"));
      writeVaultFile(sandbox, WEEK, WEEKLY_TEMPLATE);

      // #when
      apply(sandbox, { dump, items: [fileTodo(1)] });

      // #then
      expect(readVaultFile(sandbox, WEEK)).toBe(filledWeek("- [ ] A. #todo", "- Filed [[2026-10-05 1940 ClaudeWeb - rate limits|ClaudeWeb rate limits]]"));
    });

    test("goes in the Session's week, which the plan may create from the template", () => {
      // #given
      const sandbox = makeSandbox();
      writeVaultFile(sandbox, DUMP, dumpFile(ORIGIN, "## Learnings\n- [ ] A.\n"));
      writeVaultFile(sandbox, TOPIC, "# Agent Skills\n");
      writeVaultFile(sandbox, "Research/Other/Templates/XX-XX-XX Weekly Update.md", WEEKLY_TEMPLATE);

      // #when
      apply(sandbox, { dump: DUMP, creates: [{ note: WEEK, from: "weekly-template" }], items: [{ index: 1, outcome: "filed", note: TOPIC }] });

      // #then
      expect(readVaultFile(sandbox, WEEK)).toBe(WEEKLY_TEMPLATE.replace("# Notes:\n- \n", `# Notes:\n${LINK}\n`));
    });

    test("refuses a plan whose Session's week doesn't exist and isn't created", () => {
      // #given
      const sandbox = makeSandbox();
      writeVaultFile(sandbox, DUMP, dumpFile(ORIGIN, "## Learnings\n- [ ] A.\n"));
      writeVaultFile(sandbox, TOPIC, "# Agent Skills\n");

      // #when
      const result = apply(sandbox, { dump: DUMP, items: [{ index: 1, outcome: "filed", note: TOPIC }] });

      // #then
      expect([result.exitCode, result.stderr, readVaultFile(sandbox, TOPIC)]).toEqual([
        1,
        `brain-dump: Filing Plan rejected: the link line goes in ${WEEK}, which doesn't exist and isn't in creates\n`,
        "# Agent Skills\n",
      ]);
    });
  });

  describe("--dry-run", () => {
    test("returns each filed Item's lines and the link line, and writes nothing", () => {
      // #given
      const sandbox = makeSandbox();
      const dump = dumpFile(ORIGIN, "## Learnings\n- [ ] A.\n\n## Todos\n- [ ] #todo B.\n");
      writeVaultFile(sandbox, DUMP, dump);
      writeVaultFile(sandbox, TOPIC, "# Agent Skills\n");
      writeVaultFile(sandbox, WEEK, WEEKLY_TEMPLATE);

      // #when
      const result = apply(sandbox, { dump: DUMP, items: [{ index: 1, outcome: "filed", note: TOPIC }, { ...fileTodo(2), group: ["Brain Dump"] }], createGroups: [["Brain Dump"]] }, ["--dry-run"]);

      // #then
      expect([JSON.parse(result.stdout), readVaultFile(sandbox, DUMP), readVaultFile(sandbox, TOPIC), readVaultFile(sandbox, WEEK)]).toEqual([
        {
          items: [
            { index: 1, lines: ["- A.", FROM] },
            { index: 2, lines: ["- [ ] B. #todo"] },
          ],
          link: { note: WEEK, section: "# Notes:", line: LINK, due: true },
        },
        dump,
        "# Agent Skills\n",
        WEEKLY_TEMPLATE,
      ]);
    });

    test("says the link line isn't due while the plan leaves an Item open", () => {
      // #given
      const sandbox = makeSandbox();
      writeVaultFile(sandbox, DUMP, dumpFile(ORIGIN, "## Todos\n- [ ] #todo A.\n- [ ] #todo B.\n"));
      writeVaultFile(sandbox, WEEK, WEEKLY_TEMPLATE);

      // #when
      const result = apply(sandbox, { dump: DUMP, items: [fileTodo(1), { index: 2, outcome: "skipped" }] }, ["--dry-run"]);

      // #then
      expect(JSON.parse(result.stdout).link).toEqual({ note: WEEK, section: "# Notes:", line: LINK, due: false });
    });

    test("refuses a plan apply would refuse", () => {
      // #given
      const sandbox = makeSandbox();
      writeVaultFile(sandbox, DUMP, dumpFile(ORIGIN, "## Todos\n- [ ] #todo A.\n"));
      writeVaultFile(sandbox, WEEK, WEEKLY_TEMPLATE);

      // #when
      const result = apply(sandbox, { dump: DUMP, items: [{ ...fileTodo(1), section: "# Ideas:" }] }, ["--dry-run"]);

      // #then
      expect([result.exitCode, result.stderr]).toEqual([1, `brain-dump: Filing Plan rejected: ${WEEK} has no "# Ideas:" section\n`]);
    });
  });

  describe("rejects the plan without writing", () => {
    const cases: [string, (sandbox: Sandbox) => unknown, string][] = [
      ["an Item that is already filed", () => ({ dump: DUMP, items: [{ index: 1, outcome: "dropped" }] }), "Item 1 of 2026-10-05 1940 Brain-Dump - filing is already filed"],
      ["an Item the Dump does not have", () => ({ dump: DUMP, items: [{ index: 9, outcome: "dropped" }] }), "2026-10-05 1940 Brain-Dump - filing has no Item 9"],
      ["an Item listed twice", () => ({ dump: DUMP, items: [{ index: 2, outcome: "dropped" }, { index: 2, outcome: "skipped" }] }), "Item 2 appears twice in the plan"],
      ["a section the note does not have", () => ({ dump: DUMP, items: [{ ...fileTodo(2), section: "# Ideas:" }] }), `${WEEK} has no "# Ideas:" section`],
      ["a section given only by its prefix", () => ({ dump: DUMP, items: [{ ...fileTodo(2), section: "# To" }] }), `${WEEK} has no "# To" section`],
      ["a Dump outside the Inbox", () => ({ dump: WEEK, items: [] }), `${WEEK} is not an unfiled Dump in the Inbox`],
      ["a note path outside the Vault", () => ({ dump: DUMP, items: [{ index: 2, outcome: "filed", note: "../escape.md" }] }), "../escape.md is outside the Vault"],
      [
        "a finished Dump whose name is taken in Filed",
        (sandbox) => {
          writeVaultFile(sandbox, "Inbox/Filed/2026-10-05 1940 Brain-Dump - filing.md", "");
          return { dump: DUMP, items: [{ index: 2, outcome: "dropped" }] };
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
    const result = apply(sandbox, { dump: DUMP, items: [{ index: 1, outcome: "filed" }] });

    // #then
    expect(result.exitCode).toBe(2);
  });

  test("appends a filed Learning with its backlink at the end of a Topic Note, without a section", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, DUMP, dumpFile(ORIGIN, "## Learnings\n- [ ] Codex reads ~/.agents/skills.\n"));
    writeVaultFile(sandbox, TOPIC, "---\ntags:\n  - LLMs\n---\n# Agent Skills\n- existing\n\n");
    writeVaultFile(sandbox, WEEK, WEEKLY_TEMPLATE);

    // #when
    apply(sandbox, { dump: DUMP, items: [{ index: 1, outcome: "filed", note: TOPIC }] });

    // #then
    expect(readVaultFile(sandbox, TOPIC)).toBe(`---\ntags:\n  - LLMs\n---\n# Agent Skills\n- existing\n- Codex reads ~/.agents/skills.\n${FROM}\n\n`);
  });

  test("keeps a multi-line Item together when it fills a placeholder that other bullets follow", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, DUMP, dumpFile(ORIGIN, "## Decisions\n- [ ] Decision.\n\t- Why: reason.\n"));
    writeVaultFile(sandbox, WEEK, "# Notes:\n- \n- later bullet\n\n---\n");

    // #when
    apply(sandbox, { dump: DUMP, items: [{ index: 1, outcome: "filed", note: WEEK, section: "# Notes:" }] });

    // #then
    expect(readVaultFile(sandbox, WEEK)).toBe(`# Notes:\n- Decision.\n\t- Why: reason.\n${FROM}\n- later bullet\n${LINK}\n\n---\n`);
  });

  test("appends to a note that has no trailing newline", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, DUMP, dumpFile(ORIGIN, "## Learnings\n- [ ] A.\n"));
    writeVaultFile(sandbox, TOPIC, "# Agent Skills\n- existing");
    writeVaultFile(sandbox, WEEK, WEEKLY_TEMPLATE);

    // #when
    apply(sandbox, { dump: DUMP, items: [{ index: 1, outcome: "filed", note: TOPIC }] });

    // #then
    expect(readVaultFile(sandbox, TOPIC)).toBe(`# Agent Skills\n- existing\n- A.\n${FROM}`);
  });

  test("appends new Routes to the Routes note, creating it when missing and skipping ones it has", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, DUMP, dumpFile(ORIGIN, "## Learnings\n- [ ] A.\n- [ ] B.\n"));
    const plan = { dump: DUMP, items: [{ index: 1, outcome: "skipped" }], routes: [{ key: "Brain-Dump", title: "Brain-Dump" }] };
    const second = { ...plan, items: [{ index: 2, outcome: "skipped" }], routes: [{ key: "Brain-Dump", title: "Brain-Dump" }, { key: "context-bridge", title: "Context Bridge MCP Main Note" }] };

    // #when
    apply(sandbox, plan);
    apply(sandbox, second);

    // #then
    expect(readVaultFile(sandbox, "Inbox/Filing Routes.md")).toBe(
      "Brain-Dump → [[Brain-Dump]]\ncontext-bridge → [[Context Bridge MCP Main Note]]\n",
    );
  });

  describe("rejects a malformed plan", () => {
    const cases: [string, unknown][] = [
      ["a filed Item with its own lines", { dump: DUMP, items: [{ index: 1, outcome: "filed", note: WEEK, lines: ["- A."] }] }],
      ["inserts, even empty", { dump: DUMP, items: [], inserts: [] }],
      ["edited text over two lines", { dump: DUMP, items: [{ index: 1, outcome: "filed", note: WEEK, text: "A.\n- injected" }] }],
      ["blank edited text", { dump: DUMP, items: [{ index: 1, outcome: "filed", note: WEEK, text: " " }] }],
      ["a Route with a blank key", { dump: DUMP, items: [], routes: [{ key: " ", title: "X" }] }],
      ["routes that are not a list", { dump: DUMP, items: [], routes: { key: "a", title: "b" } }],
    ];

    for (const [name, plan] of cases) {
      test(name, () => {
        // #given
        const sandbox = makeSandbox();

        // #when
        const result = apply(sandbox, plan);

        // #then
        expect(result.exitCode).toBe(2);
      });
    }
  });

  test("rejects stdin that is not YAML", () => {
    // #given
    const sandbox = makeSandbox();

    // #when
    const result = apply(sandbox, "dump: [");

    // #then
    expect([result.exitCode, result.stderr]).toEqual([2, "brain-dump: invalid Filing Plan: stdin is not YAML\n"]);
  });
});
