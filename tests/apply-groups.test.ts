import { describe, expect, test } from "bun:test";
import { DEV_ORIGIN as ORIGIN, dumpFile, makeSandbox, readVaultFile, run, type Sandbox, writeVaultFile } from "./harness.ts";

const DUMP = "Inbox/2026-10-05 1940 Brain-Dump - filing.md";
const WEEK = "Research/Weekly Meetings/10-05-26 Weekly Update.md";

function setup(note: string, todos = 1): Sandbox {
  const sandbox = makeSandbox();
  const body = Array.from({ length: todos }, (_, i) => `- [ ] #todo T${i + 1}.\n`).join("");
  writeVaultFile(sandbox, DUMP, dumpFile(ORIGIN, `## Todos\n${body}`));
  writeVaultFile(sandbox, WEEK, note);
  return sandbox;
}

function todoIn(index: number, group: string[], line = `- [ ] T${index}. #todo`) {
  return { index, outcome: "filed", note: WEEK, section: "# To-Do:", group, lines: [line] };
}

function apply(sandbox: Sandbox, plan: unknown) {
  return run(sandbox, ["apply"], { stdin: JSON.stringify({ dump: DUMP, inserts: [], ...(plan as object) }) });
}

describe("brain-dump apply into Todo Groups", () => {
  test("puts a Todo right under a group bullet that has no direct Todos, before its subgroups", () => {
    // #given
    const sandbox = setup("# To-Do:\n- Dissertation\n\t- IRB\n\t\t- [ ] Finish IRB application\n- SaTC\n\n---\n");

    // #when
    apply(sandbox, { items: [todoIn(1, ["Dissertation"])] });

    // #then
    expect(readVaultFile(sandbox, WEEK)).toBe(
      "# To-Do:\n- Dissertation\n\t- [ ] T1. #todo\n\t- IRB\n\t\t- [ ] Finish IRB application\n- SaTC\n\n---\n",
    );
  });

  test("puts a Todo after the group's last direct Todo and its detail bullets, ahead of a subgroup, matching the name loosely", () => {
    // #given
    const sandbox = setup("# To-Do:\n- MCP Paper:\n\t- [x] Look at venues\n\t\t- FORGE\n\t- Workshops\n\t\t- [ ] AGENT'27\n");

    // #when
    apply(sandbox, { items: [todoIn(1, ["mcp paper"])] });

    // #then
    expect(readVaultFile(sandbox, WEEK)).toBe(
      "# To-Do:\n- MCP Paper:\n\t- [x] Look at venues\n\t\t- FORGE\n\t- [ ] T1. #todo\n\t- Workshops\n\t\t- [ ] AGENT'27\n",
    );
  });

  test("puts a Todo into a nested group, after its last Todo", () => {
    // #given
    const sandbox = setup("# To-Do:\n- Sisyphus\n\t- CHRONOS\n\t\t- [ ] Ship phase 1\n\t- [ ] Team update\n- SaTC\n");

    // #when
    apply(sandbox, { items: [todoIn(1, ["Sisyphus", "CHRONOS"])] });

    // #then
    expect(readVaultFile(sandbox, WEEK)).toBe(
      "# To-Do:\n- Sisyphus\n\t- CHRONOS\n\t\t- [ ] Ship phase 1\n\t\t- [ ] T1. #todo\n\t- [ ] Team update\n- SaTC\n",
    );
  });

  test("creates a new two-level path in a fresh Weekly Note, filling the template's placeholder", () => {
    // #given
    const sandbox = setup("# To-Do: #todo \n- [ ] \n\n---\n# Notes:\n- \n");

    // #when
    apply(sandbox, { items: [todoIn(1, ["Sisyphus", "CHRONOS"])], createGroups: [["Sisyphus", "CHRONOS"]] });

    // #then
    expect(readVaultFile(sandbox, WEEK)).toBe("# To-Do: #todo \n- Sisyphus\n\t- CHRONOS\n\t\t- [ ] T1. #todo\n\n---\n# Notes:\n- \n");
  });

  test("creates a new subgroup after its parent's existing children, and a new top-level group at the end of the section", () => {
    // #given
    const sandbox = setup("# To-Do:\n- Dissertation\n\t- [ ] Update consent form\n\t- Surveys\n\t\t- [ ] Share questions\n- [ ] Loose\n\n---\n", 2);

    // #when
    apply(sandbox, {
      items: [todoIn(1, ["Dissertation", "IRB"]), todoIn(2, ["Lab Website"])],
      createGroups: [["Dissertation", "IRB"], ["Lab Website"]],
    });

    // #then
    expect(readVaultFile(sandbox, WEEK)).toBe(
      "# To-Do:\n- Dissertation\n\t- [ ] Update consent form\n\t- Surveys\n\t\t- [ ] Share questions\n\t- IRB\n\t\t- [ ] T1. #todo\n- [ ] Loose\n- Lab Website\n\t- [ ] T2. #todo\n\n---\n",
    );
  });

  test("files two Todos into the same new group, creating it once", () => {
    // #given
    const sandbox = setup("# To-Do:\n- SaTC\n", 2);

    // #when
    apply(sandbox, { items: [todoIn(1, ["Brain Dump"]), todoIn(2, ["Brain Dump"])], createGroups: [["Brain Dump"]] });

    // #then
    expect(readVaultFile(sandbox, WEEK)).toBe("# To-Do:\n- SaTC\n- Brain Dump\n\t- [ ] T1. #todo\n\t- [ ] T2. #todo\n");
  });
});

