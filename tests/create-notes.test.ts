import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DEV_ORIGIN as ORIGIN, dumpFile, makeSandbox, readVaultFile, run, WEEKLY_TEMPLATE, writeVaultFile, type Sandbox, pinned } from "./harness.ts";

const DUMP = "Inbox/2026-10-12 0900 Brain-Dump - new week.md";
const TEMPLATE = "Research/Other/Templates/XX-XX-XX Weekly Update.md";
const NEW_WEEK = "Research/Weekly Meetings/10-12-26 Weekly Update.md";

function apply(sandbox: Sandbox, plan: unknown) {
  return run(sandbox, ["apply"], { stdin: JSON.stringify(pinned(sandbox, plan)) });
}

describe("brain-dump apply creating notes", () => {
  test("creates a missing Weekly Note as a verbatim copy of the template, then fills its placeholder", () => {
    // #given
    const sandbox = makeSandbox();
    writeVaultFile(sandbox, TEMPLATE, WEEKLY_TEMPLATE);
    writeVaultFile(sandbox, DUMP, dumpFile(ORIGIN, "## Todos\n- [ ] #todo Plan the week.\n"));
    const plan = {
      dump: DUMP,
      creates: [{ note: NEW_WEEK, from: "weekly-template" }],
      items: [{ index: 1, outcome: "filed", note: NEW_WEEK, section: "# To-Do:" }],
    };

    // #when
    apply(sandbox, plan);

    // #then
    expect(readVaultFile(sandbox, NEW_WEEK)).toBe(
      WEEKLY_TEMPLATE.replace("# To-Do: #todo \n- [ ] \n", "# To-Do: #todo \n- [ ] Plan the week. #todo\n").replace(
        "# Notes:\n- \n",
        "# Notes:\n- Filed [[2026-10-12 0900 Brain-Dump - new week|Brain-Dump new week]]\n",
      ),
    );
  });

  test("creates a new Topic Note in a new folder with tags-only frontmatter, followed by the filed Learning", () => {
    // #given
    const sandbox = makeSandbox();
    const topic = "Research/Main Notes/Agent Skills/Agent Skills.md";
    writeVaultFile(sandbox, DUMP, dumpFile(ORIGIN, "## Learnings\n- [ ] Codex reads ~/.agents/skills.\n"));
    writeVaultFile(sandbox, NEW_WEEK, WEEKLY_TEMPLATE);
    const lines = ["- Codex reads ~/.agents/skills.", "\t- From [[2026-10-12 0900 Brain-Dump - new week|dump 10-12-26]]"];
    const plan = {
      dump: DUMP,
      creates: [{ note: topic, tags: ["LLMs", "VibeCoding"] }],
      items: [{ index: 1, outcome: "filed", note: topic }],
    };

    // #when
    apply(sandbox, plan);

    // #then
    expect(readVaultFile(sandbox, topic)).toBe(`---\ntags:\n  - LLMs\n  - VibeCoding\n---\n${lines.join("\n")}\n`);
  });

  test("creates a note with no frontmatter when it has no tags", () => {
    // #given
    const sandbox = makeSandbox();
    const topic = "Research/Main Notes/Plain.md";
    writeVaultFile(sandbox, DUMP, dumpFile(ORIGIN, "## Learnings\n- [ ] A.\n"));
    writeVaultFile(sandbox, NEW_WEEK, WEEKLY_TEMPLATE);

    // #when
    apply(sandbox, { dump: DUMP, creates: [{ note: topic, tags: [] }], items: [{ index: 1, outcome: "filed", note: topic }] });

    // #then
    expect(readVaultFile(sandbox, topic)).toBe("- A.\n\t- From [[2026-10-12 0900 Brain-Dump - new week|dump 10-12-26]]\n");
  });

  describe("rejects the plan without writing", () => {
    const filedInto = (note: string) => ({ index: 1, outcome: "filed", note });
    const cases: [string, (sandbox: Sandbox) => unknown, string][] = [
      [
        "a new note that would overwrite an existing file",
        (sandbox) => {
          writeVaultFile(sandbox, "Research/Main Notes/Taken.md", "mine\n");
          return { dump: DUMP, creates: [{ note: "Research/Main Notes/Taken.md", tags: ["X"] }], items: [filedInto("Research/Main Notes/Taken.md")] };
        },
        "Research/Main Notes/Taken.md already exists",
      ],
      [
        "a Weekly Note when the template is missing",
        () => ({ dump: DUMP, creates: [{ note: NEW_WEEK, from: "weekly-template" }], items: [filedInto(NEW_WEEK)] }),
        `the Weekly Note template ${TEMPLATE} does not exist`,
      ],
      [
        "a new note nothing is filed into",
        () => ({ dump: DUMP, creates: [{ note: "Research/Main Notes/Orphan.md", tags: [] }], items: [{ index: 1, outcome: "dropped" }] }),
        "Research/Main Notes/Orphan.md would be created with nothing filed into it",
      ],
      [
        "a new note that is not Markdown",
        () => ({ dump: DUMP, creates: [{ note: "Research/Main Notes/Orphan.txt", tags: [] }], items: [filedInto("Research/Main Notes/Orphan.txt")] }),
        "Research/Main Notes/Orphan.txt is not a Markdown note",
      ],
      [
        "the same new note listed twice",
        () => ({
          dump: DUMP,
          creates: [{ note: "Research/Main Notes/Orphan.md", tags: [] }, { note: "Research/Main Notes/Orphan.md", tags: [] }],
          items: [filedInto("Research/Main Notes/Orphan.md")],
        }),
        "Research/Main Notes/Orphan.md already exists",
      ],
      [
        "a template copy that is not a Monday Weekly Note",
        (sandbox) => {
          writeVaultFile(sandbox, TEMPLATE, WEEKLY_TEMPLATE);
          return { dump: DUMP, creates: [{ note: "Research/Weekly Meetings/10-14-26 Weekly Update.md", from: "weekly-template" }], items: [filedInto("Research/Weekly Meetings/10-14-26 Weekly Update.md")] };
        },
        "Research/Weekly Meetings/10-14-26 Weekly Update.md is not a Monday Weekly Note in Research/Weekly Meetings",
      ],
    ];

    for (const [name, makePlan, reason] of cases) {
      test(name, () => {
        // #given
        const sandbox = makeSandbox();
        const dump = dumpFile(ORIGIN, "## Todos\n- [ ] #todo A.\n");
        writeVaultFile(sandbox, DUMP, dump);
        const plan = makePlan(sandbox);

        // #when
        const result = apply(sandbox, plan);

        // #then
        const created = ["Research/Main Notes/Orphan.md", "Research/Main Notes/Orphan.txt", NEW_WEEK, "Research/Weekly Meetings/10-14-26 Weekly Update.md"].filter(
          (note) => existsSync(join(sandbox.vault, note)),
        );
        expect([result.exitCode, result.stderr, readVaultFile(sandbox, DUMP), created]).toEqual([1, `brain-dump: Filing Plan rejected: ${reason}\n`, dump, []]);
      });
    }
  });

  test("rejects a new note whose tag contains a space", () => {
    // #given
    const sandbox = makeSandbox();

    // #when
    const result = apply(sandbox, { dump: DUMP, creates: [{ note: "X.md", tags: ["Two Words"] }], items: [] });

    // #then
    expect([result.exitCode, existsSync(join(sandbox.vault, "X.md"))]).toEqual([2, false]);
  });
});