describe("brain-dump apply rejects a Todo Group plan and writes nothing", () => {
  const NOTE = "# To-Do:\n- Dissertation\n\t- [ ] Update consent form\n- SaTC\n- Dissertation\n";

  function rejection(plan: unknown, todos = 1) {
    const sandbox = setup(NOTE, todos);
    const dump = readVaultFile(sandbox, DUMP);
    const result = apply(sandbox, plan);
    return { exitCode: result.exitCode, stderr: result.stderr, untouched: readVaultFile(sandbox, WEEK) === NOTE && readVaultFile(sandbox, DUMP) === dump };
  }

  test("a path that does not exist and is not in createGroups", () => {
    // #when
    const result = rejection({ items: [todoIn(1, ["Disertation"])] });

    // #then
    expect(result).toEqual({
      exitCode: 1,
      stderr: `brain-dump: Filing Plan rejected: ${WEEK} has no Todo Group "Disertation"\n`,
      untouched: true,
    });
  });

  test("a path that matches two bullets", () => {
    // #when
    const result = rejection({ items: [todoIn(1, ["dissertation:"])] });

    // #then
    expect(result).toEqual({
      exitCode: 1,
      stderr: `brain-dump: Filing Plan rejected: "dissertation:" matches lines 2 and 5 of ${WEEK}\n`,
      untouched: true,
    });
  });

  test("a createGroups entry that already exists", () => {
    // #when
    const result = rejection({ items: [todoIn(1, ["SaTC"])], createGroups: [["SaTC"]] });

    // #then
    expect(result).toEqual({
      exitCode: 1,
      stderr: `brain-dump: Filing Plan rejected: Todo Group "SaTC" already exists in ${WEEK}\n`,
      untouched: true,
    });
  });

  test("a createGroups entry no Todo is filed into", () => {
    // #when
    const result = rejection({ items: [todoIn(1, ["SaTC"])], createGroups: [["Lab Website"]] });

    // #then
    expect(result).toEqual({
      exitCode: 1,
      stderr: 'brain-dump: Filing Plan rejected: Todo Group "Lab Website" would be created with nothing filed into it\n',
      untouched: true,
    });
  });

  test("a group on a Todo with no section", () => {
    // #when
    const result = rejection({ items: [{ index: 1, outcome: "filed", note: WEEK, group: ["SaTC"], lines: ["- [ ] T1. #todo"] }] });

    // #then
    expect([result.exitCode, result.untouched]).toEqual([2, true]);
  });
});

describe("brain-dump apply remembers group Routes", () => {
  test("appends a new group Route to the Routes note, skipping one already there", () => {
    // #given
    const sandbox = setup("# To-Do:\n- Brain Dump\n");
    writeVaultFile(sandbox, "Inbox/Filing Routes.md", "SaTC → To-Do › SaTC\n");

    // #when
    apply(sandbox, {
      items: [todoIn(1, ["Brain Dump"])],
      routes: [{ key: "SaTC", group: ["satc"] }, { key: "Brain-Dump", group: ["Brain Dump"] }],
    });

    // #then
    expect(readVaultFile(sandbox, "Inbox/Filing Routes.md")).toBe("SaTC → To-Do › SaTC\nBrain-Dump → To-Do › Brain Dump\n");
  });
});
